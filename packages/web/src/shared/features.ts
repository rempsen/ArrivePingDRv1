/**
 * Control Hub feature switches: the one list of capabilities a tenant can have
 * switched on or off (blueprints/control-hub). Shared by the server (which
 * enforces them) and the dashboard (which hides what is off).
 *
 * Three kinds, deliberately kept apart:
 *  - entitlement: a part of the product a plan includes. Long-lived.
 *  - rollout: a new version being phased in. Has a remove-by date; once it is
 *    on for everyone the switch is deleted.
 *  - ops: how the platform treats the tenant behind the scenes (CRM sync,
 *    onboarding nudges). Never shown to the tenant.
 *
 * How one tenant's switch is decided (resolveFeatureSet):
 *   1. the default for its kind (customer, demo, test, internal), else on;
 *   2. an entitlement its plan doesn't include is off;
 *   3. an unexpired per-tenant override from the Control Hub wins.
 *
 * Adding a feature: add it here, then guard the API with requireFeature(key)
 * and give its sidebar item `feature: key`. A test fails if a FEATURE_ROUTES
 * or FEATURE_PAGES entry names a key that isn't here.
 */
import { planIncludes, type PlanId } from "./plans";

export const TENANT_KINDS = ["customer", "demo", "test", "internal"] as const;
export type TenantKind = (typeof TENANT_KINDS)[number];

export const TENANT_KIND_LABELS: Record<TenantKind, string> = {
  customer: "Customer",
  demo: "Demo",
  test: "Test",
  internal: "ArrivePing (ours)",
};

export function asTenantKind(v: unknown): TenantKind {
  return (TENANT_KINDS as readonly string[]).includes(String(v)) ? (v as TenantKind) : "customer";
}

export type FeatureKind = "entitlement" | "rollout" | "ops";

export interface FeatureDef {
  key: string;
  label: string;
  /** One plain sentence: what the tenant gets (or what happens behind the scenes). */
  description: string;
  kind: FeatureKind;
  group: "Operations" | "Money" | "Automation" | "Connections" | "Sales" | "Platform";
  /** Default per tenant kind; a kind not listed is on. */
  kindDefaults?: Partial<Record<TenantKind, boolean>>;
  /** Rollout flags only: the date this switch should be gone by (YYYY-MM-DD). */
  removeBy?: string;
}

export const FEATURES = [
  {
    key: "dispatch.map_v2",
    label: "New dispatch map",
    description: "The live map with drag-to-assign, the team strip and the command palette.",
    kind: "rollout",
    group: "Operations",
    kindDefaults: { customer: false, demo: true, test: true, internal: true },
    removeBy: "2027-03-31",
  },
  {
    key: "forms.v2",
    label: "Job forms v2",
    description: "The new form builder (sections, logic, photos, sign-off, versions) and forms technicians fill in on site, with answers on the report and PDF.",
    kind: "rollout",
    group: "Operations",
    kindDefaults: { customer: false, demo: true, test: true, internal: true },
    removeBy: "2027-04-30",
  },
  {
    key: "maintenance.plans",
    label: "Maintenance plans",
    description: "Recurring service agreements that book their own visits.",
    kind: "entitlement",
    group: "Operations",
  },
  {
    key: "payouts.tech_pay",
    label: "Technician pay & payouts",
    description: "Pay technicians by the hour, mileage, flat rate or a mix, and run payouts.",
    kind: "entitlement",
    group: "Money",
  },
  {
    key: "automation.rules",
    label: "Automation & AI",
    description: "Rules that act on jobs automatically, and the AI helpers.",
    kind: "entitlement",
    group: "Automation",
  },
  {
    key: "integrations.apps",
    label: "Connected apps",
    description: "QuickBooks, Xero, Google, Microsoft, Dropbox and CompanyCam.",
    kind: "entitlement",
    group: "Connections",
  },
  {
    key: "integrations.quickbooks",
    label: "QuickBooks sync",
    description: "Mirror assigned jobs as purchase orders and subtrade bills in the company's QuickBooks, and mark jobs paid when QuickBooks pays them.",
    kind: "entitlement",
    group: "Connections",
    kindDefaults: { customer: false, demo: false, test: false, internal: true },
  },
  {
    key: "api.access",
    label: "API & MCP",
    description: "API keys and the MCP server for the company's own tools and agents.",
    kind: "entitlement",
    group: "Connections",
  },
  {
    key: "sales.pack",
    label: "Sales pack",
    description: "The leads inbox and sales-meeting templates ArrivePing uses to book its own meetings.",
    kind: "entitlement",
    group: "Sales",
    kindDefaults: { customer: false, demo: false, test: false, internal: true },
  },
  {
    key: "ops.hubspot_sync",
    label: "Sync to HubSpot",
    description: "Mirror this company, its people and its deal into NVC360's HubSpot.",
    kind: "ops",
    group: "Platform",
    kindDefaults: { customer: true, demo: false, test: false, internal: false },
  },
  {
    key: "ops.launch_nudges",
    label: "Launch nudges",
    description: "Onboarding tip emails and stall alerts while the company gets set up.",
    kind: "ops",
    group: "Platform",
    kindDefaults: { customer: true, demo: false, test: false, internal: false },
  },
] as const satisfies readonly FeatureDef[];

