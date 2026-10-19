import { describe, expect, it } from "bun:test";
import {
  FEATURES,
  FEATURE_KEYS,
  FEATURE_PAGES,
  FEATURE_ROUTES,
  enabledKeys,
  featureForApiPath,
  featureForPage,
  isFeatureKey,
  resolveFeatureSet,
} from "../features";
import { PLANS, planIncludes } from "../plans";
import { PAGE_ACCESS } from "../office-pages";

const NOW = new Date("2026-10-18T12:00:00Z");

describe("feature catalog", () => {
  it("has unique keys, plain labels and descriptions", () => {
    expect(new Set(FEATURE_KEYS).size).toBe(FEATURE_KEYS.length);
    for (const f of FEATURES) {
      expect(f.label.length).toBeGreaterThan(3);
      expect(f.description.endsWith(".")).toBe(true);
    }
  });
  it("gives every rollout flag a remove-by date", () => {
    for (const f of FEATURES) if (f.kind === "rollout") expect("removeBy" in f && /^\d{4}-\d{2}-\d{2}$/.test(f.removeBy)).toBe(true);
  });
  it("only guards routes and pages with keys in the catalog", () => {
    for (const r of FEATURE_ROUTES) expect(isFeatureKey(r.feature)).toBe(true);
    for (const p of FEATURE_PAGES) expect(isFeatureKey(p.feature)).toBe(true);
  });
  it("only guards dashboard pages that exist", () => {
    for (const p of FEATURE_PAGES) expect(PAGE_ACCESS.some((a) => a.prefix === p.prefix)).toBe(true);
  });
  it("maps paths to the feature that guards them", () => {
    expect(featureForApiPath("/api/maintenance/plans")).toBe("maintenance.plans");
    expect(featureForApiPath("/api/mcp")).toBe("api.access");
    expect(featureForApiPath("/api/integrations/oauth/callback/xero")).toBeNull();
    expect(featureForApiPath("/api/integrations")).toBe("integrations.apps");
    expect(featureForApiPath("/api/bookings")).toBeNull();
    expect(featureForApiPath("/api/payoutsx")).toBeNull();
    expect(featureForPage("/admin/payouts?tab=1")).toBe("payouts.tech_pay");
    expect(featureForPage("/admin/work-orders")).toBeNull();
  });
});

describe("plans", () => {
  it("keeps every plan full-featured for now", () => {
    for (const p of Object.values(PLANS)) expect(p.features).toBe("all");
    expect(planIncludes("starter", "api.access")).toBe(true);
    expect(planIncludes("nonsense", "api.access")).toBe(true);
  });
});

describe("resolveFeatureSet", () => {
  it("leaves a customer exactly as it is today", () => {
    const set = resolveFeatureSet({ plan: "starter", kind: "customer", now: NOW });
    expect(set["dispatch.map_v2"].on).toBe(false);
    expect(set["sales.pack"].on).toBe(false);
    expect(set["ops.hubspot_sync"].on).toBe(true);
    expect(set["ops.launch_nudges"].on).toBe(true);
    for (const k of ["maintenance.plans", "payouts.tech_pay", "automation.rules", "integrations.apps", "api.access"] as const) {
      expect(set[k].on).toBe(true);
      expect(set[k].source).toBe("default");
    }
  });
  it("matches today's test-tenant rules for demo, test and internal", () => {
    for (const kind of ["demo", "test", "internal"]) {
      const set = resolveFeatureSet({ plan: "pro", kind, now: NOW });
      expect(set["dispatch.map_v2"].on).toBe(true);
      expect(set["ops.hubspot_sync"].on).toBe(false);
      expect(set["ops.launch_nudges"].on).toBe(false);
      expect(set["dispatch.map_v2"].source).toBe("kind");
    }
    expect(resolveFeatureSet({ kind: "internal" })["sales.pack"].on).toBe(true);
  });
  it("treats an unknown kind as a customer", () => {
    expect(resolveFeatureSet({ kind: "weird" })["dispatch.map_v2"].on).toBe(false);
  });
  it("lets an override win and remembers what it would inherit", () => {
    const set = resolveFeatureSet({
      kind: "customer",
      overrides: { "dispatch.map_v2": { enabled: true, reason: "beta" }, "api.access": { enabled: false } },
      now: NOW,
    });
    expect(set["dispatch.map_v2"]).toMatchObject({ on: true, source: "override", inherited: false });
    expect(set["api.access"]).toMatchObject({ on: false, source: "override", inherited: true });
  });
  it("ignores an expired override", () => {
    const set = resolveFeatureSet({
      kind: "customer",
      overrides: { "dispatch.map_v2": { enabled: true, expiresAt: "2026-10-18T11:59:59Z" } },
      now: NOW,
    });
    expect(set["dispatch.map_v2"]).toMatchObject({ on: false, source: "kind" });
    const live = resolveFeatureSet({
      kind: "customer",
      overrides: { "dispatch.map_v2": { enabled: true, expiresAt: "2026-10-19T00:00:00Z" } },
      now: NOW,
    });
    expect(live["dispatch.map_v2"].on).toBe(true);
  });
  it("ignores overrides for keys that are no longer in the catalog", () => {
    const set = resolveFeatureSet({ kind: "customer", overrides: { "old.gone": { enabled: true } }, now: NOW });
    expect(Object.keys(set).sort()).toEqual([...FEATURE_KEYS].sort());
  });
  it("lists the enabled keys", () => {
    const keys = enabledKeys(resolveFeatureSet({ kind: "internal" }));
    expect(keys).toContain("sales.pack");
    expect(keys).not.toContain("ops.hubspot_sync");
  });
});
