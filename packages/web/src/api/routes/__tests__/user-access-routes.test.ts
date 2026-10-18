/**
 * Routes for reversible user deactivation and seat downsizing:
 *   GET  /team/:id/open-jobs, POST /team/:id/deactivate, POST /team/:id/reactivate
 *   GET  /billing/seat-candidates, POST /billing/downsize
 * Real handlers, real pglite DB, header-driven auth shim, Stripe disabled.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { getTableConfig } from "drizzle-orm/pg-core";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.RESEND_API_KEY = "";
process.env.TWILIO_AUTH_TOKEN = "";

const realStripe = { ...(await import("../../../services/stripe")) };
beforeAll(() => {
  mock.module("../../../services/stripe", () => ({ ...realStripe, stripeEnabled: false }));
});
afterAll(() => {
  mock.module("../../../services/stripe", () => realStripe);
});

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { teamRoutes } = await import("../team");
const { billingRoutes } = await import("../billing");

const CO = "uar-co";
const OTHER = "uar-other";

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  const companyId = c.req.header("X-Test-Company") || CO;
  const uid = c.req.header("X-Test-User") || "uar-admin";
  const role = c.req.header("X-Test-Role") || "admin";
  c.set("companyId", companyId);
  c.set("user", { id: uid, role, email: `${uid}@t.test`, name: uid });
  return next();
});
app.route("/team", teamRoutes);
app.route("/billing", billingRoutes);

function ddlFor(table: any): string {
  const cfg = getTableConfig(table);
  const cols = cfg.columns.map((col: any) => {
    const parts = [`"${col.name}"`, col.getSQLType()];
    if (col.primary) parts.push("PRIMARY KEY");
    const d = col.default;
    const lit = typeof d === "string" ? `'${d.replace(/'/g, "''")}'` : typeof d === "boolean" ? (d ? "TRUE" : "FALSE") : typeof d === "number" ? String(d) : null;
    if (col.notNull && (lit !== null || col.primary)) parts.push("NOT NULL");
    if (lit !== null) parts.push(`DEFAULT ${lit}`);
    return parts.join(" ");
  });
  return `CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cols.join(", ")})`;
}

async function reseed() {
  const s = (db as any).$client;
  for (const t of ["bookings", "memberships", "riders", "audit_log"]) await s.execute(`DELETE FROM ${t} WHERE company_id IN ('${CO}','${OTHER}')`);
  await s.execute(`DELETE FROM "user" WHERE id LIKE 'uar-%'`);
  await s.execute(`DELETE FROM companies WHERE id IN ('${CO}','${OTHER}')`);
  await s.execute({ sql: "INSERT INTO companies (id, name, billing_status, billing_seats) VALUES (?,?,?,?)", args: [CO, "UAR Co", "active", 2] });
  await s.execute({ sql: "INSERT INTO companies (id, name, billing_status, billing_seats) VALUES (?,?,?,?)", args: [OTHER, "Other Co", "active", 2] });
  const users: [string, string, string][] = [
    ["uar-admin", "admin", CO],
    ["uar-r1", "rider", CO],
    ["uar-r2", "rider", CO],
    ["uar-r3", "rider", CO],
    ["uar-foreign", "rider", OTHER],
  ];
  for (const [id, role, co] of users) {
    await s.execute({ sql: 'INSERT INTO "user" (id, name, email, role, company_id, email_verified) VALUES (?,?,?,?,?,TRUE)', args: [id, id, `${id}@t.test`, role, co] });
    await s.execute({ sql: "INSERT INTO memberships (id, user_id, company_id, role, status, staff_type) VALUES (?,?,?,?,?,?)", args: [`m-${id}`, id, co, role, "active", role === "rider" ? "technician" : null] });
    if (role === "rider") await s.execute({ sql: "INSERT INTO riders (id, user_id, company_id, approval) VALUES (?,?,?,?)", args: [`rd-${id}`, id, co, "active"] });
  }
  await s.execute({ sql: "INSERT INTO bookings (id, company_id, customer_id, service_id, title, status, address, scheduled_at, rider_id) VALUES (?,?,?,?,?,?,?,?,?)", args: ["uar-bk1", CO, "c", "s", "Job 1", "assigned", "", new Date().toISOString(), "rd-uar-r1"] });
}

beforeAll(async () => {
  const s = (db as any).$client;
  for (const t of [schema.companies, schema.user, schema.memberships, schema.riders, schema.bookings, schema.auditLog, schema.rolePermissions]) await s.execute(ddlFor(t));
});
beforeEach(reseed);

function call(path: string, opts: { company?: string; user?: string; role?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.company) headers["X-Test-Company"] = opts.company;
  if (opts.user) headers["X-Test-User"] = opts.user;
  if (opts.role) headers["X-Test-Role"] = opts.role;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method: opts.method ?? "GET", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
}

describe("GET /team/:id/open-jobs", () => {
  it("returns count and jobs for own tenant, 404 for another tenant's user", async () => {
    const res = await call("/team/uar-r1/open-jobs");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { count: number; jobs: { id: string }[] };
    expect(json.count).toBe(1);
    expect(json.jobs[0]!.id).toBe("uar-bk1");
    expect((await call("/team/uar-foreign/open-jobs")).status).toBe(404);
  });
});

describe("POST /team/:id/deactivate", () => {
  it("returns 409 has_open_jobs without reassign; 200 with reassignTo", async () => {
    const blocked = await call("/team/uar-r1/deactivate", { method: "POST", body: {} });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { code: string }).code).toBe("has_open_jobs");
    const ok = await call("/team/uar-r1/deactivate", { method: "POST", body: { reassignTo: "uar-r2" } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { ok: boolean }).ok).toBe(true);
  });
});

describe("POST /team/:id/reactivate", () => {
  it("returns 409 seat_required at capacity, then 200 with addSeat", async () => {
    // 3 active field staff on 2 seats: deactivate one (2 left = capacity), reactivating needs a seat.
    expect((await call("/team/uar-r2/deactivate", { method: "POST", body: {} })).status).toBe(200);
    const need = await call("/team/uar-r2/reactivate", { method: "POST", body: {} });
    expect(need.status).toBe(409);
    const body = (await need.json()) as { code: string; meta: { seatsNeeded: number; monthlyDelta: number } };
    expect(body.code).toBe("seat_required");
    expect(body.meta).toEqual({ seatsNeeded: 1, monthlyDelta: 30 });
    const ok = await call("/team/uar-r2/reactivate", { method: "POST", body: { addSeat: true } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { seats: number }).seats).toBe(3);
  });
});

describe("GET /billing/seat-candidates", () => {
  it("lists field staff", async () => {
    const res = await call("/billing/seat-candidates");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { candidates: { userId: string }[]; officeRemovable: number };
    expect(json.candidates.map((c) => c.userId).sort()).toEqual(["uar-r1", "uar-r2", "uar-r3"]);
    // The admin is the only office user: their dispatcher license is included.
    expect(json.officeRemovable).toBe(0);
  });

  it("lists an extra office user, with how many can come off", async () => {
    const s = (db as any).$client;
    await s.execute({ sql: 'INSERT INTO "user" (id, name, email, role, company_id, email_verified) VALUES (?,?,?,?,?,TRUE)', args: ["uar-disp", "uar-disp", "uar-disp@t.test", "dispatcher", CO] });
    await s.execute({ sql: "INSERT INTO memberships (id, user_id, company_id, role, status) VALUES (?,?,?,?,?)", args: ["m-uar-disp", "uar-disp", CO, "dispatcher", "active"] });
    const json = (await (await call("/billing/seat-candidates")).json()) as { candidates: { userId: string; staffType: string; roleLabel: string | null; riderId: string | null }[]; officeRemovable: number };
    expect(json.candidates.find((c) => c.userId === "uar-disp")).toMatchObject({ staffType: "office", roleLabel: "Dispatcher", riderId: null });
    expect(json.candidates.some((c) => c.userId === "uar-admin")).toBe(false);
    expect(json.officeRemovable).toBe(1);
    const sum = (await (await call("/billing/summary")).json()) as Record<string, number>;
    expect(sum).toMatchObject({ seats: 2, activeDrivers: 3, activeOffice: 2, includedOffice: 1, billableUsers: 4, excessActive: 2 });
  });

  it("summary reports excessActive", async () => {
    const res = await call("/billing/summary");
    const json = (await res.json()) as Record<string, number>;
    expect(json.excessActive).toBe(1);
    expect(json).toMatchObject({ activeDrivers: 3, activeOffice: 1, includedOffice: 1, billableUsers: 3 });
  });
});

describe("POST /billing/downsize", () => {
  it("200 happy path; 409 stale; 400 reassign_target_deactivated", async () => {
    const stale = await call("/billing/downsize", { method: "POST", body: { seats: 9, deactivate: ["uar-r3"], reassign: {} } });
    expect(stale.status).toBe(409);
    const bad = await call("/billing/downsize", { method: "POST", body: { seats: 1, deactivate: ["uar-r1", "uar-r2"], reassign: { "uar-r1": "uar-r2" } } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe("reassign_target_deactivated");
    const ok = await call("/billing/downsize", { method: "POST", body: { seats: 1, deactivate: ["uar-r1", "uar-r2"], reassign: { "uar-r1": "uar-r3" } } });
    expect(ok.status).toBe(200);
    expect((await ok.json()) as object).toEqual({ ok: true, seats: 1, deactivated: ["uar-r1", "uar-r2"] });
  });
});

describe("seat candidates with no field staff", () => {
  it("returns [] and excessActive 0", async () => {
    const s = (db as any).$client;
    await s.execute(`DELETE FROM riders WHERE company_id = '${CO}'`);
    await s.execute(`DELETE FROM memberships WHERE company_id = '${CO}' AND role = 'rider'`);
    const res = await call("/billing/seat-candidates");
    expect(((await res.json()) as { candidates: unknown[] }).candidates).toEqual([]);
    const sum = await call("/billing/summary");
    expect(((await sum.json()) as { excessActive: number }).excessActive).toBe(0);
  });
});

describe("reactivate with addSeat", () => {
  it("is admin-only: a manager gets 403, no seat is added", async () => {
    expect((await call("/team/uar-r2/deactivate", { method: "POST", body: {} })).status).toBe(200);
    const res = await call("/team/uar-r2/reactivate", { method: "POST", body: { addSeat: true }, role: "manager", user: "uar-mgr" });
    expect(res.status).toBe(403);
    const sum = await call("/billing/summary");
    expect(((await sum.json()) as { seats: number }).seats).toBe(2);
  });
});

describe("authorisation", () => {
  it("non-admin gets 403 on every new route", async () => {
    const asRider = { role: "rider", user: "uar-r3" };
    expect((await call("/team/uar-r1/open-jobs", asRider)).status).toBe(403);
    expect((await call("/team/uar-r1/deactivate", { ...asRider, method: "POST", body: {} })).status).toBe(403);
    expect((await call("/team/uar-r1/reactivate", { ...asRider, method: "POST", body: {} })).status).toBe(403);
    expect((await call("/billing/seat-candidates", asRider)).status).toBe(403);
    expect((await call("/billing/downsize", { ...asRider, method: "POST", body: { seats: 1, deactivate: ["uar-r1"], reassign: {} } })).status).toBe(403);
  });
});

describe("rosters expose deactivation", () => {
  it("GET /team carries membershipStatus and deactivatedAt after a deactivation", async () => {
    expect((await call("/team/uar-r2/deactivate", { method: "POST", body: {} })).status).toBe(200);
    const res = await call("/team");
    const json = (await res.json()) as { employees: { id: string; membershipStatus: string; deactivatedAt: string | null }[] };
    const r2 = json.employees.find((e) => e.id === "uar-r2")!;
    expect(r2.membershipStatus).toBe("disabled");
    expect(typeof r2.deactivatedAt).toBe("string");
    expect(json.employees.find((e) => e.id === "uar-r3")!.deactivatedAt).toBeNull();
  });
});
