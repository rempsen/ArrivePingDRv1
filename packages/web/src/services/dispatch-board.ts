/**
 * Dispatch board — everything the Map v2 screen needs, in one snapshot.
 *
 * The classic map polled three endpoints, and the fleet one ran about three
 * queries per technician every five seconds. This is four reads whatever the
 * team size (settings, technicians, jobs, company), and open maps keep it fresh
 * from the live dispatch channel instead of polling (see routes/dispatch.ts).
 *
 * Which jobs are on the board:
 *  - every job scheduled on the selected day (company time), any status but
 *    cancelled — the day's pins and each technician's day;
 *  - every waiting job (no technician, not finished) from any day — a job
 *    waiting for a tech never drops out of sight because of its date;
 *  - every job in the field right now, whatever its date.
 * Archived jobs never. Capped at BOARD_JOB_LIMIT, live work and the day first.
 */
import { isFeatureOn } from "./features";
import { and, asc, eq, gte, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../api/database";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { DEFAULT_TZ, namedDayBounds, safeTimeZone, zonedDayKey } from "../shared/tz";
import { IN_FLIGHT_STATUSES, TERMINAL_STATUSES } from "../shared/job-status";
import { jobMinutes } from "../shared/availability";
import { parseSkills } from "../shared/qualify";
import { addDays } from "../shared/schedule-layout";
import { STALE_LOCATION_MS } from "../shared/board-patch";

export const BOARD_JOB_LIMIT = 3000;
export { STALE_LOCATION_MS } from "../shared/board-patch";

/** bookings.lat/lng default to downtown Toronto when an address never geocoded. */
const DEFAULT_JOB_POINT = { lat: 43.6532, lng: -79.3832 };

const IN_FIELD: readonly string[] = IN_FLIGHT_STATUSES;
/** Job statuses that occupy a technician: offered/accepted, or in the field. */
const OCCUPYING: readonly string[] = ["assigned", ...IN_FLIGHT_STATUSES];

export interface BoardTech {
  id: string;
  userId: string;
  name: string;
  phone: string;
  photoUrl: string;
  color: string;
  vehicle: string;
  /** riders.status: offline | available | enroute | onsite | break | busy */
  status: string;
  skills: string[];
  skillClass: string;
  lat: number | null;
  lng: number | null;
  /** ISO time of the last location, or null if they never reported one. */
  locationAt: string | null;
  /** Location older than STALE_LOCATION_MS. */
  stale: boolean;
  /** Offered, accepted and in-field jobs they hold. */
  openJobs: number;
  /** When the job they're on in the field is expected to wrap up (ISO), else null. */
  freeAt: string | null;
  /** The job they're on in the field right now. */
  currentJobId: string | null;
  /** Their next (not yet started) jobs, soonest first, at most three. */
  nextJobIds: string[];
}

export interface BoardJob {
  id: string;
  title: string;
  service: string;
  category: string;
  durationMins: number;
  /** The job's own length when the office set one; null = follows the service. */
  durationOverride: number | null;
  status: string;
  assignStatus: string;
  priority: string;
  /** Null when the address never resolved to a real place. */
  lat: number | null;
  lng: number | null;
  address: string;
  scheduledAt: string;
  riderId: string | null;
  customerName: string;
  /** The number to text or call for this job: the job's own, else the client's. */
  customerPhone: string;
  /** What the client pays (subtotal + tax). */
  total: number;
  requiredSkillClass: string;
  requiredSkills: string[];
  etaMins: number | null;
  /** The running-late watch flagged it. */
  late: boolean;
  isSample: boolean;
  /** Set when an automation rule assigned it (shown as the "A" badge); "" otherwise. */
  autoAssignedRuleId: string;
}

export interface Board {
  /** The day shown, YYYY-MM-DD in company time (the first of them when `days` > 1). */
  day: string;
  /** How many days from `day` the jobs cover (the calendar's week view asks for 7). */
  days: number;
  tz: string;
  workerNoun: string;
  jobNoun: string;
  office: { lat: number; lng: number } | null;
  /** Map v2 is on by default for this company (our own companies first). */
  mapV2Default: boolean;
  /** More jobs matched than BOARD_JOB_LIMIT; the rest were left off. */
  truncated: boolean;
  generatedAt: string;
  techs: BoardTech[];
  jobs: BoardJob[];
  /** Days off in the range (company-time days), so the calendar doesn't suggest them. */
  timeOff: Array<{ techId: string; day: string }>;
}

/** The minimum a job needs for the "free at" estimate. */
export interface FreeAtJob {
  status: string;
  scheduledAt: Date | string | number;
  startedAt: Date | string | number | null;
  durationMins: number | null;
  etaMins: number | null;
  /** The on-site clock, when the job uses it: paused time isn't work done. */
  clockState?: string | null;
  accumulatedMs?: number | null;
  lastResumeAt?: Date | string | number | null;
}

const ms = (v: Date | string | number | null | undefined): number | null => {
  if (v == null) return null;
  const n = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * When a technician's current field work should wrap up, or null if they
 * aren't in the field. The same model as ai-dispatch's techWorkload, limited to
 * the work in front of them now: working → what's left of the job (at least 5
 * min); on site → the whole job; driving → the drive (ETA, else 10 min) plus
 * the job. Later assignments are a schedule question (overlap), not "busy now".
 */
export function freeAtFor(jobs: readonly FreeAtJob[], now: number): number | null {
  let end: number | null = null;
  for (const j of jobs) {
    if (!IN_FIELD.includes(j.status)) continue;
    const dur = jobMinutes(j.durationMins);
    let remaining: number;
    const started = ms(j.startedAt);
    const clock = j.clockState === "running" || j.clockState === "paused";
    if ((j.status === "in_progress" || j.status === "onsite" || j.status === "paused") && (clock || started != null)) {
      // Work done: the on-site clock when it's in use (a paused stretch isn't
      // work), else the wall time since they started.
      const resumed = ms(j.lastResumeAt);
      const workedMs = clock
        ? (j.accumulatedMs ?? 0) + (j.clockState === "running" && resumed != null ? Math.max(0, now - resumed) : 0)
        : now - started!;
      remaining = Math.max(5, dur - workedMs / 60_000);
    } else if (j.status === "enroute") {
      remaining = (j.etaMins ?? 10) + dur;
    } else {
      remaining = dur;
    }
    const at = now + remaining * 60_000;
    end = end == null ? at : Math.max(end, at);
  }
  return end;
}

const FIELD_RANK: Record<string, number> = { in_progress: 0, paused: 1, onsite: 2, arrived: 3, enroute: 4 };

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** The most days one board read covers (the calendar's week view). */
export const MAX_BOARD_DAYS = 7;

export async function loadBoard(companyId: string, opts: { day?: string | null; days?: number; now?: Date } = {}): Promise<Board> {
  const now = opts.now ?? new Date();
  const t = tdb(companyId);

  // 1. Settings first: the day's bounds depend on the company's time zone.
  const settings = await t.selectOne(schema.companySettings);
  const tz = safeTimeZone(settings?.timezone ?? DEFAULT_TZ);
  const day = opts.day && /^\d{4}-\d{2}-\d{2}$/.test(opts.day) ? opts.day : zonedDayKey(now, tz);
  const days = Math.min(MAX_BOARD_DAYS, Math.max(1, Math.floor(opts.days ?? 1)));
  const { start } = namedDayBounds(day, tz);
  const { end } = namedDayBounds(days > 1 ? addDays(day, days - 1) : day, tz);
  const dayEnd = new Date(end.getTime() + 1); // exclusive

  const customer = alias(schema.user, "dispatch_customer");
  const B = schema.bookings;
  const inDay = and(gte(B.scheduledAt, start), lt(B.scheduledAt, dayEnd));
  const waiting = and(isNull(B.riderId), notInArray(B.status, [...TERMINAL_STATUSES]));
  const live = inArray(B.status, [...IN_FLIGHT_STATUSES]);

  const [techRows, jobRows, company, offRows] = await Promise.all([
    // 2. Technicians with their names. Deactivated ones can't be dispatched.
    t.transaction((tx) =>
      tx
        .select({
          id: schema.riders.id,
          userId: schema.riders.userId,
          name: schema.user.name,
          userPhone: schema.user.phone,
          phone: schema.riders.phone,
          photoUrl: schema.riders.photoUrl,
          color: schema.riders.color,
          vehicle: schema.riders.vehicle,
          status: schema.riders.status,
          skills: schema.riders.skills,
          skillClass: schema.riders.skillClass,
          lat: schema.riders.lat,
          lng: schema.riders.lng,
          locationUpdatedAt: schema.riders.locationUpdatedAt,
        })
        .from(schema.riders)
        .leftJoin(schema.user, eq(schema.user.id, schema.riders.userId))
        .where(t.scope(schema.riders, ne(schema.riders.approval, "suspended"))),
    ),
    // 3. Jobs, with the service and the customer's name.
    t.transaction((tx) =>
      tx
        .select({
          id: B.id,
          title: B.title,
          status: B.status,
          assignStatus: B.assignStatus,
          priority: B.priority,
          lat: B.lat,
          lng: B.lng,
          address: B.address,
          scheduledAt: B.scheduledAt,
          startedAt: B.startedAt,
          clockState: B.clockState,
          accumulatedMs: B.accumulatedMs,
          lastResumeAt: B.lastResumeAt,
          riderId: B.riderId,
          requiredSkillClass: B.requiredSkillClass,
          requiredSkills: B.requiredSkills,
          etaMins: B.etaMins,
          delayFlaggedAt: B.delayFlaggedAt,
          isSample: B.isSample,
          autoAssignedRuleId: B.autoAssignedRuleId,
          serviceName: schema.services.name,
          category: schema.services.category,
          durationMins: sql<number | null>`coalesce(${B.durationMins}, ${schema.services.durationMins})`,
          customerName: customer.name,
          durationOverride: B.durationMins,
          customerPhone: sql<string | null>`coalesce(nullif(${B.customerPhone}, ''), ${customer.phone})`,
          total: B.total,
        })
        .from(B)
        .leftJoin(schema.services, eq(schema.services.id, B.serviceId))
        .leftJoin(customer, eq(customer.id, B.customerId))
        .where(t.scope(B, and(isNull(B.deletedAt), ne(B.status, "cancelled"), or(inDay, waiting, live))))
        // If the cap bites, keep live work, then the day, then the waiting queue.
        .orderBy(sql`case when ${live} then 0 when ${inDay} then 1 else 2 end`, asc(B.scheduledAt))
        .limit(BOARD_JOB_LIMIT + 1),
    ),
    // 4. The company: office pin (the Map v2 default is its feature switch).
    db
      .select({ officeLat: schema.companies.officeLat, officeLng: schema.companies.officeLng })
      .from(schema.companies)
      .where(eq(schema.companies.id, companyId))
      .then((r) => r[0] ?? null),
    // 5. Time off in the range (a day either side covers every zone offset).
    t.select(
      schema.techShifts,
      and(
        eq(schema.techShifts.kind, "timeoff"),
        gte(schema.techShifts.date, new Date(start.getTime() - 48 * 3_600_000)),
        lt(schema.techShifts.date, new Date(dayEnd.getTime() + 48 * 3_600_000)),
      ),
    ),
  ]);
  const rangeDays = new Set(Array.from({ length: days }, (_, i) => addDays(day, i)));
  const timeOff = [
    ...new Map(
      offRows
        .map((s) => ({ techId: s.riderId, day: zonedDayKey(new Date(s.date), tz) }))
        .filter((o) => rangeDays.has(o.day))
        .map((o) => [`${o.techId}|${o.day}`, o] as const),
    ).values(),
  ];

  const truncated = jobRows.length > BOARD_JOB_LIMIT;
  const rows = truncated ? jobRows.slice(0, BOARD_JOB_LIMIT) : jobRows;
  const office =
    company?.officeLat != null && company?.officeLng != null ? { lat: company.officeLat, lng: company.officeLng } : null;
  // A job still sitting on the schema's default point never geocoded. Unless
  // the company really works in downtown Toronto, it has no place on the map.
  const defaultPointIsReal = office != null && distanceKm(office, DEFAULT_JOB_POINT) < 150;

  const jobs: BoardJob[] = rows
    .map((r) => {
      const unplaced =
        r.lat == null ||
        r.lng == null ||
        (!defaultPointIsReal && Math.abs(r.lat - DEFAULT_JOB_POINT.lat) < 1e-6 && Math.abs(r.lng - DEFAULT_JOB_POINT.lng) < 1e-6);
      return {
        id: r.id,
        title: r.title || r.serviceName || "",
        service: r.serviceName ?? "",
        category: r.category ?? "",
        durationMins: jobMinutes(r.durationMins),
        durationOverride: r.durationOverride ?? null,
        status: r.status,
        assignStatus: r.assignStatus,
        priority: r.priority,
        lat: unplaced ? null : r.lat,
        lng: unplaced ? null : r.lng,
        address: r.address,
        scheduledAt: new Date(r.scheduledAt).toISOString(),
        riderId: r.riderId,
        customerName: r.customerName ?? "",
        customerPhone: r.customerPhone ?? "",
        total: Number(r.total) || 0,
        requiredSkillClass: r.requiredSkillClass,
        requiredSkills: parseSkills(r.requiredSkills),
        etaMins: r.etaMins,
        late: r.delayFlaggedAt != null && !TERMINAL_STATUSES.includes(r.status as never),
        isSample: r.isSample,
        autoAssignedRuleId: r.autoAssignedRuleId ?? "",
      };
    })
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  // Per-technician workload from the same rows (no extra queries).
  const byTech = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.riderId || !OCCUPYING.includes(r.status)) continue;
    const list = byTech.get(r.riderId) ?? [];
    list.push(r);
    byTech.set(r.riderId, list);
  }

  const nowMs = now.getTime();
  const techs: BoardTech[] = techRows
    .map((r) => {
      const mine = byTech.get(r.id) ?? [];
      const inField = mine
        .filter((j) => IN_FIELD.includes(j.status))
        .sort((a, b) => (FIELD_RANK[a.status] ?? 9) - (FIELD_RANK[b.status] ?? 9));
      const upcoming = mine
        .filter((j) => !IN_FIELD.includes(j.status))
        .sort((a, b) => Number(new Date(a.scheduledAt)) - Number(new Date(b.scheduledAt)));
      const freeAt = freeAtFor(
        inField.map((j) => ({
          status: j.status,
          scheduledAt: j.scheduledAt,
          startedAt: j.startedAt,
          durationMins: j.durationMins,
          etaMins: j.etaMins,
          clockState: j.clockState,
          accumulatedMs: j.accumulatedMs,
          lastResumeAt: j.lastResumeAt,
        })),
        nowMs,
      );
      const locMs = ms(r.locationUpdatedAt);
      return {
        id: r.id,
        userId: r.userId,
        name: (r.name ?? "").trim(),
        phone: r.phone || r.userPhone || "",
        photoUrl: r.photoUrl,
        color: r.color,
        vehicle: r.vehicle,
        status: r.status,
        skills: parseSkills(r.skills),
        skillClass: r.skillClass,
        lat: r.lat,
        lng: r.lng,
        locationAt: locMs != null ? new Date(locMs).toISOString() : null,
        stale: locMs != null && nowMs - locMs > STALE_LOCATION_MS,
        openJobs: mine.length,
        freeAt: freeAt != null ? new Date(freeAt).toISOString() : null,
        currentJobId: inField[0]?.id ?? null,
        nextJobIds: upcoming.slice(0, 3).map((j) => j.id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    day,
    days,
    tz,
    workerNoun: settings?.workerNoun || "Technician",
    jobNoun: settings?.jobNoun || "Job",
    office,
    mapV2Default: await isFeatureOn(companyId, "dispatch.map_v2"),
    truncated,
    generatedAt: now.toISOString(),
    techs,
    jobs,
    timeOff,
  };
}