export type FeatureKey = (typeof FEATURES)[number]["key"];

export const FEATURE_KEYS: FeatureKey[] = FEATURES.map((f) => f.key);

const BY_KEY = new Map<string, FeatureDef>(FEATURES.map((f) => [f.key, f as FeatureDef]));

export function featureDef(key: string): FeatureDef | undefined {
  return BY_KEY.get(key);
}

export function isFeatureKey(key: string): key is FeatureKey {
  return BY_KEY.has(key);
}

/**
 * API paths each feature guards (prefix match on the path under /api). The
 * server's feature gate and the tests both read this, so a switch can't be
 * "off" in the hub while its API still answers.
 */
export const FEATURE_ROUTES: { prefix: string; feature: FeatureKey; except?: string[] }[] = [
  { prefix: "/api/maintenance", feature: "maintenance.plans" },
  { prefix: "/api/payouts", feature: "payouts.tech_pay" },
  { prefix: "/api/automation", feature: "automation.rules" },
  { prefix: "/api/integrations", feature: "integrations.apps", except: ["/api/integrations/oauth/callback/"] },
  { prefix: "/api/api-keys", feature: "api.access" },
  { prefix: "/api/mcp", feature: "api.access" },
];

/** Dashboard pages each feature guards (prefix match). */
export const FEATURE_PAGES: { prefix: string; feature: FeatureKey }[] = [
  { prefix: "/admin/maintenance", feature: "maintenance.plans" },
  { prefix: "/admin/payouts", feature: "payouts.tech_pay" },
  { prefix: "/admin/automation", feature: "automation.rules" },
  { prefix: "/admin/integrations", feature: "integrations.apps" },
  { prefix: "/admin/api-access", feature: "api.access" },
];

function matches(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Which feature, if any, an API path needs. */
export function featureForApiPath(path: string): FeatureKey | null {
  for (const r of FEATURE_ROUTES) {
    if (!matches(path, r.prefix)) continue;
    if (r.except?.some((e) => path.startsWith(e))) return null;
    return r.feature;
  }
  return null;
}

/** Which feature, if any, a dashboard page needs. */
export function featureForPage(path: string): FeatureKey | null {
  const p = path.split(/[?#]/)[0]!.replace(/\/+$/, "");
  return FEATURE_PAGES.find((r) => matches(p, r.prefix))?.feature ?? null;
}

export interface FeatureOverride {
  enabled: boolean;
  reason?: string;
  expiresAt?: Date | string | null;
  setByName?: string;
  setAt?: Date | string | null;
}

export type FeatureSource = "default" | "kind" | "plan" | "override";

export interface ResolvedFeature {
  on: boolean;
  source: FeatureSource;
  /** What it would be without the override (for the switchboard). */
  inherited: boolean;
  override?: FeatureOverride;
}

export type FeatureSet = Record<FeatureKey, ResolvedFeature>;

function expired(o: FeatureOverride, now: Date): boolean {
  if (!o.expiresAt) return false;
  const t = new Date(o.expiresAt).getTime();
  return Number.isFinite(t) && t <= now.getTime();
}

/**
 * Every feature's state for one tenant. Overrides for keys no longer in the
 * catalog are ignored; expired overrides are ignored (no sweep needed).
 */
export function resolveFeatureSet(a: {
  plan?: string | null;
  kind?: string | null;
  overrides?: Record<string, FeatureOverride | undefined>;
  now?: Date;
}): FeatureSet {
  const kind = asTenantKind(a.kind);
  const now = a.now ?? new Date();
  const out = {} as FeatureSet;
  for (const f of FEATURES as readonly FeatureDef[]) {
    const kd = f.kindDefaults?.[kind];
    let on = kd ?? true;
    let source: FeatureSource = kd === undefined ? "default" : "kind";
    if (f.kind === "entitlement" && on && !planIncludes(a.plan as PlanId, f.key)) {
      on = false;
      source = "plan";
    }
    const inherited = on;
    const o = a.overrides?.[f.key];
    if (o && !expired(o, now)) {
      out[f.key as FeatureKey] = { on: o.enabled, source: "override", inherited, override: o };
    } else {
      out[f.key as FeatureKey] = { on, source, inherited };
    }
  }
  return out;
}

/** Just the keys that are on (what the dashboard and API need). */
export function enabledKeys(set: FeatureSet): FeatureKey[] {
  return (Object.keys(set) as FeatureKey[]).filter((k) => set[k].on).sort();
}
