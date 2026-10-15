/**
 * ArrivePing's own subscription billing for self-serve tenants, on the
 * PLATFORM Stripe account (not Stripe Connect, which is how tenants charge
 * their customers; see stripe-connect.ts).
 *
 * The deal, as sold on /get-started: 30 days free with as many users as you
 * like, card on file, cancel before day 30 and you're never charged. After
 * that, the public price list (web/site/config.ts): $49 base covering the
 * first 2 drivers, $30 per driver for drivers 3–29, $25 per driver from 30.
 *
 * Modelled as ONE graduated-tier price whose quantity is the driver count,
 * so Stripe does the band maths and the invoice matches monthlyPrice() in
 * config.ts to the cent:
 *   tier 1: up to 2   → $49 flat, $0/unit
 *   tier 2: up to 29  → $30/unit
 *   tier 3: 30+       → $25/unit
 * Seats are re-counted right before each invoice (`invoice.upcoming`
 * webhook), never pro-rated mid-month, so a tenant pays for the drivers
 * they have on the day they're billed.
 *
 * Nothing here throws into the signup path: a Stripe failure is reported to
 * the caller as a typed result so the form can show it.
 */
import type Stripe from "stripe";
import { and, count, eq } from "drizzle-orm";
import { db, sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { getStripe, stripeEnabled } from "./stripe";
import { log } from "../api/lib/logger";
import { pricingBands, STARTER_PRICE, STARTER_DRIVERS } from "../web/site/config";

export const TRIAL_DAYS = 30;
/** Stable handle for the price in Stripe, so it is created once and found again. */
export const PRICE_LOOKUP_KEY = "arriveping_monthly_per_driver_v1";
const PRODUCT_NAME = "ArrivePing";

export type BillingStatus = "none" | "trialing" | "active" | "past_due" | "canceled" | "unpaid";

let cachedPriceId: string | null = null;

/**
 * The subscription price, created on first use from the public price list.
 * STRIPE_SUBSCRIPTION_PRICE_ID overrides it (e.g. a price made by hand in
 * the dashboard). Idempotent: looks the price up by lookup key first.
 */
export async function ensureSubscriptionPrice(): Promise<string> {
  const override = process.env.STRIPE_SUBSCRIPTION_PRICE_ID?.trim();
  if (override) return override;
  if (cachedPriceId) return cachedPriceId;
  const stripe = getStripe();
  const found = await stripe.prices.list({ lookup_keys: [PRICE_LOOKUP_KEY], active: true, limit: 1 });
  if (found.data[0]) {
    cachedPriceId = found.data[0].id;
    return cachedPriceId;
  }
  const product = await stripe.products.create({
    name: PRODUCT_NAME,
    description: "Dispatch, live technician tracking and customer arrival pages. Billed monthly per driver.",
    metadata: { source: "arriveping-self-serve" },
  });
  const [growing, fleet] = pricingBands;
  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    lookup_key: PRICE_LOOKUP_KEY,
    nickname: "ArrivePing monthly, graduated per driver",
    recurring: { interval: "month", usage_type: "licensed" },
    billing_scheme: "tiered",
    tiers_mode: "graduated",
    tiers: [
      { up_to: STARTER_DRIVERS, flat_amount: STARTER_PRICE * 100, unit_amount: 0 },
      { up_to: growing.to, unit_amount: growing.rate * 100 },
      { up_to: "inf", unit_amount: fleet.rate * 100 },
    ],
    metadata: { source: "arriveping-self-serve" },
  });
  cachedPriceId = price.id;
  log.info("billing: created subscription price", { priceId: price.id, productId: product.id });
  return price.id;
}

/** Test-only. */
export function _resetBillingCache() {
  cachedPriceId = null;
}

/**
 * Step 1 of signup billing: a Customer and a SetupIntent so the card can be
 * saved (not charged) in the browser with Payment Element. The customer is
 * marked pending until signup completes; abandoned ones are just inert
 * customers in Stripe.
 */
export async function createSignupSetup(input: { email: string; name: string; companyName: string; phone?: string }) {
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: input.email,
    name: input.companyName || input.name,
    phone: input.phone || undefined,
    metadata: { source: "arriveping-self-serve", signup: "pending", contactName: input.name },
  });
  const setup = await stripe.setupIntents.create({
    customer: customer.id,
    usage: "off_session",
    automatic_payment_methods: { enabled: true },
    metadata: { source: "arriveping-self-serve" },
  });
  return { customerId: customer.id, setupIntentId: setup.id, clientSecret: setup.client_secret! };
}

export type StartTrialResult =
  | { ok: true; subscriptionId: string; customerId: string; trialEndsAt: Date; status: BillingStatus }
  | { ok: false; message: string };

