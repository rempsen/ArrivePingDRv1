/**
 * Control Hub reads: the tenant list, one tenant's full picture, and the
 * command-center overview with its "needs attention" queue. Everything here
 * crosses tenants, so it runs on the system connection; the routes in
 * api/routes/hub.ts decide who may see it.
 */
import { and, desc, eq, gte, inArray, isNotNull, lte, ne } from "drizzle-orm";
import { sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { asTenantKind, FEATURES, type FeatureKey, type TenantKind } from "../shared/features";
import { asPlanId, PLANS } from "../shared/plans";
import { HUB_SETTINGS } from "../shared/hub-settings";
import { getTenantFeatures, allOverrides } from "./features";
import { tenants as analyticsTenants, headline, type Health, type TenantRow } from "./platform-analytics";

const DAY = 86_400_000;

export interface HubTenant {
  id: string;
  name: string;
  kind: TenantKind;
  plan: string;
  status: string;
  industry: string;
  industryLabel: string;
  billingStatus: string;
  trialEndsAt: string | null;
  demoExpiresAt: string | null;
  createdAt: string | null;
  health: Health | "unknown";
  team: number;
  techs: number;
  customers: number;
  jobs30: number;
  lastActive: string | null;
  mrr: number;
  overrides: number;
  city: string;
}

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** Analytics rows for the last 30 days, or [] when analytics can't answer. */
async function analyticsRows(): Promise<TenantRow[]> {
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 29 * DAY);
    return await analyticsTenants({
      start_day: start.toISOString().slice(0, 10),
      end_day: end.toISOString().slice(0, 10),
      include_test: true,
      tenant: null,
      industry: null,
      billing: null,
      grain: null,
    });
  } catch {
    return [];
  }
}

