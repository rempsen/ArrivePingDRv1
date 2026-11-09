/**
 * Control Hub → Stripe status: how ArrivePing's own platform Stripe account is
 * wired (key mode, webhook secrets, the subscription price) and which
 * companies are failing to pay. Config checks come from env and never expose
 * a secret; the price and webhook endpoints are asked of Stripe live, and a
 * Stripe failure comes back as `stripeError` instead of an error response.
 */
import { sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { getStripe, stripeEnabled, STRIPE_CONNECT_WEBHOOK_SECRET, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET } from "./stripe";
import { PRICE_LOOKUP_KEY } from "./billing-subscription";

export interface StripeStatus {
  configured: boolean;
  mode: "live" | "test" | "off";
  publishableKeyMatchesMode: boolean | null;
  webhookSecretSet: boolean;
  connectWebhookSecretSet: boolean;
  priceOverride: boolean;
  production: boolean;
  price: { id: string; active: boolean; lookupKey: string | null; tiers: { upTo: number | null; flat: number | null; unit: number | null }[] } | null;
  webhooks: { url: string; status: string; events: number }[];
  stripeError: string | null;
  pastDue: { id: string; name: string; billingStatus: string; seats: number }[];
  customersBilled: number;
}

export async function stripeStatus(): Promise<StripeStatus> {
  const secret = process.env.STRIPE_SECRET_KEY ?? "";
  const mode = !stripeEnabled ? "off" : secret.startsWith("sk_live") ? "live" : "test";
  const pk = STRIPE_PUBLISHABLE_KEY;
  const out: StripeStatus = {
    configured: stripeEnabled,
    mode,
    publishableKeyMatchesMode: !stripeEnabled || !pk ? null : mode === "live" ? pk.startsWith("pk_live") : pk.startsWith("pk_test"),
    webhookSecretSet: !!STRIPE_WEBHOOK_SECRET,
    connectWebhookSecretSet: !!STRIPE_CONNECT_WEBHOOK_SECRET,
    priceOverride: !!process.env.STRIPE_SUBSCRIPTION_PRICE_ID?.trim(),
    production: process.env.NODE_ENV === "production",
    price: null,
    webhooks: [],
    stripeError: null,
    pastDue: [],
    customersBilled: 0,
  };

  const rows = await sdb
    .select({
      id: schema.companies.id,
      name: schema.companies.name,
      kind: schema.companies.kind,
      billingStatus: schema.companies.billingStatus,
      seats: schema.companies.billingSeats,
      sub: schema.companies.billingSubscriptionId,
    })
    .from(schema.companies);
  const customers = rows.filter((r) => r.kind === "customer");
  out.customersBilled = customers.filter((r) => r.sub).length;
  out.pastDue = customers
    .filter((r) => r.billingStatus === "past_due" || r.billingStatus === "unpaid")
    .map((r) => ({ id: r.id, name: r.name, billingStatus: r.billingStatus, seats: r.seats }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!stripeEnabled) return out;
  try {
    const stripe = getStripe();
    const override = process.env.STRIPE_SUBSCRIPTION_PRICE_ID?.trim();
    const price = override
      ? await stripe.prices.retrieve(override, { expand: ["tiers"] })
      : (await stripe.prices.list({ lookup_keys: [PRICE_LOOKUP_KEY], active: true, limit: 1, expand: ["data.tiers"] })).data[0];
    if (price) {
      out.price = {
        id: price.id,
        active: price.active,
        lookupKey: price.lookup_key,
        tiers: (price.tiers ?? []).map((t) => ({
          upTo: t.up_to,
          flat: t.flat_amount == null ? null : t.flat_amount / 100,
          unit: t.unit_amount == null ? null : t.unit_amount / 100,
        })),
      };
    }
    const hooks = await stripe.webhookEndpoints.list({ limit: 20 });
    out.webhooks = hooks.data.map((h) => ({ url: h.url, status: h.status, events: h.enabled_events.length }));
  } catch (err) {
    out.stripeError = (err as Error).message;
  }
  return out;
}
