/**
 * Self-service account deletion ("Delete my account" in the driver app and
 * the web profile).
 *
 * Apple's App Store guideline 5.1.1(v) requires any app that lets a person
 * sign in to also let them delete the account from inside the app, and our
 * privacy policy promises deletion on request. The companies this person
 * worked for still need their job history (invoices, photos, time on site),
 * so the user row is ANONYMIZED rather than dropped:
 *
 *   - every open job they hold goes back to the board (same state change the
 *     office's Deactivate uses), finished work keeps its rider link;
 *   - every membership becomes disabled + deactivated_at, so each roster shows
 *     them under "Deactivated" and nothing can be done as them; the last-admin
 *     rule is re-checked inside each company's transaction with the company
 *     row locked, so two co-admins deleting at once cannot both get through;
 *   - every rider profile (including at companies they already left) is
 *     suspended and stripped of phone, headshot, licence and address;
 *   - the user row keeps its id and becomes "Deleted user" with role
 *     `deleted`; sessions, credentials, pending verifications (incl. password
 *     resets), push tokens, notifications and roster invites are removed, so
 *     there is nothing left to sign in with and no link that could bring the
 *     account back. authMiddleware refuses role `deleted` outright.
 *   - free-text copies of the name on messages, job events and change
 *     requests are rewritten; HubSpot contacts linked to the memberships are
 *     archived.
 *
 * Refused (nothing changes) when the person is the last active admin of any
 * company — someone has to be able to run it — and for platform superadmins,
 * whose access does not come from a membership. Re-running on an already
 * anonymized account repeats the cleanup (idempotent) so a crash midway can
 * always be finished.
 */
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { sdb } from "../api/database";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { isAdminRole, isSuperadmin } from "../api/lib/permissions";
import { audit } from "../api/lib/audit";
import { log } from "../api/lib/logger";
import { AccessError, applyDeactivation, loadMember, openJobsForRider, type Plan } from "./user-access";
import { archiveHubspotContact, queueCompanySync } from "./hubspot-sync";

export type DeletionBlocker = { companyId: string; company: string; reason: "last_admin" };

export const ANON_NAME = "Deleted user";
/** Base role written to the user row; authMiddleware and sign-in refuse it. */
export const DELETED_ROLE = "deleted";
export const anonEmail = (userId: string) => `deleted-${userId}@anon.arriveping.com`;
export const isDeletedUser = (u: { role?: string | null; email?: string | null } | null | undefined) =>
  !!u && (u.role === DELETED_ROLE || /^deleted-.*@anon\.arriveping\.com$/.test(u.email ?? ""));

type Membership = typeof schema.memberships.$inferSelect;

async function allMemberships(userId: string): Promise<Membership[]> {
  return sdb.select().from(schema.memberships).where(eq(schema.memberships.userId, userId));
}

/** Active admins at this company other than `userId`. */
function otherActiveAdmins(rows: Membership[], userId: string): number {
  return rows.filter((o) => o.status === "active" && o.userId !== userId && isAdminRole(o.role ?? "")).length;
}

/** Companies where deleting this person would leave nobody in charge. */
export async function deletionBlockers(userId: string): Promise<DeletionBlocker[]> {
  const [user] = await sdb.select().from(schema.user).where(eq(schema.user.id, userId));
  if (!user) return [];
  const mine = await allMemberships(userId);
  // Where is this person an admin? Membership role first; a legacy admin with
  // no membership rows at all still counts at their home company.
  const adminAt = new Set(mine.filter((m) => m.status === "active" && isAdminRole(m.role ?? "")).map((m) => m.companyId));
  if (!mine.length && isAdminRole(user.role) && user.companyId) adminAt.add(user.companyId);
  if (!adminAt.size) return [];
  const companies = await sdb.select().from(schema.companies).where(inArray(schema.companies.id, [...adminAt]));
  const nameById = new Map(companies.map((c) => [c.id, c.name]));
  const out: DeletionBlocker[] = [];
  for (const companyId of adminAt) {
    const rows = await tdb(companyId).select(schema.memberships, eq(schema.memberships.status, "active"));
    if (otherActiveAdmins(rows, userId) === 0) out.push({ companyId, company: nameById.get(companyId) ?? companyId, reason: "last_admin" });
  }
  return out.sort((a, b) => a.company.localeCompare(b.company));
}

