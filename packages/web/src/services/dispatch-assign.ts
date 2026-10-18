/**
 * Assigning from the dispatch map — instantly, with Undo.
 *
 * Dan's call (2026-10-17): a job dropped on a technician is assigned at once
 * and the dispatcher gets a few seconds to Undo. Two things make that honest:
 *
 *  1. Undo restores the job exactly as it was. The queue holds pending AND
 *     confirmed jobs, and the generic unassign path turns both into
 *     "confirmed". So the assign hands back a signed token carrying the
 *     previous status; Undo verifies it and puts that status back, and only if
 *     nothing has happened since (compare-and-set on the offer).
 *  2. An undone drop texts nobody. Assigning normally fires the "assigned"
 *     event at once — SMS, email and push to the technician, an email to the
 *     customer, a line on their timeline. Here that event waits out the Undo
 *     window (NOTIFY_GRACE_MS) as a scheduled task, run by an in-process timer
 *     (or the scheduler's tick if this process dies first). Undo cancels it,
 *     and the handler re-checks the job before sending anything.
 *
 * Every guard of a normal assignment (tenant check, terminal and in-flight
 * protection, double-booking, time off, compare-and-set, presence) is the
 * shared services/assign.ts — this file only adds the Undo around it.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { assignJob } from "./assign";
import { reconcileRiderStatus } from "./presence";
import { logJobEvent } from "./job-events";
import { publishDispatch } from "./realtime";
import { fireEvent } from "./dispatch";
import { cancelTasks, registerTaskHandler, runTaskNow, scheduleTask } from "./scheduler";
import { ASSIGNED_NOTICE_TASK, RESCHEDULED_NOTICE_TASK } from "./dispatch-notice-kinds";

/** How long an Undo token stays valid. The map's toast offers it for 6 s. */
export const UNDO_TOKEN_TTL_MS = 2 * 60_000;
/** How long the "assigned" notifications wait, so an Undo inside the window reaches nobody. */
export const NOTIFY_GRACE_MS = 8_000;
export { ASSIGNED_NOTICE_TASK } from "./dispatch-notice-kinds";
/** The longest decline/release reason an Undo can restore (the decline form's limit). */
const MAX_KEPT_REASON = 2_000;
/** Longest Undo token accepted: room for that reason even in 4-byte text, base64'd. */
export const MAX_UNDO_TOKEN = 12_000;

/** What changed on the job, for the map to patch its copy. */
export interface JobPatch {
  id: string;
  status: string;
  assignStatus: string;
  riderId: string | null;
}

export type AssignOutcome =
  | { ok: true; job: JobPatch; undo: string | null }
  | { ok: false; status: 404 | 409; message: string; forceable: boolean; reason?: string };

/** `notified`: the notice had already gone out before the Undo, so people heard about the change. */
export type UndoOutcome = { ok: true; job: JobPatch; notified: boolean } | { ok: false; status: 400 | 404 | 409 | 410; message: string };

interface UndoClaims {
  v: 1;
  /** kind: an assignment from the queue (the default, and every token issued before kinds existed) */
  k?: "assign";
  /** company */
  c: string;
  /** booking */
  b: string;
  /** rider it was offered to */
  r: string;
  /** previous status */
  s: string;
  /** previous assignStatus */
  a: string;
  /** When the drop also moved the time: scheduledAt before and after, ISO. */
  f?: string;
  t?: string;
  /** What the queue entry said before: why it came back (declineReason) and when it was last offered (assignedAt, ISO). */
  d?: string;
  o?: string;
  /** A move notice this assignment replaced: the time people were last told, to announce again if it's undone. */
  n?: string;
  /** The job's time when it was assigned (ISO): if it has moved since, Undo announces where it is now. */
  w?: string;
  /** This offer's assignedAt (ISO): Undo takes back this offer, not a later one to the same technician. */
  g?: string;
  /** expiry, ms */
  exp: number;
}

/** A time move on the calendar (services/dispatch-schedule.ts). */
export interface TimeUndoClaims {
  v: 1;
  k: "time";
  c: string;
  b: string;
  /** scheduledAt before the move, ISO */
  f: string;
  /** scheduledAt after the move, ISO */
  t: string;
  /** The technician it was moved for ("" when unassigned); Undo only for them. */
  r?: string;
  /** When the move was made (ISO): did its notice go out after this? */
  m?: string;
  /** The move's notice generation: Undo only while this is still the latest move. */
  q?: string;
  exp: number;
}

