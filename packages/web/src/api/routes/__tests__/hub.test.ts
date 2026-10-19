/**
 * /api/hub over HTTP: who may do what (sales < staff < owner), feature
 * switches per tenant, remote settings with an audit trail the tenant can
 * see, suspend and reopen, kinds, bulk switches and the staff list.
 *
 * Harness: in-memory PGlite; a stub middleware stands in for authMiddleware
 * (user, company and hub role from test headers). Ids prefixed "hub-".
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db, sdb } = await import("../../database/index");
const schema = await import("../../database/schema");
const { ensureTables } = await import("../../../test-support/tables");
const { hubRoutes } = await import("../hub");
const { AppError } = await import("../../lib/errors");

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  const role = c.req.header("X-Hub-Role");
  const uid = c.req.header("X-Test-User") ?? "hub-owner";
  c.set("companyId", "default");
  c.set("user", { id: uid, role: role ? "superadmin" : "admin", email: `${uid}@nvc360.com`, name: uid === "hub-owner" ? "Dan R." : uid });
  c.set("platformRole", (role as "owner" | "staff" | "sales" | undefined) ?? null);
  c.set("actAs", null);
  return next();
});
app.route("/hub", hubRoutes);
app.onError((err, c) => {
  if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
  return c.json({ message: String((err as Error).message) }, 500);
});

const req = (method: string, path: string, role: string | null, body?: unknown, user?: string) =>
  app.request(`/hub${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(role ? { "X-Hub-Role": role } : {}), ...(user ? { "X-Test-User": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  await ensureTables(
    schema.companies,
    schema.companySettings,
    schema.memberships,
    schema.user,
    schema.tenantFeatureOverrides,
    schema.platformAudit,
    schema.platformStaff,
    schema.actAsSessions,
    schema.auditLog,
    schema.integrations,
    schema.contactRequests,
  );
  await db.insert(schema.companies).values([
    { id: "hub-cust", name: "Acme HVAC", kind: "customer", plan: "starter" },
    { id: "hub-demo", name: "Demo Plumbing", kind: "demo", isInternal: true },
  ] as never);
  await db.insert(schema.companySettings).values([
    { id: "hub-cust-s", companyId: "hub-cust" },
    { id: "hub-demo-s", companyId: "hub-demo" },
  ] as never);
  await db.insert(schema.user).values([
    { id: "hub-owner", name: "Dan R.", email: "hub-owner@nvc360.com", role: "superadmin", companyId: "default" },
    { id: "hub-other-owner", name: "Gregor", email: "hub-other-owner@nvc360.com", role: "superadmin", companyId: "default" },
    { id: "hub-new", name: "Joel", email: "hub-joel@nvc360.com", role: "admin", companyId: "default" },
    { id: "hub-acme-admin", name: "Alex Admin", email: "alex@acme.test", role: "admin", companyId: "hub-cust" },
  ] as never);
  await db.insert(schema.memberships).values({ id: "hub-m1", userId: "hub-acme-admin", companyId: "hub-cust", role: "admin", status: "active" } as never);
  await sdb.insert(schema.platformStaff).values([
    { userId: "hub-owner", role: "owner" },
    { userId: "hub-other-owner", role: "owner" },
  ]);
});

describe("access", () => {
  it("is closed to everyone who isn't platform staff", async () => {
    expect((await req("GET", "/overview", null)).status).toBe(403);
    expect((await req("GET", "/tenants", null)).status).toBe(403);
  });
  it("lets sales read the overview and tenant list", async () => {
    const o = await req("GET", "/overview", "sales");
    expect(o.status).toBe(200);
    const body = (await o.json()) as { kpis: { customers: number; demos: number } };
    // Other test files share this in-memory database, so count at least ours.
    expect(body.kpis.customers).toBeGreaterThanOrEqual(1);
    expect(body.kpis.demos).toBeGreaterThanOrEqual(1);
    const t = (await (await req("GET", "/tenants", "sales")).json()) as { tenants: { id: string; kind: string }[] };
    expect(t.tenants.find((x) => x.id === "hub-cust")?.kind).toBe("customer");
    expect(t.tenants.find((x) => x.id === "hub-demo")?.kind).toBe("demo");
  });
  it("shows sales a customer's summary but not its people", async () => {
    const d = (await (await req("GET", "/tenants/hub-cust", "sales")).json()) as { readOnly: boolean; people: unknown[] };
    expect(d.readOnly).toBe(true);
    expect(d.people).toEqual([]);
    const s = (await (await req("GET", "/tenants/hub-cust", "staff")).json()) as { people: { email: string }[] };
    expect(s.people.map((p) => p.email)).toContain("alex@acme.test");
  });
  it("keeps the audit feed off the overview for sales", async () => {
    await sdb.insert(schema.platformAudit).values({ actorId: "x", actorName: "X", action: "actas.start", summary: "secret reason" });
    const sales = (await (await req("GET", "/overview", "sales")).json()) as { activity: unknown[] };
    expect(sales.activity).toEqual([]);
    const staff = (await (await req("GET", "/overview", "staff")).json()) as { activity: unknown[] };
    expect(staff.activity.length).toBeGreaterThan(0);
  });
  it("reports what each role can do", async () => {
    const me = (await (await req("GET", "/me", "staff")).json()) as { can: Record<string, boolean> };
    expect(me.can).toMatchObject({ actAs: true, editPlans: false, manageTeam: false });
  });
});

describe("feature switches", () => {
  it("lets sales switch demo accounts only", async () => {
    expect((await req("PUT", "/tenants/hub-cust/features/dispatch.map_v2", "sales", { enabled: true })).status).toBe(403);
    expect((await req("PUT", "/tenants/hub-demo/features/api.access", "sales", { enabled: false, reason: "keep it simple" })).status).toBe(200);
  });
  it("switches a customer's feature on with an end date and shows it in the detail", async () => {
    const r = await req("PUT", "/tenants/hub-cust/features/dispatch.map_v2", "staff", { enabled: true, reason: "pilot", expiresAt: "2099-01-01T00:00:00Z" });
    expect(r.status).toBe(200);
    const d = (await (await req("GET", "/tenants/hub-cust", "staff")).json()) as { features: { key: string; on: boolean; source: string }[] };
    expect(d.features.find((f) => f.key === "dispatch.map_v2")).toMatchObject({ on: true, source: "override" });
    const audit = await sdb.select().from(schema.platformAudit).where(eq(schema.platformAudit.action, "feature.on"));
    expect(audit.at(-1)?.summary).toContain("Acme HVAC: New dispatch map on until 2099-01-01 (pilot)");
  });
  it("goes back to the default when reset", async () => {
    expect((await req("PUT", "/tenants/hub-cust/features/dispatch.map_v2", "staff", { enabled: null })).status).toBe(200);
    const d = (await (await req("GET", "/tenants/hub-cust", "staff")).json()) as { features: { key: string; on: boolean; source: string }[] };
    expect(d.features.find((f) => f.key === "dispatch.map_v2")).toMatchObject({ on: false, source: "kind" });
  });
  it("refuses an unknown feature or company", async () => {
    expect((await req("PUT", "/tenants/hub-cust/features/nope", "staff", { enabled: true })).status).toBe(404);
    expect((await req("PUT", "/tenants/nobody/features/api.access", "staff", { enabled: true })).status).toBe(404);
  });
  it("lets only an owner switch a feature for many accounts at once", async () => {
    const body = { companyIds: ["hub-cust", "hub-demo", "ghost"], enabled: true, reason: "beta" };
    expect((await req("POST", "/features/dispatch.map_v2/bulk", "staff", body)).status).toBe(403);
    const r = await req("POST", "/features/dispatch.map_v2/bulk", "owner", body);
    expect(((await r.json()) as { changed: number }).changed).toBe(2);
    const f = (await (await req("GET", "/features", "sales")).json()) as { features: { key: string; onCount: number; overrides: { companyId: string; enabled: boolean }[] }[] };
    const map = f.features.find((x) => x.key === "dispatch.map_v2")!;
    expect(map.overrides.filter((o) => o.companyId.startsWith("hub-")).map((o) => o.companyId).sort()).toEqual(["hub-cust", "hub-demo"]);
    expect(map.onCount).toBeGreaterThanOrEqual(2);
    await req("POST", "/features/dispatch.map_v2/bulk", "owner", { companyIds: ["hub-cust", "hub-demo"], enabled: null });
  });
});

describe("settings", () => {
  it("changes only allowed settings, with checks in plain words", async () => {
    const bad = await req("PATCH", "/tenants/hub-cust/settings", "staff", { taxRate: 0 });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { message: string }).message).toContain("can't be changed");
    const range = await req("PATCH", "/tenants/hub-cust/settings", "staff", { geofenceRadiusM: 5 });
    expect(((await range.json()) as { message: string }).message).toContain("25 to 2000");
  });
  it("writes the change and signs it in the tenant's own audit log", async () => {
    const r = await req("PATCH", "/tenants/hub-cust/settings", "staff", { distanceUnit: "imperial", geofenceRadiusM: 200 });
    expect(r.status).toBe(200);
    const [s] = await sdb.select().from(schema.companySettings).where(eq(schema.companySettings.companyId, "hub-cust"));
    expect(s).toMatchObject({ distanceUnit: "imperial", geofenceRadiusM: 200 });
    const [a] = await sdb.select().from(schema.auditLog).where(eq(schema.auditLog.companyId, "hub-cust"));
    expect(a?.actorName).toBe("ArrivePing support (Dan R.)");
  });
  it("keeps sales out of customer settings", async () => {
    expect((await req("PATCH", "/tenants/hub-cust/settings", "sales", { distanceUnit: "metric" })).status).toBe(403);
    expect((await req("PATCH", "/tenants/hub-demo/settings", "sales", { distanceUnit: "imperial" })).status).toBe(200);
  });
});

describe("tenant changes", () => {
  it("suspends and reopens (staff), but leaves plans and kinds to owners", async () => {
    expect((await req("PATCH", "/tenants/hub-cust", "staff", { status: "suspended" })).status).toBe(200);
    expect((await sdb.select().from(schema.companies).where(eq(schema.companies.id, "hub-cust")))[0]!.status).toBe("suspended");
    expect((await req("PATCH", "/tenants/hub-cust", "staff", { status: "active" })).status).toBe(200);
    expect((await req("PATCH", "/tenants/hub-cust", "staff", { plan: "pro" })).status).toBe(403);
    expect((await req("PATCH", "/tenants/hub-cust", "staff", { kind: "test" })).status).toBe(403);
  });
  it("changes kind and keeps the analytics flag in step (owner)", async () => {
    expect((await req("PATCH", "/tenants/hub-cust", "owner", { kind: "test", plan: "pro" })).status).toBe(200);
    const [co] = await sdb.select().from(schema.companies).where(eq(schema.companies.id, "hub-cust"));
    expect(co).toMatchObject({ kind: "test", isInternal: true, plan: "pro" });
    await req("PATCH", "/tenants/hub-cust", "owner", { kind: "customer" });
    expect((await sdb.select().from(schema.companies).where(eq(schema.companies.id, "hub-cust")))[0]!.isInternal).toBe(false);
  });
  it("won't change ArrivePing's own account kind", async () => {
    await db.insert(schema.companies).values({ id: "default", name: "ArrivePing", kind: "internal" } as never).onConflictDoNothing();
    expect((await req("PATCH", "/tenants/default", "owner", { kind: "customer" })).status).toBe(400);
  });
  it("lists plans with how many accounts are on each", async () => {
    const p = (await (await req("GET", "/plans", "sales")).json()) as { plans: { id: string; includes: string[] }[] };
    expect(p.plans.map((x) => x.id)).toEqual(["starter", "pro", "enterprise"]);
    expect(p.plans[0]!.includes).toContain("api.access");
  });
});

describe("staff list", () => {
  it("is managed by owners only", async () => {
    expect((await req("POST", "/team", "staff", { email: "hub-joel@nvc360.com", role: "sales" })).status).toBe(403);
    const r = await req("POST", "/team", "owner", { email: "hub-joel@nvc360.com", role: "sales" });
    expect(r.status).toBe(200);
    const { member } = (await r.json()) as { member: { userId: string } };
    const list = (await (await req("GET", "/team", "staff")).json()) as { staff: { userId: string; role: string }[] };
    expect(list.staff.find((s) => s.userId === member.userId)?.role).toBe("sales");
    expect((await req("DELETE", `/team/${member.userId}`, "owner")).status).toBe(200);
  });
  it("won't let an owner remove themselves", async () => {
    expect((await req("DELETE", "/team/hub-owner", "owner")).status).toBe(400);
  });
  it("records hub actions in the audit trail staff can read", async () => {
    const a = (await (await req("GET", "/audit?action=team", "staff")).json()) as { entries: { action: string }[] };
    expect(a.entries.map((e) => e.action)).toEqual(["team.remove", "team.upsert"]);
    expect((await req("GET", "/audit", "sales")).status).toBe(403);
  });
});
