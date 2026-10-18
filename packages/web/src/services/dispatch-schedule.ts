/**
 * Moving a job in time from the dispatch calendar — at once, with Undo — and
 * the per-day load summary behind the Month view.
 *
 * The same promise as dispatch-assign.ts: an undone move texts nobody. Moving a
 * job normally fires "rescheduled" at once (the technician's SMS and the
 * customer's email). Here it waits out the Undo window as a scheduled task.
 * There is at most one such notice per job, and it remembers the time people
 * were last told (`from`). When it runs it announces wherever the job is now,
 * or nothing if that is still `from`. So two quick moves send one text, undoing
 * the second still announces the first, and undoing back to `from` sends none.
 *
 * A job placed from the queue already has an "assigned" notice waiting, which
 * says the time; it doesn't get a second, "rescheduled" one on top.
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
import { fireEvent } from "./dispatch";
import { ASSIGNED_NOTICE_TASK, holdNotice, readAnyUndo, signUndo, undoAssign, UNDO_TOKEN_TTL_MS, type JobPatch, type UndoOutcome } from "./dispatch-assign";
import { logJobEvent } from "./job-events";
import { publishDispatch } from "./realtime";
import { cancelTasks, registerTaskHandler } from "./scheduler";
import { RESCHEDULED_NOTICE_TASK } from "./dispatch-notice-kinds";

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

registerTaskHandler(RESCHEDULED_NOTICE_TASK, async (task) => {
  const from = typeof task.payload.from === "string" ? task.payload.from : "";
  if (!task.bookingId || !from) return;
  const b = await tdb(task.companyId).selectOne(schema.bookings, eq(schema.bookings.id, task.bookingId));
  // Archived or closed, or back where everyone was last told: nothing to say.
  if (!b || b.deletedAt || isTerminalStatus(b.status)) return;
  if (new Date(b.scheduledAt).getTime() === new Date(from).getTime()) return;
  await fireEvent("rescheduled", task.bookingId);
});

/** Notices for this job still waiting out their Undo window. */
async function pendingNotices(companyId: string, bookingId: string) {
  const T = schema.scheduledTasks;
  const rows = await tdb(companyId).select(T, and(eq(T.bookingId, bookingId), eq(T.status, "pending")));
  const of = (kind: string) => rows.filter((r) => r.kind === kind);
  return { rescheduled: of(RESCHEDULED_NOTICE_TASK), assigned: of(ASSIGNED_NOTICE_TASK).length > 0 };
}

const fromOf = (task: { payload: string }) => {
  try {
    const p = JSON.parse(task.payload || "{}") as { from?: unknown };
    return typeof p.from === "string" ? p.from : null;
  } catch {
    return null;
  }
};

/** Hold one "rescheduled" notice for the job, replacing any that is waiting. */
async function holdRescheduled(companyId: string, bookingId: string, from: string) {
  await cancelTasks({ bookingId, kind: RESCHEDULED_NOTICE_TASK });
  await holdNotice(companyId, { kind: RESCHEDULED_NOTICE_TASK, bookingId, payload: { from }, fallback: "rescheduled" });
}

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

  const waiting = await pendingNotices(companyId, prev.id);
  if (!waiting.assigned) {
    // Carry forward the time people were last told, if an earlier move is still waiting.
    const told = waiting.rescheduled.map(fromOf).find((f) => f) ?? from.toISOString();
    await holdRescheduled(companyId, prev.id, told);
  }
  void publishDispatch(companyId, { kind: "job", jobId: prev.id });

  const undo = signUndo({ v: 1, k: "time", c: companyId, b: prev.id, f: from.toISOString(), t: to.toISOString(), exp: now + UNDO_TOKEN_TTL_MS });
  return { ok: true, job: patchOf(b), undo };
}

export async function undoSchedule(companyId: string, token: unknown, by: string, now = Date.now()): Promise<UndoOutcome> {
  const c = readAnyUndo(token, now);
  if (c === "invalid" || (typeof c !== "string" && c.k !== "time")) return { ok: false, status: 400, message: "That Undo isn't valid any more." };
  if (c === "expired") return { ok: false, status: 410, message: "Too late to undo — open the job to change it." };
  if (c.c !== companyId) return { ok: false, status: 404, message: "Work order not found" };

  const t = tdb(companyId);
  const B = schema.bookings;
  // Only if the job is still where this move put it and still open.
  const [b] = await t.update(
    B,
    { scheduledAt: new Date(c.f) },
    and(eq(B.id, c.b), eq(B.scheduledAt, new Date(c.t)), isNull(B.deletedAt), ne(B.status, "completed"), ne(B.status, "cancelled")),
  );
  if (!b) {
    const cur = await t.selectOne(B, eq(B.id, c.b));
    if (!cur || cur.deletedAt) return { ok: false, status: 404, message: "Work order not found" };
    return { ok: false, status: 409, message: "This job changed since you moved it — open it to see where it is now." };
  }
  const waiting = await pendingNotices(companyId, c.b);
  const told = waiting.rescheduled.map(fromOf).find((f) => f);
  if (told) {
    // Back where people were last told: the waiting notice has nothing to say.
    if (new Date(told).getTime() === new Date(c.f).getTime()) await cancelTasks({ bookingId: c.b, kind: RESCHEDULED_NOTICE_TASK });
  } else if (!waiting.assigned) {
    // The move was already announced; announce the time it went back to.
    await holdRescheduled(companyId, c.b, c.t);
  }
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
  return { ok: true, job: { id: b.id, status: b.status, assignStatus: b.assignStatus, riderId: b.riderId } };
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
  days: Array<{ day: string; jobs: number; bookedMins: number }>;
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
  const [rows, techRows] = await Promise.all([
    t.transaction((tx) =>
      tx
        .select({ scheduledAt: B.scheduledAt, durationMins: schema.services.durationMins })
        .from(B)
        .leftJoin(schema.services, eq(schema.services.id, B.serviceId))
        .where(t.scope(B, and(isNull(B.deletedAt), ne(B.status, "cancelled"), gte(B.scheduledAt, start), lt(B.scheduledAt, end)))),
    ),
    t.transaction((tx) => tx.select({ id: schema.riders.id }).from(schema.riders).where(t.scope(schema.riders, ne(schema.riders.approval, "suspended")))),
  ]);
  const byDay = new Map<string, { jobs: number; bookedMins: number }>();
  for (let i = 0; i < days; i++) byDay.set(addDays(opts.from, i), { jobs: 0, bookedMins: 0 });
  for (const r of rows) {
    const d = byDay.get(zonedDayKey(new Date(r.scheduledAt), tz));
    if (!d) continue;
    d.jobs += 1;
    d.bookedMins += durationOf(r);
  }
  return { tz, techs: techRows.length, days: [...byDay].map(([day, v]) => ({ day, ...v })) };
}
