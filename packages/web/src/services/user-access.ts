/**
 * Reversible user deactivation and seat downsizing.
 *
 * "Deactivated" is the off switch between "working" and "deleted": the person
 * keeps every job, photo and time entry in history, cannot sign in to this
 * company, and no longer counts as a paid seat. It is represented by
 *   memberships.status  = 'disabled'   (authMiddleware excludes it)
 *   memberships.deactivated_at = now()
 *   riders.approval     = 'suspended'  (driverSeatCount counts only 'active')
 * and Reactivate reverses all three.
 *
 * Seats: a seat is a FIELD-STAFF member (membership role 'rider'). Office
 * staff may have a rider profile (so they can be assigned jobs) but are never
 * billed, so deactivating them never changes the plan.
 *
 * Every mutation validates first and writes inside one tenant transaction;
 * the Stripe quantity update (setSeats) runs after the commit, as it does for
 * the Billing tab's own seat changes.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { tdb } from "../api/database/tenant";
import { sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { OPEN_STATUSES } from "../shared/job-status";
import { isAdminRole, isSuperadmin } from "../api/lib/permissions";
import { audit } from "../api/lib/audit";
import { queueCompanySync } from "./hubspot-sync";
import { setSeats } from "./billing-subscription";
import { fireEvent } from "./dispatch";

/** Swappable for tests (a Stripe outage is simulated by making setSeats throw). */
export const deps = { setSeats, fireEvent };
import { monthlyPrice } from "../web/site/config";
import { log } from "../api/lib/logger";

export class AccessError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409,
    public code: string,
    message: string,
    public meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AccessError";
  }
}

export type Actor = { id: string; role?: string; name?: string };
export type OpenJob = { id: string; title: string; scheduledAt: string; status: string };
export type SeatCandidate = {
  userId: string;
  riderId: string;
  name: string;
  email: string;
  staffType: "driver" | "technician";
  lastActiveAt: string | null;
  openJobs: number;
};
/** userId to move the jobs to, or null = back to the unassigned board. */
export type ReassignTarget = string | null;

const FIELD_ROLE = "rider";
const OPEN = [...OPEN_STATUSES] as string[];

export type Member = { membership: typeof schema.memberships.$inferSelect; user: typeof schema.user.$inferSelect; rider: typeof schema.riders.$inferSelect | null };

export async function loadMember(companyId: string, userId: string): Promise<Member | null> {
  const t = tdb(companyId);
  const membership = await t.selectOne(schema.memberships, eq(schema.memberships.userId, userId));
  if (!membership) return null;
  // The membership row (tenant-scoped above) is what proves this person is
  // ours; the user row itself is read on the system connection because the
  // RLS policy on "user" only exposes active members, and a deactivated
  // person is exactly who reactivate needs to find.
  const [user] = await sdb.select().from(schema.user).where(eq(schema.user.id, userId));
  if (!user) return null;
  const rider = (await t.selectOne(schema.riders, eq(schema.riders.userId, userId))) ?? null;
  return { membership, user, rider };
}

export async function openJobsForRider(companyId: string, riderId: string): Promise<OpenJob[]> {
  const rows = await tdb(companyId).select(
    schema.bookings,
    and(eq(schema.bookings.riderId, riderId), inArray(schema.bookings.status, OPEN), isNull(schema.bookings.deletedAt)),
  );
  return rows.map((b) => ({ id: b.id, title: b.title, scheduledAt: b.scheduledAt.toISOString(), status: b.status }));
}

/** Jobs still ahead of (or under way with) this user, by their rider profile. */
export async function openJobsFor(companyId: string, userId: string): Promise<OpenJob[]> {
  const rider = await tdb(companyId).selectOne(schema.riders, eq(schema.riders.userId, userId));
  if (!rider) return [];
  return openJobsForRider(companyId, rider.id);
}

