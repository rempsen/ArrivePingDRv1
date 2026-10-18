/**
 * On-site payment: the public /pay/:token API and the technician's pay link.
 * Same harness as billing-integration.test.ts (real routes, in-memory DB,
 * Stripe unconfigured so money-moving calls must fail closed with 503).
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { getTableConfig, type PgColumn } from "drizzle-orm/pg-core";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { paymentsRoutes } = await import("../payments");
const { payPublicRoutes } = await import("../pay-public");
const { syncInvoiceToBooking } = await import("../../../services/billing");
const { AppError } = await import("../../lib/errors");

const A = "payos-company-a";

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  const companyId = c.req.header("X-Test-Company") || "default";
  const uid = c.req.header("X-Test-User");
  const role = c.req.header("X-Test-Role") || "owner";
  c.set("companyId", companyId);
  c.set("user", uid ? { id: uid, role, email: `${uid}@t.test`, name: uid } : null);
  return next();
});
app.route("/payments", paymentsRoutes);
app.route("/pay", payPublicRoutes);
app.onError((err, c) => {
  if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.expose ? err.message : "error" } }, err.status as 400);
  return c.json({ error: { code: "internal", message: String(err) } }, 500);
});

function ddlFor(table: any): string {
  const cfg = getTableConfig(table);
  const cols = cfg.columns.map((col: PgColumn) => {
    const parts = [`"${col.name}"`, col.getSQLType()];
    if (col.primary) parts.push("PRIMARY KEY");
    const dflt = (col as any).default;
    let lit: string | null = null;
    if (dflt !== undefined) {
      lit = typeof dflt === "string" ? `'${dflt.replace(/'/g, "''")}'` : typeof dflt === "boolean" ? (dflt ? "TRUE" : "FALSE") : typeof dflt === "number" ? String(dflt) : null;
    }
    if (col.notNull && (lit !== null || col.primary)) parts.push("NOT NULL");
    if (lit !== null) parts.push(`DEFAULT ${lit}`);
    return parts.join(" ");
  });
  return `CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cols.join(", ")})`;
}

beforeAll(async () => {
  const sql = (db as any).$client;
  for (const t of [schema.bookings, schema.invoices, schema.paymentLedger, schema.riders, schema.companies, schema.companySettings]) await sql.execute(ddlFor(t));
  await sql.execute({ sql: "INSERT OR IGNORE INTO company_settings (id, company_id, name) VALUES (?,?,?)", args: [A, A, "Prairie Test HVAC"] });
  const bk = "INSERT OR IGNORE INTO bookings (id, company_id, customer_id, service_id, title, status, address, price, subtotal, tax_amount, total, tax_label, public_token, collect_payment, rider_id, customer_phone, price_breakdown) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
  const items = JSON.stringify([{ label: "First hour", qty: 1, unit: "hr", rate: 150, amount: 150 }, { label: "Mileage", qty: 10, unit: "km", rate: 1, amount: 10 }]);
  // Collect on site, invoiced from an old estimate of $100.
  await sql.execute({ sql: bk, args: ["bk-os", A, "cust-a", "svc", "AC repair", "completed", "1 Main St", 179.2, 160, 19.2, 179.2, "GST + PST", "payostoken01", "on_site", "rider-os", "+12045550111", items] });
  await sql.execute({ sql: "INSERT OR IGNORE INTO invoices (id, company_id, booking_id, customer_id, number, amount, tax, total, status, currency) VALUES (?,?,?,?,?,?,?,?,?,?)", args: ["inv-os", A, "bk-os", "cust-a", "INV-OS-1", 100, 12, 112, "unpaid", "cad"] });
  // Not set up for on-site payment.
  await sql.execute({ sql: bk, args: ["bk-no", A, "cust-a", "svc", "Leak", "completed", "2 Main St", 50, 50, 0, 50, "", "payostoken02", "", null, "", "[]"] });
  // Collect on site with no invoice yet.
  await sql.execute({ sql: bk, args: ["bk-new", A, "cust-a", "svc", "Install", "in_progress", "3 Main St", 300, 300, 36, 336, "Tax", "payostoken03", "on_site", "rider-os", "", "[]"] });
  await sql.execute({ sql: "INSERT OR IGNORE INTO riders (id, user_id, company_id) VALUES (?,?,?)", args: ["rider-os", "u-tech", A] });
  await sql.execute({ sql: "INSERT OR IGNORE INTO riders (id, user_id, company_id) VALUES (?,?,?)", args: ["rider-other", "u-other", A] });
});

const call = (path: string, o: { company?: string; user?: string; role?: string; method?: string; body?: unknown } = {}) =>
  app.request(path, {
    method: o.method ?? "GET",
    headers: { ...(o.company ? { "X-Test-Company": o.company } : {}), ...(o.user ? { "X-Test-User": o.user } : {}), ...(o.role ? { "X-Test-Role": o.role } : {}), ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  });

describe("public pay page API", () => {
  it("shows the job's final total and billed lines — and nothing private", async () => {
    const res = await call("/pay/payostoken01");
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.total).toBe(179.2);
    expect(j.items.map((i: any) => i.label)).toEqual(["First hour", "Mileage"]);
    expect(j.company.name).toBe("Prairie Test HVAC");
    expect(j.paid).toBe(false);
    expect(JSON.stringify(j)).not.toContain("Main St");
    expect(JSON.stringify(j)).not.toContain("+1204");
  });
  it("404s for a job that isn't set to collect payment on site, and for unknown tokens", async () => {
    expect((await call("/pay/payostoken02")).status).toBe(404);
    expect((await call("/pay/nope-not-a-token")).status).toBe(404);
  });
  it("fails closed (503) when Stripe isn't configured", async () => {
    expect((await call("/pay/payostoken01/intent", { method: "POST" })).status).toBe(503);
  });
});

describe("invoice follows the job's final price before charging", () => {
  it("brings a stale estimate invoice up to the completed job's total", async () => {
    const inv = await syncInvoiceToBooking(A, "bk-os");
    expect(inv?.total).toBe(179.2);
    expect(inv?.amount).toBe(160);
    expect(inv?.tax).toBe(19.2);
  });
  it("creates the invoice when the job never had one", async () => {
    const inv = await syncInvoiceToBooking(A, "bk-new");
    expect(inv?.total).toBe(336);
    expect(inv?.number.startsWith("INV-")).toBe(true);
  });
});

describe("technician pay link", () => {
  it("gives the assigned technician the URL and a QR code", async () => {
    const res = await call("/payments/link/bk-os", { company: A, user: "u-tech", role: "rider", method: "POST", body: {} });
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.url).toMatch(/\/pay\/payostoken01$/);
    expect(j.qr.startsWith("data:image/png;base64,")).toBe(true);
    expect(j.total).toBe(179.2);
    expect(j.canText).toBe(true);
  });
  it("hides the job from a technician it isn't assigned to", async () => {
    expect((await call("/payments/link/bk-os", { company: A, user: "u-other", role: "rider", method: "POST", body: {} })).status).toBe(404);
  });
  it("refuses jobs not set up for on-site payment", async () => {
    expect((await call("/payments/link/bk-no", { company: A, user: "u-admin", role: "admin", method: "POST", body: {} })).status).toBe(409);
  });
});