export type AnyUndoClaims = UndoClaims | TimeUndoClaims;

let processKey: Buffer | null = null;
function signingKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret) return createHash("sha256").update(`arriveping:dispatch-undo:${secret}`).digest();
  // No secret (local dev): a per-process key. Undo still works on this server.
  return (processKey ??= randomBytes(32));
}

export function signUndo(claims: AnyUndoClaims): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const mac = createHmac("sha256", signingKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** An assignment token, for undoAssign. A time-move token reads as invalid here. */
export function readUndo(token: unknown, now = Date.now()): UndoClaims | "invalid" | "expired" {
  const c = readAnyUndo(token, now);
  if (typeof c === "string") return c;
  return c.k === "time" ? "invalid" : c;
}

/** Either kind of token, verified and unexpired. */
export function readAnyUndo(token: unknown, now = Date.now()): AnyUndoClaims | "invalid" | "expired" {
  if (typeof token !== "string" || token.length > MAX_UNDO_TOKEN) return "invalid";
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return "invalid";
  const [body, mac] = parts as [string, string];
  const want = createHmac("sha256", signingKey()).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return "invalid";
  let c: AnyUndoClaims;
  try {
    c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AnyUndoClaims;
  } catch {
    return "invalid";
  }
  if (!c || c.v !== 1 || typeof c.exp !== "number") return "invalid";
  const strings = c.k === "time" ? [c.c, c.b, c.f, c.t] : c.k === undefined || c.k === "assign" ? [c.c, c.b, c.r, c.s, c.a] : null;
  if (!strings || strings.some((x) => typeof x !== "string")) return "invalid";
  if (c.k !== "time" && (typeof c.f !== typeof c.t || (c.f !== undefined && typeof c.f !== "string"))) return "invalid";
  if (c.k !== "time" && [c.d, c.o, c.n, c.w, c.g].some((x) => x !== undefined && typeof x !== "string")) return "invalid";
  if (c.k === "time" && [c.r, c.m, c.q].some((x) => x !== undefined && typeof x !== "string")) return "invalid";
  if (now > c.exp) return "expired";
  return c;
}

const patchOf = (b: typeof schema.bookings.$inferSelect): JobPatch => ({
  id: b.id,
  status: b.status,
  assignStatus: b.assignStatus,
  riderId: b.riderId,
});

// The timer is injectable so tests can run the deferred notice on demand.
type GraceTimer = (run: () => void, ms: number) => void;
const realTimer: GraceTimer = (run, ms) => {
  const h = setTimeout(run, ms);
  (h as { unref?: () => void }).unref?.();
};
let graceTimer: GraceTimer = realTimer;
/** Tests only: capture the deferred-notice callback instead of waiting for it. */
export function _setGraceTimerForTests(fn: GraceTimer | null) {
  graceTimer = fn ?? realTimer;
}

/**
 * Hold a notification for the Undo window: a scheduled task run by an
 * in-process timer (or the scheduler's tick if this process dies first). If the
 * task can't be queued, the event fires now rather than never, and this
 * returns false: there is nothing left for an Undo to keep quiet.
 */
export async function holdNotice(
  companyId: string,
  opts: { kind: string; bookingId: string; payload: Record<string, unknown>; fallback: Parameters<typeof fireEvent>[0] },
): Promise<boolean> {
  const id = await scheduleTask({
    companyId,
    kind: opts.kind,
    runAt: Date.now() + NOTIFY_GRACE_MS,
    bookingId: opts.bookingId,
    payload: opts.payload,
  });
  if (!id) {
    await fireEvent(opts.fallback, opts.bookingId);
    return false;
  }
  graceTimer(() => void runTaskNow(id), NOTIFY_GRACE_MS);
  return true;
}

/** The "last told" time of a move notice still waiting for this job, if any. */
async function waitingMoveFrom(companyId: string, bookingId: string): Promise<string | null> {
  const T = schema.scheduledTasks;
  const rows = await tdb(companyId).select(T, and(eq(T.bookingId, bookingId), eq(T.status, "pending"), eq(T.kind, RESCHEDULED_NOTICE_TASK)));
  for (const r of rows) {
    try {
      const from = (JSON.parse(r.payload || "{}") as { from?: unknown }).from;
      if (typeof from === "string") return from;
    } catch {
      /* unreadable payload: nothing to carry */
    }
  }
  return null;
}

async function deferAssignedNotice(companyId: string, bookingId: string, riderId: string): Promise<boolean> {
  return holdNotice(companyId, { kind: ASSIGNED_NOTICE_TASK, bookingId, payload: { riderId }, fallback: "assigned" });
}

registerTaskHandler(ASSIGNED_NOTICE_TASK, async (task) => {
  const riderId = typeof task.payload.riderId === "string" ? task.payload.riderId : "";
  if (!task.bookingId || !riderId) return;
  const b = await tdb(task.companyId).selectOne(schema.bookings, eq(schema.bookings.id, task.bookingId));
  // Undone, given to someone else or archived in the meantime: nothing to announce.
  if (!b || b.deletedAt || b.riderId !== riderId) return;
  if (b.assignStatus !== "offered" && b.assignStatus !== "accepted") return;
  await fireEvent("assigned", task.bookingId);
});

async function techName(companyId: string, riderId: string): Promise<string> {
  const t = tdb(companyId);
  const [row] = await t.transaction((tx) =>
    tx
      .select({ name: schema.user.name })
      .from(schema.riders)
      .innerJoin(schema.user, eq(schema.user.id, schema.riders.userId))
      .where(t.scope(schema.riders, eq(schema.riders.id, riderId)))
      .limit(1),
  );
  return (row?.name ?? "").trim();
}

export async function dispatchAssign(
  companyId: string,
  input: { bookingId: string; riderId: string; force?: boolean; forceBusy?: boolean; scheduledAt?: string; by: string },
  now = Date.now(),
): Promise<AssignOutcome> {
  const t = tdb(companyId);
  const prev = await t.selectOne(schema.bookings, eq(schema.bookings.id, input.bookingId));
  if (!prev || prev.deletedAt) return { ok: false, status: 404, message: "Work order not found", forceable: false };

  // Undo is for taking a job back off the board's queue. Moving a job from one
  // technician to another is a deliberate reassignment, notified at once.
  const undoable = !prev.riderId;
  const to = input.scheduledAt ? new Date(input.scheduledAt) : null;
  const r = await assignJob(companyId, input.bookingId, input.riderId, {
    force: input.force,
    // A queue drop stays a queue drop: if someone assigned it meanwhile, refuse.
    ...(undoable ? { expectRiderId: null } : {}),
    ...(input.forceBusy !== undefined ? { forceBusy: input.forceBusy } : {}),
    by: { kind: "dispatcher", name: input.by },
    deferEvent: undoable,
    ...(to ? { scheduledAt: to } : {}),
  });
  if (!r.ok) {
    if (r.code === "tech_not_found" || r.code === "job_not_found") return { ok: false, status: 404, message: r.message, forceable: false };
    return { ok: false, status: 409, message: r.message, forceable: r.forceable, ...(r.reason ? { reason: r.reason } : {}) };
  }

  // The token restores exactly what this write replaced (assignJob's own read),
  // not this function's earlier look at the job.
  const was = r.previous;
  let undo: string | null = null;
  // A reason too long to carry back can't be restored exactly: no Undo then
  // (the notice still waits out the window, so nothing is sent early).
  const restorable = (was.declineReason ?? "").length <= MAX_KEPT_REASON;
  if (undoable) {
    // The "assigned" notice gives the time, so a move still waiting to be
    // announced has nothing to add (as on the immediate path in assignJob).
    // Its "last told" time rides in the token, so an Undo can put it back.
    const toldFrom = await waitingMoveFrom(companyId, input.bookingId);
    await cancelTasks({ bookingId: input.bookingId, kind: RESCHEDULED_NOTICE_TASK });
    const from = new Date(was.scheduledAt);
    const moved = new Date(r.booking.scheduledAt).getTime() !== from.getTime();
    undo = signUndo({
      v: 1,
      c: companyId,
      b: input.bookingId,
      r: input.riderId,
      s: was.status,
      a: was.assignStatus,
      ...(moved ? { f: from.toISOString(), t: new Date(r.booking.scheduledAt).toISOString() } : {}),
      ...(was.declineReason ? { d: was.declineReason } : {}),
      ...(was.assignedAt ? { o: new Date(was.assignedAt).toISOString() } : {}),
      ...(toldFrom ? { n: toldFrom } : {}),
      w: from.toISOString(),
      ...(r.booking.assignedAt ? { g: new Date(r.booking.assignedAt).toISOString() } : {}),
      exp: now + UNDO_TOKEN_TTL_MS,
    });
    // Already announced (the notice couldn't be held): no Undo to offer.
    if (!(await deferAssignedNotice(companyId, input.bookingId, input.riderId)) || !restorable) undo = null;
    // fireEvent (which normally refreshes open maps) is waiting, so say it here.
    void publishDispatch(companyId, { kind: "job", jobId: input.bookingId });
  }
  return { ok: true, job: patchOf(r.booking), undo };
}

export async function undoAssign(companyId: string, token: unknown, by: string, now = Date.now()): Promise<UndoOutcome> {
  const c = readUndo(token, now);
  if (c === "invalid") return { ok: false, status: 400, message: "That Undo isn't valid any more." };
  if (c === "expired") return { ok: false, status: 410, message: "Too late to undo — open the job to change it." };
  if (c.c !== companyId) return { ok: false, status: 404, message: "Work order not found" };

  const t = tdb(companyId);
  const B = schema.bookings;
  // Only an offer nobody has acted on yet: same tech, still offered, still
  // assigned, not archived. Anything else means the world moved on.
  const [b] = await t.update(
    B,
    {
      riderId: null,
      status: c.s,
      assignStatus: c.a,
      // Back as it was in the queue, including why it came back.
      assignedAt: c.o ? new Date(c.o) : null,
      declineReason: c.d ?? "",
      acceptedAt: null,
      autoAssignedRuleId: "",
      autoAssignedAt: null,
      ...(c.f ? { scheduledAt: new Date(c.f) } : {}),
    },
    and(
      eq(B.id, c.b),
      eq(B.riderId, c.r),
      eq(B.assignStatus, "offered"),
      eq(B.status, "assigned"),
      isNull(B.deletedAt),
      // A drop that also moved the time puts both back, or neither.
      ...(c.t ? [eq(B.scheduledAt, new Date(c.t))] : []),
      // This offer, not a later one to the same technician.
      ...(c.g ? [eq(B.assignedAt, new Date(c.g))] : []),
    ),
  );
  if (!b) {
    const cur = await t.selectOne(B, eq(B.id, c.b));
    if (!cur || cur.deletedAt) return { ok: false, status: 404, message: "Work order not found" };
    if (cur.riderId === c.r && cur.assignStatus === "accepted") {
      const name = await techName(companyId, c.r);
      return { ok: false, status: 409, message: `${name || "The technician"} already accepted this job — open it to change the assignment.` };
    }
    return { ok: false, status: 409, message: "This job changed since you assigned it — open it to see where it is now." };
  }

  // Nothing left to cancel: the notice already went (or is going) out.
  const notified = (await cancelTasks({ bookingId: c.b, kind: ASSIGNED_NOTICE_TASK })) === 0;
  // The assignment's notice would have given the time. With it gone, a move
  // notice waits instead: from what people were last told (a move notice the
  // assignment had replaced, else the time when it was assigned). It says
  // something only if the job is somewhere else now, e.g. moved meanwhile.
  // If the assignment's notice already went out, it announced the time this
  // drop set (c.t when it moved the job), so that is what to correct from.
  const told = notified ? (c.t ?? c.w) : (c.n ?? c.w);
  if (told)
    await holdNotice(companyId, {
      kind: RESCHEDULED_NOTICE_TASK,
      bookingId: c.b,
      payload: { from: told, at: new Date(b.scheduledAt).toISOString(), movedAt: new Date().toISOString() },
      fallback: "rescheduled",
    });
  await reconcileRiderStatus(companyId, c.r);
  await logJobEvent({
    companyId,
    bookingId: c.b,
    kind: "note_added",
    actorRole: "dispatch",
    actorName: by,
    label: "Assignment undone",
    detail: `${by || "Dispatch"} undid the assignment from the map.`,
    customerVisible: false,
  });
  void publishDispatch(companyId, { kind: "job", jobId: c.b });
  void publishDispatch(companyId, { kind: "tech", techId: c.r });
  return { ok: true, job: patchOf(b), notified };
}