/** Active field staff who count as seats, least recently active first (never-active first). */
export async function seatCandidates(companyId: string): Promise<SeatCandidate[]> {
  const t = tdb(companyId);
  const members = await t.select(schema.memberships, and(eq(schema.memberships.role, FIELD_ROLE), eq(schema.memberships.status, "active")));
  if (!members.length) return [];
  const riders = await t.select(schema.riders, eq(schema.riders.approval, "active"));
  const riderByUser = new Map(riders.map((r) => [r.userId, r]));
  const users = await sdb.select().from(schema.user).where(inArray(schema.user.id, members.map((m) => m.userId)));
  const userById = new Map(users.map((u) => [u.id, u]));
  const openCounts = new Map<string, number>();
  const riderIds = riders.map((r) => r.id);
  if (riderIds.length) {
    const open = await t.select(schema.bookings, and(inArray(schema.bookings.riderId, riderIds), inArray(schema.bookings.status, OPEN), isNull(schema.bookings.deletedAt)));
    for (const b of open) if (b.riderId) openCounts.set(b.riderId, (openCounts.get(b.riderId) ?? 0) + 1);
  }
  const out: SeatCandidate[] = [];
  for (const m of members) {
    const r = riderByUser.get(m.userId);
    const u = userById.get(m.userId);
    if (!r || !u) continue;
    out.push({
      userId: m.userId,
      riderId: r.id,
      name: u.name,
      email: u.email,
      staffType: m.staffType === "driver" ? "driver" : "technician",
      lastActiveAt: r.locationUpdatedAt ? r.locationUpdatedAt.toISOString() : null,
      openJobs: openCounts.get(r.id) ?? 0,
    });
  }
  return out.sort((a, b) => {
    if (a.lastActiveAt === b.lastActiveAt) return a.name.localeCompare(b.name);
    if (a.lastActiveAt === null) return -1;
    if (b.lastActiveAt === null) return 1;
    return a.lastActiveAt < b.lastActiveAt ? -1 : 1;
  });
}

async function activeFieldStaffCount(companyId: string): Promise<number> {
  const t = tdb(companyId);
  const members = await t.select(schema.memberships, and(eq(schema.memberships.role, FIELD_ROLE), eq(schema.memberships.status, "active")));
  if (!members.length) return 0;
  const riders = await t.select(schema.riders, eq(schema.riders.approval, "active"));
  const active = new Set(riders.map((r) => r.userId));
  return members.filter((m) => active.has(m.userId)).length;
}

/* -------------------------------------------------------------------------- */
/*  Guards                                                                     */
/* -------------------------------------------------------------------------- */

async function guardDeactivate(companyId: string, actor: Actor, target: Member) {
  if (target.membership.status === "disabled") throw new AccessError(409, "already_deactivated", "This user is already deactivated.");
  if (target.user.id === actor.id) throw new AccessError(400, "self", "You cannot deactivate your own account.");
  // A platform superadmin's access does not come from a membership (auth
  // exempts the base role), so disabling the row would report success while
  // changing nothing. Refuse rather than pretend.
  if (isSuperadmin(target.user.role)) throw new AccessError(400, "superadmin_exempt", "Platform superadmin accounts cannot be deactivated here.");
  const role = target.membership.role ?? target.user.role ?? "";
  if (isAdminRole(role)) {
    if (!isSuperadmin(actor.role)) throw new AccessError(403, "superadmin_required", "Only a superadmin can deactivate admin-level accounts.");
    const admins = await tdb(companyId).select(schema.memberships, eq(schema.memberships.status, "active"));
    const remaining = admins.filter((m) => isAdminRole(m.role) && m.userId !== target.user.id);
    if (!remaining.length) throw new AccessError(400, "last_admin", "You cannot deactivate the last admin.");
  }
}

/** Resolve a reassignment target to an active rider profile at this company, or null for unassign. */
async function resolveReassignTarget(companyId: string, reassignTo: ReassignTarget, deactivating: Set<string>): Promise<string | null> {
  if (reassignTo === null) return null;
  if (deactivating.has(reassignTo)) {
    throw new AccessError(400, "reassign_target_deactivated", "Jobs cannot be moved to a user who is also being deactivated.");
  }
  const t = tdb(companyId);
  const m = await t.selectOne(schema.memberships, and(eq(schema.memberships.userId, reassignTo), eq(schema.memberships.status, "active")));
  const r = await t.selectOne(schema.riders, and(eq(schema.riders.userId, reassignTo), eq(schema.riders.approval, "active")));
  if (!m || !r) throw new AccessError(400, "reassign_target_invalid", "Choose an active team member to take over the jobs.");
  return r.id;
}

export type Plan = { member: Member; jobs: OpenJob[]; toRiderId: string | null | undefined };

/** Validate one deactivation and work out what its jobs do. `undefined` toRiderId = nothing to move. */
async function planDeactivation(companyId: string, actor: Actor, userId: string, reassignTo: ReassignTarget | undefined, deactivating: Set<string>): Promise<Plan> {
  const member = await loadMember(companyId, userId);
  if (!member) throw new AccessError(404, "not_found", "User not found.");
  await guardDeactivate(companyId, actor, member);
  const jobs = member.rider ? await openJobsForRider(companyId, member.rider.id) : [];
  if (!jobs.length) return { member, jobs, toRiderId: undefined };
  if (reassignTo === undefined) {
    throw new AccessError(409, "has_open_jobs", `${member.user.name} still has ${jobs.length} open ${jobs.length === 1 ? "job" : "jobs"}. Reassign or unassign them first.`, { openJobs: jobs.length });
  }
  return { member, jobs, toRiderId: await resolveReassignTarget(companyId, reassignTo, deactivating) };
}

