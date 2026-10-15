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
  subscriptions: {
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

const { ensureSubscriptionPrice, createSignupSetup, startTrialSubscription, mapStatus, _resetBillingCache, PRICE_LOOKUP_KEY } =
  await import("../billing-subscription");
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
