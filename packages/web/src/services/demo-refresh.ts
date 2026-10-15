/**
 * Keeps the sales-demo tenant (Prairie Comfort HVAC) looking like a live shop.
 *
 * The demo was seeded once, so a day later every job sat in the past and the
 * board was a wall of "running late". This runs inside the server every minute
 * and makes the demo tenant match the plan in shared/demo-plan.ts:
 *
 *   1. FILL — every job the plan has for yesterday … today + 7 days exists.
 *      Pre-booked work appears days ahead; emergency calls appear ~45 minutes
 *      before the tech is due, the way a real after-hours call comes in.
 *   2. ADVANCE — each job moves forward with the clock: assigned → en route →
 *      in progress → completed. Forward only, so anything a salesperson does
 *      by hand during a demo (finishing a job early, cancelling one) sticks.
 *   3. MOVE THE VANS — techs who are on shift get a fresh location every tick
 *      (driving toward their next job, parked at the current one), so the map
 *      and the "who's available" panel look live instead of everyone offline.
 *   4. TIDY (hourly) — old jobs left in a live status by the original seed are
 *      closed out, "running late" flags are cleared, and outbound email/SMS for
 *      the tenant is kept switched off.
 *
 * Content (service, parts, prices, homeowner notes) is COPIED from the jobs the
 * tenant already has, matched by title, and customers are reused from the
 * tenant's own client list — this module invents no prices and creates no
 * people. Every row it writes carries fieldData.__demo = "<day>|<slot>" and a
 * deterministic id, so two server instances (or a re-run) can never create a
 * second copy. `__`-prefixed fieldData keys are stripped from API responses,
 * so the marker never shows on a job screen.
 *
 * Writes go straight to the tables (no lifecycle hooks) on purpose: nothing
 * here may text or email anyone. It only ever touches the one demo tenant.
 */
import { createHash } from "node:crypto";
import { and, eq, gte, ilike, inArray, isNotNull, isNull, like, lt, not, or } from "drizzle-orm";
import { db, sdb } from "../api/database";
import { tdb, type Executor } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import {
  addDays,
  lerp,
  phaseAt,
  planDay,
  STATUS_RANK,
  type DemoPhase,
  type DemoSlot,
  type DemoTech,
} from "../shared/demo-plan";
import { zonedDayKey } from "../shared/tz";

/** The demo company's display name — used when DEMO_TENANT_ID isn't set. */
export const DEMO_COMPANY_NAME = "Prairie Comfort HVAC";
/** Days of history kept before today, and days filled after it. */
export const DAYS_BACK = 1;
export const DAYS_AHEAD = 7;
const MARKER = "__demo";
/** LIKE pattern for the marker — underscores escaped, they are LIKE wildcards. */
const MARKER_LIKE = '%"\\_\\_demo"%';
const HOUR = 3_600_000;
const MIN = 60_000;
const WINNIPEG = { lat: 49.8951, lng: -97.1384 };

type Booking = typeof schema.bookings.$inferSelect;
type Rider = typeof schema.riders.$inferSelect;

export interface DemoReport {
  companyId: string | null;
  ranAt: string;
  created: number;
  advanced: number;
  techsOnline: number;
  tidied: boolean;
  closedLegacy: number;
  skipped?: string;
}

let lastReport: DemoReport | null = null;
let lastTidyAt = 0;
let tenantCache: { id: string | null; at: number } | null = null;

export function demoStatus() {
  return lastReport;
}

/** Off unless the demo tenant exists. DEMO_REFRESH=off disables it outright. */
export async function resolveDemoTenant(force = false): Promise<string | null> {
  if ((process.env.DEMO_REFRESH ?? "").toLowerCase() === "off") return null;
  if (!force && tenantCache && Date.now() - tenantCache.at < 10 * MIN) return tenantCache.id;
  let id: string | null = process.env.DEMO_TENANT_ID?.trim() || null;
  if (!id) {
    const rows = await db
      .select({ id: schema.companies.id })
      .from(schema.companies)
      .where(ilike(schema.companies.name, `${DEMO_COMPANY_NAME}%`));
    // Exactly one match or nothing: never guess between two companies.
    id = rows.length === 1 ? rows[0]!.id : null;
  }
  if (!id) {
    // Fallback: the company the demo admin login (a "prairiedemo" address) administers.
    const rows = await sdb
      .selectDistinct({ id: schema.memberships.companyId })
      .from(schema.memberships)
      .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
      .where(and(ilike(schema.user.email, "%prairiedemo%"), eq(schema.memberships.role, "admin")));
    id = rows.length === 1 ? rows[0]!.id : null;
  }
  tenantCache = { id, at: Date.now() };
  return id;
}