export type Tx = Parameters<Parameters<ReturnType<typeof tdb>["transaction"]>[0]>[0];

/**
 * The writes for one planned deactivation, inside an already-open tenant
 * transaction. Jobs move through the same state changes dispatch uses:
 * back to the board = "confirmed"/released with the assignment cleared;
 * to a new tech = "assigned"/offered with the previous tech's drive and clock
 * reset (assign.ts does the same). The UPDATE only touches jobs still on this
 * rider and still open, and we re-check afterwards: a job that landed on them
 * between planning and now rolls the whole thing back.
 */
export async function applyDeactivation(tx: Tx, companyId: string, plan: Plan, when: Date, declineReason = "Technician deactivated") {
  if (plan.member.rider) {
    const rider = plan.member.rider;
    if (plan.jobs.length) {
      const reset = { enrouteAt: null, startedAt: null, clockState: "idle", lastResumeAt: null, insideGeofence: false, autoAssignedRuleId: "", autoAssignedAt: null, acceptedAt: null };
      const set =
        plan.toRiderId === null
          ? { ...reset, riderId: null, status: "confirmed", assignStatus: "released", declineReason, assignedAt: null }
          : { ...reset, riderId: plan.toRiderId, status: "assigned", assignStatus: "offered", declineReason: "", assignedAt: when };
      await tx
        .update(schema.bookings)
        .set(set as Partial<typeof schema.bookings.$inferInsert>)
        .where(
          and(
            eq(schema.bookings.companyId, companyId),
            eq(schema.bookings.riderId, rider.id),
            inArray(schema.bookings.status, OPEN),
            inArray(schema.bookings.id, plan.jobs.map((j) => j.id)),
          ),
        );
    }
    const remaining = await tx
      .select({ id: schema.bookings.id })
      .from(schema.bookings)
      .where(and(eq(schema.bookings.companyId, companyId), eq(schema.bookings.riderId, rider.id), inArray(schema.bookings.status, OPEN), isNull(schema.bookings.deletedAt)));
    if (remaining.length) {
      throw new AccessError(409, "has_open_jobs", `${plan.member.user.name} was just assigned another job. Refresh and try again.`, { openJobs: remaining.length });
    }
    await tx.update(schema.riders).set({ approval: "suspended", status: "offline" }).where(and(eq(schema.riders.companyId, companyId), eq(schema.riders.id, rider.id)));
  }
  await tx
    .update(schema.memberships)
    .set({ status: "disabled", deactivatedAt: when, updatedAt: when })
    .where(and(eq(schema.memberships.companyId, companyId), eq(schema.memberships.id, plan.member.membership.id)));
}

/** After commit: tell the new tech about each job they were handed. Never fails the request. */
async function notifyReassigned(plans: Plan[]) {
  for (const p of plans) {
    if (!p.toRiderId) continue;
    for (const j of p.jobs) await deps.fireEvent("assigned", j.id).catch(() => {});
  }
}

/** Audit + CRM sync after a committed change; a failure here must not turn a done action into a 500. */
async function afterCommit(companyId: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    log.warn("user-access: post-commit bookkeeping failed", { companyId, err: (e as Error).message });
  }
  queueCompanySync(companyId);
}

function auditDeactivation(companyId: string, actor: Actor, plan: Plan) {
  return audit({
    companyId,
    actorId: actor.id,
    actorName: actor.name,
    action: "team.deactivate",
    entityType: "user",
    entityId: plan.member.user.id,
    summary: `Deactivated ${plan.member.user.name}`,
    meta: { openJobsMoved: plan.jobs.length, reassignedToRiderId: plan.toRiderId ?? null },
  });
}

/* -------------------------------------------------------------------------- */
/*  Public operations                                                          */
/* -------------------------------------------------------------------------- */

export async function deactivateUser(companyId: string, actor: Actor, userId: string, opts: { reassignTo?: ReassignTarget }): Promise<{ deactivatedAt: Date }> {
  const plan = await planDeactivation(companyId, actor, userId, opts.reassignTo, new Set([userId]));
  const when = new Date();
  await tdb(companyId).transaction((tx) => applyDeactivation(tx, companyId, plan, when));
  await afterCommit(companyId, async () => {
    await notifyReassigned([plan]);
    await auditDeactivation(companyId, actor, plan);
  });
  return { deactivatedAt: when };
}

