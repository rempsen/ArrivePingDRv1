/**
 * Control Hub act-as: a staff member signs in as one of a tenant's people to
 * see and fix exactly what they see. Guardrails (blueprint ADR-CH-2):
 *  - a typed reason and a time limit (15, 30 or 60 minutes), ended on its own;
 *  - staff and owners on any tenant, sales on demo and test tenants only;
 *  - never as another NVC360 super admin;
 *  - the tenant can switch support access off (Settings → Security);
 *  - start and end are written to the tenant's own Audit Log, and every change
 *    made meanwhile names the staff member (lib/audit.ts);
 *  - the riskiest writes are refused outright (shared/act-as.ts).
 *
 * The browser sends the session id in an X-Act-As header; the server checks it
 * on every request against the real signed-in staff member (middleware/auth.ts).
 */
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { audit } from "../api/lib/audit";
import { ACT_AS_MINUTES, ACT_AS_MIN_REASON } from "../shared/act-as";
import { atLeast, type PlatformRole } from "./platform-staff";
import { platformAudit } from "./platform-audit";

export class ActAsError extends Error {
  constructor(
    public code: "bad_reason" | "bad_length" | "no_company" | "no_person" | "not_allowed" | "support_off" | "staff_target",
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

type Session = typeof schema.actAsSessions.$inferSelect;

const accessCache = new Map<string, { at: number; on: boolean }>();
/** Has this tenant left "Allow ArrivePing support to sign in" on? (cached a minute) */
export async function supportAccessAllowed(companyId: string): Promise<boolean> {
  const hit = accessCache.get(companyId);
  if (hit && Date.now() - hit.at < 60_000) return hit.on;
  let on = true;
  try {
    const [s] = await sdb.select({ on: schema.companySettings.allowSupportAccess }).from(schema.companySettings).where(eq(schema.companySettings.companyId, companyId)).limit(1);
    on = s?.on ?? true;
  } catch {
    on = true;
  }
  accessCache.set(companyId, { at: Date.now(), on });
  return on;
}
export function invalidateSupportAccess(companyId?: string) {
  if (companyId) accessCache.delete(companyId);
  else accessCache.clear();
}

/** The person being acted as, at that company: their role there, or null when they can't be. */
async function targetAt(userId: string, companyId: string) {
  const [u] = await sdb.select().from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  if (!u || u.role === "deleted") return null;
  const [m] = await sdb
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.companyId, companyId), eq(schema.memberships.status, "active")))
    .limit(1);
  if (m) return { user: u, membership: m };
  // People from before memberships existed belong to their home company.
  if (u.companyId === companyId) return { user: u, membership: null };
  return null;
}

export interface StartArgs {
  actor: { id: string; name: string };
  role: PlatformRole;
  targetUserId: string;
  companyId: string;
  reason: string;
  minutes: number;
  now?: Date;
}

export async function startActAs(a: StartArgs): Promise<Session> {
  const reason = a.reason.trim();
  if (reason.length < ACT_AS_MIN_REASON) throw new ActAsError("bad_reason", `Say why in a few words (at least ${ACT_AS_MIN_REASON} characters). The company will see it.`);
  if (!(ACT_AS_MINUTES as readonly number[]).includes(a.minutes)) throw new ActAsError("bad_length", "Choose 15, 30 or 60 minutes.");
  const [co] = await sdb.select({ id: schema.companies.id, name: schema.companies.name, kind: schema.companies.kind }).from(schema.companies).where(eq(schema.companies.id, a.companyId)).limit(1);
  if (!co) throw new ActAsError("no_company", "No such company.", 404);
  if (!atLeast(a.role, "staff") && co.kind !== "demo" && co.kind !== "test") throw new ActAsError("not_allowed", "Sales can sign in as people in demo and test accounts only.", 403);
  if (!(await supportAccessAllowed(a.companyId))) throw new ActAsError("support_off", `${co.name} has switched off support access. Ask an admin there to turn it on in Settings → Security.`, 403);
  const t = await targetAt(a.targetUserId, a.companyId);
  if (!t) throw new ActAsError("no_person", "That person isn't active at this company.", 404);
  if (t.user.role === "superadmin") throw new ActAsError("staff_target", "You can't sign in as another NVC360 super admin.", 403);

  const now = a.now ?? new Date();
  // One session at a time per staff member.
  await sdb
    .update(schema.actAsSessions)
    .set({ endedAt: now, endedReason: "replaced" })
    .where(and(eq(schema.actAsSessions.actorUserId, a.actor.id), isNull(schema.actAsSessions.endedAt)));
  const [s] = await sdb
    .insert(schema.actAsSessions)
    .values({
      actorUserId: a.actor.id,
      actorName: a.actor.name,
      targetUserId: t.user.id,
      targetName: t.user.name,
      companyId: a.companyId,
      reason,
      startedAt: now,
      expiresAt: new Date(now.getTime() + a.minutes * 60_000),
    })
    .returning();
  await audit({
    companyId: a.companyId,
    actorId: a.actor.id,
    actorName: `ArrivePing support (${a.actor.name})`,
    action: "support_access",
    entityType: "user",
    entityId: t.user.id,
    summary: `signed in as ${t.user.name} for up to ${a.minutes} minutes to help: ${reason}`,
    meta: { sessionId: s!.id, minutes: a.minutes },
  });
  await platformAudit({ actor: a.actor, action: "actas.start", companyId: a.companyId, entityType: "user", entityId: t.user.id, summary: `Signed in as ${t.user.name} at ${co.name} (${a.minutes} min): ${reason}`, meta: { sessionId: s!.id } });
  return s!;
}

