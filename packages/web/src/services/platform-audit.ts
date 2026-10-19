/**
 * The Control Hub's own audit trail: every hub action and every time platform
 * staff open a tenant, across all tenants (the tenant Audit Log only ever
 * shows one company). Platform-only table, written on the system connection.
 */
import { and, desc, eq, gte, ilike, lt, or, type SQL } from "drizzle-orm";
import { sdb } from "../api/database";
import * as schema from "../api/database/schema";

export interface PlatformAuditArgs {
  actor: { id: string; name: string };
  action: string;
  companyId?: string;
  entityType?: string;
  entityId?: string;
  summary: string;
  meta?: Record<string, unknown>;
}

/** Fire-and-forget safe: a failed audit write never fails the action. */
export async function platformAudit(a: PlatformAuditArgs): Promise<void> {
  try {
    await sdb.insert(schema.platformAudit).values({
      actorId: a.actor.id,
      actorName: a.actor.name,
      action: a.action,
      companyId: a.companyId ?? "",
      entityType: a.entityType ?? "",
      entityId: a.entityId ?? "",
      summary: a.summary.slice(0, 500),
      meta: JSON.stringify(a.meta ?? {}),
    });
  } catch (e) {
    console.error("platform audit failed", e);
  }
}

/**
 * Note that a staff member opened a tenant. Requests carry the tenant on
 * every call, so this only writes once per person and tenant every 30
 * minutes on this instance.
 */
const seen = new Map<string, number>();
const SWITCH_WINDOW_MS = 30 * 60_000;
export function noteTenantVisit(actor: { id: string; name: string }, companyId: string, companyName?: string) {
  const k = `${actor.id}:${companyId}`;
  const now = Date.now();
  const last = seen.get(k);
  if (last && now - last < SWITCH_WINDOW_MS) return;
  if (seen.size > 10_000) seen.clear();
  seen.set(k, now);
  void platformAudit({
    actor,
    action: "tenant.open",
    companyId,
    entityType: "company",
    entityId: companyId,
    summary: `Opened ${companyName || companyId}`,
  });
}
/** Test hook. */
export function _resetTenantVisits() {
  seen.clear();
}

export interface PlatformAuditQuery {
  companyId?: string;
  actorId?: string;
  action?: string;
  q?: string;
  before?: Date;
  since?: Date;
  limit?: number;
}

export async function listPlatformAudit(f: PlatformAuditQuery = {}) {
  const t = schema.platformAudit;
  const where: SQL[] = [];
  if (f.companyId) where.push(eq(t.companyId, f.companyId));
  if (f.actorId) where.push(eq(t.actorId, f.actorId));
  if (f.action) where.push(ilike(t.action, `${f.action}%`));
  if (f.since) where.push(gte(t.createdAt, f.since));
  if (f.before) where.push(lt(t.createdAt, f.before));
  if (f.q) where.push(or(ilike(t.summary, `%${f.q}%`), ilike(t.actorName, `%${f.q}%`))!);
  return sdb
    .select()
    .from(t)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(t.createdAt))
    .limit(Math.min(Math.max(f.limit ?? 100, 1), 500));
}
