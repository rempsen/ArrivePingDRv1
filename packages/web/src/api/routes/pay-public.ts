/**
 * Public on-site payment — /api/pay/:token (no login).
 *
 * A work order set to "Collect payment on site" (bookings.collect_payment =
 * "on_site") gets a pay page at /pay/:token, keyed by the same unguessable
 * public token as the customer's tracking link. The technician opens it on
 * their phone for the customer, shows its QR code, or texts the link; the
 * customer pays by card / Apple Pay / Google Pay. The charge is a DIRECT charge
 * on the company's connected Stripe account (never the platform's), and the
 * invoice is brought up to the job's final total first.
 *
 * Everything here is reachable by anyone holding the link, so it exposes only
 * what a receipt would: company name/logo, the job title, the billed lines and
 * the total. Never addresses, phone numbers, notes or the technician's location.
 */
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { sdb } from "../database";
import * as schema from "../database/schema";
import type { AppEnv } from "../env";
import { trackLimiter, trackWriteLimiter } from "../lib/rate-limit";
import { AppError } from "../lib/errors";
import { getStripe, stripeEnabled, STRIPE_PUBLISHABLE_KEY } from "../../services/stripe";
import { canTakeCards, loadCompanyConnect, paymentAccountFor } from "../../services/stripe-connect";
import { syncInvoiceToBooking } from "../../services/billing";
import { startIntent, syncInvoiceFromIntent } from "./payments";
import { log } from "../lib/logger";

/** The booking behind a pay link, or null when the link is not payable. */
async function payableByToken(token: string) {
  if (!token || token.length < 8 || token.length > 64) return null;
  const [b] = await sdb.select().from(schema.bookings).where(eq(schema.bookings.publicToken, token));
  if (!b || b.deletedAt || b.status === "cancelled") return null;
  if (b.collectPayment !== "on_site") return null;
  // Same rule as the tracking link: a finished job's link is permanent, a live
  // one honours its expiry.
  if (b.status !== "completed" && b.tokenExpiresAt && Number(b.tokenExpiresAt) < Date.now()) return null;
  return b;
}

const lines = (raw: string | null | undefined) => {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v)
      ? v.slice(0, 50).map((x: any) => ({
          label: String(x?.label ?? ""),
          qty: Number(x?.qty) || 0,
          unit: String(x?.unit ?? ""),
          amount: Number(x?.amount) || 0,
        }))
      : [];
  } catch {
    return [];
  }
};

export const payPublicRoutes = new Hono<AppEnv>()
  .get("/:token", trackLimiter, async (c) => {
    const b = await payableByToken(c.req.param("token"));
    if (!b) return c.json({ message: "This payment link isn't available." }, 404);
    const [cs] = await sdb.select().from(schema.companySettings).where(eq(schema.companySettings.companyId, b.companyId));
    const [inv] = await sdb.select().from(schema.invoices).where(eq(schema.invoices.bookingId, b.id));
    const co = await loadCompanyConnect(b.companyId);
    const paid = b.paymentStatus === "paid" || inv?.status === "paid";
    return c.json(
      {
        company: { name: cs?.name || "", logo: cs?.logo || "", brandColor: cs?.brandColor || "" },
        job: { title: b.title, status: b.status, number: b.id.replace(/-/g, "").slice(0, 8).toUpperCase() },
        items: lines(b.priceBreakdown),
        subtotal: Number(b.subtotal) || 0,
        tax: Number(b.taxAmount) || 0,
        taxLabel: b.taxLabel || "Tax",
        total: Number(b.total) || Number(b.price) || 0,
        currency: inv?.currency || "cad",
        paid,
        invoiceNumber: inv?.number ?? null,
        cardPayments: stripeEnabled && canTakeCards(co),
      },
      200,
    );
  })
  // Start (or resume) the card payment for this job.
  .post("/:token/intent", trackWriteLimiter, async (c) => {
    if (!stripeEnabled) throw new AppError(503, "payments_disabled", "Card payments are not set up yet");
    const b = await payableByToken(c.req.param("token"));
    if (!b) return c.json({ message: "This payment link isn't available." }, 404);
    const inv = await syncInvoiceToBooking(b.companyId, b.id);
    if (!inv) return c.json({ message: "Nothing to pay yet." }, 409);
    if (inv.total <= 0) return c.json({ message: "This job has no balance to pay." }, 409);
    let out: Awaited<ReturnType<typeof startIntent>>;
    try {
      out = await startIntent(inv, undefined, { source: "on_site" });
    } catch (e) {
      // Stripe unreachable, the account not ready, a declined setup — the
      // customer needs a plain answer, not a 500.
      log.warn("pay: could not start the payment", { bookingId: b.id, err: String(e) });
      return c.json({ message: "Card payment isn't available right now. Please try again in a moment, or pay your technician another way." }, 502);
    }
    if ("alreadyPaid" in out) return c.json({ alreadyPaid: true }, 200);
    return c.json(
      {
        clientSecret: out.pi.client_secret,
        publishableKey: STRIPE_PUBLISHABLE_KEY,
        stripeAccount: out.acct.stripeAccount,
        total: inv.total,
        currency: inv.currency,
      },
      200,
    );
  })
  // Immediate reconcile after the browser confirms (the webhook stays the source of truth).
  .post("/:token/sync", trackWriteLimiter, async (c) => {
    if (!stripeEnabled) throw new AppError(503, "payments_disabled", "Card payments are not set up yet");
    const b = await payableByToken(c.req.param("token"));
    if (!b) return c.json({ message: "This payment link isn't available." }, 404);
    const [inv] = await sdb.select().from(schema.invoices).where(eq(schema.invoices.bookingId, b.id));
    if (!inv?.stripePaymentIntentId) return c.json({ paid: false }, 200);
    const acct = await paymentAccountFor(inv.companyId);
    const pi = await getStripe().paymentIntents.retrieve(inv.stripePaymentIntentId, {}, acct);
    const r = await syncInvoiceFromIntent(pi as unknown as Parameters<typeof syncInvoiceFromIntent>[0]);
    return c.json({ paid: r?.status === "paid" }, 200);
  });