/**
 * End one company relationship. Everything for the company happens in one
 * tenant transaction with the company row locked, so the last-admin re-check
 * inside it is authoritative even when two admins delete at the same moment.
 */
async function releaseFromCompany(companyId: string, userId: string, when: Date): Promise<number> {
  const member = await loadMember(companyId, userId);
  if (!member) return 0;
  const m = member.membership;
  if (m.status === "invited") {
    // Never accepted: there is nothing to keep, drop the invite outright.
    await tdb(companyId).delete(schema.memberships, eq(schema.memberships.id, m.id));
    return 0;
  }
  const jobs = member.rider && m.status !== "disabled" ? await openJobsForRider(companyId, member.rider.id) : [];
  const plan: Plan = { member, jobs, toRiderId: jobs.length ? null : undefined };
  await tdb(companyId).transaction(async (tx) => {
    // Serialize deletions per company (and the office's own admin changes
    // that lock the same row) so the admin count below cannot be stale.
    await tx.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.id, companyId)).for("update");
    if (m.status === "active" && isAdminRole(m.role ?? "")) {
      const rows = await tx.select().from(schema.memberships).where(and(eq(schema.memberships.companyId, companyId), eq(schema.memberships.status, "active")));
      if (otherActiveAdmins(rows, userId) === 0) {
        throw new AccessError(409, "last_admin", "You are the only admin here. Another admin must be added first.", { blockers: [{ companyId, reason: "last_admin" }] });
      }
    }
    if (m.status !== "disabled") await applyDeactivation(tx, companyId, plan, when, "Technician left ArrivePing");
    // Free-text copies of the name that live on tenant rows.
    await tx.update(schema.messages).set({ senderName: ANON_NAME }).where(and(eq(schema.messages.companyId, companyId), eq(schema.messages.senderRole, "tech"), member.rider ? eq(schema.messages.riderId, member.rider.id) : sql`false`));
    // job_events has no actor id, only a role + display name; match the exact
    // name under the tech role so the timeline stops naming them.
    await tx.update(schema.jobEvents).set({ actorName: ANON_NAME }).where(and(eq(schema.jobEvents.companyId, companyId), eq(schema.jobEvents.actorRole, "tech"), eq(schema.jobEvents.actorName, member.user.name)));
    await tx.update(schema.bookingChangeRequests).set({ requestedByName: ANON_NAME }).where(and(eq(schema.bookingChangeRequests.companyId, companyId), eq(schema.bookingChangeRequests.requestedBy, userId)));
    await tx.update(schema.bookingChangeRequests).set({ decidedByName: ANON_NAME }).where(and(eq(schema.bookingChangeRequests.companyId, companyId), eq(schema.bookingChangeRequests.decidedBy, userId)));
    await tx.update(schema.auditLog).set({ actorName: ANON_NAME }).where(and(eq(schema.auditLog.companyId, companyId), eq(schema.auditLog.actorId, userId)));
    await tx.update(schema.techInvites).set({ status: "revoked", name: ANON_NAME, phone: "", email: anonEmail(userId) }).where(and(eq(schema.techInvites.companyId, companyId), eq(schema.techInvites.userId, userId)));
  });
  try {
    await audit({
      companyId,
      actorId: userId,
      actorName: ANON_NAME,
      action: "account.delete",
      entityType: "user",
      entityId: userId,
      summary: `A team member deleted their ArrivePing account (user ${userId})`,
      meta: { openJobsReleased: jobs.length },
    });
  } catch (e) {
    log.warn("account-deletion: audit failed", { companyId, err: (e as Error).message });
  }
  if (m.hubspotContactId) {
    await archiveHubspotContact(m.hubspotContactId).catch((e) => log.warn("account-deletion: hubspot archive failed", { companyId, err: (e as Error).message }));
  }
  queueCompanySync(companyId);
  return jobs.length;
}

