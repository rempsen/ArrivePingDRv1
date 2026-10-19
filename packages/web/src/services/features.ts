/**
 * Per-tenant feature switches from the database (shared/features.ts has the
 * catalog and the rules). Reads go through the system connection: the
 * override table is platform-only, and the answer is needed before a tenant
 * request does anything else.
 *
 * Cached per company for 30 seconds and dropped on every write, so a switch
 * flipped in the Control Hub takes effect within a minute everywhere (at once
 * on the instance that made the change).
 */
import { and, eq, inArray } from "drizzle-orm";
import { sdb } from "../api/database";
import * as schema from "../api/database/schema";
import {
  enabledKeys,
  isFeatureKey,
  resolveFeatureSet,
  type FeatureKey,
  type FeatureOverride,
  type FeatureSet,
} from "../shared/features";

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; set: FeatureSet }>();

export function invalidateFeatures(companyId?: string) {
  if (companyId) cache.delete(companyId);
  else cache.clear();
}

type Row = typeof schema.tenantFeatureOverrides.$inferSelect;

function toOverride(r: Row): FeatureOverride {
  return { enabled: r.enabled, reason: r.reason, expiresAt: r.expiresAt, setByName: r.setByName, setAt: r.setAt };
}

async function loadCompanies(ids: string[]) {
  if (ids.length === 0) return [];
  return sdb
    .select({ id: schema.companies.id, plan: schema.companies.plan, kind: schema.companies.kind })
    .from(schema.companies)
    .where(inArray(schema.companies.id, ids));
}

async function loadOverrides(ids: string[]): Promise<Map<string, Record<string, FeatureOverride>>> {
  const out = new Map<string, Record<string, FeatureOverride>>();
  if (ids.length === 0) return out;
  const rows = await sdb.select().from(schema.tenantFeatureOverrides).where(inArray(schema.tenantFeatureOverrides.companyId, ids));
  for (const r of rows) {
    const m = out.get(r.companyId) ?? {};
    m[r.featureKey] = toOverride(r);
    out.set(r.companyId, m);
  }
  return out;
}

/**
 * The platform's own tenant may have no `companies` row; it is always internal.
 */
function fallbackKind(companyId: string): string {
  return companyId === "default" ? "internal" : "customer";
}

/** Every feature's state for one tenant (with where each answer came from). */
export async function getTenantFeatures(companyId: string): Promise<FeatureSet> {
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.set;
  let set: FeatureSet;
  try {
    const [co] = await loadCompanies([companyId]);
    const overrides = (await loadOverrides([companyId])).get(companyId) ?? {};
    set = resolveFeatureSet({ plan: co?.plan, kind: co?.kind ?? fallbackKind(companyId), overrides });
  } catch {
    // Tables missing (pre-migration boot) or the database blinked: fall back
    // to the plan and kind defaults rather than switching anything off.
    set = resolveFeatureSet({ kind: fallbackKind(companyId) });
  }
  if (cache.size > 5_000) cache.clear();
  cache.set(companyId, { at: Date.now(), set });
  return set;
}

export async function isFeatureOn(companyId: string, key: FeatureKey): Promise<boolean> {
  return (await getTenantFeatures(companyId))[key].on;
}

export async function enabledFeatures(companyId: string): Promise<FeatureKey[]> {
  return enabledKeys(await getTenantFeatures(companyId));
}

/**
 * Which of these companies have a feature on. One query each for companies
 * and overrides, so background sweeps (HubSpot sync, launch nudges) can filter
 * a whole list without asking per company.
 */
export async function companiesWithFeature(key: FeatureKey, companyIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(companyIds)];
  const on = new Set<string>();
  if (ids.length === 0) return on;
  const [cos, overrides] = await Promise.all([loadCompanies(ids), loadOverrides(ids)]);
  const byId = new Map(cos.map((c) => [c.id, c]));
  for (const id of ids) {
    const co = byId.get(id);
    const set = resolveFeatureSet({ plan: co?.plan, kind: co?.kind ?? fallbackKind(id), overrides: overrides.get(id) ?? {} });
    if (set[key].on) on.add(id);
  }
  return on;
}

export interface SetOverrideArgs {
  companyId: string;
  key: string;
  enabled: boolean;
  reason?: string;
  expiresAt?: Date | null;
  actor: { id: string; name: string };
}

/** Switch one feature for one tenant, overriding its plan and kind. */
export async function setFeatureOverride(a: SetOverrideArgs): Promise<void> {
  if (!isFeatureKey(a.key)) throw new Error(`unknown feature ${a.key}`);
  const values = {
    companyId: a.companyId,
    featureKey: a.key,
    enabled: a.enabled,
    reason: (a.reason ?? "").slice(0, 300),
    expiresAt: a.expiresAt ?? null,
    setBy: a.actor.id,
    setByName: a.actor.name,
    setAt: new Date(),
  };
  await sdb
    .insert(schema.tenantFeatureOverrides)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.tenantFeatureOverrides.companyId, schema.tenantFeatureOverrides.featureKey],
      set: { enabled: values.enabled, reason: values.reason, expiresAt: values.expiresAt, setBy: values.setBy, setByName: values.setByName, setAt: values.setAt },
    });
  invalidateFeatures(a.companyId);
}

/** Go back to the plan and kind default for one feature. */
export async function clearFeatureOverride(companyId: string, key: string): Promise<void> {
  await sdb
    .delete(schema.tenantFeatureOverrides)
    .where(and(eq(schema.tenantFeatureOverrides.companyId, companyId), eq(schema.tenantFeatureOverrides.featureKey, key)));
  invalidateFeatures(companyId);
}

/** Every override for one feature across all tenants (the Features page). */
export async function overridesForFeature(key: string) {
  return sdb.select().from(schema.tenantFeatureOverrides).where(eq(schema.tenantFeatureOverrides.featureKey, key));
}

/** All overrides (the Features page counts). */
export async function allOverrides() {
  return sdb.select().from(schema.tenantFeatureOverrides);
}
