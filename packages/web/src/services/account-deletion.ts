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
 *     them under "Deactivated" and nothing can be done as them;
 *   - the rider profile is suspended and stripped of phone, headshot, licence
 *     and address;
 *   - the user row keeps its id and becomes "Deleted user" with a placeholder
 *     address; sessions, credentials, pending verifications and push tokens
 *     are removed, so there is nothing left to sign in with.
 *
 * Refused (nothing changes) when the person is the last active admin of any
 * company — someone has to be able to run it — and for platform superadmins,
 * whose access does not come from a membership.
 */
import { and, eq, inArray } from "drizzle-orm";
import { sdb } from "../api/database";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { isAdminRole, isSuperadmin } from "../api/lib/permissions";
import { audit } from "../api/lib/audit";
import { log } from "../api/lib/logger";
import { AccessError, applyDeactivation, loadMember, openJobsForRider, type Plan } from "./user-access";
import { queueCompanySync } from "./hubspot-sync";

export type DeletionBlocker = { companyId: string; company: string; reason: "last_admin" };

const ANON_NAME = "Deleted user";
export const anonEmail = (userId: string) => `deleted-${userId}@anon.arriveping.com`;

async function liveMemberships(userId: string) {
  return sdb
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), inArray(schema.memberships.status, ["active", "invited", "disabled"])));
}

/** Companies where deleting this person would leave nobody in charge. */
export async function deletionBlockers(userId: string): Promise<DeletionBlocker[]> {
  const mine = await liveMemberships(userId);
  const adminAt = mine.filter((m) => m.status === "active" && isAdminRole(m.role ?? ""));
  if (!adminAt.length) return [];
  const companies = await sdb
    .select()
    .from(schema.companies)
    .where(inArray(schema.companies.id, adminAt.map((m) => m.companyId)));
  const nameById = new Map(companies.map((c) => [c.id, c.name]));
  const out: DeletionBlocker[] = [];
  for (const m of adminAt) {
    const others = await tdb(m.companyId).select(schema.memberships, eq(schema.memberships.status, "active"));
    const remaining = others.filter((o) => o.userId !== userId && isAdminRole(o.role ?? ""));
    if (!remaining.length) out.push({ companyId: m.companyId, company: nameById.get(m.companyId) ?? m.companyId, reason: "last_admin" });
  }
  return out.sort((a, b) => a.company.localeCompare(b.company));
}

async function releaseFromCompany(companyId: string, userId: string, when: Date): Promise<number> {
  const member = await loadMember(companyId, userId);
  if (!member) return 0;
  if (member.membership.status === "invited") {
    // Never accepted: there is nothing to keep, drop the invite outright.
    await tdb(companyId).delete(schema.memberships, eq(schema.memberships.id, member.membership.id));
    return 0;
  }
  const jobs = member.rider ? await openJobsForRider(companyId, member.rider.id) : [];
  const plan: Plan = { member, jobs, toRiderId: jobs.length ? null : undefined };
  await tdb(companyId).transaction(async (tx) => {
    if (member.membership.status !== "disabled") await applyDeactivation(tx, companyId, plan, when, "Technician left ArrivePing");
    if (member.rider) {
      await tx
        .update(schema.riders)
        .set({ approval: "suspended", status: "offline", phone: "", photoUrl: "", photoKey: "", licensePlate: "", licenseNumber: "", address: "", notes: "", lat: null, lng: null })
        .where(and(eq(schema.riders.companyId, companyId), eq(schema.riders.id, member.rider.id)));
    }
  });
  try {
    await audit({
      companyId,
      actorId: userId,
      actorName: member.user.name,
      action: "account.delete",
      entityType: "user",
      entityId: userId,
      summary: `${member.user.name} deleted their ArrivePing account`,
      meta: { openJobsReleased: jobs.length },
    });
  } catch (e) {
    log.warn("account-deletion: audit failed", { companyId, err: (e as Error).message });
  }
  queueCompanySync(companyId);
  return jobs.length;
}

export async function deleteOwnAccount(userId: string): Promise<{ companies: string[]; releasedJobs: number }> {
  const [user] = await sdb.select().from(schema.user).where(eq(schema.user.id, userId));
  if (!user || user.email === anonEmail(userId)) throw new AccessError(404, "not_found", "Account not found.");
  if (isSuperadmin(user.role)) throw new AccessError(400, "superadmin", "Platform superadmin accounts cannot be deleted from the app.");

  const blockers = await deletionBlockers(userId);
  if (blockers.length) {
    const names = blockers.map((b) => b.company).join(", ");
    throw new AccessError(409, "last_admin", `You are the only admin at ${names}. Make someone else an admin there (or close the company) before deleting your account.`, { blockers });
  }

  const when = new Date();
  const mine = await liveMemberships(userId);
  let releasedJobs = 0;
  const companies: string[] = [];
  for (const m of mine) {
    releasedJobs += await releaseFromCompany(m.companyId, userId, when);
    companies.push(m.companyId);
  }

  // Identity: keep the id (bookings, audit rows and payouts point at it), drop
  // everything that identifies the person. Done last so a failure above leaves
  // a still-usable account rather than a half-deleted one.
  await sdb
    .update(schema.user)
    .set({
      name: ANON_NAME,
      email: anonEmail(userId),
      emailVerified: false,
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
      updatedAt: when,
    })
    .where(eq(schema.user.id, userId));
  await sdb.delete(schema.session).where(eq(schema.session.userId, userId));
  await sdb.delete(schema.account).where(eq(schema.account.userId, userId));
  await sdb.delete(schema.verification).where(eq(schema.verification.identifier, user.email));
  await sdb.delete(schema.pushTokens).where(eq(schema.pushTokens.userId, userId));

  return { companies, releasedJobs };
}
