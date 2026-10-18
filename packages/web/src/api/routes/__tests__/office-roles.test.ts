/**
 * OFFICE ROLES WORK IN THE DASHBOARD — WITHIN THEIR ROLE.
 *
 * Until now a dispatcher or manager was treated like a customer by the jobs
 * API (they saw only jobs booked in their own name) and refused by every
 * dashboard endpoint. These drive the real handlers:
 *   - a dispatcher sees the whole board and can edit a job; a technician can't;
 *   - a manager can't add office staff, change someone's role or sign-in
 *     email (that's how you'd take an account over), but can edit a name;
 *   - on the People endpoint, managers and dispatchers edit customers, not
 *     staff accounts.
 *
 * In-memory database; routes mounted under /api like the real app so the
 * office guard sees real paths. Ids prefixed "or-".
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.RESEND_API_KEY = "";
process.env.TWILIO_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { bookingsRoutes } = await import("../bookings");
const { teamRoutes } = await import("../team");
const { adminRoutes } = await import("../admin");

function colDdl(col: PgColumn, withPk: boolean): string {
  const parts = [`"${col.name}"`, col.getSQLType()];
  if (withPk && col.primary) parts.push("PRIMARY KEY");
  const d = (col as any).default;
  const lit = d === undefined ? null : typeof d === "string" ? `'${d.replace(/'/g, "''")}'` : typeof d === "boolean" ? (d ? "TRUE" : "FALSE") : typeof d === "number" ? String(d) : null;
  if (lit !== null) parts.push(`DEFAULT ${lit}`);
  return parts.join(" ");
}
async function ensureTable(table: PgTable) {
  const s = (db as any).$client;
  const cfg = getTableConfig(table);
  await s.execute(`CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cfg.columns.map((c) => colDdl(c, true)).join(", ")})`);
  for (const c of cfg.columns) if (!c.primary) await s.execute(`ALTER TABLE "${cfg.name}" ADD COLUMN IF NOT EXISTS ${colDdl(c, false)}`);
}

const CO = "or-co";
const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", CO);
  const id = c.req.header("X-User") ?? "or-disp";
  const role = c.req.header("X-Role") ?? "dispatcher";
  c.set("user", { id, role, email: `${id}@or.test`, name: id, companyId: CO } as any);
  return next();
});
app.route("/api/bookings", bookingsRoutes);
app.route("/api/team", teamRoutes);
app.route("/api/admin", adminRoutes);
app.onError((e, c) => c.json({ message: e.message }, ((e as { status?: number }).status ?? 500) as 400));

const as = (role: string, id: string) => ({ "X-Role": role, "X-User": id, "content-type": "application/json" });
const req = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTable(v);
  await db.insert(schema.companies).values({ id: CO, name: "Office Roles Co", status: "active" } as any);
  await db.insert(schema.companySettings).values({ id: CO, companyId: CO, name: "Office Roles Co" } as any);
  const people = [
    { id: "or-disp", role: "dispatcher" },
    { id: "or-mgr", role: "manager" },
    { id: "or-tech", role: "rider" },
    { id: "or-cust", role: "customer" },
    { id: "or-cust2", role: "customer" },
    { id: "or-disp2", role: "dispatcher" },
  ];
  for (const p of people) {
    await db.insert(schema.user).values({ id: p.id, name: p.id, email: `${p.id}@or.test`, role: p.role, companyId: CO } as any);
    await db.insert(schema.memberships).values({ id: `m-${p.id}`, userId: p.id, companyId: CO, role: p.role, status: "active" } as any);
  }
  await db.insert(schema.riders).values({ id: "or-rider", userId: "or-tech", companyId: CO } as any);
  await db.insert(schema.services).values({ id: "or-svc", companyId: CO, name: "Furnace repair", category: "hvac" } as any);
  for (const [id, cust] of [["or-job-1", "or-cust"], ["or-job-2", "or-cust2"]] as const)
    await db.insert(schema.bookings).values({
      id, companyId: CO, customerId: cust, serviceId: "or-svc", title: "Furnace repair", status: "confirmed", address: "1 Test St", scheduledAt: new Date(), price: 100,
    } as any);
});

describe("jobs", () => {
  it("a dispatcher sees the whole board, not just jobs in their own name", async () => {
    const r = await req("GET", "/api/bookings", as("dispatcher", "or-disp"));
    expect(r.status).toBe(200);
    const ids = ((await r.json()) as any).bookings.map((b: any) => b.id).sort();
    expect(ids).toEqual(["or-job-1", "or-job-2"]);
  });

  it("a customer still sees only their own", async () => {
    const r = await req("GET", "/api/bookings", as("customer", "or-cust"));
    expect(((await r.json()) as any).bookings.map((b: any) => b.id)).toEqual(["or-job-1"]);
  });

  it("a dispatcher can edit a job; a technician can't", async () => {
    expect((await req("PATCH", "/api/bookings/or-job-1", as("dispatcher", "or-disp"), { notes: "Gate code 1234" })).status).toBe(200);
    expect((await req("PATCH", "/api/bookings/or-job-1", as("rider", "or-tech"), { notes: "x" })).status).toBe(403);
  });
});

describe("the team", () => {
  it("a manager can't add office staff", async () => {
    const r = await req("POST", "/api/team", as("manager", "or-mgr"), { name: "New Disp", email: "newdisp@or.test", role: "dispatcher" });
    expect(r.status).toBe(403);
    expect(((await r.json()) as any).message).toBe("Only an admin can add office staff");
  });

  it("a manager can't change someone's role or sign-in email, but can fix a name", async () => {
    let r = await req("PATCH", "/api/team/or-disp2", as("manager", "or-mgr"), { role: "manager" });
    expect(r.status).toBe(403);
    r = await req("PATCH", "/api/team/or-disp2", as("manager", "or-mgr"), { email: "mine@or.test" });
    expect(r.status).toBe(403);
    r = await req("PATCH", "/api/team/or-disp2", as("manager", "or-mgr"), { name: "Dee Dispatch", role: "dispatcher" });
    expect(r.status).toBe(200);
  });
});

describe("People (customers)", () => {
  it("a dispatcher edits a customer's details", async () => {
    const r = await req("PATCH", "/api/admin/users/or-cust", as("dispatcher", "or-disp"), { phone: "+12045550111" });
    expect(r.status).toBe(200);
  });

  it("…but not a staff member's account", async () => {
    const r = await req("PATCH", "/api/admin/users/or-disp2", as("dispatcher", "or-disp"), { email: "taken@or.test" });
    expect(r.status).toBe(403);
    expect((await req("DELETE", "/api/admin/users/or-tech", as("manager", "or-mgr"))).status).toBe(403);
  });

  it("nobody below admin sets another person's password", async () => {
    const r = await req("POST", "/api/admin/users/or-cust/reset-password", as("manager", "or-mgr"), { password: "Another-pass-1" });
    expect(r.status).toBe(403);
  });
});
