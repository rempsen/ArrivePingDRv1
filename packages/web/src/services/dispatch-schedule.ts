/**
 * Moving a job in time from the dispatch calendar — at once, with Undo — and
 * the per-day load summary behind the Month view.
 *
 * The same promise as dispatch-assign.ts: an undone move texts nobody. Moving a
 * job normally fires "rescheduled" at once (the technician's SMS and the
 * customer's email). Here it waits out the Undo window; see
 * services/dispatch-notices.ts for how that notice decides what to say.
 *
 * Guards are the ones POST /bookings/:id/schedule has: a finished or cancelled
 * job can't move (its date is in reports and payouts), and a time the
 * technician is already booked or off comes back as a question the dispatcher
 * can override.
 */
import { and, eq, gte, isNull, lt, ne } from "drizzle-orm";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { DEFAULT_TZ, namedDayBounds, safeTimeZone, zonedDayKey } from "../shared/tz";
import { isTerminalStatus } from "../shared/job-status";
import { addDays, durationOf } from "../shared/schedule-layout";
import { findAvailabilityBlock } from "./availability";
import { readAnyUndo, signUndo, undoAssign, UNDO_TOKEN_TTL_MS, type JobPatch, type UndoOutcome } from "./dispatch-assign";
import { currentMoveGen, noteMove, noteMoveUndone } from "./dispatch-notices";
import { logJobEvent } from "./job-events";
import { publishDispatch } from "./realtime";

export { RESCHEDULED_NOTICE_TASK } from "./dispatch-notice-kinds";
/** The longest range the Month view asks for (six weeks). */
export const MAX_LOAD_DAYS = 42;

export type ScheduleOutcome =
  | { ok: true; job: JobPatch & { scheduledAt: string }; undo: string | null }
  | { ok: false; status: 404 | 409; message: string; forceable: boolean; reason?: string };

const patchOf = (b: typeof schema.bookings.$inferSelect) => ({
  id: b.id,
  status: b.status,
  assignStatus: b.assignStatus,
  riderId: b.riderId,
  scheduledAt: new Date(b.scheduledAt).toISOString(),
});

export async function dispatchSchedule(
  companyId: string,
  input: { bookingId: string; scheduledAt: string; force?: boolean; by: string },
  now = Date.now(),
): Promise<ScheduleOutcome> {
  const t = tdb(companyId);
  const prev = await t.selectOne(schema.bookings, eq(schema.bookings.id, input.bookingId));
  if (!prev || prev.deletedAt) return { ok: false, status: 404, message: "Work order not found", forceable: false };
  if (isTerminalStatus(prev.status))
    return {
      ok: false,
      status: 409,
      forceable: false,
      message:
        prev.status === "completed"
          ? "This job is already completed — its date is part of your reports and payouts and can't be moved."
          : "This job was cancelled — restore it before rescheduling.",
    };

  const to = new Date(input.scheduledAt);
  if (!input.force) {
    const busy = await findAvailabilityBlock(companyId, {
      riderId: prev.riderId,
      scheduledAt: to,
      bookingId: prev.id,
      serviceId: prev.serviceId,
    });
    if (busy) return { ok: false, status: 409, message: busy.message, reason: busy.kind, forceable: true };
  }

  const from = new Date(prev.scheduledAt);
  if (from.getTime() === to.getTime()) return { ok: true, job: patchOf(prev), undo: null };

  // Compare-and-set on what was checked: a job finished, cancelled, moved or
  // given to someone else in the meantime is left alone.
  const B = schema.bookings;
  const [b] = await t.update(
    B,
    { scheduledAt: to },
    and(
      eq(B.id, prev.id),
      eq(B.status, prev.status),
      eq(B.scheduledAt, prev.scheduledAt),
      prev.riderId ? eq(B.riderId, prev.riderId) : isNull(B.riderId),
      isNull(B.deletedAt),
    ),
  );
  if (!b) return { ok: false, status: 409, message: "This job just changed — pull it up again to see where it is now.", forceable: false };

  const gen = await noteMove(companyId, prev.id, { from, to });
  void publishDispatch(companyId, { kind: "job", jobId: prev.id });

  // Already announced (the notice couldn't be held): no Undo to offer.
  if (!gen) return { ok: true, job: patchOf(b), undo: null };
  const undo = signUndo({
    v: 1,
    k: "time",
    c: companyId,
    b: prev.id,
    f: from.toISOString(),
    t: to.toISOString(),
    r: prev.riderId ?? "",
    m: new Date().toISOString(),
    q: gen,
    exp: now + UNDO_TOKEN_TTL_MS,
  });
  return { ok: true, job: patchOf(b), undo };
}

