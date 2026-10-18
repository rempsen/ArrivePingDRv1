/**
 * The one way a job gets handed to a technician.
 *
 * Both the dispatcher's `POST /bookings/:id/assign` and the automation engine
 * (assignment rules in "assign" mode) come through here, so every guard — tenant
 * check, terminal/in-flight protection, double-booking and time-off checks, the
 * compare-and-set on status, presence reconciliation and the "assigned" event —
 * applies identically whether a human or a rule did the dispatching.
 *
 * Returns a structured result instead of throwing so the route can keep its
 * exact HTTP contract (409 + forceable, etc.) and the engine can log the refusal
 * as a plain sentence.
 */
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { and, eq, isNull } from "drizzle-orm";
import { fireEvent } from "./dispatch";
import { reconcileRiderStatus } from "./presence";
import { findAvailabilityBlock } from "./availability";
import { logJobEvent } from "./job-events";
import { assignBlockedReason, isInFlightStatus } from "../shared/job-status";
import { RESCHEDULED_NOTICE_TASK } from "./dispatch-notice-kinds";
import { cancelTasks } from "./scheduler";

export type Booking = typeof schema.bookings.$inferSelect;

export interface AssignOptions {
  /** Dispatcher override: pull a tech off a live job / ignore availability clashes. */
  force?: boolean;
  /**
   * When set, the availability check is its own override: `force` then only
   * covers taking the job off a live visit, and a clash at the new time is
   * still asked about unless this is true. (The dispatch calendar asks both.)
   */
  forceBusy?: boolean;
  /** Who's doing this. Automation stamps the job so the UI can badge it. */
  by?: { kind: "dispatcher"; name?: string } | { kind: "automation"; ruleId: string; ruleName: string };
  /**
   * Don't fire the "assigned" event (notifications + timeline) here; the caller
   * fires it later. The dispatch map holds it for its few-second Undo window
   * (services/dispatch-assign.ts) so an undone drop never texts anyone.
   */
  deferEvent?: boolean;
  /**
   * Put the job at this time in the same write (the dispatch calendar drops a
   * queued job on a technician at a time). Availability is checked at this
   * time, not the old one.
   */
  scheduledAt?: Date;
}

export type AssignResult =
  /** `previous` is the row as checked and replaced by this write. */
  | { ok: true; booking: Booking; previous: Booking }
  | {
      ok: false;
      code: "tech_not_found" | "job_not_found" | "blocked" | "already_accepted" | "unavailable" | "raced";
      message: string;
      status?: string;
      /** The refusal can be overridden with force:true. */
      forceable: boolean;
      reason?: string;
    };

export async function assignJob(
  companyId: string,
  bookingId: string,
  riderId: string,
  opts: AssignOptions = {},
): Promise<AssignResult> {
  const t = tdb(companyId);
  const force = !!opts.force;

  // Tenant check: the booking update itself is tenant-scoped, but riderId must
  // be checked against the same tenant or an admin could assign a technician
  // belonging to another company by passing their id.
  const assignee = await t.selectOne(schema.riders, eq(schema.riders.id, riderId));
  if (!assignee) return { ok: false, code: "tech_not_found", message: "Technician not found", forceable: false };
  const prev = await t.selectOne(schema.bookings, eq(schema.bookings.id, bookingId));
  if (!prev) return { ok: false, code: "job_not_found", message: "Work order not found", forceable: false };

  // Terminal and in-flight jobs are protected (see assignBlockedReason).
  // `forceable` tells the dispatch UI whether this refusal is a "are you sure"
  // (a tech is mid-job) or a hard no (the job is completed/cancelled).
  const blocked = assignBlockedReason(prev.status, { force });
  if (blocked)
    return { ok: false, code: "blocked", message: blocked, status: prev.status, forceable: isInFlightStatus(prev.status) };

  // Re-offering the job to the tech who already accepted it wipes acceptedAt,
  // drops them back to "offered" and re-sends the dispatch notification.
  if (prev.riderId === riderId && prev.assignStatus === "accepted" && !force)
    return {
      ok: false,
      code: "already_accepted",
      message: "This technician has already accepted this job.",
      status: prev.status,
      forceable: true,
    };

  // Is this tech actually free then? Double-booking + time off. Forceable,
  // because a real dispatcher overrides both for good reasons — automation
  // never passes force, so a rule can't double-book anyone.
  if (opts.forceBusy === undefined ? !force : !opts.forceBusy) {
    const busy = await findAvailabilityBlock(companyId, {
      riderId,
      scheduledAt: opts.scheduledAt ?? prev.scheduledAt,
      bookingId,
      serviceId: prev.serviceId,
    });
    if (busy)
      return { ok: false, code: "unavailable", message: busy.message, reason: busy.kind, status: prev.status, forceable: true };
  }

  const auto = opts.by?.kind === "automation" ? opts.by : null;
  const set: Record<string, unknown> = {
    riderId,
    status: "assigned",
    assignStatus: "offered",
    assignedAt: new Date(),
    acceptedAt: null,
    declineReason: "",
    // A human decision replaces the automation stamp; a rule sets it.
    autoAssignedRuleId: auto ? auto.ruleId : "",
    autoAssignedAt: auto ? new Date() : null,
  };
  if (opts.scheduledAt) set.scheduledAt = opts.scheduledAt;
  // Handing a live job to someone else: the new tech must not inherit the
  // previous tech's drive time, arrival or running on-site clock (that time is
  // billable and belongs to the first visit, not to this one).
  if (prev.status !== "assigned" && prev.riderId !== riderId) {
    set.enrouteAt = null;
    set.startedAt = null;
    set.clockState = "idle";
    set.lastResumeAt = null;
    set.insideGeofence = false;
  }
  // Compare-and-set on the status we just checked: if a tech accepted, released
  // or completed the job in the meantime, this write does nothing rather than
  // clobbering the newer state.
  const [b] = await t.update(
    schema.bookings,
    set,
    and(
      eq(schema.bookings.id, bookingId),
      eq(schema.bookings.status, prev.status),
      // ...and the assignee we checked: two dispatchers reassigning at once
      // can't overwrite each other.
      prev.riderId ? eq(schema.bookings.riderId, prev.riderId) : isNull(schema.bookings.riderId),
      // Moving it too: only from the time we checked.
      ...(opts.scheduledAt ? [eq(schema.bookings.scheduledAt, prev.scheduledAt)] : []),
    ),
  );
  if (!b)
    return {
      ok: false,
      code: "raced",
      message: "This job just changed — pull it up again to see where it is now.",
      forceable: false,
    };

  await reconcileRiderStatus(companyId, riderId);
  // Free the tech who was pulled off, so they don't stay "busy" on a job they
  // no longer hold.
  if (prev.riderId && prev.riderId !== riderId) await reconcileRiderStatus(companyId, prev.riderId);

  if (auto) {
    await logJobEvent({
      companyId,
      bookingId,
      kind: "note_added",
      actorRole: "system",
      actorName: "Automation",
      label: `Auto-assigned by rule "${auto.ruleName}"`,
      detail: `Assigned automatically — rule ${auto.ruleName}.`,
      meta: { ruleId: auto.ruleId, riderId },
    });
  }

  if (!opts.deferEvent) {
    // "Assigned" tells the technician and the customer the job's time, so a
    // calendar move still waiting out its Undo window has nothing left to add.
    await cancelTasks({ bookingId, kind: RESCHEDULED_NOTICE_TASK });
    await fireEvent("assigned", bookingId);
  }
  return { ok: true, booking: b, previous: prev };
}
