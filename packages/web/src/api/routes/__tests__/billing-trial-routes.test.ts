/**
 * POST /billing/trial and /billing/trial/confirm: a demo starts the 30-day free
 * trial and is converted to a customer in the same step.
 * Real handlers and a real pglite DB; Stripe is a stub that records its calls.
 * Ids prefixed "bt-".
 */
import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { Hono } from "hono";
import { PgTable } from "drizzle-orm/pg-core";
import { and, eq } from "drizzle-orm";
import type { AppEnv } from "../../env";
import { AppError } from "../../lib/errors";
import { installStripeStub } from "../../../test-support/stripe-stub";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.RESEND_API_KEY = "";
process.env.TWILIO_AUTH_TOKEN = "";

const DEMO = "bt-demo";
const CUSTOMER = "bt-customer";
const stripe = installStripeStub({ companyId: DEMO, customerId: "cus_bt" });

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { ensureTables } = await import("../../../test-support/tables");
const { billingRoutes } = await import("../billing");
const { seedSampleDay } = await import("../../../services/sample-day");
const { setTenantKind } = await import("../../../services/tenant-kind");

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", c.req.header("X-Test-Company") || DEMO);
  const role = c.req.header("X-Test-Role") || "admin";
  c.set("user", { id: "bt-admin", role, email: "bt-admin@t.test", name: "Bt Admin" });
  return next();
});
app.route("/billing", billingRoutes);
// As in production: a thrown AppError (validation, 401) becomes its own status code.
app.onError((err, c) => (err instanceof AppError ? c.json({ error: { code: err.code } }, err.status as 400) : c.json({ error: { code: "internal" } }, 500)));

function call(path: string, opts: { company?: string; role?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.company) headers["X-Test-Company"] = opts.company;
  if (opts.role) headers["X-Test-Role"] = opts.role;
  return app.request(path, { method: "POST", headers, body: JSON.stringify(opts.body ?? {}) });
}

const company = async (id: string) => (await db.select().from(schema.companies).where(eq(schema.companies.id, id)))[0]!;
const sampleRiders = async () =>
  db.select().from(schema.riders).where(and(eq(schema.riders.companyId, DEMO), eq(schema.riders.isSample, true)));
const subscriptionsCreated = () => stripe.calls.filter((c) => c.method === "subscriptions.create").length;

beforeAll(async () => {
  await ensureTables(...(Object.values(schema).filter((v) => v instanceof PgTable) as PgTable[]));
});

beforeEach(async () => {
  stripe.reset();
  const sql = (db as any).$client;
  for (const t of ["bookings", "riders", "memberships", "services", "customers", "audit_log", "platform_audit_log", '"user"']) {
    await sql.execute(`DELETE FROM ${t} WHERE company_id IN ('${DEMO}','${CUSTOMER}')`).catch(() => null);
  }
  await sql.execute(`DELETE FROM companies WHERE id IN ('${DEMO}','${CUSTOMER}')`);
  await sql.execute({ sql: "INSERT INTO companies (id, name, contact_email, plan) VALUES (?,?,?,?)", args: [DEMO, "Bow River Heating", "owner@bowriver.test", "pro"] });
  await sql.execute({ sql: "INSERT INTO companies (id, name, contact_email, plan) VALUES (?,?,?,?)", args: [CUSTOMER, "Real Customer", "owner@real.test", "pro"] });
  await sql.execute({ sql: "INSERT INTO company_settings (id, company_id) VALUES (?,?)", args: [`${DEMO}-s`, DEMO] }).catch(() => null);
  await setTenantKind(DEMO, "demo");
  await db.update(schema.companies).set({ demoExpiresAt: new Date(Date.now() + 30 * 86_400_000) }).where(eq(schema.companies.id, DEMO));
  await seedSampleDay(DEMO);
});

describe("POST /billing/trial", () => {
  it("gives a demo admin a card form and nothing else", async () => {
    const res = await call("/billing/trial");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ clientSecret: "seti_1_secret", setupIntentId: "seti_1" });
    expect(subscriptionsCreated()).toBe(0);
    expect((await company(DEMO)).kind).toBe("demo");
  });

  it("is only for a demo", async () => {
    const res = await call("/billing/trial", { company: CUSTOMER });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("only be started from a demo");
  });

  it("is for admins: a technician is turned away", async () => {
    expect((await call("/billing/trial", { role: "rider" })).status).toBe(403);
  });
});

describe("POST /billing/trial/confirm", () => {
  // As the card form does: ask for the setup (which puts a Stripe customer on file), then confirm it.
  const confirm = async (opts: { company?: string; role?: string } = {}) => {
    await call("/billing/trial", opts);
    return call("/billing/trial/confirm", { ...opts, body: { setupIntentId: "seti_1" } });
  };

  it("starts the trial and turns the demo into a customer with its sample day cleared", async () => {
    expect((await sampleRiders()).length).toBeGreaterThan(0);
    const res = await confirm();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "trialing" });

    const sub = stripe.calls.find((c) => c.method === "subscriptions.create")!.args[0] as any;
    expect(sub.trial_period_days).toBe(30);
    expect(sub.metadata).toEqual({ companyId: DEMO, source: "arriveping-demo-trial" });

    const co = await company(DEMO);
    expect(co).toMatchObject({ kind: "customer", isInternal: false, demoExpiresAt: null, billingSubscriptionId: "sub_1", billingStatus: "trialing" });
    expect((await sampleRiders()).length).toBe(0);
  });

  it("is harmless to repeat: no second subscription, still 200", async () => {
    expect((await confirm()).status).toBe(200);
    expect((await confirm()).status).toBe(200);
    expect(subscriptionsCreated()).toBe(1);
    expect((await company(DEMO)).kind).toBe("customer");
  });

  it("finishes the conversion when the trial exists but the demo was never converted", async () => {
    await db.update(schema.companies).set({ billingSubscriptionId: "sub_1", billingCustomerId: "cus_bt", billingStatus: "trialing" }).where(eq(schema.companies.id, DEMO));
    const res = await confirm();
    expect(res.status).toBe(200);
    expect(subscriptionsCreated()).toBe(0);
    expect(await company(DEMO)).toMatchObject({ kind: "customer", demoExpiresAt: null });
    expect((await sampleRiders()).length).toBe(0);
  });

  it("leaves the demo alone when the card can't be saved", async () => {
    stripe.setupState = { status: "requires_payment_method", customer: "cus_bt", payment_method: null };
    const res = await confirm();
    expect(res.status).toBe(402);
    expect(subscriptionsCreated()).toBe(0);
    expect((await company(DEMO)).kind).toBe("demo");
    expect((await sampleRiders()).length).toBeGreaterThan(0);
  });

  it("is only for a demo, and never touches a customer", async () => {
    const res = await confirm({ company: CUSTOMER });
    expect(res.status).toBe(400);
    expect(subscriptionsCreated()).toBe(0);
    expect((await company(CUSTOMER)).kind).toBe("customer");
  });

  it("is for admins: a technician is turned away", async () => {
    expect((await confirm({ role: "rider" })).status).toBe(403);
    expect(subscriptionsCreated()).toBe(0);
  });

  it("rejects a body without a setup intent id", async () => {
    const res = await call("/billing/trial/confirm", { body: {} });
    expect(res.status).toBe(400);
    expect(subscriptionsCreated()).toBe(0);
  });
});
