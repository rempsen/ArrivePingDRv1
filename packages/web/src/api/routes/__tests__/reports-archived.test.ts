/**
 * Reports leave out archived (soft-deleted) jobs, the same as the Jobs list,
 * the scheduler and payouts. Before, the shared job loader in reports.ts had
 * no deletedAt filter, so an archived job still counted in revenue, job
 * counts, catalog, clients and zones.
 *
 * Harness: ephemeral in-memory libsql, ids prefixed "rpa-".
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { getTableConfig, type PgColumn } from "drizzle-orm/pg-core";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { reportsRoutes } = await import("../reports");

const CO = "rpa-co";
const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", CO);
  c.set("user", { id: "rpa-admin", role: "admin", email: "rpa-admin@t.test", name: "Admin" } as never);
  return next();
});
app.route("/reports", reportsRoutes);

function ddlFor(table: any): string {
  const cfg = getTableConfig(table);
  const cols = cfg.columns.map((col: PgColumn) => {
    const parts = [`"${col.name}"`, col.getSQLType()];
    if (col.primary) parts.push("PRIMARY KEY");
    const dflt = (col as any).default;
    const lit =
      typeof dflt === "string" ? `'${dflt.replace(/'/g, "''")}'`
      : typeof dflt === "boolean" ? (dflt ? "TRUE" : "FALSE")
      : typeof dflt === "number" ? String(dflt)
      : null;
    if (col.notNull && (lit !== null || col.primary)) parts.push("NOT NULL");
    if (lit !== null) parts.push(`DEFAULT ${lit}`);
    return parts.join(" ");
  });
  return `CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cols.join(", ")})`;
}

const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  d.setUTCHours(15, 0, 0, 0);
  return d;
};
const ymd = (d: Date) => d.toISOString().slice(0, 10);

beforeAll(async () => {
  const sql = (db as any).$client;
  for (const t of [
    schema.companySettings, schema.bookings, schema.services, schema.riders, schema.user,
    schema.invoices, schema.serviceZones, schema.properties, schema.jobEvents, schema.payouts, schema.reviews, schema.catalogItems,
  ]) {
    await sql.execute(ddlFor(t));
  }
  await sql.execute({ sql: "INSERT OR IGNORE INTO company_settings (id, company_id, timezone) VALUES (?,?,?)", args: ["rpa-settings", CO, "UTC"] });
  await sql.execute({
    sql: "INSERT OR IGNORE INTO services (id, company_id, name, category, base_price) VALUES (?,?,?,?,?)",
    args: ["rpa-svc", CO, "Furnace Repair", "hvac", 100],
  });
  const jobs: Array<[string, number, number | null]> = [
    ["rpa-kept-1", 400, null],
    ["rpa-kept-2", 250, null],
    ["rpa-archived", 9000, day(-1).getTime()],
  ];
  for (const [id, total, deletedAt] of jobs) {
    await sql.execute({
      sql: `INSERT OR IGNORE INTO bookings
              (id, company_id, customer_id, service_id, title, status, scheduled_at, address, price, total, public_token, deleted_at, is_sample)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [id, CO, "rpa-cust", "rpa-svc", "Job", "completed", day(-3).getTime(), "1 Test St", total, total, `tok-${id}`, deletedAt, false],
    });
  }
});

describe("reports skip archived jobs", () => {
  it("leaves an archived job out of revenue and job counts", async () => {
    const r = await app.request(`/reports/revenue?from=${ymd(day(-10))}&to=${ymd(day(0))}`);
    expect(r.status).toBe(200);
    const d = (await r.json()) as { rows: { service: string; jobs: number; revenue: number }[] };
    const row = d.rows.find((x) => x.service === "Furnace Repair")!;
    expect(row.jobs).toBe(2);
    expect(row.revenue).toBe(650);
  });

  it("leaves it out of the job status totals too", async () => {
    const r = await app.request(`/reports/job-status?from=${ymd(day(-10))}&to=${ymd(day(0))}`);
    expect(r.status).toBe(200);
    const d = (await r.json()) as { rows: { status: string; count: number }[]; kpis: { label: string; value: string }[] };
    expect(d.rows.find((x) => x.status === "completed")?.count).toBe(2);
    expect(d.kpis.find((k) => k.label === "Total jobs")?.value).toBe("2");
  });
});
