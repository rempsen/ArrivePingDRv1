/**
 * Review fixes for the Control Hub: a company's support-access choice is
 * theirs alone (ArrivePing staff can't flip it back on), and marking a company
 * "test" from Analytics is an Owner decision.
 */
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { settingsRoutes } = await import("../settings");
const { platformAnalyticsRoutes } = await import("../platform-analytics");

function appAs(role: string, platformRole: "owner" | "staff" | "sales" | null) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("companyId", "hc-cust");
      c.set("user", { id: "hc-u", role, email: "u@nvc360.com", name: "U" });
      c.set("platformRole", platformRole);
      c.set("actAs", null);
      return next();
    })
    .route("/settings", settingsRoutes)
    .route("/analytics", platformAnalyticsRoutes);
}

const put = (app: Hono<AppEnv>, allow: boolean) =>
  app.request("/settings/support-access", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allow }) });

describe("support access is the company's own choice", () => {
  it("refuses ArrivePing staff, even an owner", async () => {
    expect((await put(appAs("superadmin", "owner"), true)).status).toBe(403);
    expect((await put(appAs("superadmin", "staff"), true)).status).toBe(403);
  });
  it("refuses a non-admin at the company", async () => {
    expect((await put(appAs("dispatcher", null), true)).status).toBe(403);
  });
});

describe("marking a company test from Analytics", () => {
  it("is for owners only", async () => {
    const r = await appAs("superadmin", "staff").request("/analytics/tenants/hc-cust", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ internal: true }) });
    expect(r.status).toBe(403);
  });
});
