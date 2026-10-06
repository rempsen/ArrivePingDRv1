/**
 * Service-layer tenant-isolation guarantees for the billing service.
 *
 * The route layer was migrated to `tdb` first; these tests close the gap by
 * proving the SERVICE layer is now tenant-enforced too. They assert two
 * regressions are fixed:
 *
 *   1. resolveRegion() reads THIS tenant's company_settings row — not the
 *      legacy `id="default"` singleton, which returned MB/0-tax for every
 *      non-default company (a real tax-calculation bug).
 *   2. recomputeBooking()/accrueTechPay() refuse to read or mutate a booking
 *      that belongs to another company (fail-closed: returns null).
 *
 * Runs against an ephemeral in-memory libsql DB, schema derived from drizzle so
 * it can't drift from production.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { eq } from "drizzle-orm";
import { getTableConfig, type PgColumn } from "drizzle-orm/pg-core";

// NOTE: Bun runs all test files in one process and libsql's ":memory:" store is
// shared across them. DDL here is CREATE TABLE IF NOT EXISTS and seeds are
// INSERT OR IGNORE with disjoint ids/companies from the sibling tenant.test.ts,
// so the two files coexist in the shared store without collision.
process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { resolveRegion, recomputeBooking, accrueTechPay } = await import("../billing");

const A = "billtest-company-a";
const B = "billtest-company-b";

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
  // IF NOT EXISTS: the in-memory libsql client is a process-wide singleton, so a
  // sibling test file may have already created a shared table (e.g. services).
  return `CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cols.join(", ")})`;
}

beforeAll(async () => {
  const sql = (db as any).$client;
  await sql.execute(ddlFor(schema.companySettings));
  await sql.execute(ddlFor(schema.bookings));
  await sql.execute(ddlFor(schema.services));
  await sql.execute(ddlFor(schema.taskTemplates));
  await sql.execute(ddlFor(schema.riders));

  // Company A: legacy "default" singleton — region MB. Company B: its OWN row → ON (Ontario).
  await sql.execute({ sql: "INSERT OR IGNORE INTO company_settings (id, company_id, default_region) VALUES (?,?,?)", args: ["default", A, "MB"] });
  await sql.execute({ sql: "INSERT OR IGNORE INTO company_settings (id, company_id, default_region) VALUES (?,?,?)", args: ["b-settings", B, "ON"] });

  // A service per company (flat $100, no rate model).
  await sql.execute({ sql: "INSERT OR IGNORE INTO services (id, company_id, name, category, base_price) VALUES (?,?,?,?,?)", args: ["svc-a", A, "A service", "hvac", 100] });
  await sql.execute({ sql: "INSERT OR IGNORE INTO services (id, company_id, name, category, base_price) VALUES (?,?,?,?,?)", args: ["svc-b", B, "B service", "hvac", 100] });

  // A booking per company. No region on the booking, no parseable address region,
  // so resolveRegion() MUST fall through to the company default.
  await sql.execute({ sql: "INSERT OR IGNORE INTO bookings (id, company_id, customer_id, service_id, title, status, address, price, on_site_minutes) VALUES (?,?,?,?,?,?,?,?,?)", args: ["bk-a", A, "cust-a", "svc-a", "A job", "completed", "", 100, 60] });
  await sql.execute({ sql: "INSERT OR IGNORE INTO bookings (id, company_id, customer_id, service_id, title, status, address, price, on_site_minutes) VALUES (?,?,?,?,?,?,?,?,?)", args: ["bk-b", B, "cust-b", "svc-b", "B job", "completed", "", 100, 60] });

  // Rider for company B (to exercise accrueTechPay scoping).
  await sql.execute({ sql: "INSERT OR IGNORE INTO riders (id, company_id, user_id, status, pay_rate_per_hour) VALUES (?,?,?,?,?)", args: ["rider-b", B, "u-b", "available", 40] });
  await sql.execute({ sql: "UPDATE bookings SET rider_id = ? WHERE id = ?", args: ["rider-b", "bk-b"] });
});

describe("billing service tenant isolation", () => {
  it("resolveRegion reads the tenant's OWN settings, not the legacy default singleton", async () => {
    const [bkA] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, "bk-a"));
    const [bkB] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, "bk-b"));

    // Company A resolves to MB (its row). Company B must resolve to ON —
    // the OLD code read id="default" and would have wrongly returned MB here.
    expect(await resolveRegion(A, bkA!)).toBe("MB");
    expect(await resolveRegion(B, bkB!)).toBe("ON");
  });

  it("recomputeBooking refuses a booking from another company (fail-closed)", async () => {
    // Company A asking for company B's booking → not in tenant scope → null.
    expect(await recomputeBooking(A, "bk-b")).toBeNull();
    // The legitimate owner still gets a result.
    expect(await recomputeBooking(B, "bk-b", { persist: false })).not.toBeNull();
  });

  it("accrueTechPay refuses a booking from another company (fail-closed)", async () => {
    expect(await accrueTechPay(A, "bk-b")).toBeNull();
    const ownerResult = await accrueTechPay(B, "bk-b");
    expect(ownerResult).not.toBeNull();
    expect(ownerResult?.techPay).toBe(40); // 60 min @ $40/h = $40
  });
});
