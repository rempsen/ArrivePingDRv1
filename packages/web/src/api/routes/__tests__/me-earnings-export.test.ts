/**
 * GET /api/me/earnings/export — the technician's own earnings as a CSV.
 *
 * Protects: same scope as /earnings (own memberships only, suspended and
 * invited-only companies excluded, soft-deleted jobs excluded), the full
 * history rather than the 500-row page the app shows, the optional date
 * window, and that customer-typed text can't become a spreadsheet formula.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { getTableConfig, type PgColumn } from "drizzle-orm/pg-core";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { meRoutes } = await import("../me");

const A = "exp-acme";
const GONE = "exp-suspended";
const TECH = "exp-user-tech";
const OTHER = "exp-user-other";

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  const uid = c.req.header("X-Test-User");
  c.set("companyId", c.req.header("X-Test-Company") || "");
  c.set("user", uid ? { id: uid, role: "rider", email: `${uid}@t.test`, name: uid } : null);
  return next();
});
app.route("/me", meRoutes);

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

const DAY = 86_400_000;
const now = Date.now();
let sql: any;

const get = (qs = "", user: string | null = TECH) =>
  app.request(`/me/earnings/export${qs}`, { headers: user ? { "X-Test-User": user } : {} });

beforeAll(async () => {
  sql = (db as any).$client;
  for (const t of [schema.companies, schema.memberships, schema.riders, schema.bookings, schema.services, schema.payouts, schema.user])
    await sql.execute(ddlFor(t));
  const co = (id: string, name: string, status: string) =>
    sql.execute({ sql: "INSERT OR IGNORE INTO companies (id, name, status) VALUES (?,?,?)", args: [id, name, status] });
  await co(A, "Acme, Inc.", "active");
  await co(GONE, "Zed Suspended", "suspended");
  const member = (id: string, user: string, company: string) =>
    sql.execute({
      sql: "INSERT OR IGNORE INTO memberships (id, user_id, company_id, role, status, staff_type) VALUES (?,?,?,?,?,?)",
      args: [id, user, company, "rider", "active", "tech"],
    });
  await member("xm-1", TECH, A);
  await member("xm-2", TECH, GONE);
  await member("xm-3", OTHER, A);
  const rider = (id: string, user: string, company: string) =>
    sql.execute({ sql: "INSERT OR IGNORE INTO riders (id, user_id, company_id) VALUES (?,?,?)", args: [id, user, company] });
  await rider("xr-1", TECH, A);
  await rider("xr-2", TECH, GONE);
  await rider("xr-3", OTHER, A);
  const cust = (id: string, name: string) =>
    sql.execute({
      sql: "INSERT OR IGNORE INTO user (id, name, email, role, company_id) VALUES (?,?,?,?,?)",
      args: [id, name, `${id}@t.test`, "customer", A],
    });
  await cust("xc-evil", '=HYPERLINK("http://x.test","click")');
  await cust("xc-plain", 'Smith, "Bob"');
  const job = (id: string, company: string, riderId: string, cust: string, at: number, deletedAt: number | null = null) =>
    sql.execute({
      sql: "INSERT OR IGNORE INTO bookings (id, company_id, customer_id, rider_id, title, status, address, scheduled_at, finished_at, price, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      args: [id, company, cust, riderId, "Job", "completed", "1 Main St", at, at, 100, deletedAt],
    });
  await job("xb-evil", A, "xr-1", "xc-evil", now - 1 * DAY);
  await job("xb-plain", A, "xr-1", "xc-plain", now - 40 * DAY);
  await job("xb-del", A, "xr-1", "xc-plain", now - 1 * DAY, now - 3600_000);
  await job("xb-other", A, "xr-3", "xc-plain", now - 1 * DAY);
  await job("xb-gone", GONE, "xr-2", "xc-plain", now - 1 * DAY);
});

describe("GET /me/earnings/export", () => {
  it("returns a CSV attachment with the header row", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("arriveping-earnings-");
    const text = await res.text();
    expect(text.split("\n")[0]).toBe(
      "Date,Company,Job,Service,Customer,On-site hours,Hourly rate,Hourly pay,Mileage pay,Flat pay,Per-unit pay,Total pay,Job value (pre-tax),QuickBooks status,QuickBooks paid date",
    );
  });

  it("includes only the caller's own live jobs at companies they can use", async () => {
    const lines = (await (await get()).text()).trim().split("\n");
    expect(lines.length).toBe(3); // header + the two good jobs
  });

  it("is signed-in only", async () => {
    expect((await get("", null)).status).toBe(401);
  });

  it("filters by date window", async () => {
    const lines = (await (await get(`?from=${now - 7 * DAY}`)).text()).trim().split("\n");
    expect(lines.length).toBe(2);
    const old = (await (await get(`?to=${now - 7 * DAY}`)).text()).trim().split("\n");
    expect(old.length).toBe(2);
  });

  it("neutralises formulas typed by customers and escapes commas and quotes", async () => {
    const text = await (await get()).text();
    expect(text).toContain(`"'=HYPERLINK(""http://x.test"",""click"")"`);
    expect(text).not.toMatch(/,=HYPERLINK/);
    expect(text).toContain(`"Smith, ""Bob"""`);
    expect(text).toContain('"Acme, Inc."');
  });

  it("prints money as plain numbers", async () => {
    const row = (await (await get()).text()).trim().split("\n")[1]!;
    expect(row).not.toContain("$");
  });
});
