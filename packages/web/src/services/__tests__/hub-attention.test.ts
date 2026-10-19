import { describe, expect, it } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { buildAttention } = await import("../hub");
type T = Parameters<typeof buildAttention>[0]["tenants"][number];

const NOW = new Date("2026-10-18T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const t = (over: Partial<T>): T => ({
  id: "t", name: "Acme", kind: "customer", plan: "starter", status: "active", industry: "hvac", industryLabel: "HVAC",
  billingStatus: "active", trialEndsAt: null, demoExpiresAt: null, createdAt: day(-60), health: "active",
  team: 3, techs: 2, customers: 10, jobs30: 20, lastActive: day(-1), mrr: 79, overrides: 0, city: "Winnipeg", ...over,
});

describe("needs attention", () => {
  it("flags trials ending within a week, most urgent first", () => {
    const items = buildAttention({
      tenants: [t({ id: "a", name: "Later", billingStatus: "trialing", trialEndsAt: day(6) }), t({ id: "b", name: "Soon", billingStatus: "trialing", trialEndsAt: day(1) }), t({ id: "c", billingStatus: "trialing", trialEndsAt: day(20) })],
      leads: [],
      overrides: [],
      now: NOW,
    });
    expect(items.map((i) => i.id)).toEqual(["trial:b", "trial:a"]);
    expect(items[0]!.title).toBe("Soon: trial ends in 1 day");
    expect(items[0]!.action.href).toBe("/admin/hub/tenants/b");
  });
  it("flags failed payments and quiet customers, never demo or test accounts", () => {
    const items = buildAttention({
      tenants: [t({ id: "p", billingStatus: "past_due" }), t({ id: "q", health: "dormant" }), t({ id: "d", kind: "test", billingStatus: "past_due", health: "dormant" })],
      leads: [],
      overrides: [],
      now: NOW,
    });
    expect(items.map((i) => i.kind).sort()).toEqual(["dormant", "past_due"]);
  });
  it("flags leads waiting more than a day and demos about to end", () => {
    const items = buildAttention({
      tenants: [t({ id: "demo", kind: "demo", name: "Demo Plumbing", demoExpiresAt: day(2) }), t({ id: "old", kind: "demo", demoExpiresAt: day(-1) })],
      leads: [{ id: "l1", name: "Pat", company: "Pat's Plumbing", createdAt: day(-4) }, { id: "l2", name: "New", company: "", createdAt: day(-0.2) }],
      overrides: [],
      now: NOW,
    });
    expect(items.find((i) => i.id === "lead:l1")).toMatchObject({ severity: "high", title: "Pat (Pat's Plumbing) is waiting for a reply" });
    expect(items.some((i) => i.id === "lead:l2")).toBe(false);
    expect(items.find((i) => i.id === "demo:old")?.title).toContain("has ended");
    expect(items.find((i) => i.id === "demo:demo")?.title).toBe("Demo Demo Plumbing ends in 2 days");
  });
  it("flags switches that are about to lapse", () => {
    const items = buildAttention({ tenants: [t({ id: "a", name: "Acme" })], leads: [], overrides: [{ companyId: "a", featureKey: "dispatch.map_v2", expiresAt: day(3) }, { companyId: "a", featureKey: "api.access", expiresAt: null }], now: NOW });
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("New dispatch map for Acme ends in 3 days");
  });
});
