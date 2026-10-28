/**
 * Self-service account deletion ("Delete my account" in the driver app and
 * the web profile).
 *
 * Apple's App Store guideline 5.1.1(v) requires any app that lets a person
 * sign in to also let them delete the account from inside the app, and our
 * privacy policy promises deletion on request. The companies this person
 * worked for still need their job history (invoices, photos, time on site),
 * so the user row is ANONYMIZED rather than dropped.
 *
 * Everything happens in ONE system-connection transaction (the only place in
 * the codebase that legitimately writes across tenants, because the subject
 * is one person's identity at every company they ever worked for):
 *
 *   - every company row involved is locked, then the last-admin rule is
 *     checked for each company where they are an active admin — a failure
 *     anywhere rolls back everywhere, so two co-admins deleting at once, or a
 *     co-admin vanishing mid-request, can never leave a company with no admin
 *     or an account that is half gone;
 *   - every open job they hold goes back to the board (same state change the
 *     office's Deactivate uses), finished work keeps its rider link;
 *   - every membership becomes disabled + deactivated_at (invites are dropped);
 *   - every rider profile — including at companies they already left — is
 *     suspended and stripped of phone, headshot, licence and address; the
 *     headshot object is deleted from storage after commit;
 *   - free-text copies of the name on tenant rows (messages, job events and
 *     voice-note lines on the jobs they worked, change requests, audit rows,
 *     roster invites) are rewritten, scoped to THEIR jobs so a namesake on the
 *     same roster is untouched;
 *   - the user row keeps its id and becomes "Deleted user" with role
 *     `deleted`; sessions, credentials, pending verifications (incl.
 *     password resets), push tokens and notifications are removed, so there
 *     is nothing left to sign in with and no link that could bring the
 *     account back. authMiddleware refuses role `deleted`.
 *
 * After commit: audit rows (never carrying the real name), HubSpot contact
 * archival, CRM sync. Refused for platform superadmins (access does not come
 * from a membership) and customers (their records need a different scrub).
 * Re-running on an anonymized account repeats the cleanup (idempotent).
 */
import { and, eq, inArray, like, or, sql, asc } from "drizzle-orm";
import { sdb } from "../api/database";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { isAdminRole, isSuperadmin } from "../api/lib/permissions";
import { audit } from "../api/lib/audit";
import { log } from "../api/lib/logger";
import { deleteObject } from "../api/lib/storage";
import { OPEN_STATUSES } from "../shared/job-status";
import { AccessError, applyDeactivation, type Member, type Plan, type Tx } from "./user-access";
import { archiveHubspotContact, queueCompanySync } from "./hubspot-sync";

export type DeletionBlocker = { companyId: string; company: string; reason: "last_admin" };

export const ANON_NAME = "Deleted user";
/** Base role written to the user row; authMiddleware and sign-in refuse it. */
export const DELETED_ROLE = "deleted";
export const anonEmail = (userId: string) => `deleted-${userId}@anon.arriveping.com`;
export const isDeletedUser = (u: { role?: string | null; email?: string | null } | null | undefined) =>
  !!u && (u.role === DELETED_ROLE || /^deleted-.*@anon\.arriveping\.com$/.test(u.email ?? ""));

type Membership = typeof schema.memberships.$inferSelect;
type Rider = typeof schema.riders.$inferSelect;
const OPEN = [...OPEN_STATUSES] as string[];

/** Active admins at this company other than `userId`. */
function otherActiveAdmins(rows: Membership[], userId: string): number {
  return rows.filter((o) => o.status === "active" && o.userId !== userId && isAdminRole(o.role ?? "")).length;
}

/** Where is this person an admin? Membership role first; a legacy admin with no membership rows counts at their home company. */
function adminCompanies(user: typeof schema.user.$inferSelect, mine: Membership[]): string[] {
  const set = new Set(mine.filter((m) => m.status === "active" && isAdminRole(m.role ?? "")).map((m) => m.companyId));
  if (!mine.length && isAdminRole(user.role) && user.companyId) set.add(user.companyId);
  return [...set];
}

/** Companies where deleting this person would leave nobody in charge (read-only preview). */
export async function deletionBlockers(userId: string): Promise<DeletionBlocker[]> {
  const [user] = await sdb.select().from(schema.user).where(eq(schema.user.id, userId));
  if (!user) return [];
  const mine = await sdb.select().from(schema.memberships).where(eq(schema.memberships.userId, userId));
  const adminAt = adminCompanies(user, mine);
  if (!adminAt.length) return [];
  const companies = await sdb.select().from(schema.companies).where(inArray(schema.companies.id, adminAt));
  const nameById = new Map(companies.map((c) => [c.id, c.name]));
  const out: DeletionBlocker[] = [];
  for (const companyId of adminAt) {
    const rows = await tdb(companyId).select(schema.memberships, eq(schema.memberships.status, "active"));
    if (otherActiveAdmins(rows, userId) === 0) out.push({ companyId, company: nameById.get(companyId) ?? companyId, reason: "last_admin" });
  }
  return out.sort((a, b) => a.company.localeCompare(b.company));
}

