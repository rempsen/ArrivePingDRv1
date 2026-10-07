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
import { and, eq } from "drizzle-orm";
import { fireEvent } from "./dispatch";
import { reconcileRiderStatus } from "./presence";
import { findAvailabilityBlock } from "./availability";
import { logJobEvent } from "./job-events";
import { assignBlockedReason, isInFlightStatus } from "../shared/job-status";

export type Booking = typeof schema.bookings.$inferSelect;

export interface AssignOptions {
  /** Dispatcher override: pull a tech off a live job / ignore availability clashes. */
  force?: boolean;
  /** Who's doing this. Automation stamps the job so the UI can badge it. */
  by?: { kind: "dispatcher"; name?: string } | { kind: "automation"; ruleId: string; ruleName: string };
}

export type AssignResult =
  | { ok: true; booking: Booking }
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
  if (!force) {
    const busy = await findAvailabilityBlock(companyId, {
      riderId,
      scheduledAt: prev.scheduledAt,
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
    and(eq(schema.bookings.id, bookingId), eq(schema.bookings.status, prev.status)),
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

  await fireEvent("assigned", bookingId);
  return { ok: true, booking: b };
}
