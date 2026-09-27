/**
 * API-level cross-tenant ISOLATION tests.
 *
 * The single most important multi-tenant invariant: a user authenticated for
 * company A must never be able to READ or MUTATE company B's data — even when
 * they know B's exact record ids. These tests drive the REAL `bookingsRoutes`
 * Hono handlers through `app.request(...)`, with an auth shim that sets the
 * acting tenant from a header (mirroring production's authMiddleware). The
 * tenant-scoped `tx()` layer is the thing under test: every cross-tenant probe
 * must come back 404 / empty / forbidden, and the legitimate owner must still
 * succeed (so we know the row genuinely exists and isolation — not absence — is
 * what's protecting it).
 *
 * Same ephemeral in-memory libsql harness as the sibling suites; disjoint ids.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { getTableConfig, type PgColumn } from "drizzle-orm/pg-core";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { bookingsRoutes } = await import("../bookings");

const A = "tenint-company-a";
const B = "tenint-company-b";

const app = new Hono().use("*", async (c, next) => {
  const companyId = c.req.header("X-Test-Company") || "default";
  const uid = c.req.header("X-Test-User");
  const role = c.req.header("X-Test-Role") || "admin";
  c.set("companyId", companyId);
  c.set("user", uid ? { id: uid, role, email: `${uid}@t.test`, name: uid } : null);
  return next();
});
app.route("/bookings", bookingsRoutes);

function ddlFor(table: any): string {
  const cfg = getTableConfig(table);
  const cols = cfg.columns.map((col: PgColumn) => {
    const parts = [`"${col.name}"`, col.getSQLType()];
    if (col.primary) parts.push("PRIMARY KEY");
    const dflt = (col as any).default;
    let lit: string | null = null;
    if (dflt !== undefined) {
      lit =
        typeof dflt === "string" ? `'${dflt.replace(/'/g, "''")}'`
        : typeof dflt === "boolean" ? (dflt ? "TRUE" : "FALSE")
        : typeof dflt === "number" ? String(dflt)
        : null;
    }
    if (col.notNull && (lit !== null || col.primary)) parts.push("NOT NULL");
    if (lit !== null) parts.push(`DEFAULT ${lit}`);
    return parts.join(" ");
  });
  return `CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cols.join(", ")})`;
}

beforeAll(async () => {
  const sql = (db as any).$client;
  await sql.execute(ddlFor(schema.bookings));
  await sql.execute(ddlFor(schema.services));
  await sql.execute(ddlFor(schema.riders));
  await sql.execute(ddlFor(schema.user));

  // Admin users (one per company) so isAdminRole gates pass for the owner.
  await sql.execute({ sql: "INSERT OR IGNORE INTO user (id, name, email, email_verified, role, company_id) VALUES (?,?,?,?,?,?)", args: ["ten-owner-a", "Owner A", "oa@t.test", 1, "admin", A] });
  await sql.execute({ sql: "INSERT OR IGNORE INTO user (id, name, email, email_verified, role, company_id) VALUES (?,?,?,?,?,?)", args: ["ten-owner-b", "Owner B", "ob@t.test", 1, "admin", B] });

  await sql.execute({ sql: "INSERT OR IGNORE INTO services (id, company_id, name, category, base_price) VALUES (?,?,?,?,?)", args: ["ten-svc-a", A, "A service", "hvac", 100] });
  await sql.execute({ sql: "INSERT OR IGNORE INTO services (id, company_id, name, category, base_price) VALUES (?,?,?,?,?)", args: ["ten-svc-b", B, "B service", "hvac", 100] });

  // One booking per company.
  await sql.execute({ sql: "INSERT OR IGNORE INTO bookings (id, company_id, customer_id, service_id, title, status, address, price) VALUES (?,?,?,?,?,?,?,?)", args: ["ten-bk-a", A, "ten-owner-a", "ten-svc-a", "A job", "confirmed", "1 A St", 100] });
  await sql.execute({ sql: "INSERT OR IGNORE INTO bookings (id, company_id, customer_id, service_id, title, status, address, price) VALUES (?,?,?,?,?,?,?,?)", args: ["ten-bk-b", B, "ten-owner-b", "ten-svc-b", "B job", "confirmed", "1 B St", 100] });
});

function call(path: string, opts: { company?: string; user?: string; role?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.company) headers["X-Test-Company"] = opts.company;
  if (opts.user) headers["X-Test-User"] = opts.user;
  if (opts.role) headers["X-Test-Role"] = opts.role;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

describe("tenancy — single-record reads", () => {
  it("owner reads their OWN booking by id", async () => {
    const res = await call("/bookings/ten-bk-a", { company: A, user: "ten-owner-a" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { booking: { id: string; title: string } };
    expect(json.booking.id).toBe("ten-bk-a");
    expect(json.booking.title).toBe("A job");
  });

  it("company A reading company B's booking by exact id → 404 (isolation, not 200)", async () => {
    const res = await call("/bookings/ten-bk-b", { company: A, user: "ten-owner-a" });
    expect(res.status).toBe(404);
  });

  it("company B reading company A's booking by exact id → 404", async () => {
    const res = await call("/bookings/ten-bk-a", { company: B, user: "ten-owner-b" });
    expect(res.status).toBe(404);
  });
});

describe("tenancy — list endpoints never leak other tenants", () => {
  it("admin list for company A returns ONLY company A bookings", async () => {
    const res = await call("/bookings", { company: A, user: "ten-owner-a" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { bookings: { id: string; companyId: string }[] };
    const ids = json.bookings.map((b) => b.id);
    expect(ids).toContain("ten-bk-a");
    expect(ids).not.toContain("ten-bk-b");
    // belt and suspenders: every returned row is genuinely company A's.
    expect(json.bookings.every((b) => b.companyId === A)).toBe(true);
  });

  it("admin list for company B returns ONLY company B bookings", async () => {
    const res = await call("/bookings", { company: B, user: "ten-owner-b" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { bookings: { id: string }[] };
    const ids = json.bookings.map((b) => b.id);
    expect(ids).toContain("ten-bk-b");
    expect(ids).not.toContain("ten-bk-a");
  });
});

describe("tenancy — cross-tenant MUTATION is refused", () => {
  it("company A cannot PATCH company B's booking (404, and B's row is unchanged)", async () => {
    const res = await call("/bookings/ten-bk-b", {
      company: A,
      user: "ten-owner-a",
      role: "admin",
      method: "PATCH",
      body: { title: "HIJACKED BY A" },
    });
    expect(res.status).toBe(404);

    // Verify B's row was NOT mutated by the cross-tenant attempt.
    const verify = await call("/bookings/ten-bk-b", { company: B, user: "ten-owner-b" });
    const json = (await verify.json()) as { booking: { title: string } };
    expect(json.booking.title).toBe("B job");
  });

  it("the legitimate owner CAN patch their own booking (proves PATCH works at all)", async () => {
    const res = await call("/bookings/ten-bk-a", {
      company: A,
      user: "ten-owner-a",
      role: "admin",
      method: "PATCH",
      body: { title: "A job (edited)" },
    });
    expect(res.status).toBe(200);
    const verify = await call("/bookings/ten-bk-a", { company: A, user: "ten-owner-a" });
    const json = (await verify.json()) as { booking: { title: string } };
    expect(json.booking.title).toBe("A job (edited)");
  });
});

describe("tenancy — auth gate", () => {
  it("unauthenticated booking read is 401", async () => {
    const res = await call("/bookings/ten-bk-a", { company: A }); // no user
    expect(res.status).toBe(401);
  });
});