/** Stable UUID-shaped id from a string (name-based, v5 layout). */
export function stableId(name: string): string {
  const h = createHash("sha1").update(name).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function markerOf(b: Pick<Booking, "fieldData">): string | null {
  try {
    const fd = JSON.parse(b.fieldData || "{}");
    return typeof fd?.[MARKER] === "string" ? fd[MARKER] : null;
  } catch {
    return null;
  }
}

/* ───────────────────────────── context ───────────────────────────── */

interface CustomerRef {
  customerId: string;
  address: string;
  lat: number;
  lng: number;
  customerPhone: string;
  propertyId: string | null;
  region: string;
}

interface Ctx {
  companyId: string;
  tz: string;
  office: { lat: number; lng: number };
  techs: DemoTech[];
  riders: Map<string, Rider>;
  /** title → booking to copy content from */
  templates: Map<string, Booking>;
  durationByService: Map<string, number>;
  customers: CustomerRef[];
}

async function loadContext(companyId: string): Promise<Ctx | null> {
  const t = tdb(companyId);
  const [settings, company, riders, services, bookings] = await Promise.all([
    t.selectOne(schema.companySettings),
    db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).then((r) => r[0]),
    t.select(schema.riders, eq(schema.riders.approval, "active")),
    t.select(schema.services),
    t.select(schema.bookings),
  ]);
  const users = riders.length
    ? await t.select(schema.user, inArray(schema.user.id, riders.map((r) => r.userId)))
    : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name ?? ""]));
  const techs = riders
    .map((r) => ({ id: r.id, name: nameOf.get(r.userId) || r.id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Templates come only from the tenant's own (non-generated) jobs, newest first per title.
  const templates = new Map<string, Booking>();
  const own = bookings
    .filter((b) => !markerOf(b) && b.status !== "cancelled")
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  for (const b of own) if (b.title && !templates.has(b.title)) templates.set(b.title, b);

  const seen = new Set<string>();
  const customers: CustomerRef[] = [];
  for (const b of [...bookings].sort((a, z) => a.address.localeCompare(z.address))) {
    if (seen.has(b.customerId) || !b.address || b.lat == null || b.lng == null) continue;
    seen.add(b.customerId);
    customers.push({
      customerId: b.customerId,
      address: b.address,
      lat: Number(b.lat),
      lng: Number(b.lng),
      customerPhone: b.customerPhone,
      propertyId: b.propertyId,
      region: b.region,
    });
  }
  if (!techs.length || !templates.size || !customers.length) return null;

  const office =
    company?.officeLat != null && company?.officeLng != null
      ? { lat: Number(company.officeLat), lng: Number(company.officeLng) }
      : settings?.lat != null && settings?.lng != null
        ? { lat: Number(settings.lat), lng: Number(settings.lng) }
        : WINNIPEG;

  return {
    companyId,
    tz: settings?.timezone || "America/Winnipeg",
    office,
    techs,
    riders: new Map(riders.map((r) => [r.id, r])),
    templates,
    durationByService: new Map(services.map((s) => [s.id, Number(s.durationMins) || 60])),
    customers,
  };
}

/** The context only changes when someone edits the tenant's crew or catalog — reload it every 10 minutes. */
let ctxCache: { companyId: string; at: number; ctx: Ctx | null } | null = null;
async function cachedContext(companyId: string, now: Date): Promise<Ctx | null> {
  if (ctxCache && ctxCache.companyId === companyId && now.getTime() - ctxCache.at < 10 * MIN && ctxCache.at <= now.getTime()) {
    return ctxCache.ctx;
  }
  const ctx = await loadContext(companyId);
  ctxCache = { companyId, at: now.getTime(), ctx };
  return ctx;
}

/** Test hook: forget cached tenant/context between scenarios. */
export function resetDemoCaches() {
  ctxCache = null;
  tenantCache = null;
  lastTidyAt = 0;
  lastReport = null;
}

function planWindow(ctx: Ctx, now: Date): DemoSlot[] {
  const today = zonedDayKey(now, ctx.tz);
  const templates = [...ctx.templates.values()].map((b) => ({
    title: b.title,
    durationMins: ctx.durationByService.get(b.serviceId) ?? 60,
  }));
  const out: DemoSlot[] = [];
  for (let d = -DAYS_BACK; d <= DAYS_AHEAD; d++) {
    out.push(
      ...planDay(addDays(today, d), {
        tz: ctx.tz,
        techs: ctx.techs,
        templates,
        customerCount: ctx.customers.length,
      }),
    );
  }
  return out;
}

/* ───────────────────────────── writes ───────────────────────────── */

const EVENT_LABEL: Record<string, [string, boolean]> = {
  created: ["Service request received", true],
  assigned: ["Technician assigned", true],
  accepted: ["Technician accepted the job", false],
  enroute: ["Technician on the way", true],
  arrived: ["Technician arrived on site", true],
  started: ["Work started", true],
  completed: ["Work completed", true],
};

/** Timeline entries a job has earned by this phase, each with the moment it happened. */
function eventsFor(p: DemoPhase, createdAt: Date): Array<[string, Date]> {
  const out: Array<[string, Date]> = [["created", createdAt]];
  if (p.assignedAt) out.push(["assigned", p.assignedAt]);
  if (p.acceptedAt) out.push(["accepted", p.acceptedAt]);
  if (p.enrouteAt) out.push(["enroute", p.enrouteAt]);
  if (p.startedAt) out.push(["arrived", p.startedAt], ["started", p.startedAt]);
  if (p.finishedAt) out.push(["completed", p.finishedAt]);
  return out;
}

/** Insert timeline entries. Ids are derived from (job, kind), so a repeat is a no-op. */
async function writeEventRows(
  tx: Executor,
  companyId: string,
  events: Array<{ bookingId: string; kind: string; at: Date; tech: string }>,
) {
  for (let i = 0; i < events.length; i += 200) {
    await tx
      .insert(schema.jobEvents)
      .values(
        events.slice(i, i + 200).map(({ bookingId, kind, at, tech }) => ({
          id: stableId(`demo-ev|${bookingId}|${kind}`),
          companyId,
          bookingId,
          kind,
          actorRole: kind === "created" || kind === "assigned" ? "dispatch" : "tech",
          actorName: kind === "created" || kind === "assigned" ? "" : tech,
          label: EVENT_LABEL[kind]![0],
          customerVisible: EVENT_LABEL[kind]![1],
          createdAt: at,
        })),
      )
      .onConflictDoNothing();
  }
}

async function writeEvents(
  tx: Executor,
  companyId: string,
  booking: { id: string },
  events: Array<[string, Date]>,
  techName: string,
) {
  await writeEventRows(tx, companyId, events.map(([kind, at]) => ({ bookingId: booking.id, kind, at, tech: techName })));
}

/** Columns that follow from the job's phase. */
function phaseColumns(p: DemoPhase, durationMins: number, leadMins: number): Partial<Booking> {
  const live = p.status === "in_progress";
  const done = p.status === "completed";
  return {
    status: p.status,
    assignStatus: p.assignStatus,
    assignedAt: p.assignedAt,
    acceptedAt: p.acceptedAt,
    enrouteAt: p.enrouteAt,
    startedAt: p.startedAt,
    finishedAt: p.finishedAt,
    etaMins: p.etaMins,
    clockState: live ? "running" : "idle",
    lastResumeAt: live ? p.startedAt : null,
    insideGeofence: live,
    accumulatedMs: done ? durationMins * MIN : 0,
    onSiteMinutes: done ? durationMins : 0,
    transitMinutes: p.startedAt ? leadMins : 0,
    paymentStatus: done ? "paid" : "unpaid",
    delayFlaggedAt: null,
    delayFlaggedMins: null,
  };
}

function resetChecklist(raw: string): string {
  try {
    const list = JSON.parse(raw || "[]");
    return Array.isArray(list) ? JSON.stringify(list.map((i: any) => ({ ...i, done: false }))) : "[]";
  } catch {
    return "[]";
  }
}

function contentFrom(tpl: Booking, slot: DemoSlot, cust: CustomerRef, companyId: string) {
  let customFields: unknown;
  try {
    customFields = JSON.parse(tpl.fieldData || "{}")?._customFields;
  } catch {
    /* none */
  }
  const fieldData: Record<string, unknown> = { [MARKER]: slot.key };
  if (Array.isArray(customFields)) fieldData._customFields = customFields;
  return {
    id: stableId(`demo|${companyId}|${slot.key}`),
    companyId,
    customerId: cust.customerId,
    serviceId: tpl.serviceId,
    templateId: tpl.templateId,
    title: slot.title,
    priority: slot.priority,
    scheduledAt: slot.start,
    address: cust.address,
    propertyId: cust.propertyId,
    lat: cust.lat,
    lng: cust.lng,
    customerPhone: cust.customerPhone,
    region: cust.region || tpl.region,
    notes: slot.notes ?? tpl.notes,
    staffNotes: slot.notes ? "" : tpl.staffNotes,
    fieldData: JSON.stringify(fieldData),
    checklistState: resetChecklist(tpl.checklistState),
    price: tpl.price,
    rateModel: tpl.rateModel,
    lineItems: tpl.lineItems,
    lineItemsCost: tpl.lineItemsCost,
    lineItemsPrice: tpl.lineItemsPrice,
    subtotal: tpl.subtotal,
    taxAmount: tpl.taxAmount,
    taxRatePct: tpl.taxRatePct,
    taxLabel: tpl.taxLabel,
    total: tpl.total,
    priceBreakdown: tpl.priceBreakdown,
    requiredSkillClass: tpl.requiredSkillClass,
    requiredSkills: tpl.requiredSkills,
  };
}

/* ───────────────────────────── the tick ───────────────────────────── */

/**
 * One pass: fill, advance, move vans, and (hourly) tidy. Safe to call as often
 * as you like and from more than one instance — every write is idempotent.
 */
export async function demoTick(opts: { now?: Date; tidy?: boolean } = {}): Promise<DemoReport> {
  const now = opts.now ?? new Date();
  const report: DemoReport = {
    companyId: null,
    ranAt: now.toISOString(),
    created: 0,
    advanced: 0,
    techsOnline: 0,
    tidied: false,
    closedLegacy: 0,
  };
  const companyId = await resolveDemoTenant();
  report.companyId = companyId;
  if (!companyId) {
    report.skipped = "no demo tenant";
    return (lastReport = report);
  }
  const ctx = await cachedContext(companyId, now);
  if (!ctx) {
    report.skipped = "demo tenant has no technicians, jobs or customers to work from";
    return (lastReport = report);
  }
  const t = tdb(companyId);
  const slots = planWindow(ctx, now);
  const slotByKey = new Map(slots.map((s) => [s.key, s]));
  const windowStart = new Date(Math.min(...slots.map((s) => s.start.getTime()), now.getTime()) - 12 * HOUR);

  const managed = await t.select(
    schema.bookings,
    and(like(schema.bookings.fieldData, MARKER_LIKE), gte(schema.bookings.scheduledAt, windowStart)),
  );
  const byKey = new Map<string, Booking>();
  for (const b of managed) {
    const k = markerOf(b);
    if (k) byKey.set(k, b);
  }
  const techName = (riderId: string | null | undefined) =>
    ctx.techs.find((x) => x.id === riderId)?.name ?? "";

  await t.transaction(async (tx) => {
    // 1. FILL — batched, because the first run after a deploy writes a week of jobs at once.
    const fresh: Array<{ slot: DemoSlot; row: any; phase: DemoPhase; tpl: Booking; cust: CustomerRef }> = [];
    for (const slot of slots) {
      if (byKey.has(slot.key) || slot.appearAt.getTime() > now.getTime()) continue;
      const tpl = ctx.templates.get(slot.templateTitle);
      const cust = ctx.customers[slot.customerIndex % ctx.customers.length];
      if (!tpl || !cust) continue;
      const phase = phaseAt({ ...slot, hasTech: !!slot.techId }, now);
      const row = {
        ...contentFrom(tpl, slot, cust, companyId),
        riderId: phase.hasTech ? slot.techId : null,
        ...phaseColumns(phase, slot.durationMins, slot.leadMins),
        createdAt: new Date(Math.min(slot.appearAt.getTime(), now.getTime())),
      };
      fresh.push({ slot, row, phase, tpl, cust });
    }
    for (let i = 0; i < fresh.length; i += 50) {
      const chunk = fresh.slice(i, i + 50);
      const inserted = new Set(
        (
          await tx
            .insert(schema.bookings)
            .values(chunk.map((f) => f.row as typeof schema.bookings.$inferInsert))
            .onConflictDoNothing()
            .returning({ id: schema.bookings.id })
        ).map((r) => r.id),
      );
      const mine = chunk.filter((f) => inserted.has(f.row.id)); // another instance may have beaten us to some
      if (!mine.length) continue;
      report.created += mine.length;
      await tx
        .insert(schema.invoices)
        .values(
          mine.map(({ row, phase, tpl, cust }) => ({
            id: stableId(`demo-inv|${row.id}`),
            companyId,
            bookingId: row.id,
            customerId: cust.customerId,
            number: `INV-${String(parseInt(row.id.slice(0, 8), 16) % 1_000_000).padStart(6, "0")}`,
            amount: tpl.subtotal,
            tax: tpl.taxAmount,
            total: tpl.total,
            status: phase.status === "completed" ? "paid" : "unpaid",
            paidAt: phase.finishedAt,
            createdAt: row.createdAt,
          })),
        )
        .onConflictDoNothing();
      const events = mine.flatMap(({ row, phase }) =>
        eventsFor(phase, row.createdAt).map(([kind, at]) => ({ bookingId: row.id, kind, at, tech: techName(row.riderId) })),
      );
      await writeEventRows(tx, companyId, events);
      for (const f of mine) byKey.set(f.slot.key, { ...(f.row as Booking) });
    }

    // 2. ADVANCE
    for (const [key, b] of byKey) {
      if (b.status === "cancelled" || b.deletedAt) continue;
      const slot = slotByKey.get(key);
      const durationMins = ctx.durationByService.get(b.serviceId) ?? slot?.durationMins ?? 60;
      const leadMins = slot?.leadMins ?? 20;
      const plannedTech = b.riderId ?? slot?.techId ?? null;
      const phase = phaseAt(
        {
          start: new Date(b.scheduledAt), // honour a job someone moved by hand
          durationMins,
          leadMins,
          appearAt: slot?.appearAt ?? new Date(b.createdAt ?? b.scheduledAt),
          assignAt: b.riderId ? null : slot?.assignAt ?? null,
          offerUntil: slot?.offerUntil ?? null,
          hasTech: !!plannedTech,
        },
        now,
      );
      const rankNow = STATUS_RANK[b.status] ?? 0;
      const rankWant = STATUS_RANK[phase.status] ?? 0;
      const etaChanged = phase.status === "enroute" && b.etaMins !== phase.etaMins;
      const offerChanged = b.assignStatus !== phase.assignStatus && rankWant === rankNow;
      const needsTech = phase.hasTech && !b.riderId;
      if (rankWant < rankNow) continue; // forward only — a hand-made change wins
      if (rankWant === rankNow && !etaChanged && !offerChanged && !needsTech && !b.delayFlaggedAt) continue;

      const set: Partial<Booking> = { ...phaseColumns(phase, durationMins, leadMins) };
      if (needsTech) set.riderId = plannedTech;
      await tx
        .update(schema.bookings)
        .set(set)
        .where(and(eq(schema.bookings.companyId, companyId), eq(schema.bookings.id, b.id)));
      if (rankWant > rankNow || needsTech) {
        await writeEvents(tx, companyId, b, eventsFor(phase, new Date(b.createdAt ?? now)), techName(plannedTech));
        if (phase.status === "completed") {
          await tx
            .update(schema.invoices)
            .set({ status: "paid", paidAt: phase.finishedAt })
            .where(and(eq(schema.invoices.companyId, companyId), eq(schema.invoices.bookingId, b.id)));
        }
      }
      Object.assign(b, set);
      report.advanced++;
    }

    // 3. MOVE THE VANS
    report.techsOnline = await moveTechs(tx, ctx, [...byKey.values()], slotByKey, now);
  });

  // 4. TIDY (hourly)
  if (opts.tidy || now.getTime() - lastTidyAt >= HOUR) {
    report.closedLegacy = await tidy(ctx, now);
    report.tidied = true;
    lastTidyAt = now.getTime();
  }
  return (lastReport = report);
}

/**
 * Give every tech who is "on shift" right now a fresh heartbeat and a
 * believable position. On shift = within an hour before the drive to a job
 * starts, through 90 minutes after it ends. Off-shift techs are left alone, so
 * their heartbeat ages out and presence shows them offline (nights, days off).
 */
async function moveTechs(
  tx: Executor,
  ctx: Ctx,
  jobs: Booking[],
  slotByKey: Map<string, DemoSlot>,
  now: Date,
): Promise<number> {
  const t = now.getTime();
  let online = 0;
  for (const riderId of ctx.riders.keys()) {
    const mine = jobs
      .filter((b) => b.riderId === riderId && b.status !== "cancelled" && !b.deletedAt)
      .map((b) => {
        const slot = slotByKey.get(markerOf(b) ?? "");
        const start = new Date(b.scheduledAt).getTime();
        const dur = (ctx.durationByService.get(b.serviceId) ?? 60) * MIN;
        const lead = (slot?.leadMins ?? 20) * MIN;
        return { b, start, end: start + dur, lead };
      })
      .sort((a, z) => a.start - z.start);
    const onShift = mine.some((j) => t >= j.start - j.lead - HOUR && t <= j.end + 90 * MIN);
    if (!onShift) continue;

    const driving = mine.find((j) => j.b.status === "enroute");
    const working = mine.find((j) => j.b.status === "in_progress" || j.b.status === "arrived");
    const lastDone = [...mine].reverse().find((j) => j.end <= t && j.end >= t - 12 * HOUR);
    const at = (b: Booking) => ({ lat: Number(b.lat), lng: Number(b.lng) });
    let pos = ctx.office;
    let status = "available";
    if (working) {
      pos = at(working.b);
      status = "onsite";
    } else if (driving) {
      const prev = [...mine].reverse().find((j) => j.end <= driving.start && j.end >= driving.start - 6 * HOUR);
      const from = prev ? at(prev.b) : ctx.office;
      pos = lerp(from, at(driving.b), (t - (driving.start - driving.lead)) / driving.lead);
      status = "enroute";
    } else if (lastDone) {
      pos = at(lastDone.b);
    }
    await tx
      .update(schema.riders)
      .set({ lat: pos.lat, lng: pos.lng, locationUpdatedAt: now, status, manualOffline: false })
      .where(and(eq(schema.riders.companyId, ctx.companyId), eq(schema.riders.id, riderId)));
    online++;
  }
  return online;
}

/**
 * Hourly housekeeping: close out the original seed's jobs that are stuck in a
 * live status in the past, clear any "running late" flags, archive generated
 * jobs older than 30 days, and keep email/SMS off for the demo tenant.
 */
async function tidy(ctx: Ctx, now: Date): Promise<number> {
  const t = tdb(ctx.companyId);
  const LIVE = ["pending", "unassigned", "confirmed", "assigned", "accepted", "enroute", "arrived", "in_progress"];
  const cutoff = new Date(now.getTime() - 3 * HOUR);
  let closed = 0;
  await t.transaction(async (tx) => {
    const own = and(eq(schema.bookings.companyId, ctx.companyId), isNull(schema.bookings.deletedAt));
    const stale = await tx
      .select()
      .from(schema.bookings)
      .where(
        and(
          own,
          not(like(schema.bookings.fieldData, MARKER_LIKE)),
          inArray(schema.bookings.status, LIVE),
          lt(schema.bookings.scheduledAt, cutoff),
        ),
      );
    for (const b of stale) {
      const start = new Date(b.scheduledAt);
      const dur = ctx.durationByService.get(b.serviceId) ?? 60;
      if (b.riderId) {
        await tx
          .update(schema.bookings)
          .set({
            ...phaseColumns(
              {
                status: "completed", assignStatus: "accepted", hasTech: true,
                assignedAt: b.assignedAt ?? start, acceptedAt: b.acceptedAt ?? start,
                enrouteAt: b.enrouteAt ?? new Date(start.getTime() - 20 * MIN),
                startedAt: b.startedAt ?? start, finishedAt: new Date(start.getTime() + dur * MIN), etaMins: null,
              },
              dur,
              20,
            ),
            delayNotifiedAt: null,
            delayNotifiedMins: null,
          })
          .where(and(own, eq(schema.bookings.id, b.id)));
      } else {
        // Never dispatched and long past: archive rather than invent a tech for it.
        await tx.update(schema.bookings).set({ deletedAt: now }).where(and(own, eq(schema.bookings.id, b.id)));
      }
      closed++;
    }
    await tx
      .update(schema.bookings)
      .set({ delayFlaggedAt: null, delayFlaggedMins: null, delayNotifiedAt: null, delayNotifiedMins: null })
      .where(and(own, or(isNotNull(schema.bookings.delayFlaggedAt), isNotNull(schema.bookings.delayNotifiedAt))));
    await tx
      .update(schema.bookings)
      .set({ deletedAt: now })
      .where(
        and(own, like(schema.bookings.fieldData, MARKER_LIKE), lt(schema.bookings.scheduledAt, new Date(now.getTime() - 30 * 24 * HOUR))),
      );
    await tx
      .update(schema.notificationChannels)
      .set({ emailEnabled: false, smsEnabled: false, webhookEnabled: false })
      .where(eq(schema.notificationChannels.companyId, ctx.companyId));
  });
  return closed;
}

/** What a health check needs: is the demo current, and is anything showing late? */
export async function demoHealth(now = new Date()) {
  const companyId = await resolveDemoTenant();
  if (!companyId) return { enabled: false as const };
  const t = tdb(companyId);
  const settings = await t.selectOne(schema.companySettings);
  const tz = settings?.timezone || "America/Winnipeg";
  const lastDay = addDays(zonedDayKey(now, tz), DAYS_AHEAD);
  const rows = await t.select(
    schema.bookings,
    and(isNull(schema.bookings.deletedAt), gte(schema.bookings.scheduledAt, new Date(now.getTime() - 24 * HOUR))),
  );
  const live = rows.filter((b) => b.status !== "cancelled");
  const late = live.filter(
    (b) =>
      ["pending", "confirmed", "assigned", "accepted"].includes(b.status) &&
      new Date(b.scheduledAt).getTime() < now.getTime() - 10 * MIN,
  ).length;
  const byDay = new Map<string, number>();
  for (const b of live) {
    const d = zonedDayKey(new Date(b.scheduledAt), tz);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  const daysCovered = [...Array(DAYS_AHEAD + 1)].map((_, i) => addDays(zonedDayKey(now, tz), i));
  const emptyDays = daysCovered.filter((d) => !byDay.get(d));
  const activeNow = live.filter((b) => ["enroute", "arrived", "in_progress"].includes(b.status)).length;
  return {
    enabled: true as const,
    lastTick: lastReport?.ranAt ?? null,
    jobsToday: byDay.get(zonedDayKey(now, tz)) ?? 0,
    filledThrough: emptyDays.length ? null : lastDay,
    emptyDays,
    activeNow,
    late,
    healthy: late === 0 && emptyDays.length === 0,
  };
}
