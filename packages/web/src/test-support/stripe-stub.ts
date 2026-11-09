/**
 * Test-only: a recording stand-in for the Stripe client, for the billing tests
 * (services/billing-subscription and the billing routes). No network.
 *
 *   const stripe = installStripeStub({ companyId: "my-co" });
 *   beforeEach(() => stripe.reset());
 *   // stripe.setupState = {...}; stripe.subList = () => [...]; stripe.calls.find(...)
 *
 * It swaps the `services/stripe` module for the stub around the calling file's
 * tests only: mock.module is process-wide and rewrites the module for every
 * importer, so it is installed in beforeAll and the real module put back in
 * afterAll. Import the code under test with a dynamic `await import(...)` at
 * the top of the file (after installStripeStub), as the billing tests do.
 */
import { beforeAll, afterAll, mock } from "bun:test";

// Snapshot the real module before any file installs the stub.
const realStripe = { ...(await import("../services/stripe")) };

export type StripeCall = { method: string; args: unknown[] };
export type SetupState = { status: string; customer: string; payment_method: string | null };

const DAY = 86_400;

/** The stub client: resource -> method -> handler, e.g. client.subscriptions.create. */
export type StripeStubClient = Record<string, Record<string, (...args: any[]) => Promise<any>>>;

export function installStripeStub(opts: { companyId: string; customerId?: string }) {
  const customerId = opts.customerId ?? "cus_1";
  const companyId = opts.companyId;
  const nowSec = () => Math.floor(Date.now() / 1000);
  const defaultSetup = (): SetupState => ({ status: "succeeded", customer: customerId, payment_method: "pm_1" });

  const calls: StripeCall[] = [];
  const stripe = {
    /** The stub client itself, for a test that needs to override one method for a moment. */
    client: undefined as unknown as StripeStubClient,
    /** Every Stripe call made, in order. Cleared (same array) by clearCalls() and reset(). */
    calls,
    /** What prices.list finds; null = none, so the price gets created. */
    existingPrice: null as { id: string } | null,
    /** What setupIntents.retrieve returns (spread over `{ id: "seti_1" }`). */
    setupState: defaultSetup(),
    /** When set, subscriptions.create throws this message (a declined card). */
    subCreateError: null as string | null,
    /** What subscriptions.list returns; a function so a test can change it between checks. */
    subList: (() => []) as () => any[],
    /** Milliseconds subscriptions.create waits before answering (to force a race). */
    subCreateDelay: 0,
    /** Forget the calls so far, to assert on what one step did. */
    clearCalls() {
      calls.length = 0;
    },
    /** Back to the defaults; call from beforeEach. */
    reset() {
      stripe.clearCalls();
      stripe.existingPrice = null;
      stripe.setupState = defaultSetup();
      stripe.subCreateError = null;
      stripe.subList = () => [];
      stripe.subCreateDelay = 0;
    },
  };

  const record = (method: string, args: unknown[]) => calls.push({ method, args });
  const trialing = () => ({
    id: "sub_1",
    customer: customerId,
    status: "trialing",
    trial_end: nowSec() + 10 * DAY,
    cancel_at_period_end: false,
    items: { data: [{ id: "si_1", quantity: 3 }] },
    metadata: { companyId },
  });

  const stub = {
    prices: {
      list: async (...args: unknown[]) => (record("prices.list", args), { data: stripe.existingPrice ? [stripe.existingPrice] : [] }),
      create: async (...args: unknown[]) => (record("prices.create", args), { id: "price_new" }),
    },
    products: { create: async (...args: unknown[]) => (record("products.create", args), { id: "prod_new" }) },
    customers: {
      create: async (...args: unknown[]) => (record("customers.create", args), { id: customerId }),
      update: async (...args: unknown[]) => (record("customers.update", args), {}),
      retrieve: async (...args: unknown[]) => (record("customers.retrieve", args), { id: customerId, invoice_settings: { default_payment_method: null } }),
      listPaymentMethods: async (...args: unknown[]) => (record("customers.listPaymentMethods", args), { data: [] }),
    },
    setupIntents: {
      create: async (...args: unknown[]) => (record("setupIntents.create", args), { id: "seti_1", client_secret: "seti_1_secret" }),
      retrieve: async (...args: unknown[]) => (record("setupIntents.retrieve", args), { id: "seti_1", ...stripe.setupState }),
    },
    subscriptionItems: { update: async (...args: unknown[]) => (record("subscriptionItems.update", args), {}) },
    subscriptions: {
      retrieve: async (...args: unknown[]) => (record("subscriptions.retrieve", args), trialing()),
      update: async (...args: unknown[]) => (
        record("subscriptions.update", args),
        { ...trialing(), cancel_at_period_end: (args[1] as any)?.cancel_at_period_end ?? false }
      ),
      list: async (...args: unknown[]) => (record("subscriptions.list", args), { data: stripe.subList() }),
      // A trial request makes a trialing subscription; anything else is charged now and comes back active.
      create: async (...args: unknown[]) => {
        record("subscriptions.create", args);
        if (stripe.subCreateDelay) await new Promise((r) => setTimeout(r, stripe.subCreateDelay));
        if (stripe.subCreateError) throw new Error(stripe.subCreateError);
        const params = args[0] as any;
        return params?.trial_period_days === undefined
          ? { id: "sub_act", status: "active", created: 200, latest_invoice: "in_act", trial_end: null, items: { data: [{ id: "si_act", quantity: params.items[0].quantity }] }, metadata: { companyId: params.metadata.companyId } }
          : { id: "sub_1", customer: customerId, status: "trialing", trial_end: nowSec() + 30 * DAY, items: { data: [{ id: "si_1", quantity: 1 }] }, metadata: { companyId: params.metadata.companyId } };
      },
      cancel: async (...args: unknown[]) => (record("subscriptions.cancel", args), {}),
    },
    invoices: {
      retrieve: async (...args: unknown[]) => (record("invoices.retrieve", args), { id: args[0], payments: { data: [{ payment: { payment_intent: "pi_dup" } }] } }),
    },
    refunds: { create: async (...args: unknown[]) => (record("refunds.create", args), { id: "re_1" }) },
  };

  stripe.client = stub;

  beforeAll(() => {
    mock.module("../services/stripe", () => ({ ...realStripe, getStripe: () => stub, stripeEnabled: true }));
  });
  afterAll(() => {
    mock.module("../services/stripe", () => realStripe);
  });

  return stripe;
}