export async function reactivateUser(companyId: string, actor: Actor, userId: string, opts: { addSeat?: boolean }): Promise<{ seats: number }> {
  const member = await loadMember(companyId, userId);
  if (!member) throw new AccessError(404, "not_found", "User not found.");
  if (member.membership.status !== "disabled") throw new AccessError(409, "not_deactivated", "This user is not deactivated.");
  // Same rule as deactivate and PATCH /team: admin-level accounts are a superadmin's to change.
  if (isAdminRole(member.membership.role ?? member.user.role) && !isSuperadmin(actor.role)) {
    throw new AccessError(403, "superadmin_required", "Only a superadmin can reactivate admin-level accounts.");
  }
  const t = tdb(companyId);
  const [co] = await t.raw.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  let seats = Math.max(1, co?.billingSeats ?? 1);
  let seatAdded = false;
  const isField = (member.membership.role ?? member.user.role) === FIELD_ROLE;
  if (isField) {
    const active = await activeFieldStaffCount(companyId);
    if (active >= seats) {
      if (!opts.addSeat) {
        const monthlyDelta = monthlyPrice(seats + 1).total - monthlyPrice(seats).total;
        throw new AccessError(409, "seat_required", `Reactivating ${member.user.name} needs 1 more user on your plan.`, { seatsNeeded: 1, monthlyDelta });
      }
      seats = (await deps.setSeats(companyId, seats + 1)).seats;
      seatAdded = true;
    }
  }
  const when = new Date();
  try {
    await t.transaction(async (tx) => {
      await tx
        .update(schema.memberships)
        .set({ status: "active", deactivatedAt: null, updatedAt: when, acceptedAt: member.membership.acceptedAt ?? when })
        .where(and(eq(schema.memberships.companyId, companyId), eq(schema.memberships.id, member.membership.id)));
      if (member.rider) {
        await tx.update(schema.riders).set({ approval: "active" }).where(and(eq(schema.riders.companyId, companyId), eq(schema.riders.id, member.rider.id)));
      }
    });
  } catch (e) {
    // The seat was added for this person; if they stay deactivated, give it back.
    if (seatAdded) await deps.setSeats(companyId, seats - 1).catch((err) => log.warn("user-access: seat revert failed", { companyId, err: (err as Error).message }));
    throw e;
  }
  await afterCommit(companyId, () =>
    audit({ companyId, actorId: actor.id, actorName: actor.name, action: "team.reactivate", entityType: "user", entityId: userId, summary: `Reactivated ${member.user.name}`, meta: { seats } }),
  );
  return { seats };
}

export async function downsize(
  companyId: string,
  actor: Actor,
  input: { seats: number; deactivate: string[]; reassign: Record<string, ReassignTarget> },
): Promise<{ seats: number; deactivated: string[] }> {
  const ids = Array.from(new Set(input.deactivate));
  if (!ids.length) throw new AccessError(400, "nothing_to_do", "Choose at least one user to deactivate.");
  const candidates = new Set((await seatCandidates(companyId)).map((c) => c.userId));
  const notSeat = ids.find((id) => !candidates.has(id));
  if (notSeat) throw new AccessError(400, "not_a_seat", "Only active field staff count towards your plan and can be chosen here.");
  const active = candidates.size;
  const expected = Math.max(1, active - ids.length);
  if (input.seats !== expected) {
    throw new AccessError(409, "stale", "Your team changed since this opened. Refresh and try again.", { activeDrivers: active, expectedSeats: expected });
  }
  const deactivating = new Set(ids);
  const plans: Plan[] = [];
  for (const id of ids) {
    const reassign = Object.prototype.hasOwnProperty.call(input.reassign, id) ? input.reassign[id] : undefined;
    plans.push(await planDeactivation(companyId, actor, id, reassign, deactivating));
  }
  // Stripe first, then the database in one transaction. If Stripe refuses,
  // nobody has been deactivated; if the transaction fails, the seat count is
  // put back. Either way the tenant never ends up half-changed.
  const [co] = await sdb.select({ seats: schema.companies.billingSeats }).from(schema.companies).where(eq(schema.companies.id, companyId));
  const previousSeats = Math.max(1, co?.seats ?? 1);
  const { seats } = await deps.setSeats(companyId, input.seats);
  const when = new Date();
  try {
    await tdb(companyId).transaction(async (tx) => {
      for (const p of plans) await applyDeactivation(tx, companyId, p, when);
    });
  } catch (e) {
    await deps.setSeats(companyId, previousSeats).catch((err) => log.warn("user-access: seat revert failed", { companyId, err: (err as Error).message }));
    throw e;
  }
  await afterCommit(companyId, async () => {
    await notifyReassigned(plans);
    for (const p of plans) await auditDeactivation(companyId, actor, p);
    await audit({ companyId, actorId: actor.id, actorName: actor.name, action: "billing.downsize", entityType: "company", entityId: companyId, summary: `Plan reduced to ${seats} users`, meta: { seats, deactivated: ids } });
  });
  return { seats, deactivated: ids };
}