/** Rewrite every free-text copy of the name on one company's rows, scoped to this person's own rider identity / jobs. */
async function scrubTenantText(tx: Tx, companyId: string, user: typeof schema.user.$inferSelect, rider: Rider | null) {
  const co = (t: { companyId: any }) => eq(t.companyId, companyId);
  await tx.update(schema.auditLog).set({ actorName: ANON_NAME }).where(and(co(schema.auditLog), eq(schema.auditLog.actorId, user.id)));
  await tx.update(schema.bookingChangeRequests).set({ requestedByName: ANON_NAME }).where(and(co(schema.bookingChangeRequests), eq(schema.bookingChangeRequests.requestedBy, user.id)));
  await tx.update(schema.bookingChangeRequests).set({ decidedByName: ANON_NAME }).where(and(co(schema.bookingChangeRequests), eq(schema.bookingChangeRequests.decidedBy, user.id)));
  await tx
    .update(schema.techInvites)
    .set({ status: "revoked", name: ANON_NAME, phone: "", email: anonEmail(user.id) })
    .where(and(co(schema.techInvites), or(eq(schema.techInvites.userId, user.id), eq(schema.techInvites.email, user.email))));
  if (!rider) return;
  // Jobs this rider is (or was) on: completed work keeps its rider link, so
  // this is exactly the set of threads, timelines and notes that name them.
  const myJobs = tx.select({ id: schema.bookings.id }).from(schema.bookings).where(and(co(schema.bookings), eq(schema.bookings.riderId, rider.id)));
  await tx
    .update(schema.messages)
    .set({ senderName: ANON_NAME })
    .where(and(co(schema.messages), eq(schema.messages.senderRole, "tech"), or(eq(schema.messages.riderId, rider.id), inArray(schema.messages.bookingId, myJobs))));
  // job_events has no actor id, only role + display name: scope to their jobs
  // and their exact name so a namesake's events on other jobs stay attributed.
  await tx
    .update(schema.jobEvents)
    .set({ actorName: ANON_NAME })
    .where(and(co(schema.jobEvents), eq(schema.jobEvents.actorRole, "tech"), eq(schema.jobEvents.actorName, user.name), inArray(schema.jobEvents.bookingId, myJobs)));
  // Voice-note lines are appended to driver notes as "[Voice note — <name>, <time>] …".
  if (user.name) {
    await tx
      .update(schema.bookings)
      .set({ driverNotes: sql`replace(${schema.bookings.driverNotes}, ${user.name}, ${ANON_NAME})` })
      .where(and(co(schema.bookings), eq(schema.bookings.riderId, rider.id), like(schema.bookings.driverNotes, `%${user.name}%`)));
  }
}

