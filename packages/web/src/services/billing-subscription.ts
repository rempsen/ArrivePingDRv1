/**
 * ArrivePing's own subscription billing for self-serve tenants, on the
 * PLATFORM Stripe account (not Stripe Connect, which is how tenants charge
 * their customers; see stripe-connect.ts).
 *
 * The deal, as sold on /get-started: 30 days free with as many users as you
 * like, card on file, cancel before day 30 and you're never charged. After
 * that, the public price list (web/site/config.ts): $49 Starter covering the
 * first 2 licenses, $30 per license for licenses 3–29, $25 per license from 30.
 *
 * Who is billed (billableSeatCounts): every tenant gets the same package,
 * one dispatcher license plus two field licenses for the $49. A second
 * dispatcher, or a manager, is bought exactly like a driver's license. So
 *   billable = active field staff + max(0, active office users - 1)
 * - Field staff: membership role "rider" and active, with an active,
 *   non-sample rider profile (the driver count this file always billed).
 * - Office users: an active membership as admin | manager | dispatcher |
 *   project_manager whose user is not deleted, not platform staff
 *   (superadmin) and not a sample person.
 * The first office user is the included dispatcher license. There is one
 * membership per person per company, so an office user who also has a rider
 * profile (to be assigned jobs) counts once, as office.
 *
 * Modelled as ONE graduated-tier price whose quantity is the license count,
 * so Stripe does the band maths and the invoice matches monthlyPrice() in
 * config.ts to the cent:
 *   tier 1: up to 2   → $49 flat, $0/unit
 *   tier 2: up to 29  → $30/unit
 *   tier 3: 30+       → $25/unit
 * Seats are re-counted right before each invoice (`invoice.upcoming`
 * webhook), never pro-rated mid-month, so a tenant pays for the licenses
 * they have on the day they're billed.
 *
 * Nothing here throws into the signup path: a Stripe failure is reported to
 * the caller as a typed result so the form can show it.
 */
