/**
 * Dispatch notices held through an Undo window.
 *
 * Two kinds, kept independent because tenants configure them independently
 * (notification rules are per event and recipient):
 *
 *  - "assigned" (services/dispatch-assign.ts): a technician was given a job.
 *  - "rescheduled" (here): the job's time changed. There is at most one
 *    waiting per job. It remembers the time people were last told (`from`)
 *    and the time it is for (`at`). When it runs it speaks only if the job is
 *    still at `at` and that differs from `from`. So two quick moves send one
 *    message, undoing the second still announces the first, and undoing back
 *    to `from` sends none.
 *
 * Every move notice carries a generation (`gen`, and the one before it,
 * `prevGen`). A time-move Undo works only while its move is the latest one,
 * and undoing returns the job to the previous generation.
 *
 * Noting a move reads the job, then replaces its waiting notice. Two moves of
 * the same job noted at once could interleave there, the older one cancelling
 * the newer one's notice, so each job's notes run one at a time (see
 * `oneAtATime`). The app runs as one process (ecosystem.config.cjs); during a
 * rolling deploy's brief overlap two could still race, as every other
 * scheduling write in the app can.
 */
import { and, eq, gte } from "drizzle-orm";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { isTerminalStatus } from "../shared/job-status";
import { fireEvent } from "./dispatch";
import { RESCHEDULED_NOTICE_TASK } from "./dispatch-notice-kinds";
import {
  cancelTasks,
  registerTaskHandler,
  runTaskNow,
  scheduleTask,
} from "./scheduler";

/** How long a held notification waits, so an Undo inside the window reaches nobody. */
export const NOTIFY_GRACE_MS = 8_000;

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
  opts: {
    kind: string;
    bookingId: string;
    payload: Record<string, unknown>;
    fallback: Parameters<typeof fireEvent>[0];
  },
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

registerTaskHandler(RESCHEDULED_NOTICE_TASK, async (task) => {
  const from = typeof task.payload.from === "string" ? task.payload.from : "";
  if (!task.bookingId || !from) return;
  const b = await tdb(task.companyId).selectOne(
    schema.bookings,
    eq(schema.bookings.id, task.bookingId),
  );
  // Archived or closed, or back where everyone was last told: nothing to say.
  if (!b || b.deletedAt || isTerminalStatus(b.status)) return;
  const now = new Date(b.scheduledAt).getTime();
  if (now === new Date(from).getTime()) return;
  // Each notice is for one time. If the job has moved since, a newer notice
  // is waiting for that move, so this one stays quiet (even when the two race).
  const at = typeof task.payload.at === "string" ? task.payload.at : null;
  if (at && now !== new Date(at).getTime()) return;
  // A correction after an Undo: only if the move it corrects was announced.
  const since =
    typeof task.payload.ifToldSince === "string"
      ? new Date(task.payload.ifToldSince)
      : null;
  if (since && !(await toldSince(task.companyId, task.bookingId, since)))
    return;
  await fireEvent("rescheduled", task.bookingId);
});

/** Whether a "rescheduled" message went out for this job at or after `since`. */
async function toldSince(
  companyId: string,
  bookingId: string,
  since: Date,
): Promise<boolean> {
  const E = schema.jobEvents;
  const rows = await tdb(companyId).select(
    E,
    and(
      eq(E.bookingId, bookingId),
      eq(E.kind, "rescheduled"),
      gte(E.createdAt, since),
    ),
  );
  return rows.length > 0;
}

