import { db } from "../api/database";
import * as schema from "../api/database/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { tdb } from "../api/database/tenant";

/**
 * Booking statuses that mean a tech is genuinely occupied by an active job.
 * Anything else (confirmed/queued/completed/cancelled/declined) frees them.
 */
export const ACTIVE_JOB_STATUSES = ["assigned", "enroute", "arrived", "in_progress"] as const;

/**
 * Statuses that mean the tech is physically out on a job RIGHT NOW — these
 * make a tech busy regardless of the job's scheduled time.
 */
const IN_FIELD_STATUSES = new Set(["enroute", "arrived", "in_progress"]);

/**
 * How far ahead of a job's scheduled start an `assigned` job starts to make a
 * tech "busy". Outside this window an assigned-but-not-started future job does
 * NOT lock the tech — they stay available for dispatch today.
 */
const ASSIGNED_BUSY_LEAD_MS = 2 * 60 * 60 * 1000; // 2 hours before start

/** Live presence states that should be preserved when a job is in flight. */
const LIVE_FIELD_STATES = new Set(["enroute", "onsite"]);

/**
 * Liveness window. A tech's app reports its GPS heartbeat (PATCH /riders/me
 * {lat,lng}) every few seconds while it's running and they're on shift. If we
 * haven't heard from the device within this window, the app is NOT running
 * (signed out / closed / phone off) and the tech must NOT be shown as
 * "available" to dispatch — they get downgraded to "offline".
 *
 * The mobile heartbeat fires on a 6–10s interval, so a few minutes of grace
 * absorbs brief network drops / backgrounding without flapping.
 */
const LIVENESS_TTL_MS = 3 * 60 * 1000; // 3 minutes since last device heartbeat

/** True if the device has phoned home recently enough to be considered online. */
function hasFreshHeartbeat(lastSeen: Date | number | null | undefined): boolean {
  if (!lastSeen) return false;
  const ts = lastSeen instanceof Date ? lastSeen.getTime() : new Date(lastSeen).getTime();
  if (!ts || Number.isNaN(ts)) return false;
  return Date.now() - ts <= LIVENESS_TTL_MS;
}

/**
 * Recompute a rider's TRUE availability from their current bookings AND their
 * device liveness.
 *
 * Rules:
 *  - If the tech manually toggled offline → "offline" (their choice wins).
 *  - Else if they have a job in the field RIGHT NOW (enroute/arrived/in_progress)
 *    → keep/derive the live field state — an active job means the app is in use.
 *  - Else if their app hasn't sent a heartbeat within LIVENESS_TTL_MS → "offline"
 *    (the app isn't running, so they can't actually be dispatched).
 *  - Else if they have an accepted/assigned active job starting soon → "busy".
 *  - Else → "available".
 *
 * This is the self-heal: it clears stuck "busy" left behind by cancels/reassigns
 * AND prevents phantom "available" techs whose app is closed.
 */
export async function reconcileRiderStatus(companyId: string, riderId: string): Promise<string> {
  const t = tdb(companyId);
  const rider = await t.selectOne(schema.riders, eq(schema.riders.id, riderId));
  if (!rider) return "offline";

  // Manual offline always wins — tech explicitly went off the clock.
  if (rider.manualOffline) {
    if (rider.status !== "offline") {
      await t.update(schema.riders, { status: "offline" }, eq(schema.riders.id, riderId));
    }
    return "offline";
  }

  // Does this tech have any genuinely active job right now? (tenant-scoped)
  const candidates = (
    await t.select(
      schema.bookings,
      and(
        eq(schema.bookings.riderId, riderId),
        inArray(schema.bookings.status, ACTIVE_JOB_STATUSES as unknown as string[]),
        // An archived job keeps its status (only deletedAt is set, so
        // restoring it is exact) — without this a deleted job stuck in an
        // active status locks the tech "busy" forever with no job to clear it.
        isNull(schema.bookings.deletedAt),
      ),
    )
  ).map((b) => ({ id: b.id, status: b.status, assignStatus: b.assignStatus, scheduledAt: b.scheduledAt }));

  // A job only makes the tech busy NOW if:
  //  - it's in the field (enroute/arrived/in_progress), OR
  //  - it's `assigned` and starting soon (within the lead window).
  // Future assigned jobs scheduled hours/days out do NOT lock the tech today.
  const now = Date.now();
  const active = candidates.filter((j) => {
    if (IN_FIELD_STATUSES.has(j.status)) return true;
    // assigned: only "busy" once we're within the lead window of its start
    const start = j.scheduledAt ? new Date(j.scheduledAt).getTime() : 0;
    return start > 0 && now >= start - ASSIGNED_BUSY_LEAD_MS;
  });

  // Is the tech physically out on a job in the field right now? That means the
  // app is actively in use, so we trust the live field state regardless of the
  // last GPS heartbeat timestamp.
  const inField = candidates.some((j) => IN_FIELD_STATUSES.has(j.status));
  const online = inField || hasFreshHeartbeat(rider.locationUpdatedAt);

  let next: string;
  if (!online) {
    // App isn't running / tech isn't reachable → they cannot be dispatched.
    // Show offline even if they have a future assigned job; they'll flip back
    // to busy/available automatically once their device starts reporting again.
    next = "offline";
  } else if (active.length === 0) {
    // Online with no active jobs → they are free.
    next = "available";
  } else if (LIVE_FIELD_STATES.has(rider.status)) {
    // Preserve a live field state (driving/on-site) that matches a real active job.
    next = rider.status;
  } else {
    next = "busy";
  }

  if (rider.status !== next) {
    await t.update(schema.riders, { status: next }, eq(schema.riders.id, riderId));
  }
  return next;
}

/**
 * Reconcile every rider across ALL tenants — the boot/cron sweep.
 * This is intentionally cross-tenant (system path): it reads the global rider
 * set, then reconciles each one scoped to its own company.
 */
export async function reconcileAllRiders(): Promise<void> {
  const rows = await db
    .select({ id: schema.riders.id, companyId: schema.riders.companyId })
    .from(schema.riders);
  await Promise.all(rows.map((r) => reconcileRiderStatus(r.companyId, r.id)));
}