/**
 * Step 2, on signup submit: confirm the card was saved, make it the default,
 * and start the subscription with a 30-day trial. If the card is gone by the
 * end of the trial, Stripe cancels rather than leaving an unpaid account.
 */
export async function startTrialSubscription(input: {
  customerId: string;
  setupIntentId: string;
  companyId: string;
  companyName: string;
  seats?: number;
}): Promise<StartTrialResult> {
  const stripe = getStripe();
  const setup = await stripe.setupIntents.retrieve(input.setupIntentId);
  const customerOf = typeof setup.customer === "string" ? setup.customer : setup.customer?.id;
  if (customerOf !== input.customerId) return { ok: false, message: "That payment setup doesn't belong to this signup." };
  if (setup.status !== "succeeded" || !setup.payment_method) {
    return { ok: false, message: "We couldn't save your card. Please check the details and try again." };
  }
  const pm = typeof setup.payment_method === "string" ? setup.payment_method : setup.payment_method.id;

  await stripe.customers.update(input.customerId, {
    name: input.companyName,
    invoice_settings: { default_payment_method: pm },
    metadata: { signup: "complete", companyId: input.companyId },
  });
  const priceId = await ensureSubscriptionPrice();
  const sub = await stripe.subscriptions.create(
    {
      customer: input.customerId,
      items: [{ price: priceId, quantity: Math.max(1, input.seats ?? 1) }],
      trial_period_days: TRIAL_DAYS,
      default_payment_method: pm,
      collection_method: "charge_automatically",
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      // No proration: seats are set right before each invoice, not mid-cycle.
      proration_behavior: "none",
      metadata: { companyId: input.companyId, source: "arriveping-self-serve" },
    },
    { idempotencyKey: `signup-sub-${input.customerId}` },
  );
  const trialEndsAt = new Date((sub.trial_end ?? Math.floor(Date.now() / 1000) + TRIAL_DAYS * 86400) * 1000);
  return { ok: true, subscriptionId: sub.id, customerId: input.customerId, trialEndsAt, status: mapStatus(sub.status) };
}

/** Undo a subscription when provisioning failed after it was created. */
export async function cancelSubscriptionQuietly(subscriptionId: string) {
  try {
    await getStripe().subscriptions.cancel(subscriptionId, { prorate: false });
  } catch (e) {
    log.warn("billing: could not cancel subscription after failed signup", { subscriptionId, err: (e as Error).message });
  }
}

export function mapStatus(s: Stripe.Subscription.Status): BillingStatus {
  switch (s) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "unpaid":
      return "unpaid";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "none"; // incomplete, paused
  }
}

/** Drivers that count as seats: riders whose approval is active (not invited, pending or suspended). */
export async function driverSeatCount(companyId: string): Promise<number> {
  const [row] = await sdb
    .select({ n: count() })
    .from(schema.riders)
    .where(and(eq(schema.riders.companyId, companyId), eq(schema.riders.approval, "active")));
  return Number(row?.n ?? 0);
}

/**
 * Put the current driver count on the subscription so the next invoice bills
 * it. Called from the `invoice.upcoming` webhook (a few days before each
 * renewal, and before the trial ends) and from the daily sweep as a backstop.
 */
export async function syncSeats(companyId: string): Promise<{ seats: number; updated: boolean }> {
  const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  if (!co?.billingSubscriptionId || !stripeEnabled) return { seats: 0, updated: false };
  const seats = Math.max(1, await driverSeatCount(companyId));
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(co.billingSubscriptionId);
  const item = sub.items.data[0];
  if (!item) return { seats, updated: false };
  if (item.quantity !== seats && !["canceled", "incomplete_expired"].includes(sub.status)) {
    await stripe.subscriptionItems.update(item.id, { quantity: seats, proration_behavior: "none" });
  }
  await db.update(schema.companies).set({ billingSeats: seats }).where(eq(schema.companies.id, companyId));
  return { seats, updated: item.quantity !== seats };
}

/** Mirror a subscription's state onto its company (from webhooks). */
export async function applySubscriptionState(sub: Stripe.Subscription): Promise<string | null> {
  const companyId = sub.metadata?.companyId;
  const [co] = companyId
    ? await db.select().from(schema.companies).where(eq(schema.companies.id, companyId))
    : await db.select().from(schema.companies).where(eq(schema.companies.billingSubscriptionId, sub.id));
  if (!co) return null;
  await db
    .update(schema.companies)
    .set({
      billingStatus: mapStatus(sub.status),
      billingTrialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : co.billingTrialEndsAt,
      billingSeats: sub.items.data[0]?.quantity ?? co.billingSeats,
    })
    .where(eq(schema.companies.id, co.id));
  return co.id;
}

/** Company id for a Stripe customer, for events that carry no metadata. */
export async function companyForCustomer(customerId: string): Promise<string | null> {
  const [co] = await db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.billingCustomerId, customerId));
  return co?.id ?? null;
}
