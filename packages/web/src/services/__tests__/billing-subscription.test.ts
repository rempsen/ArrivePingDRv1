/**
 * Self-serve subscription billing: the Stripe price mirrors the public price
 * list, the trial is 30 days on the saved card, and failures come back as
 * results rather than exceptions. Stripe is a stub; no network.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, mock } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

type Call = { method: string; args: unknown[] };
let calls: Call[] = [];
let existingPrice: { id: string } | null = null;
let setupState: { status: string; customer: string; payment_method: string | null } = { status: "succeeded", customer: "cus_1", payment_method: "pm_1" };

const stripeStub = {
  prices: {
    list: async (...args: unknown[]) => (calls.push({ method: "prices.list", args }), { data: existingPrice ? [existingPrice] : [] }),
    create: async (...args: unknown[]) => (calls.push({ method: "prices.create", args }), { id: "price_new" }),
  },
  products: { create: async (...args: unknown[]) => (calls.push({ method: "products.create", args }), { id: "prod_new" }) },
  customers: {
    create: async (...args: unknown[]) => (calls.push({ method: "customers.create", args }), { id: "cus_1" }),
    update: async (...args: unknown[]) => (calls.push({ method: "customers.update", args }), {}),
  },
  setupIntents: {
    create: async (...args: unknown[]) => (calls.push({ method: "setupIntents.create", args }), { id: "seti_1", client_secret: "seti_1_secret" }),
    retrieve: async (...args: unknown[]) => (calls.push({ method: "setupIntents.retrieve", args }), { id: "seti_1", ...setupState }),
  },
  subscriptionItems: { update: async (...args: unknown[]) => (calls.push({ method: "subscriptionItems.update", args }), {}) },
  subscriptions: {
    retrieve: async (...args: unknown[]) => (
      calls.push({ method: "subscriptions.retrieve", args }),
      { id: "sub_1", status: "trialing", trial_end: Math.floor(Date.now() / 1000) + 10 * 86400, cancel_at_period_end: false, items: { data: [{ id: "si_1", quantity: 3 }] }, metadata: { companyId: CO } }
    ),
    update: async (...args: unknown[]) => (
      calls.push({ method: "subscriptions.update", args }),
      { id: "sub_1", status: "trialing", trial_end: Math.floor(Date.now() / 1000) + 10 * 86400, cancel_at_period_end: (args[1] as any)?.cancel_at_period_end ?? false, items: { data: [{ id: "si_1", quantity: 3 }] }, metadata: { companyId: CO } }
    ),
    create: async (...args: unknown[]) => (
      calls.push({ method: "subscriptions.create", args }),
      { id: "sub_1", status: "trialing", trial_end: Math.floor(Date.now() / 1000) + 30 * 86400, items: { data: [{ id: "si_1", quantity: 1 }] } }
    ),
    cancel: async (...args: unknown[]) => (calls.push({ method: "subscriptions.cancel", args }), {}),
  },
};

// mock.module is process-wide and rewrites the module for every importer, so
// (as payments-webhook.test.ts does) install it only around this file's tests
// and put the real module back afterwards.
const realStripe = { ...(await import("../stripe")) };
beforeAll(() => {
  mock.module("../stripe", () => ({ ...realStripe, getStripe: () => stripeStub, stripeEnabled: true }));
});
afterAll(() => {
  mock.module("../stripe", () => realStripe);
});

const { ensureSubscriptionPrice, createSignupSetup, startTrialSubscription, mapStatus, _resetBillingCache, PRICE_LOOKUP_KEY, setSeats, syncSeats, closeAccount, cancelAtPeriodEnd } =
  await import("../billing-subscription");
const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { getTableConfig } = await import("drizzle-orm/pg-core");
const { eq } = await import("drizzle-orm");

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
const CO = "billtest-co";
beforeAll(async () => {
  const sql = (db as any).$client;
  for (const t of [schema.companies, schema.riders, schema.user, schema.memberships]) await sql.execute(ddlFor(t));
  await sql.execute({
    sql: "INSERT OR IGNORE INTO companies (id, name, billing_customer_id, billing_subscription_id, billing_status, billing_seats) VALUES (?,?,?,?,?,?)",
    args: [CO, "Bill Test Co", "cus_1", "sub_1", "trialing", 3],
  });
});
const { monthlyPrice } = await import("../../web/site/config");

beforeEach(() => {
  calls = [];
  existingPrice = null;
  setupState = { status: "succeeded", customer: "cus_1", payment_method: "pm_1" };
  _resetBillingCache();
  delete process.env.STRIPE_SUBSCRIPTION_PRICE_ID;
});

describe("ensureSubscriptionPrice", () => {
  it("creates one graduated price that matches the public price list, then reuses it", async () => {
    const id = await ensureSubscriptionPrice();
    expect(id).toBe("price_new");
    const create = calls.find((c) => c.method === "prices.create")!.args[0] as any;
    expect(create.lookup_key).toBe(PRICE_LOOKUP_KEY);
    expect(create.recurring).toEqual({ interval: "month", usage_type: "licensed" });
    expect(create.tiers_mode).toBe("graduated");
    expect(create.tiers).toEqual([
      { up_to: 2, flat_amount: 4900, unit_amount: 0 },
      { up_to: 29, unit_amount: 3000 },
      { up_to: "inf", unit_amount: 2500 },
    ]);
    // Stripe's graduated maths on these tiers equals monthlyPrice() for every fleet size we quote.
    const stripeTotal = (n: number) => 49 + Math.max(0, Math.min(n, 29) - 2) * 30 + Math.max(0, n - 29) * 25;
    for (const n of [1, 2, 3, 10, 29, 30, 50, 100]) expect(stripeTotal(n)).toBe(monthlyPrice(n).total);

    calls = [];
    expect(await ensureSubscriptionPrice()).toBe("price_new");
    expect(calls).toHaveLength(0); // cached
  });

  it("finds an existing price by lookup key instead of creating another", async () => {
    existingPrice = { id: "price_existing" };
    expect(await ensureSubscriptionPrice()).toBe("price_existing");
    expect(calls.map((c) => c.method)).toEqual(["prices.list"]);
  });

  it("STRIPE_SUBSCRIPTION_PRICE_ID overrides everything", async () => {
    process.env.STRIPE_SUBSCRIPTION_PRICE_ID = "price_manual";
    expect(await ensureSubscriptionPrice()).toBe("price_manual");
    expect(calls).toHaveLength(0);
  });
});

describe("signup billing", () => {
  it("setup creates a pending customer and an off-session SetupIntent", async () => {
    const r = await createSignupSetup({ email: "a@b.co", name: "Ann Lee", companyName: "Acme HVAC", phone: "204-555-0100" });
    expect(r).toEqual({ customerId: "cus_1", setupIntentId: "seti_1", clientSecret: "seti_1_secret" });
    const cust = calls.find((c) => c.method === "customers.create")!.args[0] as any;
    expect(cust.metadata.signup).toBe("pending");
    expect(cust.name).toBe("Acme HVAC");
    const si = calls.find((c) => c.method === "setupIntents.create")!.args[0] as any;
    expect(si.usage).toBe("off_session");
  });

  it("starts a 30-day trial on the saved card, cancelling if the card goes missing", async () => {
    existingPrice = { id: "price_existing" };
    const r = await startTrialSubscription({ customerId: "cus_1", setupIntentId: "seti_1", companyId: "acme-hvac", companyName: "Acme HVAC" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.subscriptionId).toBe("sub_1");
    expect(r.status).toBe("trialing");
    expect(r.trialEndsAt.getTime() - Date.now()).toBeGreaterThan(29 * 86400_000);
    const sub = calls.find((c) => c.method === "subscriptions.create")!;
    const body = sub.args[0] as any;
    expect(body.trial_period_days).toBe(30);
    expect(body.default_payment_method).toBe("pm_1");
    expect(body.items).toEqual([{ price: "price_existing", quantity: 1 }]);
    expect(body.trial_settings).toEqual({ end_behavior: { missing_payment_method: "cancel" } });
    expect(body.metadata.companyId).toBe("acme-hvac");
    expect((sub.args[1] as any).idempotencyKey).toBe("signup-sub-cus_1");
    const cu = calls.find((c) => c.method === "customers.update")!.args[1] as any;
    expect(cu.invoice_settings.default_payment_method).toBe("pm_1");
  });

  it("refuses a setup that isn't finished or isn't this customer's", async () => {
    setupState = { status: "requires_payment_method", customer: "cus_1", payment_method: null };
    const r1 = await startTrialSubscription({ customerId: "cus_1", setupIntentId: "seti_1", companyId: "x", companyName: "X" });
    expect(r1.ok).toBe(false);
    setupState = { status: "succeeded", customer: "cus_other", payment_method: "pm_9" };
    const r2 = await startTrialSubscription({ customerId: "cus_1", setupIntentId: "seti_1", companyId: "x", companyName: "X" });
    expect(r2.ok).toBe(false);
    expect(calls.some((c) => c.method === "subscriptions.create")).toBe(false);
  });

  it("maps Stripe statuses onto the company's billing status", () => {
    expect(mapStatus("trialing")).toBe("trialing");
    expect(mapStatus("active")).toBe("active");
    expect(mapStatus("past_due")).toBe("past_due");
    expect(mapStatus("canceled")).toBe("canceled");
    expect(mapStatus("incomplete")).toBe("none");
  });
});

describe("tenant self-service", () => {
  it("setSeats puts the chosen user count on the subscription without proration", async () => {
    const r = await setSeats(CO, 5);
    expect(r.seats).toBe(5);
    const u = calls.find((c) => c.method === "subscriptionItems.update")!;
    expect(u.args[0]).toBe("si_1");
    expect(u.args[1]).toEqual({ quantity: 5, proration_behavior: "none" });
    const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, CO));
    expect(co!.billingSeats).toBe(5);
  });

  it("syncSeats never bills fewer than the chosen seats", async () => {
    await setSeats(CO, 4);
    calls = [];
    const r = await syncSeats(CO); // no active drivers in this db
    expect(r.seats).toBe(4);
    expect(calls.find((c) => c.method === "subscriptionItems.update")!.args[1]).toEqual({ quantity: 4, proration_behavior: "none" });
  });

  it("cancel at period end flips the flag and mirrors the state", async () => {
    await cancelAtPeriodEnd(CO, true);
    expect(calls.find((c) => c.method === "subscriptions.update")!.args[1]).toEqual({ cancel_at_period_end: true });
  });

  it("closeAccount cancels now and seals the company", async () => {
    await closeAccount(CO);
    expect(calls.find((c) => c.method === "subscriptions.cancel")!.args[0]).toBe("sub_1");
    const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, CO));
    expect(co!.status).toBe("closed");
    expect(co!.billingStatus).toBe("canceled");
  });
});
