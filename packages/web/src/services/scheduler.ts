/**
 * Deferred task scheduler.
 *
 * Before this existed the entire notification system was reactive — everything
 * fired the instant a lifecycle event happened, and nothing could ever happen
 * "later". This is the tick that makes review requests, maintenance reminders,
 * warranty nudges, and time-based automation triggers possible.
 *
 * Concurrency: like services/retention.ts, this may run in more than one
 * process during a rolling deploy. Tasks are therefore *claimed* with a
 * conditional UPDATE (`... WHERE id = ? AND status = 'pending'`) and we only
 * execute a task if that update actually changed the row. Two instances racing
 * the same task means one wins the claim and the other sees zero rows changed
 * and skips it — no double-sends.
 */
import { sdb } from "../api/database";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { and, eq, lte, asc } from "drizzle-orm";

/*
 * This is a single background process ticking across EVERY tenant's due
 * tasks, not a per-request handler — there is no one companyId to scope to
 * for the scan/claim/boot-recovery queries below, so those genuinely need
 * the system (BYPASSRLS) connection. `scheduleTask` is the one exception:
 * its caller already knows which company the task belongs to, so that
 * insert goes through tdb() like any other tenant write.
 */

/**
 * Reads the affected-row count off an UPDATE/DELETE result regardless of
 * driver: libsql used `rowsAffected`, postgres.js's raw (no `.returning()`)
 * result is the array itself with a `.count` property, and the pglite test
 * harness returns `.rowCount`. Check all three rather than assuming one.
 */
function affectedRows(res: unknown): number {
  const r = res as { rowsAffected?: number; rowCount?: number; count?: number } | undefined;
  return r?.rowsAffected ?? r?.rowCount ?? r?.count ?? 0;
}

export type TaskHandler = (task: {
  id: string;
  companyId: string;
  kind: string;
  bookingId: string | null;
  propertyId: string | null;
  payload: Record<string, unknown>;
}) => Promise<void>;

const handlers = new Map<string, TaskHandler>();

/**
 * Register a handler for a task kind. Called at module load by whatever feature
 * owns that kind (review requests, maintenance reminders, etc.) so the
 * scheduler itself stays free of feature logic.
 */
export function registerTaskHandler(kind: string, fn: TaskHandler) {
  if (handlers.has(kind)) {
    console.warn(`[scheduler] handler for "${kind}" replaced`);
  }
  handlers.set(kind, fn);
}

/** Queue work for later. Returns the task id, or null if it couldn't be queued. */
export async function scheduleTask(opts: {
  companyId: string;
  kind: string;
  runAt: Date | number;
  bookingId?: string | null;
  propertyId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<string | null> {
  try {
    const [row] = await tdb(opts.companyId).insert(schema.scheduledTasks, {
      kind: opts.kind,
      runAt: new Date(opts.runAt),
      bookingId: opts.bookingId ?? null,
      propertyId: opts.propertyId ?? null,
      payload: JSON.stringify(opts.payload ?? {}),
    });
    return row?.id ?? null;
  } catch (e) {
    console.error("[scheduler] schedule failed", opts.kind, e);
    return null;
  }
}

/**
 * Cancel pending tasks — used when the thing they were about goes away
 * (job cancelled, maintenance plan deactivated). Only touches pending rows, so
 * already-executed work is never rewritten.
 */
export async function cancelTasks(opts: {
  bookingId?: string;
  kind?: string;
}): Promise<number> {
  try {
    const conds = [eq(schema.scheduledTasks.status, "pending")];
    if (opts.bookingId) conds.push(eq(schema.scheduledTasks.bookingId, opts.bookingId));
    if (opts.kind) conds.push(eq(schema.scheduledTasks.kind, opts.kind));
    const res = await sdb
      .update(schema.scheduledTasks)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(and(...conds));
    return affectedRows(res);
  } catch (e) {
    console.error("[scheduler] cancel failed", e);
    return 0;
  }
}

const MAX_ATTEMPTS = 3;
const BATCH = 25;

/** Claim a single task. Returns true only if THIS process won the claim. */
async function claim(id: string): Promise<boolean> {
  const res = await sdb
    .update(schema.scheduledTasks)
    .set({ status: "running" })
    .where(
      and(eq(schema.scheduledTasks.id, id), eq(schema.scheduledTasks.status, "pending")),
    );
  // If another instance claimed it first, this is 0.
  return affectedRows(res) > 0;
}

/** Run one pass over due tasks. Exported for tests / manual invocation. */
export async function runDueTasks(now: Date = new Date()): Promise<number> {
  let ran = 0;
  try {
    const due = await sdb
      .select()
      .from(schema.scheduledTasks)
      .where(
        and(
          eq(schema.scheduledTasks.status, "pending"),
          lte(schema.scheduledTasks.runAt, now),
        ),
      )
      .orderBy(asc(schema.scheduledTasks.runAt))
      .limit(BATCH);

    for (const task of due) {
      const handler = handlers.get(task.kind);
      if (!handler) {
        // Unknown kind — park it rather than spinning on it every tick.
        await sdb
          .update(schema.scheduledTasks)
          .set({
            status: "failed",
            lastError: `no handler registered for kind "${task.kind}"`,
            completedAt: new Date(),
          })
          .where(eq(schema.scheduledTasks.id, task.id));
        continue;
      }

      if (!(await claim(task.id))) continue; // lost the race, another instance has it

      const attempts = task.attempts + 1;
      try {
        await handler({
          id: task.id,
          companyId: task.companyId,
          kind: task.kind,
          bookingId: task.bookingId,
          propertyId: task.propertyId,
          payload: (() => {
            try {
              return JSON.parse(task.payload || "{}");
            } catch {
              return {};
            }
          })(),
        });
        await sdb
          .update(schema.scheduledTasks)
          .set({ status: "done", attempts, completedAt: new Date(), lastError: "" })
          .where(eq(schema.scheduledTasks.id, task.id));
        ran++;
      } catch (e: any) {
        const msg = e?.message || String(e);
        // Retry with a widening backoff, then give up so a poison task can't
        // block the queue forever.
        const giveUp = attempts >= MAX_ATTEMPTS;
        await sdb
          .update(schema.scheduledTasks)
          .set({
            status: giveUp ? "failed" : "pending",
            attempts,
            lastError: msg.slice(0, 500),
            runAt: giveUp
              ? task.runAt
              : new Date(Date.now() + attempts * 5 * 60 * 1000),
            completedAt: giveUp ? new Date() : null,
          })
          .where(eq(schema.scheduledTasks.id, task.id));
        console.error(`[scheduler] task ${task.kind} failed (attempt ${attempts})`, msg);
      }
    }
  } catch (e) {
    console.error("[scheduler] tick failed", e);
  }
  return ran;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the 60s tick. Idempotent. */
export function startScheduler(intervalMs = 60 * 1000) {
  if (timer) return;
  // Recover anything left "running" by a process that died mid-task. Safe
  // because handlers are expected to be idempotent-ish and we cap attempts.
  sdb.update(schema.scheduledTasks)
    .set({ status: "pending" })
    .where(eq(schema.scheduledTasks.status, "running"))
    .catch((e) => console.error("[scheduler] boot recovery failed", e));

  timer = setInterval(() => {
    runDueTasks().catch((e) => console.error("[scheduler] tick error", e));
  }, intervalMs);
  timer.unref?.();
  console.log(`[scheduler] started (every ${Math.round(intervalMs / 1000)}s)`);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
