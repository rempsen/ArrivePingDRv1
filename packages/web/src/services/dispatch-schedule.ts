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
 * An "assigned" notice gives the job's time too. A move notice waits while one
 * is pending and stays quiet if it went out after the move; if it never goes
 * out (the offer was declined or undone), the move notice speaks.
 *
 * Guards are the ones POST /bookings/:id/schedule has: a finished or cancelled
 * job can't move (its date is in reports and payouts), and a time the
 * technician is already booked or off comes back as a question the dispatcher
 * can override.
 */
import { and, eq, gte, inArray, isNull, lt, ne } from "drizzle-orm";
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

/** How many times a move notice waits for an assignment notice before speaking anyway. */
const MAX_NOTICE_WAITS = 5;

registerTaskHandler(RESCHEDULED_NOTICE_TASK, async (task) => {
  const from = typeof task.payload.from === "string" ? task.payload.from : "";
  if (!task.bookingId || !from) return;
  const t = tdb(task.companyId);
  const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, task.bookingId));
  // Archived or closed, or back where everyone was last told: nothing to say.
  if (!b || b.deletedAt || isTerminalStatus(b.status)) return;
  if (new Date(b.scheduledAt).getTime() === new Date(from).getTime()) return;
  // Each notice is for one time (`at`). If the job has moved since, a newer
  // notice is waiting for that move, so this one stays quiet (even when the
  // two race: a move landing while this one is already running).
  const at = typeof task.payload.at === "string" ? task.payload.at : null;
  if (at && new Date(b.scheduledAt).getTime() !== new Date(at).getTime()) return;

  // An "assigned" notice for this job states its time. While one is still to
  // go (or going), wait for it rather than guess whether it will be sent.
  const T = schema.scheduledTasks;
  const assigning = await t.select(T, and(eq(T.bookingId, task.bookingId), eq(T.kind, ASSIGNED_NOTICE_TASK), inArray(T.status, ["pending", "running"])));
  const waits = typeof task.payload.waits === "number" ? task.payload.waits : 0;
  if (assigning.length > 0 && waits < MAX_NOTICE_WAITS) {
    await holdNotice(task.companyId, { kind: RESCHEDULED_NOTICE_TASK, bookingId: task.bookingId, payload: { ...task.payload, waits: waits + 1 }, fallback: "rescheduled" });
    return;
  }
  // A correction after an Undo: only if the move it corrects was announced.
  const correcting = typeof task.payload.ifToldSince === "string" ? new Date(task.payload.ifToldSince) : null;
  if (correcting && !(await toldSince(task.companyId, task.bookingId, correcting))) return;
  // ...and if it went out after this move, it already said the new time.
  const movedAt = typeof task.payload.movedAt === "string" ? new Date(task.payload.movedAt) : null;
  if (movedAt) {
    const E = schema.jobEvents;
    const told = await t.select(E, and(eq(E.bookingId, task.bookingId), eq(E.kind, "assigned"), gte(E.createdAt, movedAt)));
    if (told.length > 0) return;
  }
  await fireEvent("rescheduled", task.bookingId);
});

/** Whether a "rescheduled" message went out for this job at or after `since`. */
async function toldSince(companyId: string, bookingId: string, since: Date): Promise<boolean> {
  const E = schema.jobEvents;
  const rows = await tdb(companyId).select(E, and(eq(E.bookingId, bookingId), eq(E.kind, "rescheduled"), gte(E.createdAt, since)));
  return rows.length > 0;
}

/** Move notices for this job still waiting out their Undo window. */
async function pendingNotices(companyId: string, bookingId: string) {
  const T = schema.scheduledTasks;
  const rescheduled = await tdb(companyId).select(T, and(eq(T.bookingId, bookingId), eq(T.status, "pending"), eq(T.kind, RESCHEDULED_NOTICE_TASK)));
  return { rescheduled };
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
async function holdRescheduled(companyId: string, bookingId: string, from: string, at: string, ifToldSince?: string): Promise<boolean> {
  await cancelTasks({ bookingId, kind: RESCHEDULED_NOTICE_TASK });
  return holdNotice(companyId, {
    kind: RESCHEDULED_NOTICE_TASK,
    bookingId,
    payload: { from, at, movedAt: new Date().toISOString(), ...(ifToldSince ? { ifToldSince } : {}) },
    fallback: "rescheduled",
  });
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

  // Carry forward the time people were last told, if an earlier move is still
  // waiting. (If an "assigned" notice is also waiting, this one defers to it.)
  const waiting = await pendingNotices(companyId, prev.id);
  const told = waiting.rescheduled.map(fromOf).find((f) => f) ?? from.toISOString();
  const held = await holdRescheduled(companyId, prev.id, told, to.toISOString());
  void publishDispatch(companyId, { kind: "job", jobId: prev.id });

  // Already announced (the notice couldn't be held): no Undo to offer.
  if (!held) return { ok: true, job: patchOf(b), undo: null };
  const undo = signUndo({
    v: 1,
    k: "time",
    c: companyId,
    b: prev.id,
    f: from.toISOString(),
    t: to.toISOString(),
    r: prev.riderId ?? "",
    m: new Date().toISOString(),
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
  const waiting = await pendingNotices(companyId, c.b);
  const told = waiting.rescheduled.map(fromOf).find((f) => f);
  if (told) {
    // Back where people were last told: the waiting notice has nothing to say.
    // Otherwise it now announces the time the job went back to.
    if (new Date(told).getTime() === new Date(c.f).getTime()) await cancelTasks({ bookingId: c.b, kind: RESCHEDULED_NOTICE_TASK });
    else await holdRescheduled(companyId, c.b, told, c.f);
  } else {
    // No notice waiting: it went out, or is going out right now. A correction
    // waits its turn and speaks only if the move was in fact announced.
    await holdRescheduled(companyId, c.b, c.t, c.f, c.m);
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
  // Had the move been announced? Its message is in the job's history if so.
  const notified = !told && (c.m ? await toldSince(companyId, c.b, new Date(c.m)) : true);
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
  /** jobs: all that day, queued included; bookedMins: assigned work only. */
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
        .select({ scheduledAt: B.scheduledAt, riderId: B.riderId, durationMins: schema.services.durationMins })
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
    // Booked time is time on someone's day; queued jobs are demand, not load.
    if (r.riderId) d.bookedMins += durationOf(r);
  }
  return { tz, techs: techRows.length, days: [...byDay].map(([day, v]) => ({ day, ...v })) };
}