/** Suspend + scrub every rider profile, including at companies the person already left. */
async function scrubRiders(userId: string) {
  const riders = await sdb.select().from(schema.riders).where(eq(schema.riders.userId, userId));
  for (const r of riders) {
    await tdb(r.companyId).update(
      schema.riders,
      { approval: "suspended", status: "offline", phone: "", photoUrl: "", photoKey: "", licensePlate: "", licenseNumber: "", address: "", notes: "", lat: null, lng: null, locationUpdatedAt: null },
      eq(schema.riders.id, r.id),
    );
  }
}

export async function deleteOwnAccount(userId: string): Promise<{ companies: string[]; releasedJobs: number }> {
  const [user] = await sdb.select().from(schema.user).where(eq(schema.user.id, userId));
  if (!user) throw new AccessError(404, "not_found", "Account not found.");
  if (isSuperadmin(user.role)) throw new AccessError(400, "superadmin", "Platform superadmin accounts cannot be deleted from the app.");
  if (user.role === "customer") {
    throw new AccessError(400, "customer", "Customer records are deleted on request — email privacy@nvc360.com from this address and we will remove it within 30 days.");
  }

  // Already anonymized (a previous run crashed partway)? Skip the admin check
  // — the memberships are already disabled — and just finish the cleanup.
  const alreadyDeleted = isDeletedUser(user);
  if (!alreadyDeleted) {
    const blockers = await deletionBlockers(userId);
    if (blockers.length) {
      const names = blockers.map((b) => b.company).join(", ");
      throw new AccessError(409, "last_admin", `You are the only admin at ${names}. Ask support@nvc360.com to make someone else the admin there, then delete your account.`, { blockers });
    }
  }

  const when = new Date();
  const mine = await allMemberships(userId);
  let releasedJobs = 0;
  const companies: string[] = [];
  for (const m of mine) {
    releasedJobs += await releaseFromCompany(m.companyId, userId, when);
    companies.push(m.companyId);
  }
  await scrubRiders(userId);

  // Identity: keep the id (bookings, audit rows and payouts point at it), drop
  // everything that identifies the person, and remove every way back in. One
  // transaction so a crash cannot leave an anonymized row with a live session.
  await sdb.transaction(async (tx) => {
    await tx
      .update(schema.user)
      .set({
        name: ANON_NAME,
        email: anonEmail(userId),
        emailVerified: false,
        role: DELETED_ROLE,
        companyId: "default",
        image: null,
        phone: null,
        altPhone: null,
        firstName: null,
        lastName: null,
        company: null,
        website: null,
        address: null,
        city: null,
        region: null,
        postalCode: null,
        country: null,
        notes: null,
        addresses: null,
        contacts: null,
        calendarToken: null,
        permissions: null,
        updatedAt: when,
      })
      .where(eq(schema.user.id, userId));
    await tx.delete(schema.session).where(eq(schema.session.userId, userId));
    await tx.delete(schema.account).where(eq(schema.account.userId, userId));
    // better-auth keeps password-reset tokens as identifier "reset-password:<token>"
    // with the user id in `value`; older flows keyed on the email. Clear both.
    await tx.delete(schema.verification).where(or(eq(schema.verification.value, userId), eq(schema.verification.identifier, user.email), like(schema.verification.identifier, `%${user.email}`)));
    await tx.delete(schema.pushTokens).where(eq(schema.pushTokens.userId, userId));
    await tx.delete(schema.notifications).where(eq(schema.notifications.userId, userId));
  });

  return { companies, releasedJobs };
}
