/**
 * Shared helpers for attaching a person to a company.
 *
 * The rule this file exists to enforce: **a second company never sets a
 * password for someone who already has a login.**
 *
 * Before multi-company support, "add a technician" meant "create a user with
 * this email and this password". Now that the same technician can work for
 * several companies, that flow becomes a real security hole — if Bolt Plumbing
 * could type a password for an email that already exists at Acme HVAC, Bolt
 * would gain control of that person's Acme login. So:
 *
 *   - brand new email  -> create the login, membership is active immediately
 *   - existing email   -> NO password is set; we create an `invited` membership
 *                         and email them. They accept with their existing
 *                         password. Until they accept, they have no access.
 */
import { and, eq } from "drizzle-orm";
import { sdb } from "../database";
import { tdb } from "../database/tenant";
import * as schema from "../database/schema";

export type MembershipRole = string;

export interface AttachArgs {
  userId: string;
  companyId: string;
  role: MembershipRole;
  staffType?: string | null;
  managerId?: string | null;
  permissions?: string | null;
  /** "active" for a brand-new login, "invited" when the person already exists. */
  status?: "active" | "invited" | "disabled";
  invitedBy?: string | null;
}

/**
 * Create or update this person's membership of a company. Idempotent: adding
 * someone who is already on the roster updates their role instead of failing or
 * duplicating them.
 */
export async function attachMembership(a: AttachArgs) {
  const status = a.status ?? "active";
  const t = tdb(a.companyId);
  const existing = await t.selectOne(
    schema.memberships,
    eq(schema.memberships.userId, a.userId),
  );

  if (existing) {
    // Re-adding someone who was disabled reactivates them, but we never
    // downgrade an already-active membership back to "invited" — that would
    // lock out someone who is currently working.
    const nextStatus =
      existing.status === "active" && status === "invited" ? "active" : status;
    const [row] = await t.update(
      schema.memberships,
      {
        role: a.role,
        staffType: a.staffType ?? existing.staffType,
        managerId: a.managerId ?? existing.managerId,
        permissions: a.permissions ?? existing.permissions,
        status: nextStatus,
        updatedAt: new Date(),
        acceptedAt:
          nextStatus === "active" ? (existing.acceptedAt ?? new Date()) : existing.acceptedAt,
      },
      eq(schema.memberships.id, existing.id),
    );
    return { membership: row, created: false };
  }

  const [row] = await t.insert(schema.memberships, {
    userId: a.userId,
    role: a.role,
    staffType: a.staffType ?? null,
    managerId: a.managerId ?? null,
    permissions: a.permissions ?? null,
    status,
    invitedBy: a.invitedBy ?? null,
    acceptedAt: status === "active" ? new Date() : null,
    updatedAt: new Date(),
  });
  return { membership: row, created: true };
}

/** Is this person an active member of this company? */
export async function isMember(userId: string, companyId: string): Promise<boolean> {
  const row = await tdb(companyId).selectOne(
    schema.memberships,
    and(eq(schema.memberships.userId, userId), eq(schema.memberships.status, "active")),
  );
  return !!row;
}

/**
 * Look up a login by email, GLOBALLY (case-insensitive is not needed: emails
 * are stored as entered). No companyId is known yet at most call sites of
 * this — that's the whole point (checking whether an email already has a
 * login anywhere before creating one, or resolving which company a shared
 * login belongs to) — so this runs on the BYPASSRLS system connection.
 */
export async function findUserByEmail(email: string) {
  const [u] = await sdb.select().from(schema.user).where(eq(schema.user.email, email));
  return u ?? null;
}

/**
 * Find a person by email who is already on THIS company's roster.
 *
 * Public intake used to look up `email + user.companyId`, which only ever
 * matched someone's home company. A customer shared with another company would
 * miss and get a second, namespaced-email duplicate created for them every time
 * they submitted a form.
 */
export async function findCompanyUserByEmail(email: string, companyId: string) {
  if (!email) return null;
  const u = await findUserByEmail(email);
  if (!u) return null;
  return (await isMember(u.id, companyId)) ? u : null;
}

/**
 * Remove someone from a company WITHOUT deleting their login.
 *
 * This is the other half of the safety story. Deleting the `user` row would
 * destroy the person's access at every other company they work for. Removing a
 * membership only ends the relationship with this one company; their jobs stay
 * attached for history.
 */
export async function detachMembership(userId: string, companyId: string) {
  await tdb(companyId).delete(schema.memberships, eq(schema.memberships.userId, userId));

  // If this was their default company, move their default to another one they
  // still belong to so they don't land on a company they were removed from.
  // This reassigns companyId on a user who may no longer have ANY
  // relationship to `companyId` after the delete above — a genuine
  // system-level bookkeeping step, not a tenant-scoped read/write, so it
  // runs on the BYPASSRLS connection (same as findUserByEmail above).
  const [u] = await sdb.select().from(schema.user).where(eq(schema.user.id, userId));
  if (u && u.companyId === companyId) {
    const remaining = await sdb
      .select()
      .from(schema.memberships)
      .where(
        and(eq(schema.memberships.userId, userId), eq(schema.memberships.status, "active")),
      );
    const next = remaining[0]?.companyId;
    if (next) {
      await sdb.update(schema.user).set({ companyId: next }).where(eq(schema.user.id, userId));
    }
  }
}

/** Every active member of a company, joined to their identity. */
export async function listCompanyMembers(companyId: string) {
  return tdb(companyId).select(schema.memberships);
}

/**
 * The user rows belonging to a company, with each person's role AT THAT
 * COMPANY overlaid.
 *
 * Use this anywhere that used to do
 *   (await db.select().from(user)).filter(u => u.companyId === cid)
 * That old filter only ever matched a person's DEFAULT company, so a shared
 * technician silently disappeared from every roster but one. It also read the
 * global `user.role`, which is now only meaningful at their home company.
 */
export async function usersForCompany(companyId: string) {
  const t = tdb(companyId);
  const [members, allUsers] = await Promise.all([
    t.select(schema.memberships),
    // Scoped `user` reads already return home-company OR active-membership
    // rows for this company (see tenant.ts's tenantReadPredicate) — exactly
    // the superset `members` below needs to match against.
    t.select(schema.user),
  ]);
  const byId = new Map(members.map((m) => [m.userId, m]));
  return allUsers
    .filter((u) => byId.has(u.id))
    .map((u) => {
      const m = byId.get(u.id)!;
      return {
        ...u,
        role: m.role ?? u.role,
        permissions: m.permissions ?? u.permissions,
        staffType: m.staffType ?? u.staffType,
        managerId: m.managerId ?? u.managerId,
        membershipStatus: m.status,
        /** True when this company is not the person's home company. */
        isShared: u.companyId !== companyId,
      };
    });
}