export async function undoSchedule(companyId: string, token: unknown, by: string, now = Date.now()): Promise<UndoOutcome> {
  const c = readAnyUndo(token, now);
  if (c === "invalid" || (typeof c !== "string" && c.k !== "time")) return { ok: false, status: 400, message: "That Undo isn't valid any more." };
  if (c === "expired") return { ok: false, status: 410, message: "Too late to undo — open the job to change it." };
  if (c.c !== companyId) return { ok: false, status: 404, message: "Work order not found" };

  const t = tdb(companyId);
  const B = schema.bookings;
  // Only the latest move can be undone: moved away and back since, the job
  // may sit at the same time, but this token's move isn't the last one.
  if (c.q && (await currentMoveGen(companyId, c.b)) !== c.q)
    return { ok: false, status: 409, message: "This job changed since you moved it — open it to see where it is now." };
  // The old slot may have been filled since: don't put the job back into a
  // double booking or a day off without asking (open the job to force it).
  const cur = await t.selectOne(B, eq(B.id, c.b));
  if (cur && !cur.deletedAt) {
    const busy = await findAvailabilityBlock(companyId, { riderId: cur.riderId, scheduledAt: new Date(c.f), bookingId: cur.id, serviceId: cur.serviceId });
    if (busy) return { ok: false, status: 409, message: `Can't put it back: ${busy.message} Open the job to move it.` };
  }
  // Only if the job is still where this move put it, with the same technician
  // (their availability was what the move checked), and still open.
  const [b] = await t.update(
    B,
    { scheduledAt: new Date(c.f) },
    and(
      eq(B.id, c.b),
      eq(B.scheduledAt, new Date(c.t)),
      ...(c.r === undefined ? [] : [c.r ? eq(B.riderId, c.r) : isNull(B.riderId)]),
      isNull(B.deletedAt),
      ne(B.status, "completed"),
      ne(B.status, "cancelled"),
    ),
  );
  if (!b) {
    const cur = await t.selectOne(B, eq(B.id, c.b));
    if (!cur || cur.deletedAt) return { ok: false, status: 404, message: "Work order not found" };
    return { ok: false, status: 409, message: "This job changed since you moved it — open it to see where it is now." };
  }
  const notified = await noteMoveUndone(companyId, c.b, { f: c.f, t: c.t, m: c.m });
  await logJobEvent({
    companyId,
    bookingId: c.b,
    kind: "note_added",
    actorRole: "dispatch",
    actorName: by,
    label: "Reschedule undone",
    detail: `${by || "Dispatch"} undid a time change from the calendar.`,
    customerVisible: false,
  });
  void publishDispatch(companyId, { kind: "job", jobId: c.b });
  return { ok: true, job: { id: b.id, status: b.status, assignStatus: b.assignStatus, riderId: b.riderId }, notified };
}

/** Undo either kind of token. */
export async function undoAny(companyId: string, token: unknown, by: string, now = Date.now()): Promise<UndoOutcome> {
  const c = readAnyUndo(token, now);
  if (typeof c !== "string" && c.k === "time") return undoSchedule(companyId, token, by, now);
  return undoAssign(companyId, token, by, now);
}

export interface DayLoad {
  tz: string;
  /** Technicians who can be dispatched (not suspended). */
  techs: number;
  /** jobs: all that day, queued included; bookedMins: assigned work only; techs: the team less anyone off that day. */
  days: Array<{ day: string; jobs: number; bookedMins: number; techs: number }>;
}

/**
 * Jobs and booked minutes per company-time day, for the Month view. One read
 * for the jobs and one for the head count, however many days.
 */
export async function loadDayLoad(companyId: string, opts: { from: string; days: number }): Promise<DayLoad> {
  const t = tdb(companyId);
  const settings = await t.selectOne(schema.companySettings);
  const tz = safeTimeZone(settings?.timezone ?? DEFAULT_TZ);
  const days = Math.min(MAX_LOAD_DAYS, Math.max(1, Math.floor(opts.days)));
  const start = namedDayBounds(opts.from, tz).start;
  const end = new Date(namedDayBounds(addDays(opts.from, days - 1), tz).end.getTime() + 1);
  const B = schema.bookings;
  const [rows, techRows, offRows] = await Promise.all([
    t.transaction((tx) =>
      tx
        .select({ scheduledAt: B.scheduledAt, riderId: B.riderId, durationMins: schema.services.durationMins })
        .from(B)
        .leftJoin(schema.services, eq(schema.services.id, B.serviceId))
        .where(t.scope(B, and(isNull(B.deletedAt), ne(B.status, "cancelled"), gte(B.scheduledAt, start), lt(B.scheduledAt, end)))),
    ),
    t.transaction((tx) => tx.select({ id: schema.riders.id }).from(schema.riders).where(t.scope(schema.riders, ne(schema.riders.approval, "suspended")))),
    // Days off in range (a day either side covers every zone offset).
    t.select(
      schema.techShifts,
      and(
        eq(schema.techShifts.kind, "timeoff"),
        gte(schema.techShifts.date, new Date(start.getTime() - 48 * 3_600_000)),
        lt(schema.techShifts.date, new Date(end.getTime() + 48 * 3_600_000)),
      ),
    ),
  ]);
  const team = new Set(techRows.map((r) => r.id));
  const offByDay = new Map<string, Set<string>>();
  for (const o of offRows) {
    if (!team.has(o.riderId)) continue;
    const key = zonedDayKey(new Date(o.date), tz);
    offByDay.set(key, (offByDay.get(key) ?? new Set()).add(o.riderId));
  }
  const byDay = new Map<string, { jobs: number; bookedMins: number; techs: number }>();
  for (let i = 0; i < days; i++) {
    const key = addDays(opts.from, i);
    byDay.set(key, { jobs: 0, bookedMins: 0, techs: team.size - (offByDay.get(key)?.size ?? 0) });
  }
  for (const r of rows) {
    const d = byDay.get(zonedDayKey(new Date(r.scheduledAt), tz));
    if (!d) continue;
    d.jobs += 1;
    // Booked time is time on someone's day; queued jobs are demand, not load.
    if (r.riderId) d.bookedMins += durationOf(r);
  }
  return { tz, techs: techRows.length, days: [...byDay].map(([day, v]) => ({ day, ...v })) };
}