export async function deleteOwnAccount(userId: string): Promise<{ companies: string[]; releasedJobs: number }> {
  const [user] = await sdb.select().from(schema.user).where(eq(schema.user.id, userId));
  if (!user) throw new AccessError(404, "not_found", "Account not found.");
  if (isSuperadmin(user.role)) throw new AccessError(400, "superadmin", "Platform superadmin accounts cannot be deleted from the app.");
  if (user.role === "customer") {
    throw new AccessError(400, "customer", "Customer records are deleted on request — email privacy@nvc360.com from this address and we will remove it within 30 days.");
  }

  // Friendly early refusal (with company names) before any lock is taken; the
  // authoritative check happens again inside the transaction below.
  if (!isDeletedUser(user)) {
    const blockers = await deletionBlockers(userId);
    if (blockers.length) {
      const names = blockers.map((b) => b.company).join(", ");
      throw new AccessError(409, "last_admin", `You are the only admin at ${names}. Ask support@nvc360.com to make someone else the admin there, then delete your account.`, { blockers });
    }
  }

  const when = new Date();
  const result = await sdb.transaction(async (tx) => {
    const mine = await tx.select().from(schema.memberships).where(eq(schema.memberships.userId, userId));
    const riders = await tx.select().from(schema.riders).where(eq(schema.riders.userId, userId));
    const companyIds = [...new Set([...mine.map((m) => m.companyId), ...riders.map((r) => r.companyId)])].sort();

    // Lock every company involved, in id order (same order everywhere → no deadlocks).
    if (companyIds.length) {
      await tx.select({ id: schema.companies.id }).from(schema.companies).where(inArray(schema.companies.id, companyIds)).orderBy(asc(schema.companies.id)).for("update");
    }
    // Last-admin rule, authoritative now that the rows are locked.
    for (const companyId of adminCompanies(user, mine)) {
      const rows = await tx.select().from(schema.memberships).where(and(eq(schema.memberships.companyId, companyId), eq(schema.memberships.status, "active")));
      if (otherActiveAdmins(rows, userId) === 0) {
        throw new AccessError(409, "last_admin", "You are the only admin at one of your companies. Ask support@nvc360.com to make someone else the admin there, then delete your account.", { blockers: [{ companyId, reason: "last_admin" }] });
      }
    }

    const riderByCompany = new Map(riders.map((r) => [r.companyId, r]));

    // Text scrub FIRST: it finds "their jobs" through bookings.rider_id, and
    // releasing open jobs below clears that link.
    for (const companyId of companyIds) await scrubTenantText(tx, companyId, user, riderByCompany.get(companyId) ?? null);

    let releasedJobs = 0;
    const perCompanyJobs = new Map<string, number>();
    for (const m of mine) {
      if (m.status === "invited") {
        await tx.delete(schema.memberships).where(eq(schema.memberships.id, m.id));
        continue;
      }
      if (m.status === "disabled") continue;
      const rider = riderByCompany.get(m.companyId) ?? null;
      const open = rider
        ? await tx
            .select()
            .from(schema.bookings)
            .where(and(eq(schema.bookings.companyId, m.companyId), eq(schema.bookings.riderId, rider.id), inArray(schema.bookings.status, OPEN), sql`${schema.bookings.deletedAt} is null`))
        : [];
      const member: Member = { membership: m, user, rider };
      const plan: Plan = {
        member,
        jobs: open.map((b) => ({ id: b.id, title: b.title, scheduledAt: b.scheduledAt.toISOString(), status: b.status })),
        toRiderId: open.length ? null : undefined,
      };
      await applyDeactivation(tx, m.companyId, plan, when, "Technician left ArrivePing");
      releasedJobs += open.length;
      perCompanyJobs.set(m.companyId, open.length);
    }

    // Rider profiles everywhere (incl. companies already left): suspend + scrub.
    for (const r of riders) {
      await tx
        .update(schema.riders)
        .set({ approval: "suspended", status: "offline", phone: "", photoUrl: "", photoKey: "", licensePlate: "", licenseNumber: "", address: "", notes: "", lat: null, lng: null, locationUpdatedAt: null, lastSeenAt: null })
        .where(eq(schema.riders.id, r.id));
    }

    // Identity: keep the id (bookings, audit rows and payouts point at it),
    // drop everything that identifies the person, and remove every way back in.
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
    // with the user id in `value`; email-keyed rows use the exact address.
    await tx.delete(schema.verification).where(or(eq(schema.verification.value, userId), eq(schema.verification.identifier, user.email)));
    await tx.delete(schema.pushTokens).where(eq(schema.pushTokens.userId, userId));
    await tx.delete(schema.notifications).where(eq(schema.notifications.userId, userId));

    return { companyIds, memberships: mine, riders, releasedJobs, perCompanyJobs };
  });

  // ---- After commit: bookkeeping that must never undo a committed deletion.
  for (const r of result.riders) {
    if (r.photoKey) await deleteObject(r.photoKey).catch((e) => log.warn("account-deletion: headshot delete failed", { key: r.photoKey, err: (e as Error).message }));
  }
  for (const companyId of result.companyIds) {
    try {
      await audit({
        companyId,
        actorId: userId,
        actorName: ANON_NAME,
        action: "account.delete",
        entityType: "user",
        entityId: userId,
        summary: `A team member deleted their ArrivePing account (user ${userId})`,
        meta: { openJobsReleased: result.perCompanyJobs.get(companyId) ?? 0 },
      });
    } catch (e) {
      log.warn("account-deletion: audit failed", { companyId, err: (e as Error).message });
    }
    queueCompanySync(companyId);
  }
  for (const m of result.memberships) {
    if (m.hubspotContactId) {
      await archiveHubspotContact(m.hubspotContactId).catch((e) => log.warn("account-deletion: hubspot archive failed", { companyId: m.companyId, err: (e as Error).message }));
    }
  }

  return { companies: result.memberships.map((m) => m.companyId), releasedJobs: result.releasedJobs };
}