async function closeSession(s: Session, why: "exit" | "expired" | "revoked", now: Date) {
  const res = await sdb
    .update(schema.actAsSessions)
    .set({ endedAt: now, endedReason: why })
    .where(and(eq(schema.actAsSessions.id, s.id), isNull(schema.actAsSessions.endedAt)))
    .returning({ id: schema.actAsSessions.id });
  if (res.length === 0) return; // someone else closed it first
  const mins = Math.max(1, Math.round((now.getTime() - new Date(s.startedAt).getTime()) / 60_000));
  const how = why === "exit" ? "signed out" : why === "expired" ? "time ran out" : "ended";
  await audit({
    companyId: s.companyId,
    actorId: s.actorUserId,
    actorName: `ArrivePing support (${s.actorName})`,
    action: "support_access_end",
    entityType: "user",
    entityId: s.targetUserId,
    summary: `stopped acting as ${s.targetName} after ${mins} min (${how})`,
    meta: { sessionId: s.id },
  });
  await platformAudit({ actor: { id: s.actorUserId, name: s.actorName }, action: `actas.${why}`, companyId: s.companyId, entityType: "user", entityId: s.targetUserId, summary: `Stopped acting as ${s.targetName} after ${mins} min (${how})`, meta: { sessionId: s.id } });
}

/** The staff member leaves act-as. */
export async function endActAs(sessionId: string, actorId: string, now = new Date()): Promise<boolean> {
  const [s] = await sdb.select().from(schema.actAsSessions).where(and(eq(schema.actAsSessions.id, sessionId), eq(schema.actAsSessions.actorUserId, actorId))).limit(1);
  if (!s || s.endedAt) return false;
  await closeSession(s, "exit", now);
  return true;
}

export type ResolvedActAs =
  | { ok: true; session: Session; target: NonNullable<Awaited<ReturnType<typeof targetAt>>> }
  | { ok: false; reason: "unknown" | "ended" | "expired" | "revoked" | "support_off" };

/**
 * Check an X-Act-As header against the real signed-in staff member. Expired
 * or no-longer-valid sessions are closed (and logged) on the spot, so the
 * request carries on as the staff member and never keeps the target's powers.
 */
export async function resolveActAs(sessionId: string, actorId: string, now = new Date()): Promise<ResolvedActAs> {
  let s: Session | undefined;
  try {
    [s] = await sdb.select().from(schema.actAsSessions).where(and(eq(schema.actAsSessions.id, sessionId), eq(schema.actAsSessions.actorUserId, actorId))).limit(1);
  } catch {
    return { ok: false, reason: "unknown" };
  }
  if (!s) return { ok: false, reason: "unknown" };
  if (s.endedAt) return { ok: false, reason: "ended" };
  if (new Date(s.expiresAt).getTime() <= now.getTime()) {
    await closeSession(s, "expired", now);
    return { ok: false, reason: "expired" };
  }
  if (!(await supportAccessAllowed(s.companyId))) {
    await closeSession(s, "revoked", now);
    return { ok: false, reason: "support_off" };
  }
  const target = await targetAt(s.targetUserId, s.companyId);
  if (!target || target.user.role === "superadmin") {
    await closeSession(s, "revoked", now);
    return { ok: false, reason: "revoked" };
  }
  return { ok: true, session: s, target };
}

/** This staff member's open session, if any (for the hub's "you're acting as" state). */
export async function currentSession(actorId: string, now = new Date()) {
  const [s] = await sdb
    .select()
    .from(schema.actAsSessions)
    .where(and(eq(schema.actAsSessions.actorUserId, actorId), isNull(schema.actAsSessions.endedAt), gt(schema.actAsSessions.expiresAt, now)))
    .orderBy(desc(schema.actAsSessions.startedAt))
    .limit(1);
  return s ?? null;
}
