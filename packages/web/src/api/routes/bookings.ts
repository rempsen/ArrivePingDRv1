import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { assignJob } from "../../services/assign";
import { findAvailabilityBlock } from "../../services/availability";
import { accrueTechPay, recomputeBooking } from "../../services/billing";
import {
  applyBookingStatus,
  resumeClock,
  StatusTransitionError,
} from "../../services/booking-status";
import {
  changeStateFor,
  requestCancel,
  requestReschedule,
  serializeState,
} from "../../services/change-requests";
import { companyTimeZone } from "../../services/company-tz";
import { onChecklistTicked } from "../../services/custom-milestones";
import { fireEvent } from "../../services/dispatch";
import { isFeatureOn } from "../../services/features";
import { sendFormCopy } from "../../services/form-copy";
import { forwardGeocode } from "../../services/geocode";
import { jobTimeline, logJobEvent } from "../../services/job-events";
import { buildOfferPreview } from "../../services/job-offer";
import {
  answeredCountFor,
  closeJobForm,
  currentVersion,
  isInternalItem,
  missingForJob,
  reopenJobForm,
  versionFormFor,
} from "../../services/job-forms";
import { reconcileRiderStatus } from "../../services/presence";
import { linkBookingToProperty } from "../../services/properties";
import { publishDispatch, publishTrack } from "../../services/realtime";
import { deleteSignatureObject } from "../../services/signatures";
import {
  isOwnVoiceNote,
  parseMeta,
  removeVoiceNoteLine,
  voiceNoteKey,
} from "../../services/voice-notes";
import {
  checkServiceZone,
  OUTSIDE_ZONE_MESSAGE,
  OUTSIDE_ZONE_MESSAGE_ADMIN,
} from "../../services/zones";
import { isTerminalStatus } from "../../shared/job-status";
import { DECLINE_REASONS, declineDetail, type DeclineReason } from "../../shared/offer";
import { fmtInZone, zonedDayBounds } from "../../shared/tz";
import { sdb } from "../database";
import * as schema from "../database/schema";
import { tdb } from "../database/tenant";
import type { AppEnv } from "../env";
import { capture } from "../lib/analytics";
import { Err } from "../lib/errors";
import { mergeInternalFieldData, publicFieldData } from "../lib/field-data";
import {
  attachMembership,
  findCompanyUserByEmail,
  findUserByEmail,
  isMember,
} from "../lib/memberships";
import { incr } from "../lib/metrics";
import { deleteObject, putObject } from "../lib/storage";
import {
  bookingStatus,
  durationMins as durationField,
  email,
  id as idField,
  isoDate,
  jsonBlob,
  jsonBody,
  jsonObject,
  latitude,
  longitude,
  longText,
  phone,
  priority as priorityField,
  rating as ratingField,
  shortText,
} from "../lib/validate";
import { officeCan, requireAuth, tenantId, tx } from "../middleware/auth";
import { techPayModelJson } from "./templates";

type SessionUser = { id: string; role?: string; email: string; name: string };

/**
 * Best-effort speech-to-text for tech voice notes. Uses the AI gateway's
 * OpenAI-compatible transcription endpoint when configured. Returns "" on any
 * failure — the audio itself is always kept, the transcript is a convenience.
 */