import type Stripe from "stripe";
import { and, count, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import { db, sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { getStripe, stripeEnabled } from "./stripe";
import { log } from "../api/lib/logger";
import { queueCompanySync } from "./hubspot-sync";
import { monthlyPrice, pricingBands, STARTER_PRICE, STARTER_DRIVERS } from "../web/site/config";

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

/* -------------------------------------------------------------------------- */
/*  Who counts as a license (see the header)                                   */
/* -------------------------------------------------------------------------- */

const FIELD_SEAT_ROLE = "rider";
/** Membership roles that are office users. Each active one is a license; the first is included. */
export const OFFICE_SEAT_ROLES = ["admin", "manager", "dispatcher", "project_manager"] as const;
/** Every plan includes one dispatcher license. */
export const INCLUDED_OFFICE_SEATS = 1;
/** User roles that never take a license even with an office membership: gone, or platform staff. */
const NON_BILLABLE_USER_ROLES = ["deleted", "superadmin"];

export type SeatCounts = {
  /** Active field staff (technicians and drivers). */
  field: number;
  /** Active office users (admins, managers, dispatchers, project managers), including the one that's included. */
  office: number;
  /** What the tenant is billed for: field + max(0, office - 1). */
  billable: number;
};

/** The billing rule itself: every field license, plus each office user after the included one. */
export function billableFromCounts(field: number, office: number): number {
  return Math.max(0, field) + Math.max(0, office - INCLUDED_OFFICE_SEATS);
}

/** How many office users can come off before only the included dispatcher license is left. */
export function officeRemovable(office: number): number {
  return Math.max(0, office - INCLUDED_OFFICE_SEATS);
}

// The SQL predicates below and the two JS predicates after them must say the
// same thing: the SQL counts who is active now, the JS decides whether one
// person (e.g. about to be reactivated) would count.
const fieldSeatJoin = and(eq(schema.memberships.userId, schema.riders.userId), eq(schema.memberships.companyId, schema.riders.companyId));
function fieldSeatWhere(companyId: string) {
  return and(
    eq(schema.riders.companyId, companyId),
    eq(schema.riders.approval, "active"),
    eq(schema.riders.isSample, false), // sample-day techs are never billed
    eq(schema.memberships.role, FIELD_SEAT_ROLE),
    eq(schema.memberships.status, "active"),
  );
}
const officeSeatJoin = eq(schema.user.id, schema.memberships.userId);
function officeSeatWhere(companyId: string) {
  return and(
    eq(schema.memberships.companyId, companyId),
    eq(schema.memberships.status, "active"),
    inArray(schema.memberships.role, [...OFFICE_SEAT_ROLES]),
    or(isNull(schema.user.role), notInArray(schema.user.role, NON_BILLABLE_USER_ROLES)),
    eq(schema.user.isSample, false),
  );
}

/** Would this person take a field license once active? (Same rule as fieldSeatWhere.) */
export function isFieldSeat(membershipRole: string | null | undefined, rider: { isSample: boolean } | null | undefined): boolean {
  return membershipRole === FIELD_SEAT_ROLE && !!rider && !rider.isSample;
}

/** Would this person take an office license once active? (Same rule as officeSeatWhere.) */
export function isOfficeSeat(membershipRole: string | null | undefined, user: { role: string | null; isSample: boolean }): boolean {
  return (OFFICE_SEAT_ROLES as readonly string[]).includes(membershipRole ?? "") && !NON_BILLABLE_USER_ROLES.includes(user.role ?? "") && !user.isSample;
}

/** Active field staff who are billed, with their rider profiles. */
export async function fieldSeatMembers(companyId: string) {
  return sdb
    .select({ membership: schema.memberships, rider: schema.riders })
    .from(schema.riders)
    .innerJoin(schema.memberships, fieldSeatJoin)
    .where(fieldSeatWhere(companyId));
}

/** Active office users who hold a license (the included one among them), with their user rows. */
export async function officeSeatMembers(companyId: string) {
  return sdb
    .select({ membership: schema.memberships, user: schema.user })
    .from(schema.memberships)
    .innerJoin(schema.user, officeSeatJoin)
    .where(officeSeatWhere(companyId));
}

/** Field, office and billable license counts for a company, right now. */
export async function billableSeatCounts(companyId: string): Promise<SeatCounts> {
  const field = await driverSeatCount(companyId);
  const [o] = await sdb.select({ n: count() }).from(schema.memberships).innerJoin(schema.user, officeSeatJoin).where(officeSeatWhere(companyId));
  const office = Number(o?.n ?? 0);
  return { field, office, billable: billableFromCounts(field, office) };
}

/**
 * The plan for a stated number of field staff (the onboarding chat asks only
 * "how many technicians?"), plus a license for each office user already
 * active beyond the included one.
 */
export async function plannedSeatsFor(companyId: string, fieldCount: number): Promise<{ seats: number; extraOffice: number }> {
  const { office } = await billableSeatCounts(companyId);
  return { seats: Math.max(1, billableFromCounts(fieldCount, office)), extraOffice: officeRemovable(office) };
}

/**
 * Active FIELD staff that are billed: membership role "rider" and active,
 * rider approval active, not a sample-day tech. This is only the field part
 * of the bill; billableSeatCounts adds the extra office users.
 */
export async function driverSeatCount(companyId: string): Promise<number> {
  const [row] = await sdb.select({ n: count() }).from(schema.riders).innerJoin(schema.memberships, fieldSeatJoin).where(fieldSeatWhere(companyId));
  return Number(row?.n ?? 0);
}

/**
 * Put the current license count on the subscription so the next invoice
 * bills it. Called from the `invoice.upcoming` webhook (a few days before
 * each renewal, and before the trial ends).
 */
export async function syncSeats(companyId: string): Promise<{ seats: number; updated: boolean }> {
  const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  if (!co?.billingSubscriptionId || !stripeEnabled) return { seats: 0, updated: false };
  // The tenant chooses their seat count in Settings → Billing; the billable
  // count (field staff + extra office users) only ever raises it (you can't
  // run 5 licenses on 3 seats).
  const seats = Math.max(1, co.billingSeats || 1, (await billableSeatCounts(companyId)).billable);
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
  queueCompanySync(co.id);
  return co.id;
}

/** Company id for a Stripe customer, for events that carry no metadata. */
export async function companyForCustomer(customerId: string): Promise<string | null> {
  const [co] = await db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.billingCustomerId, customerId));
  return co?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Tenant self-service: Settings → Billing                                   */
/* -------------------------------------------------------------------------- */

export interface BillingSummary {
  configured: boolean;
  status: BillingStatus;
  seats: number;
  /** Active field staff (each one a license). */
  activeDrivers: number;
  /** Active office users (admins, managers, dispatchers, project managers), the included one among them. */
  activeOffice: number;
  /** Office licenses that come with every plan (1). */
  includedOffice: number;
  /** What the tenant is billed for: activeDrivers + max(0, activeOffice - includedOffice). */
  billableUsers: number;
  /** Billable users above the paid seat count; > 0 means the tenant must choose who to deactivate to lower seats. */
  excessActive: number;
  monthlyTotal: number;
  breakdown: string;
  plan: string;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  nextInvoiceAt: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  paymentMethod: { kind: string; brand: string; last4: string; expMonth: number | null; expYear: number | null; label: string } | null;
  /** Set when Stripe couldn't be read; the numbers above are then our last known values. */
  stripeError?: string;
}

function subscriptionItem(sub: Stripe.Subscription) {
  return sub.items.data[0] ?? null;
}

/** Everything the Billing tab shows. Reads Stripe for the live subscription and card. */
export async function billingSummary(companyId: string): Promise<BillingSummary> {
  const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  const counts = await billableSeatCounts(companyId);
  const seats = Math.max(1, co?.billingSeats || 1);
  const price = monthlyPrice(seats);
  const base: BillingSummary = {
    configured: Boolean(co?.billingSubscriptionId && stripeEnabled),
    status: (co?.billingStatus as BillingStatus) ?? "none",
    seats,
    activeDrivers: counts.field,
    activeOffice: counts.office,
    includedOffice: INCLUDED_OFFICE_SEATS,
    billableUsers: counts.billable,
    excessActive: Math.max(0, counts.billable - seats),
    monthlyTotal: price.total,
    breakdown: price.breakdown,
    plan: price.plan,
    trialEndsAt: co?.billingTrialEndsAt ? co.billingTrialEndsAt.toISOString() : null,
    trialDaysLeft: co?.billingTrialEndsAt ? Math.max(0, Math.ceil((co.billingTrialEndsAt.getTime() - Date.now()) / 86_400_000)) : null,
    nextInvoiceAt: null,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    paymentMethod: null,
  };
  if (!base.configured || !co?.billingSubscriptionId) return base;
  try {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(co.billingSubscriptionId, { expand: ["default_payment_method"] });
    const item = subscriptionItem(sub);
    // The card: the subscription's default, else the customer's default, else
    // any card saved on the customer (a SetupIntent attaches one even when
    // no default was recorded).
    let pm: Stripe.PaymentMethod | null = (sub.default_payment_method as Stripe.PaymentMethod | null) ?? null;
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    if (!pm) {
      const cust = (await stripe.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] })) as Stripe.Customer;
      const def = cust.invoice_settings?.default_payment_method;
      if (def && typeof def !== "string") pm = def;
    }
    if (!pm) {
      // Any saved method, whatever its type (card, Link, Apple Pay, bank).
      const list = await stripe.customers.listPaymentMethods(customerId, { limit: 1 });
      const first = list.data[0];
      if (first) {
        pm = first;
        // Heal the record so the renewal charge has a card to use.
        await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: first.id } }).catch(() => {});
        await stripe.subscriptions.update(sub.id, { default_payment_method: first.id }).catch(() => {});
      }
    }
    const periodEnd = (item as unknown as { current_period_end?: number })?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
    return {
      ...base,
      status: mapStatus(sub.status),
      seats: Math.max(1, item?.quantity ?? seats),
      excessActive: Math.max(0, counts.billable - Math.max(1, item?.quantity ?? seats)),
      ...(item?.quantity ? { ...monthlyPrice(item.quantity), monthlyTotal: monthlyPrice(item.quantity).total } : {}),
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : base.trialEndsAt,
      trialDaysLeft: sub.trial_end ? Math.max(0, Math.ceil((sub.trial_end * 1000 - Date.now()) / 86_400_000)) : base.trialDaysLeft,
      nextInvoiceAt: sub.status === "canceled" ? null : periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      cancelAt: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
      paymentMethod: pm ? describePaymentMethod(pm) : null,
    };
  } catch (e) {
    log.warn("billing: summary could not read Stripe", { companyId, err: (e as Error).message });
    // Say so on the page rather than quietly showing database values.
    return { ...base, stripeError: (e as Error).message };
  }
}

