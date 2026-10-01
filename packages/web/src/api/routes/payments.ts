import { Hono } from "hono";
import { sdb } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin, tenantId, tx } from "../middleware/auth";
import { isAdminRole } from "../lib/permissions";
import { notify, buildEmailData } from "../../services/notify";
import { getStripe, stripeEnabled, STRIPE_PUBLISHABLE_KEY, toMinor } from "../../services/stripe";
import {
  CONNECT_COUNTRIES,
  canTakeCards,
  paymentAccountFor,
  setUsePlatform,
  type PaymentAccount,
  createDashboardLink,
  createOnboardingLink,
  describeRequirements,
  ensureConnectedAccount,
  loadCompanyConnect,
  refreshFromStripe,
  stateFromCompany,
  type ConnectCountry,
} from "../../services/stripe-connect";
import { publicOrigin } from "../lib/request-origin";
import { isSuperadmin } from "../lib/permissions";
import { AppError, Err } from "../lib/errors";
import { log } from "../lib/logger";
import { capture } from "../lib/analytics";
import { incr } from "../lib/metrics";
import { jsonBody, money } from "../lib/validate";
import { z } from "zod";
import type { AppEnv } from "../env";

const ConnectStartBody = z.object({
  country: z.enum(CONNECT_COUNTRIES).default("CA"),
});

/**
 * Resolve the tenant's connected Stripe account for a Stripe call, or fail
 * loudly. Never falls back to the platform account: a charge created there
 * would deposit the tenant's money into NVC360's bank.
 */
async function requireConnected(companyId: string): Promise<PaymentAccount> {
  const opt = await paymentAccountFor(companyId);
  if (!opt) {
    throw new AppError(409, "stripe_not_connected", "This business has not connected a Stripe account yet");
  }
  return opt;
}

/** Same lookup when all we have is an invoice (webhook / sync / refund paths). */
async function connectedForInvoice(inv: { companyId: string }) {
  return paymentAccountFor(inv.companyId);
}

const PlatformBody = z.object({ enabled: z.boolean() });

const RefundBody = z.object({
  amount: money("Refund amount").positive("Refund amount must be greater than zero").optional(),
  reason: z.string().trim().max(400, "Reason must be 400 characters or fewer").optional(),
});

type SessionUser = { id: string };

/** Append an immutable ledger row. Never throws into the request path. */
async function ledger(row: {
  companyId?: string;
  invoiceId?: string | null;
  bookingId?: string | null;
  kind: "charge" | "refund" | "dispute" | "adjustment";
  amount: number;
  currency: string;
  stripeObjectId?: string | null;
  status: "succeeded" | "pending" | "failed";
  memo?: string;
}) {
  try {
    // Derive the tenant from the linked invoice when not explicitly supplied
    // (webhook context has no request user). Falls back to "default". This
    // whole helper runs on the system (BYPASSRLS) connection: it is called
    // both from authenticated request handlers (which already resolved a
    // companyId elsewhere) and from the Stripe webhook, which has no tenant
    // at all until the invoice lookup below resolves one.
    let companyId = row.companyId;
    if (!companyId && row.invoiceId) {
      const [inv] = await sdb
        .select({ companyId: schema.invoices.companyId })
        .from(schema.invoices)
        .where(eq(schema.invoices.id, row.invoiceId));
      companyId = inv?.companyId;
    }
    await sdb.insert(schema.paymentLedger).values({
      companyId: companyId ?? "default",
      invoiceId: row.invoiceId ?? null,
      bookingId: row.bookingId ?? null,
      kind: row.kind,
      amount: row.amount,
      currency: row.currency,
      stripeObjectId: row.stripeObjectId ?? null,
      status: row.status,
      memo: row.memo,
    });
  } catch (e) {
    log.error("ledger write failed", { err: (e as Error).message, ...row });
  }
}

