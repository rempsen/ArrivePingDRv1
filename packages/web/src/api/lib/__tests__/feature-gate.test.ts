/**
 * The API feature gate: a module switched off for a tenant answers 403
 * feature_off; switched on (the default) it is untouched; paths no feature
 * guards are never touched. Real authMiddleware with getSession mocked.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

let current: { id: string; role: string; companyId: string; email: string; name: string } | null = null;
const realAuth = { ...(await import("../../auth")) };
beforeAll(() => {
  mock.module("../../auth", () => ({
    ...realAuth,
    auth: { ...realAuth.auth, api: { ...realAuth.auth.api, getSession: async () => (current ? { user: current, session: { id: "s" } } : null) } },
  }));
});
afterAll(() => {
  mock.module("../../auth", () => realAuth);
});

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { ensureTables } = await import("../../../test-support/tables");
const { authMiddleware, featureGate } = await import("../../middleware/auth");
const features = await import("../../../services/features");

const app = new Hono<AppEnv>()
  .use("*", authMiddleware)
  .use("*", featureGate)
  .get("/api/maintenance/plans", (c) => c.json({ ok: true }))
  .get("/api/integrations/oauth/callback/xero", (c) => c.json({ ok: true }))
  .get("/api/bookings", (c) => c.json({ ok: true }));

beforeAll(async () => {
  await ensureTables(schema.companies, schema.memberships, schema.tenantFeatureOverrides, schema.platformStaff);
  await db.insert(schema.companies).values({ id: "fg-co", name: "Gate Co" } as never);
  await db.insert(schema.memberships).values({ id: "fg-m", userId: "fg-admin", companyId: "fg-co", role: "admin", status: "active" } as never);
  current = { id: "fg-admin", role: "admin", companyId: "fg-co", email: "a@fg.test", name: "A" };
});

describe("feature gate", () => {
  it("lets a module through when its switch is on (the default)", async () => {
    expect((await app.request("/api/maintenance/plans")).status).toBe(200);
  });
  it("answers 403 feature_off once the Control Hub switches it off", async () => {
    await features.setFeatureOverride({ companyId: "fg-co", key: "maintenance.plans", enabled: false, actor: { id: "o", name: "O" } });
    const r = await app.request("/api/maintenance/plans");
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: { code: string; feature: string } }).error).toMatchObject({ code: "feature_off", feature: "maintenance.plans" });
    await features.clearFeatureOverride("fg-co", "maintenance.plans");
    expect((await app.request("/api/maintenance/plans")).status).toBe(200);
  });
  it("never touches unguarded paths or the OAuth callback", async () => {
    await features.setFeatureOverride({ companyId: "fg-co", key: "integrations.apps", enabled: false, actor: { id: "o", name: "O" } });
    expect((await app.request("/api/integrations/oauth/callback/xero")).status).toBe(200);
    expect((await app.request("/api/bookings")).status).toBe(200);
  });
});
