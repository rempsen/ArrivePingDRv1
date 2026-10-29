/**
 * Payroll & Payouts for a tenant whose technicians are paid through
 * QuickBooks: the report counts each job's purchase order, bill and payment
 * (bookings.vendor_bill_status) per technician instead of ArrivePing's own
 * Stripe payouts, which such a tenant never has.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { PgTable } = await import("drizzle-orm/pg-core");
const { ensureTables } = await import("../../../test-support/tables");
const { reportsRoutes } = await import("../reports");
const features = await import("../../../services/features");

const CO = "rpq-co";
const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", CO);
  c.set("requestId", "rpq-req");
  c.set("user", { id: "rpq-admin", role: "admin", email: "a@rpq.test", name: "Admin" } as never);
  return next();
});
app.route("/reports", reportsRoutes);

const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTables(v);
  await db.insert(schema.companies).values({ id: CO, name: "Payroll QBO Co", kind: "customer" } as never);
  await db.insert(schema.companySettings).values({ id: "rpq-settings", companyId: CO, timezone: "UTC" } as never);
  await db.insert(schema.user).values([
    { id: "rpq-admin", name: "Admin", email: "a@rpq.test", role: "admin", companyId: CO },
    { id: "rpq-u1", name: "Dan Rosenblat", email: "d@rpq.test", role: "rider", companyId: CO },
    { id: "rpq-u2", name: "Second Tech", email: "s@rpq.test", role: "rider", companyId: CO },
  ] as never);
  await db.insert(schema.memberships).values([
    { userId: "rpq-u1", companyId: CO, role: "rider" },
    { userId: "rpq-u2", companyId: CO, role: "rider" },
  ] as never);
  await db.insert(schema.riders).values([{ id: "rpq-r1", userId: "rpq-u1", companyId: CO }, { id: "rpq-r2", userId: "rpq-u2", companyId: CO }] as never);
  await db.insert(schema.services).values({ id: "rpq-svc", name: "Flooring", category: "flooring", basePrice: 0, companyId: CO } as never);
  await db.insert(schema.integrations).values({ companyId: CO, provider: "quickbooks", status: "connected", externalAccountId: "r5", accessToken: "at", refreshToken: "rt", expiresAt: new Date(Date.now() + 3600_000), config: JSON.stringify({ shadow: false }) } as never);
  await features.setFeatureOverride({ companyId: CO, key: "integrations.quickbooks", enabled: true, actor: { id: "t", name: "T" } });
  const job = (riderId: string, techPay: number, vendorBillStatus: string, extra: Record<string, unknown> = {}) => ({
    companyId: CO, serviceId: "rpq-svc", riderId, status: "completed", scheduledAt: at("2026-10-29T15:00:00Z"), address: "x", techPay, vendorBillStatus, ...extra,
  });
  await db.insert(schema.bookings).values([
    job("rpq-r1", 250, "paid", { subtradePaidAt: at("2026-10-29T12:00:00Z") }),
    job("rpq-r1", 500, "billed"),
    job("rpq-r1", 120, "po_open"),
    job("rpq-r2", 300, "none"),
    job("rpq-r2", 80, "paid", { subtradePaidAt: at("2026-10-28T12:00:00Z"), scheduledAt: at("2026-10-28T15:00:00Z") }),
    job("rpq-r1", 999, "paid", { scheduledAt: at("2026-08-01T15:00:00Z") }), // outside the range
    job("rpq-r1", 777, "paid", { isSample: true }), // sample day never counts
  ] as never);
});

describe("payroll report with QuickBooks", () => {
  it("totals purchase orders, bills and payments per technician from the jobs themselves", async () => {
    const r = await app.request("/reports/payroll?from=2026-10-27&to=2026-10-30");
    expect(r.status).toBe(200);
    const d = (await r.json()) as any;
    expect(d.source).toBe("quickbooks");
    expect(d.kpis.map((k: any) => k.label)).toEqual(["Technician pay", "Billed, unpaid", "Paid in QuickBooks", "Not yet billed"]);
    expect(d.kpis.map((k: any) => k.value)).toEqual(["$1,250.00", "$500.00", "$330.00", "$420.00"]);
    const dan = d.rows.find((x: any) => x.technician === "Dan Rosenblat");
    expect(dan).toMatchObject({ jobs: 3, techPay: 870, poOpen: 120, billed: 500, paid: 250, lastPaid: "2026-10-29" });
    const second = d.rows.find((x: any) => x.technician === "Second Tech");
    expect(second).toMatchObject({ jobs: 2, techPay: 380, notSynced: 300, paid: 80, lastPaid: "2026-10-28" });
    expect(d.columns.map((c: any) => c.key)).toEqual(["technician", "jobs", "techPay", "notSynced", "poOpen", "billed", "paid", "lastPaid"]);
    expect(d.series.bars.map((b: any) => b.key)).toEqual(["billed", "paid"]);
  });
});