/** Reflect a Stripe PaymentIntent's terminal/intermediate state onto our invoice. */
async function syncInvoiceFromIntent(pi: {
  id: string;
  status: string;
  latest_charge?: string | null;
  last_payment_error?: { message?: string } | null;
}) {
  // Same reasoning as ledger() above: reconciling from a Stripe object id
  // happens before any tenant is known, so this runs on sdb throughout.
  const [inv] = await sdb
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.stripePaymentIntentId, pi.id));
  if (!inv) return null;

  let status = inv.status;
  if (pi.status === "succeeded") status = "paid";
  else if (pi.status === "processing") status = "processing";
  else if (pi.status === "canceled") status = "failed";
  else if (pi.status === "requires_payment_method" && pi.last_payment_error) status = "failed";

  const paidNow = status === "paid" && inv.status !== "paid";

  await sdb
    .update(schema.invoices)
    .set({
      status,
      stripeChargeId: pi.latest_charge ?? inv.stripeChargeId,
      lastPaymentError: pi.last_payment_error?.message ?? null,
      paidAt: status === "paid" ? (inv.paidAt ?? new Date()) : inv.paidAt,
    })
    .where(eq(schema.invoices.id, inv.id));

  if (status === "paid") {
    await sdb
      .update(schema.bookings)
      .set({ paymentStatus: "paid" })
      .where(eq(schema.bookings.id, inv.bookingId));
  }

  if (paidNow) {
    await ledger({
      invoiceId: inv.id,
      bookingId: inv.bookingId,
      kind: "charge",
      amount: inv.total,
      currency: inv.currency,
      stripeObjectId: pi.latest_charge ?? pi.id,
      status: "succeeded",
      memo: `Invoice ${inv.number} paid`,
    });
    incr("invoices_paid_total");
    incr("revenue_paid_cents_total", Math.round(inv.total * 100));
    capture("invoice.paid", inv.companyId, {
      invoiceId: inv.id,
      bookingId: inv.bookingId,
      amount: inv.total,
      currency: inv.currency,
    });
    // receipt email + in-app notification
    const ed = await buildEmailData(inv.companyId, inv.bookingId);
    if (ed) {
      await notify({
        companyId: inv.companyId,
        type: "receipt",
        userId: inv.customerId,
        bookingId: inv.bookingId,
        title: "Payment received",
        body: `Receipt ${inv.number} — $${inv.total.toFixed(2)} paid.`,
        emailKind: "receipt",
        email: ed.email,
        emailData: { ...ed.emailData, price: inv.total, invoiceNumber: inv.number },
      }).catch((e) => log.error("receipt notify failed", { err: (e as Error).message }));
    }
  }
  return { inv, status };
}