/** The tenant chooses how many users they pay for. Takes effect on the next invoice (no mid-month proration). */
export async function setSeats(companyId: string, seats: number): Promise<{ seats: number }> {
  const n = Math.max(1, Math.min(10_000, Math.floor(seats)));
  const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  if (!co) throw new Error("Company not found");
  if (co.billingSubscriptionId && stripeEnabled) {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(co.billingSubscriptionId);
    const item = subscriptionItem(sub);
    if (item && !["canceled", "incomplete_expired"].includes(sub.status)) {
      await stripe.subscriptionItems.update(item.id, { quantity: n, proration_behavior: "none" });
    }
  }
  await db.update(schema.companies).set({ billingSeats: n }).where(eq(schema.companies.id, companyId));
  queueCompanySync(companyId);
  return { seats: n };
}

/** Cancel at the end of the current period (or the trial): access continues until then, nothing more is charged. */
export async function cancelAtPeriodEnd(companyId: string, cancel: boolean): Promise<void> {
  const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  if (!co?.billingSubscriptionId || !stripeEnabled) return;
  const sub = await getStripe().subscriptions.update(co.billingSubscriptionId, { cancel_at_period_end: cancel });
  await applySubscriptionState(sub);
}

/** A SetupIntent on the existing customer, so the card can be replaced (never removed). */
export async function startPaymentMethodChange(companyId: string): Promise<{ clientSecret: string; setupIntentId: string } | null> {
  const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  if (!co?.billingCustomerId || !stripeEnabled) return null;
  const si = await getStripe().setupIntents.create({
    customer: co.billingCustomerId,
    usage: "off_session",
    automatic_payment_methods: { enabled: true },
    metadata: { companyId, source: "arriveping-billing-change-card" },
  });
  return { clientSecret: si.client_secret!, setupIntentId: si.id };
}

