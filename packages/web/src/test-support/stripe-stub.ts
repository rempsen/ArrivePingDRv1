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
/** The stub client: resource -> method -> handler, e.g. client.subscriptions.create. */
export type StripeStubClient = Record<string, Record<string, (...args: any[]) => Promise<any>>>;

const DAY = 86_400;
const nowSec = () => Math.floor(Date.now() / 1000);

class StripeStub {
  /** Every Stripe call made, in order. */
  readonly calls: StripeCall[] = [];
  /** What prices.list finds; null = none, so the price gets created. */
  existingPrice: { id: string } | null = null;
  /** What setupIntents.retrieve returns (spread over `{ id: "seti_1" }`). */
  setupState: SetupState;
  /** When set, subscriptions.create throws this message (a declined card). */
  subCreateError: string | null = null;
  /** What subscriptions.list returns; a function so a test can change it between checks. */
  subList: () => any[] = () => [];
  /** Milliseconds subscriptions.create waits before answering (to force a race). */
  subCreateDelay = 0;
  /** The stub client itself, for a test that needs to override one method for a moment. */
  readonly client: StripeStubClient;

  constructor(
    private readonly companyId: string,
    private readonly customerId: string,
  ) {
    this.setupState = this.defaultSetup();
    this.client = this.buildClient();
  }

  /** Forget the calls so far, to assert on what one step did. */
  clearCalls() {
    this.calls.length = 0;
  }

  /** Back to the defaults; call from beforeEach. */
  reset() {
    this.clearCalls();
    this.existingPrice = null;
    this.setupState = this.defaultSetup();
    this.subCreateError = null;
    this.subList = () => [];
    this.subCreateDelay = 0;
  }

  private defaultSetup(): SetupState {
    return { status: "succeeded", customer: this.customerId, payment_method: "pm_1" };
  }

  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });
  }

  private trialing() {
    return {
      id: "sub_1",
      customer: this.customerId,
      status: "trialing",
      trial_end: nowSec() + 10 * DAY,
      cancel_at_period_end: false,
      items: { data: [{ id: "si_1", quantity: 3 }] },
      metadata: { companyId: this.companyId },
    };
  }

  private buildClient(): StripeStubClient {
    const rec = (method: string, args: unknown[]) => this.record(method, args);
    return {
      prices: {
        list: async (...args) => (rec("prices.list", args), { data: this.existingPrice ? [this.existingPrice] : [] }),
        create: async (...args) => (rec("prices.create", args), { id: "price_new" }),
      },
      products: { create: async (...args) => (rec("products.create", args), { id: "prod_new" }) },
      customers: {
        create: async (...args) => (rec("customers.create", args), { id: this.customerId }),
        update: async (...args) => (rec("customers.update", args), {}),
        retrieve: async (...args) => (rec("customers.retrieve", args), { id: this.customerId, invoice_settings: { default_payment_method: null } }),
        listPaymentMethods: async (...args) => (rec("customers.listPaymentMethods", args), { data: [] }),
      },
      setupIntents: {
        create: async (...args) => (rec("setupIntents.create", args), { id: "seti_1", client_secret: "seti_1_secret" }),
        retrieve: async (...args) => (rec("setupIntents.retrieve", args), { id: "seti_1", ...this.setupState }),
      },
      subscriptionItems: { update: async (...args) => (rec("subscriptionItems.update", args), {}) },
      subscriptions: {
        retrieve: async (...args) => (rec("subscriptions.retrieve", args), this.trialing()),
        update: async (...args) => (
          rec("subscriptions.update", args),
          { ...this.trialing(), cancel_at_period_end: args[1]?.cancel_at_period_end ?? false }
        ),
        list: async (...args) => (rec("subscriptions.list", args), { data: this.subList() }),
        // A trial request makes a trialing subscription; anything else is charged now and comes back active.
        create: async (...args) => {
          rec("subscriptions.create", args);
          if (this.subCreateDelay) await new Promise((r) => setTimeout(r, this.subCreateDelay));
          if (this.subCreateError) throw new Error(this.subCreateError);
          const params = args[0];
          return params?.trial_period_days === undefined
            ? { id: "sub_act", status: "active", created: 200, latest_invoice: "in_act", trial_end: null, items: { data: [{ id: "si_act", quantity: params.items[0].quantity }] }, metadata: { companyId: params.metadata.companyId } }
            : { id: "sub_1", customer: this.customerId, status: "trialing", trial_end: nowSec() + 30 * DAY, items: { data: [{ id: "si_1", quantity: 1 }] }, metadata: { companyId: params.metadata.companyId } };
        },
        cancel: async (...args) => (rec("subscriptions.cancel", args), {}),
      },
      invoices: {
        retrieve: async (...args) => (rec("invoices.retrieve", args), { id: args[0], payments: { data: [{ payment: { payment_intent: "pi_dup" } }] } }),
      },
      refunds: { create: async (...args) => (rec("refunds.create", args), { id: "re_1" }) },
    };
  }
}

export function installStripeStub(opts: { companyId: string; customerId?: string }) {
  const stripe = new StripeStub(opts.companyId, opts.customerId ?? "cus_1");
  beforeAll(() => {
    mock.module("../services/stripe", () => ({ ...realStripe, getStripe: () => stripe.client, stripeEnabled: true }));
  });
  afterAll(() => {
    mock.module("../services/stripe", () => realStripe);
  });
  return stripe;
}
