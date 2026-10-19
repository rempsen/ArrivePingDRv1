/**
 * Control Hub API (/api/hub): platform staff run every tenant from inside the
 * ArrivePing tenant. Who may do what:
 *
 *   sales  — read the overview and tenant list; switch features and settings
 *            on demo and test tenants; demos and leads (routes in hub-demos.ts)
 *   staff  — everything a support person needs on any tenant: switches,
 *            settings, suspend and reopen, act-as, the audit trail
 *   owner  — plus plans, tenant kinds, bulk switches and the staff list
 *
 * Every write lands in the platform audit; settings changes also show in the
 * tenant's own Audit Log, signed "ArrivePing support".
 */
import { Hono } from "hono";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { sdb } from "../database";
import * as schema from "../database/schema";
import { jsonBody } from "../lib/validate";
import { audit } from "../lib/audit";
import { requirePlatform, invalidateCompanyCache, _resetCompanyClosedCache } from "../middleware/auth";
import { tdb } from "../database/tenant";
import { atLeast, listStaff, removeStaff, upsertStaff, StaffError, PLATFORM_ROLES, type PlatformRole } from "../../services/platform-staff";
import { clearFeatureOverride, invalidateFeatures, setFeatureOverride } from "../../services/features";
import { featureSummary, hubOverview, hubTenantDetail, listHubTenants } from "../../services/hub";
import { listPlatformAudit, platformAudit } from "../../services/platform-audit";
import { setTenantKind } from "../../services/tenant-kind";
import { FEATURES, TENANT_KINDS, TENANT_KIND_LABELS, featureDef, isFeatureKey, type TenantKind } from "../../shared/features";
import { PLANS, PLAN_IDS } from "../../shared/plans";
import { validateHubSettings } from "../../shared/hub-settings";

type Me = { id: string; name?: string; email?: string };

function actorOf(c: { get: (k: "user") => unknown }) {
  const me = c.get("user") as Me;
  return { id: me.id, name: me.name || me.email || "ArrivePing staff" };
}

async function companyRow(id: string) {
  const [co] = await sdb.select({ id: schema.companies.id, name: schema.companies.name, kind: schema.companies.kind, status: schema.companies.status, plan: schema.companies.plan }).from(schema.companies).where(eq(schema.companies.id, id));
  return co ?? null;
}

/**
 * Sales may change demo and test tenants only; staff and owners any tenant.
 * Our own tenant counts as theirs too, since sales books its meetings there.
 */
function mayTouch(role: PlatformRole | null | undefined, kind: string, id: string) {
  if (atLeast(role, "staff")) return true;
  return role === "sales" && (id === "default" || kind === "demo" || kind === "test");
}

const FeatureBody = z.object({
  enabled: z.boolean().nullable(),
  reason: z.string().trim().max(300).optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});

