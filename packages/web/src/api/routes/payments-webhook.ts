import { Hono } from "hono";
import { db, sdb } from "../database";
// idempotency_keys is a GLOBAL table (see database/tenant.ts) so it stays on
// `db`; invoices/bookings looked up by a raw Stripe object id are genuinely
// pre-tenant and go through `sdb`.
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { getStripe, stripeEnabled, STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_WEBHOOK_SECRET, fromMinor } from "../../services/stripe";
import { syncInvoiceFromIntent, ledger } from "./payments";
import { syncAccountFlags } from "../../services/stripe-connect";
import { log } from "../lib/logger";
import type Stripe from "stripe";
import type { AppEnv } from "../env";

/**
 * Stripe webhook — mounted BEFORE json parsing/auth in api/index.ts so we can
 * read the raw request body for signature verification. Replay-safe via the
 * idempotency_keys table (keyed on the Stripe event id).
 */
export const paymentsWebhookRoutes = new Hono<AppEnv>().post("/", async (c) => {
  if (!stripeEnabled) return c.json({ received: false, reason: "stripe disabled" }, 200);

  const sig = c.req.header("stripe-signature");
  const raw = await c.req.text();

  // Fail closed in production: never accept an unsigned/unverifiable webhook.
  const isProd = process.env.NODE_ENV === "production";
  // Two endpoints share this URL: the platform-account one and the
  // "Connected accounts" one (Stripe Connect). Each has its own secret.
  const secrets = [STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_WEBHOOK_SECRET].filter(Boolean);
  if (isProd && (!secrets.length || !sig)) {
    log.error("stripe webhook rejected: signature required in production", {
      hasSecret: secrets.length > 0,
      hasSig: !!sig,
    });
    return c.json({ error: "webhook signature required" }, 400);
  }

  let event: Stripe.Event;
  const stripe = getStripe();
  try {
    if (secrets.length && sig) {
      let verified: Stripe.Event | null = null;
      let lastErr: Error | null = null;
      for (const secret of secrets) {
        try {
          verified = stripe.webhooks.constructEvent(raw, sig, secret);
          break;
        } catch (e) {
          lastErr = e as Error;
        }
      }
      if (!verified) throw lastErr ?? new Error("no matching webhook secret");
      event = verified;
    } else {
      // dev fallback when no signing secret is configured yet — parse only.
      // NEVER reached in prod because STRIPE_WEBHOOK_SECRET will be set.
      log.warn("stripe webhook signature NOT verified (no secret configured)");
      event = JSON.parse(raw) as Stripe.Event;
    }
  } catch (err) {
    log.error("stripe webhook signature verification failed", { err: (err as Error).message });
    return c.json({ error: "invalid signature" }, 400);
  }

  if (!event?.id) return c.json({ error: "missing event id" }, 400);

  // idempotent replay guard
  const existing = await db
    .select()
    .from(schema.idempotencyKeys)
    .where(eq(schema.idempotencyKeys.key, event.id));
  if (existing.length) return c.json({ received: true, duplicate: true }, 200);
  await db
    .insert(schema.idempotencyKeys)
    .values({ key: event.id, scope: "stripe_webhook", responseStatus: 200 })
    .onConflictDoNothing();

  try {
    switch (event.type) {
      case "payment_intent.succeeded":
      case "payment_intent.processing":
      case "payment_intent.payment_failed":
      case "payment_intent.canceled": {
        const pi = event.data.object as Stripe.PaymentIntent;
        await syncInvoiceFromIntent({
          id: pi.id,
          status: pi.status,
          latest_charge: typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id ?? null,
          last_payment_error: pi.last_payment_error ? { message: pi.last_payment_error.message } : null,
        });
        break;
      }
      case "charge.refunded": {
        const ch = event.data.object as Stripe.Charge;
        const piId = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id;
        if (piId) {
          const [inv] = await sdb
            .select()
            .from(schema.invoices)
            .where(eq(schema.invoices.stripePaymentIntentId, piId));
          if (inv) {
            const refunded = fromMinor(ch.amount_refunded);
            const fully = refunded >= inv.total - 0.001;
            await sdb
              .update(schema.invoices)
              .set({ amountRefunded: refunded, status: fully ? "refunded" : inv.status })
              .where(eq(schema.invoices.id, inv.id));
            if (fully) {
              await sdb
                .update(schema.bookings)
                .set({ paymentStatus: "refunded" })
                .where(eq(schema.bookings.id, inv.bookingId));
            }
          }
        }
        break;
      }
      // Connected account finished (or changed) onboarding — mirror the
      // charges/payouts flags so Settings → Payments and the customer
      // portal's "Pay" button reflect reality without a manual refresh.
      case "account.updated": {
        const acct = event.data.object as Stripe.Account;
        const companyId = await syncAccountFlags(acct);
        log.info("stripe connect account updated", {
          accountId: acct.id,
          companyId,
          chargesEnabled: acct.charges_enabled,
          payoutsEnabled: acct.payouts_enabled,
        });
        break;
      }
      case "charge.dispute.created": {
        const dp = event.data.object as Stripe.Dispute;
        const piId = typeof dp.payment_intent === "string" ? dp.payment_intent : dp.payment_intent?.id;
        const [inv] = piId
          ? await sdb.select().from(schema.invoices).where(eq(schema.invoices.stripePaymentIntentId, piId))
          : [undefined];
        await ledger({
          invoiceId: inv?.id ?? null,
          bookingId: inv?.bookingId ?? null,
          kind: "dispute",
          amount: -fromMinor(dp.amount),
          currency: dp.currency,
          stripeObjectId: dp.id,
          status: "pending",
          memo: `Dispute opened: ${dp.reason}`,
        });
        break;
      }
      default:
        log.info("stripe webhook ignored event", { type: event.type });
    }
  } catch (err) {
    // The idempotency key above was written BEFORE processing, so Stripe's
    // retry after this 500 would otherwise hit the replay guard above and be
    // swallowed as `{ duplicate: true }` — the failed sync/refund/dispute
    // update would then never actually apply, permanently, even though Stripe
    // considers the retry delivered. Delete the marker so the retry Stripe
    // sends after a 500 actually reprocesses the event instead of no-op'ing.
    await db.delete(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.key, event.id));
    log.error("stripe webhook handler error", { type: event.type, err: (err as Error).message });
    return c.json({ error: "handler error" }, 500);
  }

  return c.json({ received: true }, 200);
});