/** After the browser confirmed the SetupIntent: make the new card the default everywhere. */
export async function confirmPaymentMethodChange(companyId: string, setupIntentId: string): Promise<{ ok: boolean; message?: string }> {
  const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  if (!co?.billingCustomerId || !stripeEnabled) return { ok: false, message: "Billing is not set up for this account." };
  const stripe = getStripe();
  const si = await stripe.setupIntents.retrieve(setupIntentId);
  const owner = typeof si.customer === "string" ? si.customer : si.customer?.id;
  if (owner !== co.billingCustomerId || si.status !== "succeeded" || !si.payment_method) {
    return { ok: false, message: "That card wasn't saved. Please try again." };
  }
  const pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method.id;
  await stripe.customers.update(co.billingCustomerId, { invoice_settings: { default_payment_method: pm } });
  if (co.billingSubscriptionId) await stripe.subscriptions.update(co.billingSubscriptionId, { default_payment_method: pm });
  return { ok: true };
}

/**
 * Close the account for good: the subscription ends now (nothing further is
 * charged) and the company is marked closed so nobody can sign into it.
 * Data is kept; a superadmin can reopen it.
 */
export async function closeAccount(companyId: string): Promise<void> {
  const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  if (!co) throw new Error("Company not found");
  if (co.billingSubscriptionId && stripeEnabled) {
    try {
      await getStripe().subscriptions.cancel(co.billingSubscriptionId, { prorate: false });
    } catch (e) {
      log.warn("billing: subscription cancel on close failed", { companyId, err: (e as Error).message });
    }
  }
  await db
    .update(schema.companies)
    .set({ status: "closed", billingStatus: "canceled", updatedAt: new Date() })
    .where(eq(schema.companies.id, companyId));
  queueCompanySync(companyId);
}

/** A one-line description of any Stripe payment method, for the Billing tab. */
export function describePaymentMethod(pm: Stripe.PaymentMethod): NonNullable<BillingSummary["paymentMethod"]> {
  if (pm.card) {
    const brand = pm.card.wallet?.type ? `${pm.card.brand} (${pm.card.wallet.type.replace(/_/g, " ")})` : pm.card.brand;
    return { kind: "card", brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year, label: `${cap(brand)} ending in ${pm.card.last4}` };
  }
  if (pm.type === "link") {
    const email = (pm as unknown as { link?: { email?: string } }).link?.email ?? "";
    return { kind: "link", brand: "Link", last4: "", expMonth: null, expYear: null, label: `Link${email ? ` (${email})` : ""}` };
  }
  const bank = (pm as unknown as Record<string, { last4?: string; bank_name?: string } | undefined>)[pm.type];
  if (bank?.last4) {
    return { kind: pm.type, brand: bank.bank_name ?? "Bank account", last4: bank.last4, expMonth: null, expYear: null, label: `${bank.bank_name ?? "Bank account"} ending in ${bank.last4}` };
  }
  return { kind: pm.type, brand: pm.type, last4: "", expMonth: null, expYear: null, label: cap(pm.type.replace(/_/g, " ")) };
}
function cap(s: string) {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