// Per job, the tail of its queue of notes: each waits for the one before.
const queues = new Map<string, Promise<unknown>>();
async function oneAtATime<T>(
  companyId: string,
  bookingId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${companyId}:${bookingId}`;
  const before = queues.get(key) ?? Promise.resolve();
  const run = before.then(fn, fn);
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  try {
    return await run;
  } finally {
    // Last in line: nothing left to wait for, so drop the entry.
    if (queues.get(key) === tail) queues.delete(key);
  }
}

const readPayload = (
  raw: string,
): { from?: string; gen?: string; prevGen?: string } => {
  try {
    const p = JSON.parse(raw || "{}") as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    return { from: str(p.from), gen: str(p.gen), prevGen: str(p.prevGen) };
  } catch {
    return {};
  }
};

/** The latest move notice for this job (any status): its generation and the one before. */
async function latestMove(
  companyId: string,
  bookingId: string,
): Promise<{ gen: string | null; prevGen: string | null }> {
  const T = schema.scheduledTasks;
  const rows = await tdb(companyId).select(
    T,
    and(eq(T.bookingId, bookingId), eq(T.kind, RESCHEDULED_NOTICE_TASK)),
  );
  const latest = rows.sort(
    (x, y) =>
      new Date(y.createdAt ?? 0).getTime() -
      new Date(x.createdAt ?? 0).getTime(),
  )[0];
  const p = latest ? readPayload(latest.payload) : {};
  return { gen: p.gen ?? null, prevGen: p.prevGen ?? null };
}

/** The time people were last told, from a move notice still waiting, if any. */
async function waitingFrom(
  companyId: string,
  bookingId: string,
): Promise<string | null> {
  const T = schema.scheduledTasks;
  const rows = await tdb(companyId).select(
    T,
    and(
      eq(T.bookingId, bookingId),
      eq(T.status, "pending"),
      eq(T.kind, RESCHEDULED_NOTICE_TASK),
    ),
  );
  for (const r of rows) {
    const from = readPayload(r.payload).from;
    if (from) return from;
  }
  return null;
}

async function hold(
  companyId: string,
  bookingId: string,
  p: {
    from: string;
    at: string;
    gen?: string | null;
    prevGen?: string | null;
    ifToldSince?: string;
  },
): Promise<string | null> {
  await cancelTasks({ bookingId, kind: RESCHEDULED_NOTICE_TASK });
  const gen = p.gen ?? crypto.randomUUID();
  const held = await holdNotice(companyId, {
    kind: RESCHEDULED_NOTICE_TASK,
    bookingId,
    payload: {
      from: p.from,
      at: p.at,
      gen,
      ...(p.prevGen ? { prevGen: p.prevGen } : {}),
      ...(p.ifToldSince ? { ifToldSince: p.ifToldSince } : {}),
    },
    fallback: "rescheduled",
  });
  return held ? gen : null;
}

/**
 * A job's time changed from `from` to `to`: hold one "rescheduled" notice for
 * it. Returns the move's generation, or null if the notice couldn't be held
 * and went out at once (then there's no Undo to offer).
 */
export function noteMove(
  companyId: string,
  bookingId: string,
  move: { from: Date; to: Date },
): Promise<string | null> {
  return oneAtATime(companyId, bookingId, async () => {
    // A later move got here first: its notice stands, and this one has nothing
    // to say (nor an Undo to offer).
    const cur = await tdb(companyId).selectOne(
      schema.bookings,
      eq(schema.bookings.id, bookingId),
    );
    if (!cur || new Date(cur.scheduledAt).getTime() !== move.to.getTime())
      return null;
    const told =
      (await waitingFrom(companyId, bookingId)) ?? move.from.toISOString();
    const before = await latestMove(companyId, bookingId);
    return hold(companyId, bookingId, {
      from: told,
      at: move.to.toISOString(),
      prevGen: before.gen,
    });
  });
}

/** The generation of the job's latest move, for binding an Undo to it. */
export async function currentMoveGen(
  companyId: string,
  bookingId: string,
): Promise<string | null> {
  return (await latestMove(companyId, bookingId)).gen;
}

/**
 * A move from `f` to `t` (made at `m`) was undone and the job is back at `f`.
 * Returns whether the move had already been announced.
 */
export function noteMoveUndone(
  companyId: string,
  bookingId: string,
  move: { f: string; t: string; m?: string },
): Promise<boolean> {
  return oneAtATime(companyId, bookingId, () =>
    undone(companyId, bookingId, move),
  );
}

async function undone(
  companyId: string,
  bookingId: string,
  move: { f: string; t: string; m?: string },
): Promise<boolean> {
  const told = await waitingFrom(companyId, bookingId);
  const { prevGen } = await latestMove(companyId, bookingId);
  if (told) {
    // The waiting notice now speaks for the time the job went back to: nothing
    // if that's where people were last told, else that time.
    await hold(companyId, bookingId, { from: told, at: move.f, gen: prevGen });
    return false;
  }
  // Nothing waiting: it went out, or is going out right now. A correction
  // waits its turn and speaks only if the move was in fact announced.
  await hold(companyId, bookingId, {
    from: move.t,
    at: move.f,
    gen: prevGen,
    ...(move.m ? { ifToldSince: move.m } : {}),
  });
  return move.m ? toldSince(companyId, bookingId, new Date(move.m)) : true;
}