const TenantPatch = z
  .object({
    plan: z.enum(PLAN_IDS).optional(),
    kind: z.enum(TENANT_KINDS).optional(),
    status: z.enum(["active", "suspended"]).optional(),
    demoExpiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.plan || v.kind || v.status || v.demoExpiresAt !== undefined, { message: "Nothing to change" });

const BulkBody = z.object({
  companyIds: z.array(z.string().min(1).max(120)).min(1).max(1000),
  enabled: z.boolean().nullable(),
  reason: z.string().trim().max(300).optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});

const StaffBody = z.object({ email: z.string().trim().email().max(200), role: z.enum(PLATFORM_ROLES) });

function staffError(e: unknown) {
  if (e instanceof StaffError) return { status: e.code === "not_found" ? 404 : 400, message: e.message };
  throw e;
}

export const hubRoutes = new Hono<AppEnv>()
  // ── who am I in the hub ────────────────────────────────────────────────
  .get("/me", requirePlatform("sales"), (c) => {
    const role = c.get("platformRole")!;
    return c.json({
      role,
      can: {
        switchAnyTenant: atLeast(role, "staff"),
        actAs: atLeast(role, "staff"),
        editPlans: role === "owner",
        editKinds: role === "owner",
        manageTeam: role === "owner",
        deleteTenants: role === "owner",
        seeAudit: atLeast(role, "staff"),
      },
    });
  })

  // ── command center ─────────────────────────────────────────────────────
  .get("/overview", requirePlatform("sales"), async (c) => c.json(await hubOverview()))

  // ── tenants ────────────────────────────────────────────────────────────
  .get("/tenants", requirePlatform("sales"), async (c) => c.json({ tenants: await listHubTenants(), kinds: TENANT_KINDS.map((k) => ({ id: k, label: TENANT_KIND_LABELS[k] })), plans: Object.values(PLANS).map((p) => ({ id: p.id, label: p.label })) }))

  .get("/tenants/:id", requirePlatform("sales"), async (c) => {
    const d = await hubTenantDetail(c.req.param("id"));
    if (!d) return c.json({ message: "No such company" }, 404);
    const role = c.get("platformRole");
    // Sales see a customer's summary, not its people or history.
    if (role === "sales" && d.company.kind === "customer") {
      return c.json({ ...d, people: [], tenantAudit: [], hubAudit: [], sessions: [], readOnly: true });
    }
    if (!atLeast(role, "staff")) return c.json({ ...d, hubAudit: [], readOnly: false });
    return c.json({ ...d, readOnly: false });
  })

  .patch("/tenants/:id", requirePlatform("staff"), jsonBody(TenantPatch), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const role = c.get("platformRole");
    const co = await companyRow(id);
    if (!co) return c.json({ message: "No such company" }, 404);
    if ((body.plan || body.kind) && role !== "owner") return c.json({ message: "Only an Owner can change a plan or kind." }, 403);
    if (id === "default" && (body.kind || body.status)) return c.json({ message: "ArrivePing's own account can't be changed this way." }, 400);
    const actor = actorOf(c);
    const changes: string[] = [];
    const set: Partial<typeof schema.companies.$inferInsert> = {};
    if (body.plan && body.plan !== co.plan) {
      set.plan = body.plan;
      changes.push(`plan ${co.plan} → ${body.plan}`);
    }
    if (body.status && body.status !== co.status) {
      if (co.status === "closed" && role !== "owner") return c.json({ message: "Only an Owner can reopen a closed account." }, 403);
      set.status = body.status;
      changes.push(body.status === "suspended" ? "suspended" : "reopened");
    }
    if (body.demoExpiresAt !== undefined) {
      set.demoExpiresAt = body.demoExpiresAt ? new Date(body.demoExpiresAt) : null;
      changes.push(body.demoExpiresAt ? `demo ends ${body.demoExpiresAt.slice(0, 10)}` : "demo end date removed");
    }
    if (Object.keys(set).length) {
      await sdb.update(schema.companies).set({ ...set, updatedAt: new Date() }).where(eq(schema.companies.id, id));
    }
    if (body.kind && body.kind !== co.kind) {
      await setTenantKind(id, body.kind as TenantKind);
      changes.push(`kind ${co.kind} → ${body.kind}`);
    }
    invalidateCompanyCache();
    _resetCompanyClosedCache();
    // A plan change can switch entitlements on or off.
    invalidateFeatures(id);
    if (changes.length) {
      await platformAudit({ actor, action: "tenant.update", companyId: id, entityType: "company", entityId: id, summary: `${co.name}: ${changes.join(", ")}`, meta: { ...body } });
    }
    return c.json({ ok: true, changes });
  })

  .put("/tenants/:id/features/:key", requirePlatform("sales"), jsonBody(FeatureBody), async (c) => {
    const id = c.req.param("id");
    const key = c.req.param("key");
    if (!isFeatureKey(key)) return c.json({ message: "No such feature" }, 404);
    const co = await companyRow(id);
    if (!co) return c.json({ message: "No such company" }, 404);
    if (!mayTouch(c.get("platformRole"), co.kind, id)) return c.json({ message: "Sales can change demo and test accounts only." }, 403);
    const { enabled, reason, expiresAt } = c.req.valid("json");
    const actor = actorOf(c);
    const label = featureDef(key)!.label;
    if (enabled === null) {
      await clearFeatureOverride(id, key);
      await platformAudit({ actor, action: "feature.reset", companyId: id, entityType: "feature", entityId: key, summary: `${co.name}: ${label} back to plan default` });
    } else {
      await setFeatureOverride({ companyId: id, key, enabled, reason, expiresAt: expiresAt ? new Date(expiresAt) : null, actor });
      await platformAudit({
        actor,
        action: enabled ? "feature.on" : "feature.off",
        companyId: id,
        entityType: "feature",
        entityId: key,
        summary: `${co.name}: ${label} ${enabled ? "on" : "off"}${expiresAt ? ` until ${expiresAt.slice(0, 10)}` : ""}${reason ? ` (${reason})` : ""}`,
      });
    }
    return c.json({ ok: true });
  })

  .patch("/tenants/:id/settings", requirePlatform("sales"), async (c) => {
    const id = c.req.param("id");
    const co = await companyRow(id);
    if (!co) return c.json({ message: "No such company" }, 404);
    if (!mayTouch(c.get("platformRole"), co.kind, id)) return c.json({ message: "Sales can change demo and test accounts only." }, 403);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ message: "Send the settings to change." }, 400);
    }
    const v = validateHubSettings((raw ?? {}) as Record<string, unknown>);
    if (!v.ok) return c.json({ message: v.message }, 400);
    const actor = actorOf(c);
    await tdb(id).update(schema.companySettings, v.values as Partial<typeof schema.companySettings.$inferInsert>, eq(schema.companySettings.companyId, id));
    const summary = `Settings changed by ArrivePing support: ${Object.keys(v.values).join(", ")}`;
    await audit({ companyId: id, actorId: actor.id, actorName: `ArrivePing support (${actor.name})`, action: "update", entityType: "settings", entityId: id, summary, meta: v.values });
    await platformAudit({ actor, action: "tenant.settings", companyId: id, entityType: "settings", entityId: id, summary: `${co.name}: ${Object.entries(v.values).map(([k, val]) => `${k} = ${val}`).join(", ")}`, meta: v.values });
    return c.json({ ok: true, values: v.values });
  })

  // ── features ───────────────────────────────────────────────────────────
  .get("/features", requirePlatform("sales"), async (c) => c.json({ features: await featureSummary() }))

  .post("/features/:key/bulk", requirePlatform("owner"), jsonBody(BulkBody), async (c) => {
    const key = c.req.param("key");
    if (!isFeatureKey(key)) return c.json({ message: "No such feature" }, 404);
    const { companyIds, enabled, reason, expiresAt } = c.req.valid("json");
    const actor = actorOf(c);
    const known = new Set((await sdb.select({ id: schema.companies.id }).from(schema.companies)).map((r) => r.id));
    const ids = [...new Set(companyIds)].filter((id) => known.has(id));
    for (const id of ids) {
      if (enabled === null) await clearFeatureOverride(id, key);
      else await setFeatureOverride({ companyId: id, key, enabled, reason, expiresAt: expiresAt ? new Date(expiresAt) : null, actor });
    }
    const label = featureDef(key)!.label;
    await platformAudit({ actor, action: "feature.bulk", entityType: "feature", entityId: key, summary: `${label} ${enabled === null ? "back to default" : enabled ? "on" : "off"} for ${ids.length} account${ids.length === 1 ? "" : "s"}${reason ? ` (${reason})` : ""}`, meta: { companyIds: ids, enabled, expiresAt } });
    return c.json({ ok: true, changed: ids.length });
  })

  // ── plans ──────────────────────────────────────────────────────────────
  .get("/plans", requirePlatform("sales"), async (c) => {
    const tenants = await listHubTenants();
    const entitlements = FEATURES.filter((f) => f.kind === "entitlement").map((f) => ({ key: f.key, label: f.label, group: f.group }));
    return c.json({
      entitlements,
      plans: Object.values(PLANS).map((p) => ({
        id: p.id,
        label: p.label,
        includes: entitlements.map((e) => e.key).filter((k) => p.features === "all" || p.features.includes(k)),
        tenants: tenants.filter((t) => t.plan === p.id && t.status !== "closed").length,
        customers: tenants.filter((t) => t.plan === p.id && t.kind === "customer" && t.status !== "closed").length,
      })),
    });
  })

  // ── audit ──────────────────────────────────────────────────────────────
  .get("/audit", requirePlatform("staff"), async (c) => {
    const q = c.req.query();
    const before = q.before ? new Date(q.before) : undefined;
    const rows = await listPlatformAudit({
      companyId: q.company || undefined,
      actorId: q.actor || undefined,
      action: q.action || undefined,
      q: q.q?.slice(0, 80) || undefined,
      before: before && !Number.isNaN(before.getTime()) ? before : undefined,
      limit: Number(q.limit) || 100,
    });
    const sessions = await sdb.select().from(schema.actAsSessions).orderBy(desc(schema.actAsSessions.startedAt)).limit(50);
    return c.json({ entries: rows, sessions });
  })

  // ── team (the staff list) ──────────────────────────────────────────────
  .get("/team", requirePlatform("staff"), async (c) => c.json({ staff: await listStaff(), roles: PLATFORM_ROLES }))

  .post("/team", requirePlatform("owner"), jsonBody(StaffBody), async (c) => {
    const { email, role } = c.req.valid("json");
    const actor = actorOf(c);
    try {
      const m = await upsertStaff({ email, role, actorId: actor.id });
      await platformAudit({ actor, action: "team.upsert", entityType: "staff", entityId: m.userId, summary: `${m.name || m.email} is now ${role}` });
      return c.json({ ok: true, member: m });
    } catch (e) {
      const err = staffError(e);
      return c.json({ message: err.message }, err.status as 400);
    }
  })

  .delete("/team/:userId", requirePlatform("owner"), async (c) => {
    const userId = c.req.param("userId");
    const actor = actorOf(c);
    if (userId === actor.id) return c.json({ message: "Ask another Owner to take you off the list." }, 400);
    try {
      await removeStaff(userId);
      await platformAudit({ actor, action: "team.remove", entityType: "staff", entityId: userId, summary: `Removed ${userId} from the Control Hub` });
      return c.json({ ok: true });
    } catch (e) {
      const err = staffError(e);
      return c.json({ message: err.message }, err.status as 400);
    }
  });
