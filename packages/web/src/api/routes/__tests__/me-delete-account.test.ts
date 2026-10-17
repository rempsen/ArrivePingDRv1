/**
 * DELETE /api/me and GET /api/me/deletion-preview — self-service account
 * deletion for the driver app (App Store 5.1.1(v)). Real handlers, real pglite
 * DB, header-driven auth shim.
 */
import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { getTableConfig } from "drizzle-orm/pg-core";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { meRoutes } = await import("../me");

const CO = "mdel-co";

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  const uid = c.req.header("X-Test-User");
  const role = c.req.header("X-Test-Role") || "rider";
  c.set("companyId", CO);
  c.set("user", uid ? { id: uid, role, email: `${uid}@t.test`, name: uid } : null);
  return next();
});
app.route("/me", meRoutes);

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
  for (const t of ["bookings", "memberships", "riders", "audit_log", "push_tokens"]) await s.execute(`DELETE FROM ${t} WHERE company_id = '${CO}'`);
  await s.execute(`DELETE FROM "user" WHERE id LIKE 'mdel-%'`);
  await s.execute(`DELETE FROM companies WHERE id = '${CO}'`);
  await s.execute({ sql: "INSERT INTO companies (id, name, billing_status, billing_seats) VALUES (?,?,?,?)", args: [CO, "MDel Co", "active", 3] });
  const users: [string, string][] = [
    ["mdel-tech", "rider"],
    ["mdel-admin", "admin"],
  ];
  for (const [id, role] of users) {
    await s.execute({ sql: 'INSERT INTO "user" (id, name, email, role, company_id, email_verified) VALUES (?,?,?,?,?,TRUE)', args: [id, id, `${id}@t.test`, role, CO] });
    await s.execute({ sql: "INSERT INTO memberships (id, user_id, company_id, role, status, staff_type) VALUES (?,?,?,?,?,?)", args: [`m-${id}`, id, CO, role, "active", role === "rider" ? "technician" : null] });
  }
  await s.execute({ sql: "INSERT INTO riders (id, user_id, company_id, approval) VALUES (?,?,?,?)", args: ["rd-mdel-tech", "mdel-tech", CO, "active"] });
}

beforeAll(async () => {
  const s = (db as any).$client;
  for (const t of [schema.companies, schema.user, schema.memberships, schema.riders, schema.bookings, schema.auditLog, schema.session, schema.account, schema.verification, schema.pushTokens]) await s.execute(ddlFor(t));
});
beforeEach(reseed);

function call(path: string, opts: { user?: string; role?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.user) headers["X-Test-User"] = opts.user;
  if (opts.role) headers["X-Test-Role"] = opts.role;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method: opts.method ?? "GET", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
}

describe("GET /me/deletion-preview", () => {
  it("401 signed out; allowed for a tech; blocked for the last admin", async () => {
    expect((await call("/me/deletion-preview")).status).toBe(401);
    const tech = await call("/me/deletion-preview", { user: "mdel-tech" });
    expect(await tech.json()).toEqual({ allowed: true, blockers: [] });
    const admin = await call("/me/deletion-preview", { user: "mdel-admin", role: "admin" });
    expect(await admin.json()).toEqual({ allowed: false, blockers: [{ companyId: CO, company: "MDel Co", reason: "last_admin" }] });
  });
});

describe("DELETE /me", () => {
  it("requires the DELETE confirmation word", async () => {
    const res = await call("/me", { method: "DELETE", user: "mdel-tech", body: {} });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("confirm_required");
    const [u] = await db.select().from(schema.user).where((await import("drizzle-orm")).eq(schema.user.id, "mdel-tech"));
    expect(u!.email).toBe("mdel-tech@t.test");
  });

  it("409 last_admin for the only admin", async () => {
    const res = await call("/me", { method: "DELETE", user: "mdel-admin", role: "admin", body: { confirm: "DELETE" } });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("last_admin");
  });

  it("200 anonymizes the tech and disables their membership", async () => {
    const res = await call("/me", { method: "DELETE", user: "mdel-tech", body: { confirm: "DELETE" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, companies: [CO], releasedJobs: 0 });
    const { eq } = await import("drizzle-orm");
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, "mdel-tech"));
    expect(u!.name).toBe("Deleted user");
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, "m-mdel-tech"));
    expect(m!.status).toBe("disabled");
  });
});
