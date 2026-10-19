/**
 * Feature switches read from the database: plan and kind defaults, overrides
 * with expiry, the cache dropping on write, and the bulk filter background
 * sweeps use. Harness: in-memory PGlite, ids prefixed "fdb-".
 */
import { beforeAll, describe, expect, it } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { ensureTables } = await import("../../test-support/tables");
const f = await import("../features");
const { setTenantKind, kindForInternalFlag } = await import("../tenant-kind");

const actor = { id: "fdb-owner", name: "Dan R." };

beforeAll(async () => {
  await ensureTables(schema.companies, schema.tenantFeatureOverrides);
  await db.insert(schema.companies).values([
    { id: "fdb-cust", name: "Customer Co", kind: "customer" },
    { id: "fdb-demo", name: "Demo Co", kind: "demo", isInternal: true },
  ] as never);
});

describe("getTenantFeatures", () => {
  it("resolves plan and kind defaults", async () => {
    expect(await f.isFeatureOn("fdb-cust", "dispatch.map_v2")).toBe(false);
    expect(await f.isFeatureOn("fdb-demo", "dispatch.map_v2")).toBe(true);
    expect(await f.isFeatureOn("fdb-demo", "ops.hubspot_sync")).toBe(false);
  });
  it("treats the platform's own tenant as internal even without a row", async () => {
    expect(await f.isFeatureOn("default", "sales.pack")).toBe(true);
  });
  it("applies an override at once on this instance and clears it", async () => {
    await f.setFeatureOverride({ companyId: "fdb-cust", key: "dispatch.map_v2", enabled: true, reason: "pilot", actor });
    const set = await f.getTenantFeatures("fdb-cust");
    expect(set["dispatch.map_v2"]).toMatchObject({ on: true, source: "override" });
    expect(set["dispatch.map_v2"].override?.setByName).toBe("Dan R.");
    // upsert, not a second row
    await f.setFeatureOverride({ companyId: "fdb-cust", key: "dispatch.map_v2", enabled: false, actor });
    expect(await f.isFeatureOn("fdb-cust", "dispatch.map_v2")).toBe(false);
    expect((await f.overridesForFeature("dispatch.map_v2")).length).toBe(1);
    await f.clearFeatureOverride("fdb-cust", "dispatch.map_v2");
    expect((await f.getTenantFeatures("fdb-cust"))["dispatch.map_v2"].source).toBe("kind");
  });
  it("ignores an override once it has expired", async () => {
    await f.setFeatureOverride({ companyId: "fdb-cust", key: "api.access", enabled: false, expiresAt: new Date(Date.now() - 1000), actor });
    expect(await f.isFeatureOn("fdb-cust", "api.access")).toBe(true);
    await f.clearFeatureOverride("fdb-cust", "api.access");
  });
  it("refuses a key that isn't in the catalog", async () => {
    await expect(f.setFeatureOverride({ companyId: "fdb-cust", key: "nope", enabled: true, actor })).rejects.toThrow();
  });
});

describe("companiesWithFeature", () => {
  it("filters a list in one pass, honouring overrides", async () => {
    await f.setFeatureOverride({ companyId: "fdb-demo", key: "ops.hubspot_sync", enabled: true, actor });
    const on = await f.companiesWithFeature("ops.hubspot_sync", ["fdb-cust", "fdb-demo", "fdb-missing"]);
    expect([...on].sort()).toEqual(["fdb-cust", "fdb-demo", "fdb-missing"]);
    await f.clearFeatureOverride("fdb-demo", "ops.hubspot_sync");
    const off = await f.companiesWithFeature("ops.hubspot_sync", ["fdb-cust", "fdb-demo"]);
    expect([...off]).toEqual(["fdb-cust"]);
  });
});

describe("tenant kind", () => {
  it("keeps the old test flag in step with the kind", async () => {
    const row = await setTenantKind("fdb-cust", "test");
    expect(row).toMatchObject({ kind: "test", internal: true });
    expect(await f.isFeatureOn("fdb-cust", "dispatch.map_v2")).toBe(true);
    expect(await setTenantKind("fdb-cust", "customer")).toMatchObject({ kind: "customer", internal: false });
  });
  it("picks a kind when only the old flag is flipped", () => {
    expect(kindForInternalFlag("customer", true)).toBe("test");
    expect(kindForInternalFlag("demo", true)).toBe("demo");
    expect(kindForInternalFlag("demo", false)).toBe("customer");
  });
});