function cityOf(address: string | null | undefined): string {
  const parts = String(address ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // "423 Main St, Winnipeg, MB R3B 1B3" → "Winnipeg"
  return parts.length >= 2 ? parts[parts.length - 2]!.replace(/\s+[A-Z]{2}(\s+\S+)?$/, "") : "";
}

/** Every tenant with what the hub list needs, newest first. */
export async function listHubTenants(): Promise<HubTenant[]> {
  const [cos, stats, overrides] = await Promise.all([
    sdb.select().from(schema.companies),
    analyticsRows(),
    allOverrides().catch(() => [] as { companyId: string; expiresAt: Date | null }[]),
  ]);
  const byId = new Map(stats.map((s) => [s.id, s]));
  const now = Date.now();
  const ovCount = new Map<string, number>();
  for (const o of overrides) {
    if (o.expiresAt && new Date(o.expiresAt).getTime() <= now) continue;
    ovCount.set(o.companyId, (ovCount.get(o.companyId) ?? 0) + 1);
  }
  return cos
    .map((c): HubTenant => {
      const s = byId.get(c.id);
      return {
        id: c.id,
        name: c.name,
        kind: c.id === "default" ? "internal" : asTenantKind(c.kind),
        plan: asPlanId(c.plan),
        status: c.status,
        industry: c.industry,
        industryLabel: s?.industry_label ?? c.industry,
        billingStatus: c.billingStatus,
        trialEndsAt: iso(c.billingTrialEndsAt),
        demoExpiresAt: iso(c.demoExpiresAt),
        createdAt: iso(c.createdAt),
        health: s?.health ?? (c.status === "closed" ? "closed" : "unknown"),
        team: s?.team ?? 0,
        techs: s?.techs ?? 0,
        customers: s?.customers ?? 0,
        jobs30: s?.jobs ?? 0,
        lastActive: s?.last_active ?? null,
        mrr: s?.plan_value ?? 0,
        overrides: ovCount.get(c.id) ?? 0,
        city: cityOf(c.officeAddress),
      };
    })
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export interface AttentionItem {
  id: string;
  severity: "high" | "medium" | "low";
  kind: "trial_ending" | "past_due" | "dormant" | "lead_waiting" | "demo_expiring" | "override_expiring" | "suspended";
  title: string;
  detail: string;
  companyId?: string;
  action: { label: string; href: string };
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/**
 * The "needs attention" queue: each row a thing to do, with the button that
 * starts it. Pure, so the rules are tested without a database.
 */
export function buildAttention(a: {
  tenants: HubTenant[];
  leads: { id: string; name: string; company: string; createdAt: Date | string }[];
  overrides: { companyId: string; featureKey: string; expiresAt: Date | string | null }[];
  now?: Date;
}): AttentionItem[] {
  const now = (a.now ?? new Date()).getTime();
  const out: AttentionItem[] = [];
  const name = new Map(a.tenants.map((t) => [t.id, t.name]));
  const days = (iso: string) => Math.ceil((new Date(iso).getTime() - now) / DAY);
  for (const t of a.tenants) {
    if (t.kind === "customer" && t.billingStatus === "trialing" && t.trialEndsAt) {
      const d = days(t.trialEndsAt);
      if (d >= 0 && d <= 7) {
        out.push({ id: `trial:${t.id}`, severity: d <= 2 ? "high" : "medium", kind: "trial_ending", companyId: t.id, title: `${t.name}: trial ends ${d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`}`, detail: `${t.techs} technicians · ${t.jobs30} jobs in 30 days`, action: { label: "Open", href: `/admin/hub/tenants/${t.id}` } });
      }
    }
    if (t.kind === "customer" && (t.billingStatus === "past_due" || t.billingStatus === "unpaid")) {
      out.push({ id: `pastdue:${t.id}`, severity: "high", kind: "past_due", companyId: t.id, title: `${t.name}: payment failed`, detail: "Their card was declined. Billing retries on its own; a call usually fixes it faster.", action: { label: "Open", href: `/admin/hub/tenants/${t.id}` } });
    }
    if (t.kind === "customer" && t.status === "active" && t.health === "dormant") {
      out.push({ id: `dormant:${t.id}`, severity: "medium", kind: "dormant", companyId: t.id, title: `${t.name} has gone quiet`, detail: t.lastActive ? `Last active ${t.lastActive.slice(0, 10)}` : "No activity in 30 days", action: { label: "Open", href: `/admin/hub/tenants/${t.id}` } });
    }
    if (t.status === "suspended") {
      out.push({ id: `suspended:${t.id}`, severity: "low", kind: "suspended", companyId: t.id, title: `${t.name} is suspended`, detail: "Nobody there can sign in until it is reopened.", action: { label: "Open", href: `/admin/hub/tenants/${t.id}` } });
    }
    if (t.kind === "demo" && t.demoExpiresAt && t.status !== "closed") {
      const d = days(t.demoExpiresAt);
      if (d <= 3) {
        out.push({ id: `demo:${t.id}`, severity: d < 0 ? "medium" : "low", kind: "demo_expiring", companyId: t.id, title: d < 0 ? `Demo ${t.name} has ended` : `Demo ${t.name} ends ${d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`}`, detail: "Extend it, turn it into a customer, or delete it.", action: { label: "Demos", href: "/admin/hub/demos" } });
      }
    }
  }
  for (const l of a.leads) {
    const age = now - new Date(l.createdAt).getTime();
    if (age < DAY) continue;
    const d = Math.floor(age / DAY);
    out.push({ id: `lead:${l.id}`, severity: d >= 3 ? "high" : "medium", kind: "lead_waiting", title: `${l.name}${l.company ? ` (${l.company})` : ""} is waiting for a reply`, detail: `Asked to be contacted ${d} day${d === 1 ? "" : "s"} ago`, action: { label: "Leads", href: "/admin/hub/leads" } });
  }
  for (const o of a.overrides) {
    if (!o.expiresAt) continue;
    const d = days(new Date(o.expiresAt).toISOString());
    if (d < 0 || d > 7) continue;
    const f = FEATURES.find((x) => x.key === o.featureKey);
    out.push({ id: `ov:${o.companyId}:${o.featureKey}`, severity: "low", kind: "override_expiring", companyId: o.companyId, title: `${f?.label ?? o.featureKey} for ${name.get(o.companyId) ?? o.companyId} ends ${d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`}`, detail: "It goes back to the plan default unless extended.", action: { label: "Open", href: `/admin/hub/tenants/${o.companyId}?tab=features` } });
  }
  return out.sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity]);
}

/** Leads nobody has picked up yet (marketing-site "contact me" requests). */
export async function openLeads() {
  try {
    return await sdb
      .select({ id: schema.contactRequests.id, name: schema.contactRequests.name, company: schema.contactRequests.company, createdAt: schema.contactRequests.createdAt })
      .from(schema.contactRequests)
      .where(eq(schema.contactRequests.status, "new"))
      .orderBy(desc(schema.contactRequests.createdAt))
      .limit(200);
  } catch {
    return [];
  }
}

export async function hubOverview(now = new Date()) {
  const [tenants, leads, overrides, recent] = await Promise.all([
    listHubTenants(),
    openLeads(),
    allOverrides().catch(() => []),
    sdb.select().from(schema.platformAudit).orderBy(desc(schema.platformAudit.createdAt)).limit(15).catch(() => []),
  ]);
  let head: Awaited<ReturnType<typeof headline>> | null = null;
  try {
    const end = now.toISOString().slice(0, 10);
    const start = new Date(now.getTime() - 29 * DAY).toISOString().slice(0, 10);
    head = await headline({ start_day: start, end_day: end, include_test: false, tenant: null, industry: null, billing: null, grain: null });
  } catch {
    head = null;
  }
  const customers = tenants.filter((t) => t.kind === "customer" && t.status !== "closed");
  const signupsToday = tenants.filter((t) => t.kind === "customer" && t.createdAt && now.getTime() - new Date(t.createdAt).getTime() < DAY).length;
  return {
    kpis: {
      mrr: head?.mrr ?? customers.reduce((s, t) => s + t.mrr, 0),
      activeTenants: head?.tenants_active ?? customers.filter((t) => t.health === "active" || t.health === "new").length,
      customers: customers.length,
      paying: head?.paying ?? customers.filter((t) => t.billingStatus === "active").length,
      trialing: head?.trialing ?? customers.filter((t) => t.billingStatus === "trialing").length,
      trialsEndingSoon: customers.filter((t) => t.billingStatus === "trialing" && t.trialEndsAt && new Date(t.trialEndsAt).getTime() - now.getTime() <= 7 * DAY && new Date(t.trialEndsAt).getTime() >= now.getTime()).length,
      signupsToday,
      openLeads: leads.length,
      demos: tenants.filter((t) => t.kind === "demo" && t.status !== "closed").length,
      jobsCompleted30: head?.jobs_completed ?? 0,
      customerUpdates30: head?.customer_updates ?? 0,
    },
    attention: buildAttention({ tenants, leads, overrides, now }),
    activity: recent,
    generatedAt: now.toISOString(),
  };
}

/** Everything the tenant page shows, or null when there is no such tenant. */
export async function hubTenantDetail(companyId: string) {
  const [co] = await sdb.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  if (!co) return null;
  const settingKeys = HUB_SETTINGS.map((s) => s.key);
  const [settingsRow] = await sdb.select().from(schema.companySettings).where(eq(schema.companySettings.companyId, companyId)).limit(1).catch(() => []);
  const settings: Record<string, unknown> = {};
  if (settingsRow) for (const k of settingKeys) settings[k] = (settingsRow as Record<string, unknown>)[k];

  const [features, people, integrations, tenantAudit, hubAudit, sessions, list] = await Promise.all([
    getTenantFeatures(companyId),
    hubPeople(companyId),
    sdb
      .select({ provider: schema.integrations.provider, status: schema.integrations.status, accountLabel: schema.integrations.accountLabel, lastSyncAt: schema.integrations.lastSyncAt })
      .from(schema.integrations)
      .where(eq(schema.integrations.companyId, companyId))
      .catch(() => []),
    sdb.select().from(schema.auditLog).where(eq(schema.auditLog.companyId, companyId)).orderBy(desc(schema.auditLog.createdAt)).limit(40).catch(() => []),
    sdb.select().from(schema.platformAudit).where(eq(schema.platformAudit.companyId, companyId)).orderBy(desc(schema.platformAudit.createdAt)).limit(40).catch(() => []),
    sdb.select().from(schema.actAsSessions).where(eq(schema.actAsSessions.companyId, companyId)).orderBy(desc(schema.actAsSessions.startedAt)).limit(20).catch(() => []),
    listHubTenants(),
  ]);
  const summary = list.find((t) => t.id === companyId) ?? null;
  return {
    company: {
      id: co.id,
      name: co.name,
      kind: co.id === "default" ? ("internal" as TenantKind) : asTenantKind(co.kind),
      plan: asPlanId(co.plan),
      status: co.status,
      industry: co.industry,
      contactEmail: co.contactEmail,
      phone: co.phone,
      officeAddress: co.officeAddress,
      createdAt: iso(co.createdAt),
      onboardingCompletedAt: iso(co.onboardingCompletedAt),
      demoExpiresAt: iso(co.demoExpiresAt),
      billing: { status: co.billingStatus, seats: co.billingSeats, trialEndsAt: iso(co.billingTrialEndsAt), customerId: co.billingCustomerId ? "linked" : null },
      stripe: { connected: Boolean(co.stripeAccountId), chargesEnabled: co.stripeChargesEnabled, payoutsEnabled: co.stripePayoutsEnabled, usePlatform: co.stripeUsePlatform },
      hubspot: { companyId: co.hubspotCompanyId, dealId: co.hubspotDealId, syncedAt: iso(co.hubspotSyncedAt) },
      allowSupportAccess: settingsRow ? Boolean((settingsRow as { allowSupportAccess?: boolean }).allowSupportAccess ?? true) : true,
    },
    summary,
    settings,
    features: FEATURES.map((f) => ({ key: f.key as FeatureKey, label: f.label, description: f.description, kind: f.kind, group: f.group, ...features[f.key as FeatureKey] })),
    people,
    integrations,
    tenantAudit,
    hubAudit,
    sessions,
    plans: Object.values(PLANS).map((p) => ({ id: p.id, label: p.label })),
  };
}

export interface HubPerson {
  userId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  sample: boolean;
}

/** The company's people (office and field), for act-as and support. */
export async function hubPeople(companyId: string): Promise<HubPerson[]> {
  const rows = await sdb
    .select({
      userId: schema.memberships.userId,
      role: schema.memberships.role,
      status: schema.memberships.status,
      name: schema.user.name,
      email: schema.user.email,
      userRole: schema.user.role,
      isSample: schema.user.isSample,
    })
    .from(schema.memberships)
    .leftJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(eq(schema.memberships.companyId, companyId))
    .catch(() => []);
  const seen = new Set(rows.map((r) => r.userId));
  // People from before memberships existed belong to their home company only.
  const legacy = await sdb
    .select({ userId: schema.user.id, name: schema.user.name, email: schema.user.email, role: schema.user.role })
    .from(schema.user)
    .where(and(eq(schema.user.companyId, companyId), ne(schema.user.role, "customer"), ne(schema.user.role, "deleted")))
    .catch(() => []);
  const out: HubPerson[] = rows
    .filter((r) => r.userRole !== "deleted")
    .map((r) => ({ userId: r.userId, name: r.name ?? "", email: r.email ?? "", role: r.role, status: r.status, sample: Boolean(r.isSample) }));
  for (const l of legacy) if (!seen.has(l.userId)) out.push({ userId: l.userId, name: l.name, email: l.email, role: l.role ?? "", status: "active", sample: false });
  const rank: Record<string, number> = { admin: 0, manager: 1, dispatcher: 2, project_manager: 3, rider: 4 };
  return out.sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || a.name.localeCompare(b.name));
}

/** Per feature: how many tenants have it on, and the overrides behind that. */
export async function featureSummary() {
  const [tenants, overrides] = await Promise.all([listHubTenants(), allOverrides().catch(() => [])]);
  const live = overrides.filter((o) => !o.expiresAt || new Date(o.expiresAt).getTime() > Date.now());
  const sets = await Promise.all(tenants.filter((t) => t.status !== "closed").map(async (t) => ({ t, set: await getTenantFeatures(t.id) })));
  const name = new Map(tenants.map((t) => [t.id, t.name]));
  return FEATURES.map((f) => {
    const on = sets.filter((s) => s.set[f.key as FeatureKey].on);
    return {
      key: f.key,
      label: f.label,
      description: f.description,
      kind: f.kind,
      group: f.group,
      removeBy: "removeBy" in f ? f.removeBy : null,
      kindDefaults: "kindDefaults" in f ? f.kindDefaults : null,
      onCount: on.length,
      total: sets.length,
      overrides: live
        .filter((o) => o.featureKey === f.key)
        .map((o) => ({ companyId: o.companyId, companyName: name.get(o.companyId) ?? o.companyId, enabled: o.enabled, reason: o.reason, expiresAt: iso(o.expiresAt), setByName: o.setByName, setAt: iso(o.setAt) })),
    };
  });
}

/** Trials ending in a window and demos past their end date (used by sweeps and tests). */
export async function demosPastEnd(now = new Date()) {
  return sdb
    .select({ id: schema.companies.id, name: schema.companies.name, demoExpiresAt: schema.companies.demoExpiresAt })
    .from(schema.companies)
    .where(and(eq(schema.companies.kind, "demo"), isNotNull(schema.companies.demoExpiresAt), lte(schema.companies.demoExpiresAt, now), ne(schema.companies.status, "closed")));
}

export async function trialsEndingBetween(from: Date, to: Date) {
  return sdb
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .where(and(gte(schema.companies.billingTrialEndsAt, from), lte(schema.companies.billingTrialEndsAt, to)));
}

export async function companiesByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return sdb.select({ id: schema.companies.id, name: schema.companies.name, kind: schema.companies.kind }).from(schema.companies).where(inArray(schema.companies.id, ids));
}