export const paymentsRoutes = new Hono<AppEnv>()
  // publishable key + capability flag for the browser
  .get("/config", (c) =>
    c.json({ enabled: stripeEnabled, publishableKey: STRIPE_PUBLISHABLE_KEY }, 200),
  )

  // Get the invoice for a booking.
  //
  // 404 means "you can't see this booking" — a booking outside your tenant, or
  // one that isn't yours when you're a customer/tech. A booking you CAN see
  // that simply hasn't been invoiced yet is a normal, healthy state and returns
  // 200 with `invoice: null`, so the customer tracking page doesn't error out
  // on every job before its invoice exists.
  .get("/invoice/:bookingId", requireAuth, async (c) => {
    const u = c.get("user") as SessionUser & { role?: string };
    const t = tx(c);
    const bookingId = c.req.param("bookingId");

    const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, bookingId));
    if (!b) return c.json({ message: "Not found" }, 404);

    // Tenant scoping alone is not enough: without this, any signed-in customer
    // could read a co-tenant's invoice by guessing a booking id. Office roles
    // (admin/superadmin/manager/dispatcher/...) legitimately see every invoice
    // in their own tenant; the two roles that are scoped to their own work are
    // the client and the technician.
    if (u.role === "customer" || u.role === "rider") {
      let allowed = false;
      if (u.role === "rider") {
        const rp = await t.selectOne(schema.riders, eq(schema.riders.userId, u.id));
        allowed = !!rp && !!b.riderId && rp.id === b.riderId;
      } else {
        allowed = b.customerId === u.id;
      }
      if (!allowed) return c.json({ message: "Not found" }, 404);
    }

    const inv = await t.selectOne(schema.invoices, eq(schema.invoices.bookingId, bookingId));
    // Card payment is only offered when THIS tenant has a connected Stripe
    // account that can take charges. Without it the portal hides "Pay".
    const co = await loadCompanyConnect(b.companyId);
    const cardPayments = { enabled: canTakeCards(co) };
    return c.json({ invoice: inv ?? null, cardPayments }, 200);
  })

  // Create (or reuse) a PaymentIntent for a booking's invoice and return its
  // client_secret so the browser can confirm with Stripe Elements.
  // Idempotent: a client-supplied Idempotency-Key dedupes retries.
  .post("/intent/:bookingId", requireAuth, async (c) => {
    if (!stripeEnabled) throw new AppError(503, "payments_disabled", "Payments are not configured");
    const u = c.get("user") as SessionUser;
    const bookingId = c.req.param("bookingId");

    const inv = await tx(c).selectOne(schema.invoices, eq(schema.invoices.bookingId, bookingId));
    if (!inv) throw Err.notFound("Invoice not found");
    if (inv.status === "paid") return c.json({ alreadyPaid: true, invoice: inv }, 200);

    const stripe = getStripe();
    // Direct charge on the tenant's connected account.
    const acct = await requireConnected(inv.companyId);
    // Key includes the previous intent id so that after a canceled/failed
    // intent we get a FRESH one instead of Stripe replaying the dead one.
    const idemKey = c.req.header("Idempotency-Key") || `pi_${inv.id}_${inv.stripePaymentIntentId ?? "first"}`;

    // reuse an existing open intent if we have one (avoids duplicate charges)
    let pi;
    if (inv.stripePaymentIntentId) {
      pi = await stripe.paymentIntents.retrieve(inv.stripePaymentIntentId, acct).catch(() => null);
      if (pi && ["canceled", "succeeded"].includes(pi.status)) pi = null;
      // keep amount in sync if invoice total changed
      if (pi && pi.amount !== toMinor(inv.total)) {
        pi = await stripe.paymentIntents.update(pi.id, { amount: toMinor(inv.total) }, acct);
      }
    }
    if (!pi) {
      pi = await stripe.paymentIntents.create(
        {
          amount: toMinor(inv.total),
          currency: inv.currency,
          automatic_payment_methods: { enabled: true },
          metadata: { invoiceId: inv.id, bookingId, customerId: u.id, number: inv.number, companyId: inv.companyId },
          description: `Invoice ${inv.number}`,
        },
        { idempotencyKey: idemKey, ...acct },
      );
      await tx(c).update(
        schema.invoices,
        { stripePaymentIntentId: pi.id, status: "processing", lastPaymentError: null },
        eq(schema.invoices.id, inv.id),
      );
    }

    // `stripeAccount` must be passed to Stripe.js on the browser side too —
    // a direct charge's client_secret only resolves on the connected account.
    return c.json({ clientSecret: pi.client_secret, paymentIntentId: pi.id, publishableKey: STRIPE_PUBLISHABLE_KEY, stripeAccount: acct.stripeAccount }, 200);
  })

  // Confirm/refresh: poll Stripe for the latest intent state and reconcile.
  // Used as a fallback when the webhook is delayed.
  .post("/sync/:bookingId", requireAuth, async (c) => {
    if (!stripeEnabled) throw new AppError(503, "payments_disabled", "Payments are not configured");
    const bookingId = c.req.param("bookingId");
    const t = tx(c);
    const inv = await t.selectOne(schema.invoices, eq(schema.invoices.bookingId, bookingId));
    if (!inv?.stripePaymentIntentId) throw Err.notFound("No payment in progress");

    const pi = await getStripe().paymentIntents.retrieve(inv.stripePaymentIntentId, await connectedForInvoice(inv));
    // `retrieve` resolves to Stripe's Response<PaymentIntent> wrapper (the intent
    // plus `lastResponse`); the syncer only reads intent fields.
    await syncInvoiceFromIntent(pi as unknown as Parameters<typeof syncInvoiceFromIntent>[0]);
    const fresh = await t.selectOne(schema.invoices, eq(schema.invoices.id, inv.id));
    return c.json({ invoice: fresh }, 200);
  })

  // Refund (full or partial). Writes a negative ledger entry.
  .post("/refund/:bookingId", requireAuth, jsonBody(RefundBody), async (c) => {
    if (!stripeEnabled) throw new AppError(503, "payments_disabled", "Payments are not configured");
    const u = c.get("user") as SessionUser & { role?: string };
    if (u.role && !(isAdminRole(u.role) || ["owner", "dispatcher"].includes(u.role))) {
      throw Err.forbidden("Not allowed to issue refunds");
    }
    const bookingId = c.req.param("bookingId");
    // `amount` was unchecked: NaN survives `Math.min(NaN, remaining)` and the
    // `amount <= 0` guard (both comparisons are false with NaN), so a NaN
    // refund reached the Stripe API. `reason` was unbounded and goes into
    // Stripe metadata, which rejects values over 500 chars.
    const body = c.req.valid("json");

    const t = tx(c);
    const inv = await t.selectOne(schema.invoices, eq(schema.invoices.bookingId, bookingId));
    if (!inv) throw Err.notFound("Invoice not found");
    if (!inv.stripePaymentIntentId || inv.status !== "paid") {
      throw Err.conflict("Invoice is not in a refundable state");
    }

    const remaining = inv.total - inv.amountRefunded;
    const amount = body.amount != null ? Math.min(body.amount, remaining) : remaining;
    if (amount <= 0) throw Err.conflict("Nothing left to refund");

    const stripe = getStripe();
    const refund = await stripe.refunds.create(
      {
        payment_intent: inv.stripePaymentIntentId,
        amount: toMinor(amount),
        reason: "requested_by_customer",
        metadata: { invoiceId: inv.id, bookingId, by: u.id, note: body.reason ?? "" },
      },
      { idempotencyKey: `refund_${inv.id}_${toMinor(amount)}_${inv.amountRefunded}`, ...(await connectedForInvoice(inv)) },
    );

    const newRefunded = inv.amountRefunded + amount;
    const fullyRefunded = newRefunded >= inv.total - 0.001;
    await t.update(
      schema.invoices,
      { amountRefunded: newRefunded, status: fullyRefunded ? "refunded" : inv.status },
      eq(schema.invoices.id, inv.id),
    );
    if (fullyRefunded) {
      await t.update(
        schema.bookings,
        { paymentStatus: "refunded" },
        eq(schema.bookings.id, bookingId),
      );
    }

    await ledger({
      invoiceId: inv.id,
      bookingId,
      kind: "refund",
      amount: -amount,
      currency: inv.currency,
      stripeObjectId: refund.id,
      status: "succeeded",
      memo: body.reason ?? "Refund issued",
    });

    const fresh = await t.selectOne(schema.invoices, eq(schema.invoices.id, inv.id));
    return c.json({ invoice: fresh, refundId: refund.id, refunded: amount }, 200);
  })

  // ledger view for an invoice/booking (audit)
  .get("/ledger/:bookingId", requireAuth, async (c) => {
    const rows = await tx(c).select(
      schema.paymentLedger,
      eq(schema.paymentLedger.bookingId, c.req.param("bookingId")),
    );
    return c.json({ entries: rows }, 200);
  })

  // ── Stripe Connect (Settings → Payments) ─────────────────────────────────
  //
  // Each tenant connects its own Stripe account via Stripe-hosted onboarding.
  // Admin-only: this is the business owner wiring up where their money goes.

  // Current connection state. `?refresh=1` re-reads the account from Stripe
  // (used when the admin lands back from onboarding, before the webhook).
  .get("/connect/status", requireAdmin, async (c) => {
    const co = await loadCompanyConnect(tenantId(c));
    if (!co) throw Err.notFound("Company not found");
    let requirementsDue: string[] = [];
    let disabledReason: string | null = null;
    if (co.stripeAccountId && stripeEnabled && (c.req.query("refresh") === "1" || !co.stripeChargesEnabled)) {
      try {
        const acct = await refreshFromStripe(co.stripeAccountId);
        requirementsDue = describeRequirements(acct);
        disabledReason = acct.requirements?.disabled_reason ?? null;
        const fresh = await loadCompanyConnect(tenantId(c));
        if (fresh) Object.assign(co, fresh);
      } catch (e) {
        log.warn("stripe connect refresh failed", { companyId: co.id, err: (e as Error).message });
      }
    }
    return c.json(
      {
        enabled: stripeEnabled,
        countries: CONNECT_COUNTRIES,
        ...stateFromCompany(co),
        requirementsDue,
        disabledReason,
      },
      200,
    );
  })

  // Create the connected account (first time) and hand back a Stripe-hosted
  // onboarding URL. Also used to RESUME onboarding when details are missing.
  .post("/connect/start", requireAdmin, jsonBody(ConnectStartBody), async (c) => {
    if (!stripeEnabled) throw new AppError(503, "payments_disabled", "Payments are not configured");
    const u = c.get("user") as SessionUser;
    const companyId = tenantId(c);
    const { country } = c.req.valid("json") as { country: ConnectCountry };
    let accountId: string;
    try {
      accountId = await ensureConnectedAccount(companyId, country);
    } catch (e) {
      const raw = (e as Error).message ?? "Stripe error";
      // Account-creation failures here are NVC360-side problems (platform
      // profile not completed, rolled API key…), not the tenant's. Log the
      // real reason; show it only to superadmins so Dan can see it while
      // testing, and give tenants a plain "contact support" message.
      log.error("stripe connect account create failed", { companyId, err: raw });
      const msg =
        u.role === "superadmin"
          ? `Stripe: ${raw}`
          : "Stripe setup isn't available right now — ArrivePing's payment account needs attention. Please contact support.";
      // 409 not 502: Cloudflare replaces origin 502/504 bodies with its own
      // "error code: 502" page, which hid this message in production.
      throw new AppError(409, "stripe_connect_failed", msg, { expose: true });
    }
    const url = await createOnboardingLink(accountId, publicOrigin(c));
    capture("stripe.connect_started", companyId, { by: u.id, country });
    return c.json({ url, accountId }, 200);
  })

  // Express dashboard sign-in link (balance, payouts, disputes, bank account).
  .post("/connect/dashboard", requireAdmin, async (c) => {
    if (!stripeEnabled) throw new AppError(503, "payments_disabled", "Payments are not configured");
    const co = await loadCompanyConnect(tenantId(c));
    if (!co?.stripeAccountId) throw Err.conflict("Stripe is not connected yet");
    const url = await createDashboardLink(co.stripeAccountId);
    return c.json({ url }, 200);
  })

  // SUPERADMIN ONLY: route this tenant's card payments through NVC360's own
  // Stripe account (no connected account). Intended for the ArrivePing tenant,
  // whose money belongs in the platform bank. Never expose to tenant admins.
  .post("/connect/platform", requireAdmin, jsonBody(PlatformBody), async (c) => {
    const u = c.get("user") as SessionUser;
    if (!isSuperadmin(u.role)) throw Err.forbidden("Superadmin only");
    const companyId = tenantId(c);
    const { enabled } = c.req.valid("json") as { enabled: boolean };
    await setUsePlatform(companyId, enabled);
    capture("stripe.use_platform_toggled", companyId, { by: u.id, enabled });
    const co = await loadCompanyConnect(companyId);
    return c.json({ ok: true, ...(co ? stateFromCompany(co) : {}) }, 200);
  });

// Exported for the webhook route (mounted before auth in api/index.ts).
export { syncInvoiceFromIntent, ledger };