async function transcribeAudio(
  bytes: Buffer,
  filename: string,
  mime?: string,
): Promise<string> {
  const base = process.env.AI_GATEWAY_BASE_URL;
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!base || !key) return "";
  try {
    const fd = new FormData();
    fd.append(
      "file",
      new Blob([new Uint8Array(bytes)], { type: mime || "audio/m4a" }),
      filename,
    );
    fd.append("model", process.env.AI_TRANSCRIBE_MODEL || "openai/whisper-1");
    const res = await fetch(`${base.replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return "";
    const json = (await res.json()) as { text?: string };
    return String(json?.text || "").trim();
  } catch (e) {
    console.error("[voice-note] transcription failed", e);
    return "";
  }
}

/**
 * Convert a Form Builder template's `fields` (text/number/checkbox/select/
 * photo/signature/date) into the `_customFields` shape the work-order modal
 * and mobile job screen already know how to render and fill in. This is what
 * actually connects templates to real work orders — previously a template's
 * fields were saved but never read back anywhere once a booking was created.
 * "photo" and "signature" both map to "file" (the existing attach-a-file
 * type); there's no dedicated signature capture yet, tracked separately.
 */
function templateFieldsToCustomFields(
  rawFields: string | null | undefined,
): any[] {
  let parsed: any[] = [];
  try {
    parsed = JSON.parse(rawFields || "[]");
  } catch {
    parsed = [];
  }
  if (!Array.isArray(parsed)) return [];
  const TYPE_MAP: Record<string, string> = {
    text: "text",
    number: "number",
    checkbox: "checkbox",
    select: "select",
    date: "date",
    photo: "file",
    signature: "file",
  };
  return parsed
    .filter((f) => f && f.type && TYPE_MAP[f.type])
    .map((f) => ({
      id: `tpl_${Math.random().toString(36).slice(2, 10)}`,
      type: TYPE_MAP[f.type],
      label: f.label || "",
      required: !!f.required,
      // checkbox fields carry their list of items too (dropping them left a
      // "Checklist" with nothing to tick on the job)
      ...(f.type === "select" || f.type === "checkbox"
        ? { options: Array.isArray(f.options) ? f.options : [] }
        : {}),
    }));
}

// status -> notification mapping

/** The shape every booking endpoint returns. Unchanged from the original
 *  per-row `enrich()` — batching must not alter the contract, because 10
 *  call sites (including the mobile app) already consume it. */
type EnrichedBooking = typeof schema.bookings.$inferSelect & {
  service: any;
  rider: any;
  customer: { id: string; name: any; phone: any; email: any } | null;
};

/**
 * Batched enrichment — 4 queries TOTAL regardless of row count.
 *
 * This replaces a per-booking `enrich()` that issued up to 4 SEQUENTIAL queries
 * for every row (service → rider → rider's user → customer). Against a remote
 * Turso instance that measured 822 ms / ~50 round trips for just 14 bookings and
 * scaled linearly — a tenant with a few hundred jobs would have timed out.
 *
 * Pattern copied from `job-search.ts`'s `enrichRows()`, which already did this
 * correctly. Output is byte-for-byte the same as the old per-row version.
 *
 * Tenant safety: `services` and `riders` are tenant-owned, so those lookups go
 * through `tdb(companyId)` and stay company-scoped. `user` IS tenant-owned
 * too (see database/tenant.ts), but this batch can legitimately span several
 * companies at once (system paths), so it is read by explicit id list on the
 * `sdb` system connection rather than one `tdb(cid)` call per company.
 */
async function enrichMany(
  rows: (typeof schema.bookings.$inferSelect)[],
): Promise<EnrichedBooking[]> {
  if (!rows.length) return [];

  // Fallback used if the batch fails — never let enrichment crash a whole list.
  const bare = (): EnrichedBooking[] =>
    rows.map((b) => ({
      ...b,
      fieldData: publicFieldData(b.fieldData),
      service: null,
      rider: null,
      customer: null,
    }));

  try {
    // Rows can span companies only via system paths; group defensively so the
    // tenant-scoped lookups stay correct either way.
    const companyIds = [
      ...new Set(rows.map((r) => r.companyId).filter(Boolean)),
    ];

    const svcIds = [
      ...new Set(rows.map((r) => r.serviceId).filter((v): v is string => !!v)),
    ];
    const riderIds = [
      ...new Set(rows.map((r) => r.riderId).filter((v): v is string => !!v)),
    ];
    const custIds = [
      ...new Set(rows.map((r) => r.customerId).filter((v): v is string => !!v)),
    ];

    // 1) services — tenant-scoped, one query per company (normally exactly one)
    const svcMap = new Map<string, any>();
    if (svcIds.length) {
      await Promise.all(
        companyIds.map(async (cid) => {
          const found = await tdb(cid)
            .select(schema.services, inArray(schema.services.id, svcIds))
            .catch(() => []);
          found.forEach((s: any) => svcMap.set(s.id, s));
        }),
      );
    }

    // 2) riders — tenant-scoped
    const riderRows: any[] = [];
    if (riderIds.length) {
      await Promise.all(
        companyIds.map(async (cid) => {
          const found = await tdb(cid)
            .select(schema.riders, inArray(schema.riders.id, riderIds))
            .catch(() => []);
          riderRows.push(...found);
        }),
      );
    }

    // 3) users — GLOBAL table; one query covers both rider users and customers
    const userIds = [
      ...new Set([
        ...riderRows.map((r) => r.userId).filter(Boolean),
        ...custIds,
      ]),
    ] as string[];
    const userMap = new Map<string, any>();
    if (userIds.length) {
      const us = await sdb
        .select()
        .from(schema.user)
        .where(inArray(schema.user.id, userIds))
        .catch(() => []);
      us.forEach((u: any) => userMap.set(u.id, u));
    }

    const riderMap = new Map<string, any>();
    riderRows.forEach((r) => {
      const ru = userMap.get(r.userId);
      riderMap.set(r.id, { ...r, name: ru?.name, phone: ru?.phone });
    });

    return rows.map((b) => {
      const cust = b.customerId ? userMap.get(b.customerId) : undefined;
      return {
        ...b,
        // never ship server-internal keys (Live Activity push tokens) to clients
        fieldData: publicFieldData(b.fieldData),
        service: (b.serviceId ? svcMap.get(b.serviceId) : null) ?? null,
        rider: b.riderId ? (riderMap.get(b.riderId) ?? null) : null,
        customer: cust
          ? {
              id: cust.id,
              name: cust.name,
              phone: cust.phone,
              email: cust.email,
            }
          : null,
      };
    });
  } catch (err) {
    console.error("[enrichMany] batch failed, returning unenriched rows", err);
    return bare();
  }
}

/** Single-row convenience wrapper. Same contract as before. */
async function enrich(b: typeof schema.bookings.$inferSelect) {
  const [one] = await enrichMany([b]);
  return (
    one ?? {
      ...b,
      fieldData: publicFieldData(b.fieldData),
      service: null,
      rider: null,
      customer: null,
    }
  );
}

async function enrichById(companyId: string, id: string) {
  const fresh = await tdb(companyId).selectOne(
    schema.bookings,
    eq(schema.bookings.id, id),
  );
  if (!fresh) throw new Error(`Booking ${id} not found`);
  return enrich(fresh);
}

/* -------------------------------------------------------------------------- */
/*  Request schemas                                                            */
/* -------------------------------------------------------------------------- */
/**
 * These routes previously wrote `await c.req.json()` straight into the
 * bookings table. The consequences were not theoretical:
 * - `POST /:id/status` accepted ANY string, so a typo'd or hand-crafted status
 *   ("Completed", "done", "<script>") was written to the row. Every screen and
 *   every dispatch rule keys off that value, and none of them match it again.
 * - `POST /:id/review` accepted any rating, so `rating: 500` sailed into the
 *   reviews table and straight through the technician's rating average.
 * - Anything doing `new Date(body.scheduledAt)` produced an Invalid Date on
 *   garbage input and stored it, breaking the row on every calendar view.
 * - fieldData / rateModel / lineItems were JSON.stringify'd with no size limit.
 *
 * Unknown keys are stripped rather than rejected (several clients send extras),
 * which also removes the mass-assignment surface on the PATCH route.
 */

/** Fields shared by the customer-facing and admin work-order create routes. */
const BookingCore = {
  serviceId: idField("Service"),
  templateId: idField("Template").nullish(),
  title: shortText("Title", 200).optional(),
  priority: priorityField.optional(),
  scheduledAt: isoDate("Schedule date"),
  address: shortText("Address", 500),
  lat: latitude.optional(),
  lng: longitude.optional(),
  notes: longText(10_000).optional(),
  staffNotes: longText(10_000).optional(),
  region: shortText("Region", 120).optional().or(z.literal("")),
  phone: phone.optional(),
  fieldData: jsonObject().optional(),
  rateModel: jsonBlob().optional(),
  lineItems: z.array(z.unknown()).max(500, "Too many line items").optional(),
  requiredSkillClass: shortText("Skill class", 120)
    .optional()
    .or(z.literal("")),
  requiredSkills: z
    .union([z.string().max(2_000), z.array(z.string().max(120)).max(50)])
    .optional(),
};

const BookingCreate = z.object(BookingCore);

const BookingAdminCreate = z
  .object({
    ...BookingCore,
    // An existing client, OR (when the office typed someone new into the
    // combobox) a name + email to find-or-create one from. Exactly one of
    // these two paths is valid — enforced below.
    customerId: idField("Client").optional(),
    customerName: shortText("Customer name", 200).optional(),
    customerEmail: email("Customer email").optional(),
    riderId: idField("Technician").nullish(),
    status: bookingStatus.optional(),
    /** How this job pays the technician (TechPayModel); omitted = the template's. */
    techPayModel: z.unknown().optional(),
    /** "on_site" = the technician collects payment in the field; omitted = the template's. */
    collectPayment: z.enum(["", "on_site"]).optional(),
    /** Book it anyway: the tech is already out on a job then, or has time off. */
    force: z.boolean().optional(),
  })
  .refine(
    (d) => !!d.customerId || (!!d.customerName?.trim() && !!d.customerEmail),
    {
      message:
        "Select an existing client, or enter a name and email to add a new one",
      path: ["customerId"],
    },
  );

/** Every field is optional, but a present field must still be the right shape. */
const BookingPatch = z
  .object({
    title: shortText("Title", 200),
    priority: priorityField,
    address: shortText("Address", 500),
    notes: longText(10_000),
    staffNotes: longText(10_000),
    customerId: idField("Client"),
    serviceId: idField("Service"),
    templateId: idField("Template").nullable().or(z.literal("")),
    region: shortText("Region", 120).or(z.literal("")),
    lat: latitude,
    lng: longitude,
    customerPhone: phone,
    // Best-effort correction to the client's own CRM email (not a per-booking
    // snapshot like customerPhone) — lets the office fix a typo or fill one
    // in that was missing, without ever being allowed to steal someone
    // else's login (silently ignored on a unique-email collision).
    customerEmail: email("Customer email"),
    scheduledAt: z.union([isoDate("Schedule date"), z.literal("")]),
    /** Minutes this job is booked for; null goes back to the service's length. */
    durationMins: durationField.nullable(),
    rateModel: jsonBlob(),
    lineItems: z.array(z.unknown()).max(500, "Too many line items"),
    requiredSkillClass: shortText("Skill class", 120).or(z.literal("")),
    requiredSkills: z.union([
      z.string().max(2_000),
      z.array(z.string().max(120)).max(50),
    ]),
    fieldData: jsonObject(),
    riderId: idField("Technician").nullable().or(z.literal("")),
    techPayModel: z.unknown(),
    collectPayment: z.enum(["", "on_site"]),
    /** Save it anyway when the new tech/time double-books somebody. */
    force: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

const ScheduleBody = z.object({
  scheduledAt: isoDate("Schedule date"),
  /** Move it anyway, onto time the assigned tech is already booked for. */
  force: z.boolean().optional(),
});
const AssignBody = z.object({
  riderId: idField("Technician"),
  /** Explicit dispatcher confirmation to pull a tech off a job they're working. */
  force: z.boolean().optional(),
});
const StatusBody = z.object({ status: bookingStatus });
const ReviewBody = z.object({
  rating: ratingField,
  comment: longText(4_000).optional(),
});
const ChecklistBody = z.object({
  index: z
    .number({ message: "Index must be a number" })
    .int("Index must be a whole number")
    .min(0, "Index must be 0 or greater"),
  done: z.boolean({ message: "Done must be true or false" }),
});
const DriverNotesBody = z.object({ notes: longText(10_000).default("") });

/**
 * Signature capture. The route already hand-guarded the point count, but the
 * stroke array itself was unchecked `any[][][]` — a stroke of non-numbers
 * rendered `MNaN NaN` into the stored SVG.
 */
const SignatureBody = z.object({
  strokes: z
    .array(
      z.array(z.tuple([z.number().finite(), z.number().finite()])).max(20_000),
    )
    .min(1, "Signature is empty")
    .max(500, "Too many strokes"),
  width: z.number().finite().min(1).max(10_000).optional(),
  height: z.number().finite().min(1).max(10_000).optional(),
  name: shortText("Printed name", 120),
});
/**
 * Declining an offer. Current apps send a fixed `code` (DECLINE_REASONS in
 * shared/offer.ts) and an optional `note`; older apps and the web tech app
 * send free text in `reason`, which is kept as written.
 */
const DeclineBody = z.object({
  reason: longText(2_000).optional().default(""),
  // Unknown codes (an older app's list) read as "other" rather than failing.
  code: z
    .string()
    .max(40)
    .optional()
    .transform((v) => (v === undefined ? undefined : (DECLINE_REASONS as readonly string[]).includes(v) ? (v as DeclineReason) : ("other" as const))),
  note: longText(2_000).optional().default(""),
});

/** Customer-initiated appointment changes (see shared/change-policy.ts). */
const RescheduleRequestBody = z.object({
  scheduledAt: isoDate("New appointment time"),
  reason: longText(2_000).optional().default(""),
});
const CancelRequestBody = z.object({
  reason: longText(2_000).optional().default(""),
});

/**
 * May the caller act on this job's offer? The tech it's offered to may, and so
 * may the office (accepting or declining on a tech's behalf). Anyone else in
 * the tenant may not: without this, any signed-in user could accept or
 * decline someone else's offer.
 */
async function offerHolder(
  c: Context<AppEnv>,
  b: { riderId: string | null },
): Promise<{ allowed: boolean; isHolder: boolean; rider: typeof schema.riders.$inferSelect | null }> {
  const u = c.get("user") as SessionUser;
  const rider = (b.riderId ? await tx(c).selectOne(schema.riders, eq(schema.riders.id, b.riderId)) : null) ?? null;
  if (rider && rider.userId === u.id) return { allowed: true, isHolder: true, rider };
  return { allowed: await officeCan(u, "work_orders:edit"), isHolder: false, rider };
}

/**
 * Why a tech is dropping a job they already ACCEPTED. Fixed list (so the office
 * can count patterns per tech / per reason) plus an optional free-text note for
 * the detail a dropdown can never capture.
 */
export const RELEASE_REASONS = [
  "emergency",
  "vehicle",
  "running_late",
  "missing_parts",
  "unsafe_site",
  "wrong_skills",
  "other",
] as const;
export const RELEASE_REASON_LABELS: Record<
  (typeof RELEASE_REASONS)[number],
  string
> = {
  emergency: "Personal emergency",
  vehicle: "Vehicle breakdown",
  running_late: "Running too late to make it",
  missing_parts: "Missing parts or equipment",
  unsafe_site: "Unsafe site conditions",
  wrong_skills: "Wrong skill set for this job",
  other: "Other",
};
const ReleaseBody = z.object({
  reason: z.enum(RELEASE_REASONS, {
    error: "Pick a reason for releasing this job",
  }),
  note: longText(2_000).optional().default(""),
});

/**
 * Job stages a tech may still hand back. "offered" is deliberately excluded —
 * an un-accepted offer is a Decline, which is a different (routine) event.
 * Once work is finished or the job is dead there is nothing to release.
 */
const RELEASABLE_STATUSES = [
  "assigned",
  "confirmed",
  "enroute",
  "arrived",
  "onsite",
  "in_progress",
  "paused",
] as const;

export const bookingsRoutes = new Hono<AppEnv>()
  // list for current user (customer sees own, rider sees assigned, admin sees all)
  /**
   * List bookings for the current user (customer sees own, rider sees assigned,
   * admin sees all).
   *
   * Pagination is OPT-IN via `?page` / `?pageSize`, deliberately. Several
   * existing consumers (admin dashboard, scheduler, rider earnings) aggregate
   * over the WHOLE result set to compute revenue and counts — silently
   * defaulting to page 1 would have made those totals quietly wrong, which is a
   * worse bug than the one being fixed.
   *
   * Instead:
   *  - enrichment is now batched for everyone (the actual N+1 fix), and
   *  - an unpaginated read is hard-capped at MAX_LIST rows and reports
   *    `truncated: true` so it can never become an unbounded fetch.
   *
   * Extra response fields (`total`, `page`, `pageSize`, `pages`, `truncated`)
   * are additive — existing callers that only read `bookings` are unaffected.
   */
  .get("/", requireAuth, async (c) => {
    const u = c.get("user") as SessionUser;
    const t = tx(c);

    /** Absolute ceiling for an unpaginated read. */
    const MAX_LIST = 2000;

    const rawPage = Number(c.req.query("page"));
    const rawSize = Number(c.req.query("pageSize"));
    const paginated = Number.isFinite(rawPage) && rawPage >= 1;
    const page = paginated ? Math.floor(rawPage) : 1;
    const pageSize = Math.min(
      Math.max(
        Number.isFinite(rawSize) && rawSize >= 1 ? Math.floor(rawSize) : 50,
        1,
      ),
      200,
    );

    // Build the same visibility predicate the old code expressed with branches.
    let where: SQL | undefined;
    if (await officeCan(u, "work_orders:view")) {
      where = isNull(schema.bookings.deletedAt);
    } else if (u.role === "rider") {
      const rp = await t.selectOne(
        schema.riders,
        eq(schema.riders.userId, u.id),
      );
      // No rider profile → no jobs. Preserves the previous `[]` behaviour.
      if (!rp) {
        return c.json(
          {
            bookings: [],
            total: 0,
            page,
            pageSize,
            pages: 0,
            truncated: false,
          },
          200,
        );
      }
      // isNull(deletedAt) matters as much here as it does for admins: without
      // it a soft-deleted work order stayed in the tech's list forever and was
      // counted in their Earnings history (found live — one deleted job was
      // padding a driver's completed-jobs list).
      where = and(
        eq(schema.bookings.riderId, rp.id),
        isNull(schema.bookings.deletedAt),
      );
    } else {
      where = and(
        eq(schema.bookings.customerId, u.id),
        isNull(schema.bookings.deletedAt),
      );
    }

    const scoped = t.scope(schema.bookings, where);

    // Hand-written COUNT + orderBy/limit/offset query — runs inside
    // t.transaction() so the RLS session var (app.tenant_id) is actually set
    // for these raw builder calls, same pattern as job-events.ts/reviews.ts.
    const { total, rows } = await t.transaction(async (tx) => {
      // Total via COUNT(*) rather than fetching rows to count them.
      const countQ = tx
        .select({ n: sql<number>`count(*)` })
        .from(schema.bookings);
      const [countRow] = await (scoped ? countQ.where(scoped) : countQ);
      const n = countRow?.n ?? 0;

      // Sort in SQL (was an in-memory sort over every row).
      const baseQ = tx
        .select()
        .from(schema.bookings)
        .orderBy(desc(schema.bookings.createdAt));
      const withWhere = scoped ? baseQ.where(scoped) : baseQ;

      const limit = paginated ? pageSize : MAX_LIST;
      const offset = paginated ? (page - 1) * pageSize : 0;
      const r = (await withWhere
        .limit(limit)
        .offset(offset)) as (typeof schema.bookings.$inferSelect)[];
      return { total: n, rows: r };
    });

    const truncated = !paginated && Number(total) > MAX_LIST;
    if (truncated) {
      console.warn(
        `[bookings] unpaginated read truncated at ${MAX_LIST} of ${total} rows ` +
          `(company=${t.companyId}) — this caller should paginate`,
      );
    }

    const enriched = await enrichMany(rows);
    return c.json(
      {
        bookings: enriched,
        total: Number(total),
        page,
        pageSize: paginated ? pageSize : rows.length,
        pages: paginated ? Math.ceil(Number(total) / pageSize) : 1,
        truncated,
      },
      200,
    );
  })
  // ── Today's stats for the logged-in tech ────────────────────────────────
  // GET /api/bookings/today-stats
  //
  // MUST stay above `/:id`. Hono matches in registration order, and this route
  // used to be declared at the very bottom of the file — so `/:id` swallowed it
  // and every call returned 404 "Not found" with `id = "today-stats"`. The
  // driver app treats a non-ok response as zeros, so the home screen showed
  // 0 jobs / $0 earnings for every technician, always.
  // Returns { jobsDone, earnings, activeJobs, totalToday } for the tenant's
  // local day.
  .get("/today-stats", requireAuth, async (c) => {
    const u = c.get("user") as SessionUser;
    const t = tx(c);
    // find rider record for this user
    const rider = await t.selectOne(
      schema.riders,
      eq(schema.riders.userId, u.id),
    );
    if (!rider) return c.json({ jobsDone: 0, earnings: 0, activeJobs: 0 }, 200);
    // Practice and sample jobs are pretend work: they don't count toward the day.
    const all = await t.select(
      schema.bookings,
      and(
        eq(schema.bookings.riderId, rider.id),
        eq(schema.bookings.isSample, false),
      ),
    );
    // "Today" is the tenant's local day, not the server's. setHours() here ran
    // in the process time zone (UTC in production), so for a Winnipeg tenant
    // the window rolled over at 19:00 local: the tech's completed jobs and
    // earnings for the day disappeared from their phone mid-evening, and an
    // evening job counted toward tomorrow.
    const tz = await companyTimeZone(tenantId(c));
    const { start: todayStart, end: todayEnd } = zonedDayBounds(new Date(), tz);
    const todayJobs = all.filter((b) => {
      const d = b.scheduledAt ? new Date(b.scheduledAt) : null;
      return d && d >= todayStart && d <= todayEnd;
    });
    const jobsDone = todayJobs.filter((b) => b.status === "completed").length;
    // "Earnings" is what the TECH takes home — the job's tech pay — not the
    // customer-facing price (Dan, 2026-10-06). Shows $0 until dispatch fills
    // tech pay in on the job.
    const earnings = todayJobs
      .filter((b) => b.status === "completed")
      .reduce((sum, b) => sum + (Number((b as any).techPay) || 0), 0);
    const activeJobs = todayJobs.filter((b) =>
      ["assigned", "enroute", "arrived", "in_progress"].includes(b.status),
    ).length;
    return c.json(
      { jobsDone, earnings, activeJobs, totalToday: todayJobs.length },
      200,
    );
  })
  .get("/:id", requireAuth, async (c) => {
    const b = await tx(c).selectOne(
      schema.bookings,
      eq(schema.bookings.id, c.req.param("id")),
    );
    if (!b) return c.json({ message: "Not found" }, 404);
    return c.json({ booking: await enrich(b) }, 200);
  })
  // create a booking (customer)
  .post("/", requireAuth, jsonBody(BookingCreate), async (c) => {
    const u = c.get("user") as SessionUser;
    const co = tenantId(c);
    const t = tx(c);
    const body = c.req.valid("json");
    const svc = await t.selectOne(
      schema.services,
      eq(schema.services.id, body.serviceId),
    );
    if (!svc) return c.json({ message: "Service not found" }, 404);

    const cu = await t.selectOne(schema.user, eq(schema.user.id, u.id));

    // Resolve real coordinates for the address. The lat/lng columns are NOT NULL
    // with a downtown-Toronto default, so a create with no coordinates used to
    // record the job at 43.6532,-79.3832 — visible on the fleet map, feeding
    // distance/ETA, and skipping the zone check below. If we still can't resolve
    // them we do NOT invent a location and we do NOT zone-check on a guess.
    const geo =
      body.lat != null && body.lng != null
        ? { lat: body.lat, lng: body.lng }
        : await forwardGeocode(body.address);

    // Zone enforcement — the customer path had NONE, so a customer far outside
    // every active zone got a confirmed booking, an invoice and a dispatch.
    if (geo) {
      const zone = await checkServiceZone(co, geo.lat, geo.lng);
      if (!zone.ok) return c.json({ message: OUTSIDE_ZONE_MESSAGE }, 422);
    }

    const [b] = await t.insert(schema.bookings, {
      customerId: u.id,
      serviceId: body.serviceId,
      templateId: body.templateId ?? null,
      title: body.title ?? svc.name,
      priority: body.priority ?? "normal",
      status: "confirmed",
      scheduledAt: new Date(body.scheduledAt),
      address: body.address,
      lat: geo?.lat ?? 43.6532,
      lng: geo?.lng ?? -79.3832,
      notes: body.notes ?? "",
      staffNotes: (body as any).staffNotes ?? "",
      fieldData: body.fieldData ? JSON.stringify(body.fieldData) : "{}",
      customerPhone: body.phone ?? cu?.phone ?? "",
      region: body.region ?? "",
      rateModel: body.rateModel ? JSON.stringify(body.rateModel) : "",
      lineItems: Array.isArray(body.lineItems)
        ? JSON.stringify(body.lineItems)
        : "",
      requiredSkillClass: (body as any).requiredSkillClass ?? "",
      requiredSkills: (body as any).requiredSkills ?? "",
      price: svc.basePrice,
    });
    if (!b) throw new Error("Failed to insert booking");

    // compute estimate from rate model + region (no actuals yet -> uses included-only quote)
    const bill = await recomputeBooking(co, b.id);

    // create invoice (unpaid)
    const num = `INV-${Date.now().toString().slice(-6)}`;
    const amount = bill?.subtotal ?? svc.basePrice;
    // No hardcoded 0.13 fallback: recomputeBooking() only returns null when the
    // booking we just inserted can't be read back, and inventing Ontario HST for
    // a Calgary customer is worse than invoicing tax-free and letting the office
    // recompute. bill is the only source of tax.
    const tax = bill?.taxAmount ?? 0;
    await t.insert(schema.invoices, {
      bookingId: b.id,
      customerId: u.id,
      number: num,
      amount,
      tax,
      total: bill?.total ?? +(amount + tax).toFixed(2),
    });

    // Attach to the property record for this address (creates it on first
    // job there). Best-effort — a failure here must not fail the booking.
    await linkBookingToProperty(b.id);

    // fire "created" event through the configurable dispatch engine
    await fireEvent("created", b.id);

    incr("bookings_created_total");
    capture("booking.created", co, {
      bookingId: b.id,
      serviceId: body.serviceId,
      source: "customer",
    });

    return c.json({ booking: await enrichById(co, b.id) }, 201);
  })
  // admin creates a work order on behalf of a client
  .post("/admin", requireAuth, jsonBody(BookingAdminCreate), async (c) => {
    const u = c.get("user") as SessionUser;
    if (!(await officeCan(u, "work_orders:create")))
      return c.json({ message: "Forbidden" }, 403);
    const body = c.req.valid("json");

    const co = tenantId(c);
    const t = tx(c);
    const svc = await t.selectOne(
      schema.services,
      eq(schema.services.id, body.serviceId),
    );
    if (!svc) return c.json({ message: "Service not found" }, 404);

    // Resolve the client: either an existing one picked from the combobox, or
    // find-or-create one from the name/email the office typed for someone
    // new. Never creates a duplicate — email is the identity key, and
    // `attachMembership` is idempotent (see lib/memberships.ts):
    //   - already on THIS company's roster (any role)         -> reuse as-is
    //   - has a login elsewhere (another company, or a rider/
    //     installer account here) but not on this roster yet  -> reuse the
    //     one global login, just add a "customer" membership so they show up
    //     on this company's client list too
    //   - genuinely new email                                 -> create it
    let cu: typeof schema.user.$inferSelect | undefined;
    if (body.customerId) {
      cu = await t.selectOne(schema.user, eq(schema.user.id, body.customerId));
      if (!cu) return c.json({ message: "Client not found" }, 404);
      // Office corrected/filled in the email while an existing client was
      // selected. Best-effort — never blocks the booking on a collision.
      if (body.customerEmail && body.customerEmail !== cu.email) {
        const updated = await t
          .update(
            schema.user,
            { email: body.customerEmail },
            eq(schema.user.id, cu.id),
          )
          .catch(() => [] as (typeof schema.user.$inferSelect)[]);
        if (updated[0]) cu = updated[0];
      }
    } else {
      const newEmail = body.customerEmail!;
      const newName = body.customerName!.trim();
      cu = (await findCompanyUserByEmail(newEmail, co)) ?? undefined;
      if (!cu) {
        const globalMatch = await findUserByEmail(newEmail);
        if (globalMatch) {
          await attachMembership({
            userId: globalMatch.id,
            companyId: co,
            role: "customer",
            status: "active",
          });
          cu = globalMatch;
        } else {
          const created = await t
            .insert(schema.user, {
              id: crypto.randomUUID(),
              name: newName,
              email: newEmail,
              role: "customer",
              phone: body.phone || null,
              address: body.address || null,
            })
            .catch(() => [] as (typeof schema.user.$inferSelect)[]);
          cu = created[0];
          if (!cu)
            return c.json(
              {
                message:
                  "Couldn't create that customer — check the email address",
              },
              422,
            );
          await attachMembership({
            userId: cu.id,
            companyId: co,
            role: "customer",
            status: "active",
          });
        }
      }
    }

    // riderId is a foreign key too, and unlike serviceId/customerId it was
    // never resolved — a bogus technician id was a bare 500 on the FK.
    if (body.riderId) {
      const rd = await t.selectOne(
        schema.riders,
        eq(schema.riders.id, body.riderId),
      );
      if (!rd) return c.json({ message: "Technician not found" }, 404);
    }

    // Booking a brand-new job straight onto a tech who is already out on one at
    // that hour (or has the day off) was accepted without a word.
    if (body.riderId && !body.force) {
      const busy = await findAvailabilityBlock(co, {
        riderId: body.riderId,
        scheduledAt: new Date(body.scheduledAt),
        serviceId: body.serviceId,
      });
      if (busy)
        return c.json(
          { message: busy.message, reason: busy.kind, forceable: true },
          409,
        );
    }

    // Coordinates + zone enforcement, identical logic to the customer path
    // (services/zones.ts) so the two can't drift. Geocode when the office typed
    // an address without picking a suggestion, instead of defaulting to Toronto.
    const geo =
      body.lat != null && body.lng != null
        ? { lat: body.lat, lng: body.lng }
        : await forwardGeocode(body.address);
    if (geo) {
      const zone = await checkServiceZone(co, geo.lat, geo.lng);
      if (!zone.ok) return c.json({ message: OUTSIDE_ZONE_MESSAGE_ADMIN }, 422);
    }

    // Seed field data + checklist from the chosen template. The admin modal
    // already lets the office add/edit custom fields before saving (sent as
    // body.fieldData._customFields) — if it did, that's authoritative (it may
    // include office edits on top of the template's defaults). Otherwise, if
    // a template is selected, seed both from it so templates actually DO
    // something on a real work order instead of being write-only.
    let fieldData = body.fieldData ? JSON.stringify(body.fieldData) : "{}";
    let checklistState = "[]";
    // Tech pay + field payment: what the office set on this work order, else the template's.
    let techPayModel =
      body.techPayModel !== undefined
        ? techPayModelJson(body.techPayModel)
        : "";
    let collectPayment: string = body.collectPayment ?? "";
    // Job forms v2: book the job against the template's current version, so
    // it keeps these questions, prices and pay whatever happens to the
    // template later. The form replaces the separate checklist.
    let templateVersionId: string | null = null;
    if (body.templateId) {
      const tpl = await t.selectOne(
        schema.taskTemplates,
        eq(schema.taskTemplates.id, body.templateId),
      );
      const ver =
        tpl && (await isFeatureOn(co, "forms.v2"))
          ? await currentVersion(co, tpl.id)
          : null;
      if (tpl && ver) {
        templateVersionId = ver.id;
        if (body.techPayModel === undefined)
          techPayModel = ver.techPayModel || "";
        if (body.collectPayment === undefined)
          collectPayment = ver.collectPayment || "";
        const hasOwnFields =
          Array.isArray(body.fieldData?._customFields) &&
          body.fieldData._customFields.length > 0;
        // Older phone builds still read _customFields (read-only labels).
        if (!hasOwnFields) {
          const seeded = templateFieldsToCustomFields(tpl.fields);
          if (seeded.length)
            fieldData = JSON.stringify({
              ...body.fieldData,
              _customFields: seeded,
            });
        }
      } else if (tpl) {
        if (body.techPayModel === undefined)
          techPayModel = tpl.techPayModel || "";
        if (body.collectPayment === undefined)
          collectPayment = tpl.collectPayment || "";
        const hasOwnFields =
          Array.isArray(body.fieldData?._customFields) &&
          body.fieldData._customFields.length > 0;
        if (!hasOwnFields) {
          const seeded = templateFieldsToCustomFields(tpl.fields);
          if (seeded.length)
            fieldData = JSON.stringify({
              ...body.fieldData,
              _customFields: seeded,
            });
        }
        try {
          const checklist = JSON.parse(tpl.checklist || "[]");
          if (Array.isArray(checklist) && checklist.length) {
            // `required` carries through from the template: a real
            // compliance/quality gate (e.g. a documented reading, a
            // mandated sign-off) that the mobile app blocks job completion
            // on if left unchecked — not just a cosmetic label.
            checklistState = JSON.stringify(
              checklist.map((item: any) => ({
                label: typeof item === "string" ? item : item.label,
                done: false,
                required: typeof item === "object" && item.required === true,
              })),
            );
          }
        } catch {
          /* leave as "[]" */
        }
      }
    }

    const assignedRider = body.riderId || null;
    const [b] = await t.insert(schema.bookings, {
      customerId: cu!.id,
      serviceId: body.serviceId,
      riderId: assignedRider,
      templateId: body.templateId ?? null,
      templateVersionId,
      title: body.title || svc.name,
      priority: body.priority ?? "normal",
      status: assignedRider ? "assigned" : "confirmed",
      scheduledAt: new Date(body.scheduledAt),
      address: body.address ?? "",
      lat: geo?.lat ?? 43.6532,
      lng: geo?.lng ?? -79.3832,
      notes: body.notes ?? "",
      staffNotes: (body as any).staffNotes ?? "",
      fieldData,
      checklistState,
      techPayModel,
      collectPayment,
      customerPhone: body.phone ?? cu!.phone ?? "",
      region: body.region ?? "",
      rateModel: body.rateModel ? JSON.stringify(body.rateModel) : "",
      lineItems: Array.isArray(body.lineItems)
        ? JSON.stringify(body.lineItems)
        : "",
      requiredSkillClass: (body as any).requiredSkillClass ?? "",
      requiredSkills: (body as any).requiredSkills ?? "",
      price: svc.basePrice,
    });
    if (!b) throw new Error("Failed to insert booking");

    const bill = await recomputeBooking(co, b.id);

    const num = `INV-${Date.now().toString().slice(-6)}`;
    const amount = bill?.subtotal ?? svc.basePrice;
    const tax = bill?.taxAmount ?? +(svc.basePrice * 0.13).toFixed(2);
    await t.insert(schema.invoices, {
      bookingId: b.id,
      customerId: cu!.id,
      number: num,
      amount,
      tax,
      total: bill?.total ?? +(amount + tax).toFixed(2),
    });

    if (assignedRider) {
      await reconcileRiderStatus(co, assignedRider);
    }

    await linkBookingToProperty(b.id);
    await fireEvent("created", b.id);
    incr("bookings_created_total");
    capture("booking.created", co, {
      bookingId: b.id,
      serviceId: body.serviceId,
      source: "admin",
    });
    if (assignedRider) {
      await t.update(
        schema.bookings,
        { assignStatus: "offered", assignedAt: new Date() },
        eq(schema.bookings.id, b.id),
      );
      await fireEvent("assigned", b.id);
      incr("dispatch_assigned_total");
      capture("dispatch.assigned", co, {
        bookingId: b.id,
        riderId: assignedRider,
      });
    }

    return c.json({ booking: await enrichById(co, b.id) }, 201);
  })
  // reschedule a work order (admin) -> set scheduledAt (drag onto a calendar day)
  .post("/:id/schedule", requireAuth, jsonBody(ScheduleBody), async (c) => {
    const u = c.get("user") as SessionUser;
    if (!(await officeCan(u, "scheduler:edit")))
      return c.json({ message: "Forbidden" }, 403);
    const id = c.req.param("id");
    const { scheduledAt, force } = c.req.valid("json");
    const t = tx(c);
    const prev = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!prev) return c.json({ message: "Not found" }, 404);
    // Revenue reports and payout periods are selected by scheduledAt, so dragging
    // a finished or cancelled job on the calendar quietly moved money from one
    // reporting period into another.
    if (isTerminalStatus(prev.status))
      return c.json(
        {
          message:
            prev.status === "completed"
              ? "This job is already completed — its date is part of your reports and payouts and can't be moved."
              : "This job was cancelled — restore it before rescheduling.",
          status: prev.status,
        },
        409,
      );
    // Dragging a job onto a time its tech is already booked for (or a day they
    // have off) is the same silent double-booking as a bad assign.
    if (!force) {
      const busy = await findAvailabilityBlock(tenantId(c), {
        riderId: prev.riderId,
        scheduledAt,
        bookingId: id,
        serviceId: prev.serviceId,
      });
      if (busy)
        return c.json(
          {
            message: busy.message,
            reason: busy.kind,
            status: prev.status,
            forceable: true,
          },
          409,
        );
    }
    const set: Record<string, unknown> = { scheduledAt };
    const [b] = await t.update(
      schema.bookings,
      set,
      eq(schema.bookings.id, id),
    );
    if (!b) return c.json({ message: "Not found" }, 404);
    // A `rescheduled` notification exists and is on by default for the client
    // (email) and the tech (SMS) — but only the customer-initiated change-request
    // flow ever fired it. When the office moved a job on the calendar, the tech's
    // phone kept showing the old time and the customer was never told.
    const moved = Number(prev.scheduledAt ?? 0) !== Number(scheduledAt ?? 0);
    if (moved) await fireEvent("rescheduled", id);
    return c.json({ booking: await enrich(b) }, 200);
  })
  // admin edits any field on a work order (address, schedule, service, pricing, etc.)
  .patch("/:id", requireAuth, jsonBody(BookingPatch), async (c) => {
    const u = c.get("user") as SessionUser;
    if (!(await officeCan(u, "work_orders:edit")))
      return c.json({ message: "Forbidden" }, 403);
    const id = c.req.param("id");
    const co = tenantId(c);
    const t = tx(c);
    const body = c.req.valid("json");
    const prev = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!prev) return c.json({ message: "Not found" }, 404);

    // Every one of these columns is a foreign key. The schema only checks the
    // SHAPE of an id, so a stale or hand-typed id sailed through and blew up
    // on the FK constraint as a bare 500 (reproduced live with
    // { serviceId: "zz-deleted-service" }, and the same for riderId,
    // customerId and templateId). Resolving them here also keeps the write
    // inside the caller's tenant instead of pointing a work order at another
    // company's row.
    if (body.serviceId !== undefined) {
      const svc = await t.selectOne(
        schema.services,
        eq(schema.services.id, body.serviceId),
      );
      if (!svc) return c.json({ message: "Service not found" }, 404);
    }
    if (body.customerId !== undefined) {
      const cu = await t.selectOne(
        schema.user,
        eq(schema.user.id, body.customerId),
      );
      // Membership, not user.companyId: a client shared with another company is
      // still this company's client, and comparing home companies rejected them.
      if (!cu || !(await isMember(cu.id, co)))
        return c.json({ message: "Client not found" }, 404);
    }
    // Best-effort correction to the client's own CRM email — fixes a typo or
    // fills one in that was missing. Never blocks the save on a collision
    // with someone else's login; it just keeps the old email in that case.
    if (body.customerEmail !== undefined) {
      const targetCustomerId = body.customerId ?? prev.customerId;
      if (targetCustomerId) {
        const targetCu = await t.selectOne(
          schema.user,
          eq(schema.user.id, targetCustomerId),
        );
        if (targetCu && targetCu.email !== body.customerEmail) {
          await t
            .update(
              schema.user,
              { email: body.customerEmail },
              eq(schema.user.id, targetCustomerId),
            )
            .catch(() => {});
        }
      }
    }
    if (body.riderId) {
      const rd = await t.selectOne(
        schema.riders,
        eq(schema.riders.id, body.riderId),
      );
      if (!rd) return c.json({ message: "Technician not found" }, 404);
    }
    if (body.templateId) {
      const tpl = await t.selectOne(
        schema.taskTemplates,
        eq(schema.taskTemplates.id, body.templateId),
      );
      if (!tpl) return c.json({ message: "Template not found" }, 404);
    }

    // A save from the work-order modal can change the tech, the time, or both —
    // the same double-booking as a drag or an assign, just through a different
    // door. Only checked when one of those two actually changed.
    const nextRider =
      body.riderId === undefined ? (prev.riderId ?? "") : body.riderId || "";
    const nextAt = body.scheduledAt
      ? new Date(body.scheduledAt)
      : prev.scheduledAt;
    const movedInTime =
      Boolean(body.scheduledAt) &&
      Number(nextAt) !== Number(prev.scheduledAt ?? 0);
    // A longer (or shorter) job can run into the next one just like a move.
    const resized =
      body.durationMins !== undefined &&
      (body.durationMins ?? null) !== (prev.durationMins ?? null);
    if (
      nextRider &&
      !body.force &&
      !isTerminalStatus(prev.status) &&
      (nextRider !== (prev.riderId ?? "") || movedInTime || resized)
    ) {
      // The length the job will have after this save: the new override, else
      // (cleared or never set) the service's.
      const nextService = body.serviceId ?? prev.serviceId;
      const override =
        body.durationMins !== undefined ? body.durationMins : prev.durationMins;
      const svcMins = nextService
        ? ((await t.selectOne(schema.services, eq(schema.services.id, nextService)))
            ?.durationMins ?? null)
        : null;
      const busy = await findAvailabilityBlock(co, {
        riderId: nextRider,
        scheduledAt: nextAt,
        bookingId: id,
        serviceId: nextService,
        durationMins: override ?? svcMins,
      });
      if (busy)
        return c.json(
          { message: busy.message, reason: busy.kind, forceable: true },
          409,
        );
    }

    const set: Record<string, unknown> = {};
    if (body.title !== undefined) set.title = body.title;
    if (body.priority !== undefined) set.priority = body.priority;
    if (body.address !== undefined) set.address = body.address;
    if (body.notes !== undefined) set.notes = body.notes;
    if ((body as any).staffNotes !== undefined)
      set.staffNotes = (body as any).staffNotes;
    if (body.customerId !== undefined) set.customerId = body.customerId;
    if (body.serviceId !== undefined) set.serviceId = body.serviceId;
    if (body.templateId !== undefined) {
      set.templateId = body.templateId || null;
      // Job forms v2: a different template means its current version (answers
      // already given to the old form stay stored against the old version).
      if ((body.templateId || null) !== (prev.templateId ?? null)) {
        // Answers already given belong to this job's form: changing the
        // template would hide them. A finished job keeps its form as the record.
        if (prev.templateVersionId && (await answeredCountFor(co, prev)) > 0)
          return c.json(
            {
              message:
                "This job's form already has answers, so its template can't be changed. Create a new job instead.",
              reason: "form_has_answers",
            },
            409,
          );
        if (!isTerminalStatus(prev.status)) {
          const ver =
            body.templateId && (await isFeatureOn(co, "forms.v2"))
              ? await currentVersion(co, body.templateId)
              : null;
          set.templateVersionId = ver?.id ?? null;
        }
      }
    }
    if (body.region !== undefined) set.region = body.region ?? "";
    if (body.lat !== undefined) set.lat = body.lat;
    if (body.lng !== undefined) set.lng = body.lng;
    if (body.customerPhone !== undefined)
      set.customerPhone = body.customerPhone;
    if (body.scheduledAt) set.scheduledAt = body.scheduledAt;
    if (body.durationMins !== undefined) set.durationMins = body.durationMins;
    if (body.rateModel !== undefined)
      set.rateModel = body.rateModel ? JSON.stringify(body.rateModel) : "";
    if (body.techPayModel !== undefined)
      set.techPayModel = techPayModelJson(body.techPayModel);
    if (body.collectPayment !== undefined)
      set.collectPayment = body.collectPayment;
    if (body.lineItems !== undefined)
      set.lineItems = Array.isArray(body.lineItems)
        ? JSON.stringify(body.lineItems)
        : "";
    if ((body as any).requiredSkillClass !== undefined)
      set.requiredSkillClass = (body as any).requiredSkillClass ?? "";
    if ((body as any).requiredSkills !== undefined)
      set.requiredSkills = (body as any).requiredSkills ?? "";
    // BUG FIX: this route never accepted fieldData at all, so any custom
    // field edits made in the work-order modal (e.g. filling in/adjusting the
    // dropdown/checkbox/etc. fields carried over from a template) were
    // silently dropped on every save. The modal always sends the full
    // { _customFields: [...] } shape, so the public keys are a plain overwrite.
    // Internal `__`-prefixed keys (iOS Live Activity push tokens written by
    // tracking.ts) are never sent to clients, so they're merged back in here
    // instead of being wiped by the overwrite.
    if (body.fieldData !== undefined)
      set.fieldData = mergeInternalFieldData(
        prev.fieldData,
        body.fieldData as any,
      );

    // handle (re)assignment if the rider changed
    const newRider = body.riderId;
    if (newRider !== undefined && newRider !== (prev.riderId ?? "")) {
      // A human changed the tech, so the job is no longer an automation's call.
      set.autoAssignedRuleId = "";
      set.autoAssignedAt = null;
      if (newRider) {
        set.riderId = newRider;
        if (["pending", "confirmed", "unassigned"].includes(prev.status))
          set.status = "assigned";
        set.assignStatus = "offered";
        set.assignedAt = new Date();
        set.acceptedAt = null;
        set.declineReason = "";
      } else {
        set.riderId = null;
        if (["assigned"].includes(prev.status)) set.status = "confirmed";
        set.assignStatus = "";
      }
    }

    await t.update(schema.bookings, set, eq(schema.bookings.id, id));
    // Edits that fire no lifecycle event (title, address, priority, skills)
    // still need to reach open dispatch maps.
    void publishDispatch(co, { kind: "job", jobId: id });

    // keep busy status + offer flow in sync on a real reassignment
    if (newRider !== undefined && newRider !== (prev.riderId ?? "")) {
      if (newRider) {
        await reconcileRiderStatus(co, newRider);
        await fireEvent("assigned", id);
      }
      // free the previous tech if they were assigned (clears their stale "busy")
      if (prev.riderId) await reconcileRiderStatus(co, prev.riderId);
    }

    // Editing the date in the work-order modal is a reschedule too — same silent
    // failure as the calendar drag: nobody was told the appointment moved.
    if (
      body.scheduledAt &&
      !isTerminalStatus(prev.status) &&
      Number(prev.scheduledAt ?? 0) !== Number(body.scheduledAt ?? 0)
    ) {
      await fireEvent("rescheduled", id);
    }

    // re-price whenever pricing-relevant fields move
    if (
      body.rateModel !== undefined ||
      body.region !== undefined ||
      body.serviceId !== undefined ||
      body.templateId !== undefined ||
      body.lineItems !== undefined
    ) {
      await recomputeBooking(co, id);
    }
    // A finished job's tech pay follows its pay rules until a payout locks it in.
    if (
      (body.techPayModel !== undefined || body.lineItems !== undefined) &&
      prev.status === "completed" &&
      !prev.payoutId
    ) {
      await accrueTechPay(co, id);
    }

    return c.json({ booking: await enrichById(co, id) }, 200);
  })
  // assign a rider (admin) -> offers the job; tech must accept before en route
  .post("/:id/assign", requireAuth, jsonBody(AssignBody), async (c) => {
    const co = tenantId(c);
    const u = c.get("user") as SessionUser;
    // Dispatching work is an office action. This route was open to any signed-in
    // user in the tenant, so a technician could hand themselves (or a coworker)
    // any job on the board.
    if (!(await officeCan(u, "work_orders:edit")))
      return c.json({ message: "Forbidden" }, 403);
    const { riderId, force } = c.req.valid("json");
    const id = c.req.param("id");
    // Every guard (tenant check on the tech, terminal/in-flight protection,
    // double-booking + time off, compare-and-set, presence, "assigned" event)
    // lives in services/assign.ts so automation rules and dispatchers share it.
    const r = await assignJob(co, id, riderId, {
      force,
      by: { kind: "dispatcher", name: u.name },
    });
    if (!r.ok) {
      if (r.code === "tech_not_found" || r.code === "job_not_found")
        return c.json({ message: r.message }, 404);
      return c.json(
        {
          message: r.message,
          ...(r.status ? { status: r.status } : {}),
          ...(r.reason ? { reason: r.reason } : {}),
          forceable: r.forceable,
        },
        409,
      );
    }
    return c.json({ booking: await enrich(r.booking) }, 200);
  })
  // tech accepts an offered job.
  // Compare-and-set: only transitions a job that is STILL "offered". If the
  // office reassigned, cancelled, or another tech already grabbed it (or a
  // duplicate tap / multi-node race fires twice), 0 rows update and we return
  // 409 instead of silently clobbering a newer state.
  // What a tech needs to decide on an offer: drive time and distance from
  // where they are, estimated pay, and the scope. Only the tech it's offered
  // to (or the office) can read it.
  .get("/:id/offer", requireAuth, async (c) => {
    const id = c.req.param("id");
    const t = tx(c);
    const cur = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!cur) return c.json({ message: "Not found" }, 404);
    const holder = await offerHolder(c, cur);
    if (!holder.allowed) return c.json({ message: "Forbidden" }, 403);
    // The pay estimate reveals the tech's rates: the tech themselves, or
    // office users who may see payouts.
    const showPay = holder.isHolder || (await officeCan(c.get("user") as SessionUser, "payouts:view"));
    const offer = await buildOfferPreview(tenantId(c), cur, holder.rider, { showPay });
    return c.json({ offer }, 200);
  })
  .post("/:id/accept", requireAuth, async (c) => {
    const id = c.req.param("id");
    const cur = await tx(c).selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!cur) return c.json({ message: "Not found" }, 404);
    // Only the tech the job is offered to (or the office, on their behalf).
    if (!(await offerHolder(c, cur)).allowed) return c.json({ message: "Forbidden" }, 403);
    const [b] = await tx(c).update(
      schema.bookings,
      { assignStatus: "accepted", acceptedAt: new Date() },
      and(
        eq(schema.bookings.id, id),
        eq(schema.bookings.assignStatus, "offered"),
        cur.riderId ? eq(schema.bookings.riderId, cur.riderId) : isNull(schema.bookings.riderId),
      ),
    );
    if (!b) throw Err.conflict("This job is no longer available to accept.");
    await fireEvent("accepted", id);
    return c.json({ booking: await enrich(b) }, 200);
  })
  // tech declines an offered job -> back to dispatch queue, notify office
  .post("/:id/decline", requireAuth, jsonBody(DeclineBody), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const detail = declineDetail(body);
    const t = tx(c);
    const cur = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!cur) return c.json({ message: "Not found" }, 404);
    // Only the tech the job is offered to (or the office, on their behalf).
    if (!(await offerHolder(c, cur)).allowed) return c.json({ message: "Forbidden" }, 403);
    // Only an OFFERED job can be declined. Guards against a stale tap after the
    // office already pulled/reassigned the job (would otherwise wrongly null
    // out a freshly-assigned rider).
    if (cur.assignStatus !== "offered") {
      throw Err.conflict("This job is no longer pending your response.");
    }
    // Claim the decline by moving the job out of "offered" in one
    // compare-and-set, with the reason on it, while riderId still names who
    // declined (the "declined" notice and timeline read both off the row).
    // A second tap, or the office moving the job meanwhile, changes 0 rows and
    // answers 409, so the office is told once.
    const holderRider = cur.riderId;
    const [claimed] = await t.update(
      schema.bookings,
      { assignStatus: "declined", declineReason: detail },
      and(
        eq(schema.bookings.id, id),
        eq(schema.bookings.assignStatus, "offered"),
        holderRider ? eq(schema.bookings.riderId, holderRider) : isNull(schema.bookings.riderId),
      ),
    );
    if (!claimed) throw Err.conflict("This job is no longer pending your response.");
    await fireEvent("declined", id);
    // Back to the queue. Compare-and-set on the claim: if the office already
    // re-offered it (to anyone) while the notice went out, leave their
    // assignment alone.
    const [b] = await t.update(
      schema.bookings,
      {
        riderId: null,
        status: "confirmed",
        assignStatus: "declined",
        declineReason: detail,
        autoAssignedRuleId: "",
        autoAssignedAt: null,
      },
      and(
        eq(schema.bookings.id, id),
        eq(schema.bookings.assignStatus, "declined"),
        holderRider ? eq(schema.bookings.riderId, holderRider) : isNull(schema.bookings.riderId),
      ),
    );
    // free the tech (presence works out on-a-job vs. available)
    if (holderRider) await reconcileRiderStatus(tenantId(c), holderRider).catch(() => {});
    if (!b) {
      const now = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
      return c.json({ booking: now ? await enrich(now) : null }, 200);
    }
    return c.json({ booking: await enrich(b) }, 200);
  })
  // update status (rider/admin) -> triggers notifications + emails
  .post("/:id/status", requireAuth, jsonBody(StatusBody), async (c) => {
    const co = tenantId(c);
    const u = c.get("user") as SessionUser;
    const { status } = c.req.valid("json");
    const id = c.req.param("id");
    // The office can correct a record (put a wrongly-completed job back on the
    // board); the field app cannot skip or reverse a stage. Without this a
    // driver could go enroute -> completed: no arrival, no transit time, no
    // on-site clock, and no "your technician is here" for the customer.
    const office = await officeCan(u, "work_orders:edit");
    // Job forms v2: a technician on a form-aware app (X-Forms: 2) can't
    // finish the job while required questions are unanswered. Older phone
    // builds can't fill the form, so they aren't blocked (the office sees the
    // form as unfinished instead); the office can always complete.
    if (status === "completed" && !office && c.req.header("X-Forms") === "2") {
      const cur = await tx(c).selectOne(
        schema.bookings,
        eq(schema.bookings.id, id),
      );
      if (cur?.templateVersionId) {
        const missing = await missingForJob(co, cur);
        if (missing.length)
          return c.json(
            {
              message: `Answer the required questions first: ${missing
                .slice(0, 3)
                .map((m) => m.label)
                .join(
                  ", ",
                )}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}.`,
              reason: "form_incomplete",
              missing: missing.map((m) => ({ id: m.id, label: m.label })),
            },
            409,
          );
      }
    }
    let b;
    try {
      b = await applyBookingStatus(co, id, status, { force: office });
    } catch (e) {
      if (e instanceof StatusTransitionError)
        return c.json({ message: e.message, from: e.from, to: e.to }, 409);
      throw e;
    }
    if (!b) return c.json({ error: "not found" }, 404);
    if (status !== "completed" && b.templateVersionId) {
      await reopenJobForm(co, b).catch((e) =>
        console.error("[bookings] reopen form failed", id, e),
      );
    }
    if (status === "completed" && b.templateVersionId) {
      await closeJobForm(co, b, u.name || u.email || "").catch((e) =>
        console.error("[bookings] close form failed", id, e),
      );
      // The customer's copy of the form, when the template asks for one.
      // Fire-and-forget: never holds up or fails the status change.
      void sendFormCopy(co, b.id).catch((e) =>
        console.error("[bookings] form copy failed", id, e),
      );
    }
    return c.json({ booking: await enrich(b) }, 200);
  })
  /**
   * Tech manually restarts their own on-site clock after it auto-paused
   * (stepped too far from the site, GPS glitched, whatever the reason).
   * Hardwired system-wide for every tenant — there is no setting that turns
   * this off. Only the tech actually holding the job (or the office) can hit
   * it, same guard as /release, and it only does anything when the clock is
   * actually paused on an in-flight job; otherwise it's a no-op 409 rather
   * than silently starting a clock on a job that was never on-site.
   */
  .post("/:id/resume-clock", requireAuth, async (c) => {
    const co = tenantId(c);
    const u = c.get("user") as SessionUser;
    const id = c.req.param("id");
    const t = tx(c);
    const cur = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!cur) return c.json({ message: "Not found" }, 404);
    const holder = cur.riderId
      ? await t.selectOne(schema.riders, eq(schema.riders.id, cur.riderId))
      : null;
    const isHolder = !!holder && holder.userId === u.id;
    if (!isHolder && !(await officeCan(u, "work_orders:edit")))
      return c.json({ message: "Forbidden" }, 403);
    if (cur.status !== "arrived" && cur.status !== "in_progress")
      throw Err.conflict("This job's clock can't be resumed right now.");
    if (cur.clockState !== "paused")
      throw Err.conflict("This job's clock isn't paused.");
    const b = await resumeClock(co, id);
    if (!b) return c.json({ error: "not found" }, 404);
    return c.json({ booking: await enrich(b) }, 200);
  })
  /**
   * Tech hands an ACCEPTED job back to dispatch (van broke down, emergency,
   * can't make it). The job returns to the queue UNASSIGNED so the office can
   * re-dispatch it — it is NOT cancelled, and the customer is told nothing here
   * (office owns that conversation).
   */
  .post("/:id/release", requireAuth, jsonBody(ReleaseBody), async (c) => {
    const co = tenantId(c);
    const u = c.get("user") as SessionUser;
    const id = c.req.param("id");
    const { reason, note } = c.req.valid("json");
    const t = tx(c);
    const cur = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!cur) return c.json({ message: "Not found" }, 404);
    // Only the tech actually holding the job (or the office) can release it.
    // Without this any signed-in user in the tenant could unassign anyone's job.
    const holder = cur.riderId
      ? await t.selectOne(schema.riders, eq(schema.riders.id, cur.riderId))
      : null;
    const isHolder = !!holder && holder.userId === u.id;
    if (!isHolder && !(await officeCan(u, "work_orders:edit")))
      return c.json({ message: "Forbidden" }, 403);
    if (!cur.riderId) throw Err.conflict("This job isn't assigned to anyone.");
    if (cur.assignStatus === "offered")
      throw Err.conflict(
        "You haven't accepted this job yet — decline it instead.",
      );
    if (
      !RELEASABLE_STATUSES.includes(
        cur.status as (typeof RELEASABLE_STATUSES)[number],
      )
    )
      throw Err.conflict("This job can no longer be released.");
    const detail = `${RELEASE_REASON_LABELS[reason]}${note ? ` — ${note}` : ""}`;
    const releasedRider = cur.riderId;
    // Compare-and-set on (id, riderId, status): if the office reassigned or the
    // job moved on between the read and the write, 0 rows change and we 409
    // instead of clobbering newer state. Doing that as the reason-write means
    // the reason is already on the row when the event fires (notification +
    // timeline read it from there) while riderId still resolves to the tech who
    // bailed, so the office sees WHO dropped it and why.
    const [claimed] = await t.update(
      schema.bookings,
      { declineReason: detail },
      and(
        eq(schema.bookings.id, id),
        eq(schema.bookings.riderId, releasedRider),
        eq(schema.bookings.status, cur.status),
      ),
    );
    if (!claimed)
      throw Err.conflict("This job just changed — pull it up again.");
    await fireEvent("released", id);
    const [b] = await t.update(
      schema.bookings,
      {
        riderId: null,
        status: "confirmed",
        assignStatus: "released",
        declineReason: detail,
        autoAssignedRuleId: "",
        autoAssignedAt: null,
        assignedAt: null,
        acceptedAt: null,
        // in-flight progress belongs to the trip that just ended: reset it so
        // the next tech's drive/clock starts clean. Banked totals
        // (onSiteMinutes, mileageKm, transitMinutes, accumulatedMs) are kept as
        // the record of work already done — the office adjusts pay, not us.
        enrouteAt: null,
        startedAt: null,
        clockState: "idle",
        lastResumeAt: null,
        insideGeofence: false,
        etaMins: null,
        etaDistanceKm: null,
      },
      eq(schema.bookings.id, id),
    );
    if (!b) throw Err.conflict("This job just changed — pull it up again.");
    await reconcileRiderStatus(co, releasedRider);
    return c.json({ booking: await enrich(b) }, 200);
  })
  .post("/:id/cancel", requireAuth, async (c) => {
    const co = tenantId(c);
    const u = c.get("user") as SessionUser;
    const id = c.req.param("id");
    const t = tx(c);
    const prev = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!prev) return c.json({ message: "Not found" }, 404);
    // Cancelling belongs to the office or the customer whose job it is. This
    // route used to be guarded by requireAuth alone, so ANY signed-in user in
    // the tenant — including a tech, or a customer poking at another
    // customer's booking id — could kill someone else's work order.
    const office = await officeCan(u, "work_orders:edit");
    if (!office && prev.customerId !== u.id)
      return c.json({ message: "Forbidden" }, 403);
    // A CUSTOMER can no longer hard-cancel their own job here, which is what
    // this endpoint allowed: a job could leave the dispatch board with nobody at
    // the company deciding it should, and no reason recorded. Customer-side
    // cancellation is a request the office approves
    // (POST /:id/cancel-request). Office cancellation is unchanged.
    if (!office)
      return c.json(
        {
          message:
            "Cancellations are handled by the office — send a cancellation request and we'll confirm it.",
          useEndpoint: `/api/bookings/${id}/cancel-request`,
        },
        409,
      );
    const [b] = await t.update(
      schema.bookings,
      { status: "cancelled" },
      eq(schema.bookings.id, id),
    );
    if (!b) return c.json({ message: "Not found" }, 404);
    await fireEvent("cancelled", id);
    // free the assigned tech so they don't stay stuck "busy" after a cancel
    if (prev?.riderId) await reconcileRiderStatus(co, prev.riderId);
    return c.json({ booking: await enrich(b) }, 200);
  })
  /**
   * What the signed-in customer may do to this appointment right now, plus any
   * request already in flight. The portal renders buttons off this instead of
   * guessing, and the write endpoints below re-run the same evaluator — so the
   * screen and the server can never disagree.
   */
  .get("/:id/change-policy", requireAuth, async (c) => {
    const co = tenantId(c);
    const u = c.get("user") as SessionUser;
    const id = c.req.param("id");
    const b = await tx(c).selectOne(
      schema.bookings,
      eq(schema.bookings.id, id),
    );
    if (!b) return c.json({ message: "Not found" }, 404);
    if (b.customerId !== u.id && !(await officeCan(u, "work_orders:view")))
      return c.json({ message: "Forbidden" }, 403);
    const state = await changeStateFor(co, b);
    return c.json(serializeState(state), 200);
  })
  /**
   * Customer moves their appointment. Outside the tenant's cutoff this is
   * applied immediately; inside it, it becomes a request the office approves.
   * services/change-requests.ts owns both paths so the audit trail is identical.
   */
  .post(
    "/:id/reschedule",
    requireAuth,
    jsonBody(RescheduleRequestBody),
    async (c) => {
      const co = tenantId(c);
      const u = c.get("user") as SessionUser;
      const id = c.req.param("id");
      const body = c.req.valid("json");
      const b = await tx(c).selectOne(
        schema.bookings,
        eq(schema.bookings.id, id),
      );
      if (!b) return c.json({ message: "Not found" }, 404);
      if (b.customerId !== u.id && !(await officeCan(u, "work_orders:edit")))
        return c.json({ message: "Forbidden" }, 403);
      const r = await requestReschedule({
        companyId: co,
        booking: b,
        proposedAt: body.scheduledAt,
        reason: body.reason ?? "",
        actorId: u.id,
        actorName: u.name ?? "",
      });
      if (!r.ok)
        return c.json(
          { message: r.message },
          r.code === "invalid" ? 422 : r.code === "conflict" ? 409 : 403,
        );
      return c.json(
        r.mode === "applied"
          ? { mode: "applied", scheduledAt: r.scheduledAt, request: r.request }
          : { mode: "requested", request: r.request },
        200,
      );
    },
  )
  /**
   * Customer ASKS to cancel. Never cancels anything — it files a pending request
   * for the office. See the /:id/cancel guard above for why.
   */
  .post(
    "/:id/cancel-request",
    requireAuth,
    jsonBody(CancelRequestBody),
    async (c) => {
      const co = tenantId(c);
      const u = c.get("user") as SessionUser;
      const id = c.req.param("id");
      const body = c.req.valid("json");
      const b = await tx(c).selectOne(
        schema.bookings,
        eq(schema.bookings.id, id),
      );
      if (!b) return c.json({ message: "Not found" }, 404);
      if (b.customerId !== u.id && !(await officeCan(u, "work_orders:edit")))
        return c.json({ message: "Forbidden" }, 403);
      const r = await requestCancel({
        companyId: co,
        booking: b,
        reason: body.reason ?? "",
        actorId: u.id,
        actorName: u.name ?? "",
      });
      if (!r.ok)
        return c.json(
          { message: r.message },
          r.code === "conflict" ? 409 : 403,
        );
      return c.json({ mode: "requested", request: r.request }, 201);
    },
  )
  // review
  .post("/:id/review", requireAuth, jsonBody(ReviewBody), async (c) => {
    const u = c.get("user") as SessionUser;
    const id = c.req.param("id");
    const { rating, comment } = c.req.valid("json");
    const t = tx(c);
    const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!b) return c.json({ message: "Not found" }, 404);
    const [r] = await t.insert(schema.reviews, {
      bookingId: id,
      customerId: u.id,
      riderId: b.riderId,
      rating,
      comment: comment ?? "",
    });
    return c.json({ review: r }, 201);
  })
  // list job photos for a work order
  .get("/:id/photos", requireAuth, async (c) => {
    const rows = await tx(c).select(
      schema.jobPhotos,
      eq(schema.jobPhotos.bookingId, c.req.param("id")),
    );
    rows.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
    return c.json({ photos: rows }, 200);
  })
  // upload a job photo (tech). multipart: file, optional caption
  .post("/:id/photos", requireAuth, async (c) => {
    const id = c.req.param("id");
    const t = tx(c);
    const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!b) return c.json({ message: "Not found" }, 404);
    const form = await c.req.formData();
    const file = form.get("file");
    const caption = String(form.get("caption") || "");
    // before | during | after — what stage of the job this shot documents.
    const rawPhase = String(form.get("phase") || "during").toLowerCase();
    const phase = ["before", "during", "after"].includes(rawPhase)
      ? rawPhase
      : "during";
    // techs can mark a shot office-only (default: the homeowner sees it)
    const customerVisible =
      String(form.get("customerVisible") ?? "true") !== "false";
    // Job forms v2: the question this photo answers (tags the photo only; the
    // answer itself is saved through /api/job-forms with the returned id).
    const formItemId = String(form.get("formItemId") || "")
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 64);
    // A photo for an office-only question (or one in an office-only section)
    // is office-only, whatever the client sent, and carries no caption onto
    // the customer's timeline.
    let photoCaption = caption;
    let photoVisible = customerVisible;
    if (formItemId) {
      const vf = await versionFormFor(b.companyId, b);
      if (vf && isInternalItem(vf, formItemId)) {
        photoVisible = false;
        photoCaption = "";
      }
    }
    if (!(file instanceof File)) return c.json({ message: "No file" }, 400);
    if (file.size > 15 * 1024 * 1024)
      return c.json({ message: "Image too large (max 15MB)" }, 400);
    const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
    if (file.type && !ALLOWED.includes(file.type))
      return c.json({ message: `Unsupported type ${file.type}` }, 400);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().slice(0, 8);
    const key = `job-photos/${id}/${crypto.randomUUID()}.${ext}`;
    const stored = await putObject(
      key,
      Buffer.from(await file.arrayBuffer()),
      file.type || "image/jpeg",
    );
    const [p] = await t.insert(schema.jobPhotos, {
      bookingId: id,
      url: stored.url,
      caption: photoCaption,
      source: "upload",
      phase,
      customerVisible: photoVisible,
      formItemId,
    });
    if (!p) throw new Error("Failed to insert job photo");
    // Timeline entry so the photo shows up in the customer's job history and
    // permanent record, not just the admin gallery.
    const me = c.get("user") as SessionUser;
    await logJobEvent({
      companyId: b.companyId,
      bookingId: id,
      kind: "photo_added",
      actorRole: "tech",
      actorName: me?.name || "",
      label: photoCaption
        ? `${phase === "before" ? "Before" : phase === "after" ? "After" : "Job"} photo — ${photoCaption}`
        : `${phase === "before" ? "Before" : phase === "after" ? "After" : "Job"} photo added`,
      meta: { photoId: p.id, url: stored.url, caption: photoCaption, phase },
      // an office-only photo must not surface a timeline entry to the customer
      customerVisible: photoVisible ? undefined : false,
    });

    // Notify dispatch in real-time so the office sees the new photo immediately
    if (b.publicToken && photoVisible) {
      void publishTrack({
        type: "status",
        token: b.publicToken,
        data: { event: "photo_added", photoId: p.id, bookingId: id },
      });
    }
    return c.json({ photo: p }, 201);
  })
  // ── Full internal timeline for the office (includes hidden events) ───────
  // GET /api/bookings/:id/events
  .get("/:id/events", requireAuth, async (c) => {
    const id = c.req.param("id");
    const b = await tx(c).selectOne(
      schema.bookings,
      eq(schema.bookings.id, id),
    );
    if (!b) return c.json({ message: "Not found" }, 404);
    const events = await jobTimeline(b.companyId, id, {
      onlyCustomerVisible: false,
    });
    return c.json(
      {
        events,
        signature: b.signedAt
          ? { url: b.signatureUrl, name: b.signatureName, at: b.signedAt }
          : null,
      },
      200,
    );
  })
  // ── Customer sign-off (tech captures on site) ────────────────────────────
  // POST /api/bookings/:id/signature
  //   { strokes: [[[x,y],...], ...], width, height, name }  ← drawn on device
  // Strokes are rendered to an SVG server-side and stored like any other job
  // asset. Drawing is sent as points rather than a rasterised image so the
  // mobile app needs no native canvas/webview dependency (ships over-the-air).
  .post("/:id/signature", requireAuth, jsonBody(SignatureBody), async (c) => {
    const id = c.req.param("id");
    const t = tx(c);
    const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!b) return c.json({ message: "Not found" }, 404);
    // One sign-off per job: a second capture means deleting the first.
    if (b.signedAt)
      throw Err.conflict(
        "This job is already signed. Delete the signature first to capture a new one.",
      );

    const body = c.req.valid("json");
    const strokes = body.strokes;
    const name = body.name;
    // guard against a runaway payload
    const points = strokes.reduce((n, s) => n + s.length, 0);
    if (points > 20000) throw Err.badRequest("Signature too large");

    const w = Math.round(body.width ?? 600);
    const h = Math.round(body.height ?? 200);
    const paths = strokes
      .filter((s) => s.length > 0)
      .map((s) => {
        const d = s
          .map((pt, i) => {
            const x = Math.round(pt[0] * 100) / 100;
            const y = Math.round(pt[1] * 100) / 100;
            return `${i === 0 ? "M" : "L"}${x} ${y}`;
          })
          .join(" ");
        return `<path d="${d}" fill="none" stroke="#0f172a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      })
      .join("");
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
      `<rect width="100%" height="100%" fill="#ffffff"/>${paths}</svg>`;

    const stored = await putObject(
      `signatures/${id}/${crypto.randomUUID()}.svg`,
      Buffer.from(svg, "utf8"),
      "image/svg+xml",
    );
    const signedAt = new Date();
    await t.update(
      schema.bookings,
      { signatureUrl: stored.url, signatureName: name, signedAt },
      eq(schema.bookings.id, id),
    );

    const me = c.get("user") as SessionUser;
    await logJobEvent({
      companyId: b.companyId,
      bookingId: id,
      kind: "signature_captured",
      actorRole: "tech",
      actorName: me?.name || "",
      label: `Signed off by ${name}`,
      meta: { url: stored.url, name },
    });
    if (b.publicToken) {
      void publishTrack({
        type: "status",
        token: b.publicToken,
        data: { event: "signature_captured", bookingId: id },
      });
    }
    return c.json(
      { signatureUrl: stored.url, signatureName: name, signedAt },
      201,
    );
  })
  // DELETE /api/bookings/:id/signature — take the sign-off back (the job's
  // technician, or the office), so a new one can be captured. Removes the
  // stored image and the customer-facing "Sign-off captured" entry, and leaves
  // an office-only record of who removed whose.
  .delete("/:id/signature", requireAuth, async (c) => {
    const id = c.req.param("id");
    const u = c.get("user") as SessionUser;
    const t = tx(c);
    const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!b) return c.json({ message: "Not found" }, 404);
    const holder = b.riderId
      ? await t.selectOne(schema.riders, eq(schema.riders.id, b.riderId))
      : null;
    const isHolder = !!holder && holder.userId === u.id;
    const office = await officeCan(u, "work_orders:edit");
    if (!isHolder && !office) return c.json({ message: "Forbidden" }, 403);
    if (!b.signedAt)
      return c.json({ message: "This job has no signature" }, 404);

    await t.update(
      schema.bookings,
      { signatureUrl: "", signatureName: "", signedAt: null },
      eq(schema.bookings.id, id),
    );
    await t.delete(
      schema.jobEvents,
      and(
        eq(schema.jobEvents.bookingId, id),
        eq(schema.jobEvents.kind, "signature_captured"),
      ),
    );
    await logJobEvent({
      companyId: b.companyId,
      bookingId: id,
      kind: "signature_removed",
      actorRole: office && !isHolder ? "dispatch" : "tech",
      actorName: u?.name || "",
      label: `Sign-off by ${b.signatureName || "customer"} removed`,
    });
    await deleteSignatureObject(b.signatureUrl, id);
    return c.json({ ok: true }, 200);
  })
  // ── Voice note (tech dictates, office reads) ─────────────────────────────
  // POST /api/bookings/:id/voice-note   multipart: file, optional transcript
  // Office-only: stored as an internal job event and appended to driverNotes.
  // Never customer-visible.
  .post("/:id/voice-note", requireAuth, async (c) => {
    const id = c.req.param("id");
    const t = tx(c);
    const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!b) return c.json({ message: "Not found" }, 404);

    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ message: "No file" }, 400);
    if (file.size > 25 * 1024 * 1024)
      return c.json({ message: "Recording too long (max 25MB)" }, 400);
    const secs = Math.max(0, Math.round(Number(form.get("durationSecs")) || 0));
    const bytes = Buffer.from(await file.arrayBuffer());
    const ext = (file.name.split(".").pop() || "m4a").toLowerCase().slice(0, 8);
    const stored = await putObject(
      `voice-notes/${id}/${crypto.randomUUID()}.${ext}`,
      bytes,
      file.type || "audio/m4a",
    );

    // Client may transcribe on-device; otherwise try the gateway. Both are
    // best-effort — a failed transcript must never lose the recording.
    let transcript = String(form.get("transcript") || "").trim();
    if (!transcript)
      transcript = await transcribeAudio(
        bytes,
        file.name || `note.${ext}`,
        file.type,
      );

    const me = c.get("user") as SessionUser;
    // Stamped on the tenant's clock: an office reader seeing "2:14 AM" on a
    // note dictated at 9:14 PM has no idea what they're looking at.
    const stamp = fmtInZone(
      new Date(),
      await companyTimeZone(t.companyId),
      { dateStyle: "medium", timeStyle: "short" },
      "en-CA",
    );
    // The exact line added to driverNotes, kept so deleting the note can take
    // it back out again.
    const line = transcript
      ? `[Voice note — ${me?.name || "Tech"}, ${stamp}] ${transcript}`
      : "";
    if (line) {
      const next = b.driverNotes ? `${b.driverNotes}\n${line}` : line;
      await t.update(
        schema.bookings,
        { driverNotes: next },
        eq(schema.bookings.id, id),
      );
    }
    await logJobEvent({
      companyId: b.companyId,
      bookingId: id,
      kind: "voice_note",
      actorRole: "tech",
      actorName: me?.name || "",
      label: transcript
        ? `Voice note: ${transcript.slice(0, 120)}`
        : "Voice note recorded",
      detail: transcript,
      // userId says whose note it is; key and line are what deleting it has to
      // clean up (services/voice-notes.ts).
      meta: {
        url: stored.url,
        key: stored.key,
        durationSecs: secs,
        transcribed: !!transcript,
        userId: me?.id ?? "",
        line,
      },
    });
    return c.json({ url: stored.url, transcript, durationSecs: secs }, 201);
  })
  // ── The caller's own voice notes on a job (listen back, delete) ──────────
  // GET /api/bookings/:id/voice-notes
  .get("/:id/voice-notes", requireAuth, async (c) => {
    const id = c.req.param("id");
    const t = tx(c);
    const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!b) return c.json({ message: "Not found" }, 404);
    const me = c.get("user") as SessionUser;
    const rows = await t.select(
      schema.jobEvents,
      and(
        eq(schema.jobEvents.bookingId, id),
        eq(schema.jobEvents.kind, "voice_note"),
      ),
    );
    const notes = rows
      .map((r) => ({ row: r, meta: parseMeta(r.meta) }))
      .filter(({ meta }) => isOwnVoiceNote(meta, me))
      .sort((a, z) => +new Date(a.row.createdAt) - +new Date(z.row.createdAt))
      .map(({ row, meta }) => ({
        id: row.id,
        url: typeof meta.url === "string" ? meta.url : "",
        durationSecs: Number(meta.durationSecs) || 0,
        transcript: row.detail,
        createdAt: row.createdAt,
      }));
    return c.json({ notes }, 200);
  })
  // DELETE /api/bookings/:id/voice-notes/:eventId — your own note only. Removes
  // the recording, the timeline entry and the transcript line it added to the
  // job's field notes.
  .delete("/:id/voice-notes/:eventId", requireAuth, async (c) => {
    const id = c.req.param("id");
    const eventId = c.req.param("eventId");
    const t = tx(c);
    const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!b) return c.json({ message: "Not found" }, 404);
    const me = c.get("user") as SessionUser;
    const ev = await t.selectOne(
      schema.jobEvents,
      and(
        eq(schema.jobEvents.id, eventId),
        eq(schema.jobEvents.bookingId, id),
        eq(schema.jobEvents.kind, "voice_note"),
      ),
    );
    if (!ev) return c.json({ message: "Not found" }, 404);
    const meta = parseMeta(ev.meta);
    if (!isOwnVoiceNote(meta, me))
      return c.json(
        { message: "You can only delete your own voice notes" },
        403,
      );

    // Only ever delete under this job's voice-note folder, whatever the row says.
    const key = voiceNoteKey(meta, id);
    if (key)
      await deleteObject(key).catch((e) =>
        console.error("[voice-note] delete object failed", key, e),
      );
    const notes = removeVoiceNoteLine(b.driverNotes, meta);
    if (notes !== b.driverNotes)
      await t.update(
        schema.bookings,
        { driverNotes: notes },
        eq(schema.bookings.id, id),
      );
    await t.delete(schema.jobEvents, eq(schema.jobEvents.id, eventId));
    return c.json({ ok: true }, 200);
  })
  // ── Checklist toggle (tech) ──────────────────────────────────────────────
  // PATCH /api/bookings/:id/checklist { index: number, done: boolean }
  // Tech can check/uncheck individual items. Stored in bookings.checklistState JSON.
  .patch("/:id/checklist", requireAuth, jsonBody(ChecklistBody), async (c) => {
    const id = c.req.param("id");
    const { index, done } = c.req.valid("json");
    const t = tx(c);
    const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!b) return c.json({ message: "Not found" }, 404);
    let checklist: any[] = [];
    try {
      checklist = JSON.parse(b.checklistState || "[]");
    } catch {}
    if (index < 0 || index >= checklist.length)
      return c.json({ message: "Invalid index" }, 400);
    const item = checklist[index];
    const wasDone = typeof item === "object" && item !== null && !!item.done;
    checklist[index] =
      typeof item === "object"
        ? { ...item, done }
        : { label: String(item), done };
    await t.update(
      schema.bookings,
      { checklistState: JSON.stringify(checklist) },
      eq(schema.bookings.id, id),
    );
    // A custom milestone waiting on this item ("Water restored") goes off the
    // first time it's ticked. Unticking and re-ticking never sends it again.
    if (done && !wasDone) {
      const label = String(checklist[index]?.label ?? "");
      await onChecklistTicked(b.companyId, b.id, label).catch((e) =>
        console.error("[bookings] checklist milestone failed", id, e),
      );
    }
    return c.json({ checklist }, 200);
  })
  // Tech saves a field note to the booking record (visible to office/dispatch)
  .patch(
    "/:id/driver-notes",
    requireAuth,
    jsonBody(DriverNotesBody),
    async (c) => {
      const id = c.req.param("id");
      const t = tx(c);
      const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
      if (!b) return c.json({ message: "Not found" }, 404);
      const { notes } = c.req.valid("json");
      await t.update(
        schema.bookings,
        { driverNotes: notes ?? "" },
        eq(schema.bookings.id, id),
      );
      return c.json({ ok: true }, 200);
    },
  );
