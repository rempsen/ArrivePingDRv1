/**
 * Control Hub staff: the named NVC360 people who keep super-admin powers, and
 * what each may do in the hub.
 *
 *   owner — everything, including the staff list, plans and deleting tenants
 *   staff — support: every tenant, switches, settings, act-as
 *   sales — demo and test tenants only, the leads inbox
 *
 * Super admin still needs an NVC360 email (permissions.canBeSuperadmin). The
 * list narrows it: a super admin who isn't on it is treated as an admin of
 * their own company (middleware/auth.ts). Two safety nets stop a lock-out:
 * an empty list means every super admin is an owner, and anyone whose email
 * is in PLATFORM_OWNER_EMAILS is an owner whatever the list says.
 */
import { eq } from "drizzle-orm";
import { sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { canBeSuperadmin } from "../api/lib/permissions";

export const PLATFORM_ROLES = ["sales", "staff", "owner"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  owner: "Owner",
  staff: "Staff",
  sales: "Sales",
};

export function isPlatformRole(v: unknown): v is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(String(v));
}

/** Does `role` reach at least `min` (sales < staff < owner)? */
export function atLeast(role: PlatformRole | null | undefined, min: PlatformRole): boolean {
  if (!role) return false;
  return PLATFORM_ROLES.indexOf(role) >= PLATFORM_ROLES.indexOf(min);
}

function breakGlassEmails(): Set<string> {
  return new Set(
    (process.env.PLATFORM_OWNER_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

let rosterCache: { at: number; map: Map<string, PlatformRole> } | null = null;

export function invalidateRoster() {
  rosterCache = null;
}

/**
 * The staff list, or null when it can't be read right now. A missing table
 * (the release is running before its migration) reads as an empty list, so
 * super admins keep the powers they had before the hub; any other database
 * error gives nobody a hub role for that request (fail closed).
 */
async function loadRoster(): Promise<Map<string, PlatformRole> | null> {
  if (rosterCache && Date.now() - rosterCache.at < 30_000) return rosterCache.map;
  try {
    const rows = await sdb.select().from(schema.platformStaff);
    const map = new Map<string, PlatformRole>();
    for (const r of rows) if (isPlatformRole(r.role)) map.set(r.userId, r.role);
    rosterCache = { at: Date.now(), map };
    return map;
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e);
    const code = (e as { code?: string })?.code;
    if (code === "42P01" || /platform_staff" does not exist|relation .* does not exist/i.test(msg)) return new Map();
    return null;
  }
}

/**
 * This person's Control Hub role, or null when they aren't platform staff.
 * Only a super admin with an NVC360 email can have one.
 */
export async function platformRoleOf(user: { id: string; email?: string | null; role?: string | null } | null | undefined): Promise<PlatformRole | null> {
  if (!user || user.role !== "superadmin" || !canBeSuperadmin(user.email)) return null;
  if (breakGlassEmails().has((user.email ?? "").toLowerCase())) return "owner";
  const roster = await loadRoster();
  if (!roster) return null;
  if (roster.size === 0) return "owner";
  return roster.get(user.id) ?? null;
}

export interface StaffMember {
  userId: string;
  name: string;
  email: string;
  role: PlatformRole;
  addedBy: string;
  createdAt: Date | null;
}

export async function listStaff(): Promise<StaffMember[]> {
  const rows = await sdb
    .select({
      userId: schema.platformStaff.userId,
      role: schema.platformStaff.role,
      addedBy: schema.platformStaff.addedBy,
      createdAt: schema.platformStaff.createdAt,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.platformStaff)
    .leftJoin(schema.user, eq(schema.user.id, schema.platformStaff.userId));
  return rows
    .map((r) => ({
      userId: r.userId,
      name: r.name ?? "",
      email: r.email ?? "",
      role: isPlatformRole(r.role) ? r.role : "staff",
      addedBy: r.addedBy,
      createdAt: r.createdAt,
    }))
    .sort((a, b) => PLATFORM_ROLES.indexOf(b.role) - PLATFORM_ROLES.indexOf(a.role) || a.name.localeCompare(b.name));
}

export class StaffError extends Error {
  constructor(
    public code: "not_found" | "not_nvc360" | "last_owner" | "bad_role",
    message: string,
  ) {
    super(message);
  }
}

type Tx = Parameters<Parameters<typeof sdb.transaction>[0]>[0];

/** Owners, locked for the rest of the transaction so two demotions can't both pass. */
async function lockedOwnerCount(tx: Tx): Promise<number> {
  const rows = await tx.select({ id: schema.platformStaff.userId }).from(schema.platformStaff).where(eq(schema.platformStaff.role, "owner")).for("update");
  return rows.length;
}

/**
 * Add someone with an NVC360 email (or change their role). They become a
 * super admin so the existing cross-tenant plumbing works for them.
 */
export async function upsertStaff(a: { email: string; role: PlatformRole; actorId: string }): Promise<StaffMember> {
  if (!isPlatformRole(a.role)) throw new StaffError("bad_role", "Choose Owner, Staff or Sales.");
  const email = a.email.trim().toLowerCase();
  if (!canBeSuperadmin(email)) throw new StaffError("not_nvc360", "Only NVC360 email addresses can be added.");
  const [u] = await sdb.select().from(schema.user).where(eq(schema.user.email, email)).limit(1);
  if (!u) throw new StaffError("not_found", "No account uses that email yet. Ask them to sign in once first.");
  const existing = await sdb.transaction(async (tx) => {
    const owners = await lockedOwnerCount(tx);
    const [row] = await tx.select().from(schema.platformStaff).where(eq(schema.platformStaff.userId, u.id)).limit(1);
    if (row?.role === "owner" && a.role !== "owner" && owners <= 1) {
      throw new StaffError("last_owner", "There has to be at least one Owner.");
    }
    if (row) await tx.update(schema.platformStaff).set({ role: a.role }).where(eq(schema.platformStaff.userId, u.id));
    else await tx.insert(schema.platformStaff).values({ userId: u.id, role: a.role, addedBy: a.actorId });
    if (u.role !== "superadmin") await tx.update(schema.user).set({ role: "superadmin" }).where(eq(schema.user.id, u.id));
    return row;
  });
  invalidateRoster();
  return { userId: u.id, name: u.name, email: u.email, role: a.role, addedBy: existing?.addedBy ?? a.actorId, createdAt: existing?.createdAt ?? new Date() };
}

/** Take someone off the list. They keep an admin role at their own company. */
export async function removeStaff(userId: string): Promise<void> {
  await sdb.transaction(async (tx) => {
    const owners = await lockedOwnerCount(tx);
    const [existing] = await tx.select().from(schema.platformStaff).where(eq(schema.platformStaff.userId, userId)).limit(1);
    if (!existing) throw new StaffError("not_found", "They aren't on the list.");
    if (existing.role === "owner" && owners <= 1) throw new StaffError("last_owner", "There has to be at least one Owner.");
    await tx.delete(schema.platformStaff).where(eq(schema.platformStaff.userId, userId));
    await tx.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, userId));
  });
  invalidateRoster();
}
