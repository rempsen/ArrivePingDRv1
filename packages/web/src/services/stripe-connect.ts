import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db, sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { getStripe, stripeEnabled } from "./stripe";
import { log } from "../api/lib/logger";

/**
 * Stripe Connect — one connected account per tenant.
 *
 * Model (decided with Dan, 2026-10-01):
 *  - Connected account controller: FULL Stripe dashboard (the tenant gets a
 *    normal Stripe login), Stripe collects requirements (hosted onboarding),
 *    tenant pays Stripe's processing fee (`fees.payer: account`), Stripe is
 *    liable for negative balances (`losses.payments: stripe`). This is
 *    Stripe's "Stripe handles pricing" tier — no per-account or per-payout
 *    Connect fees for the platform. Stripe REQUIRES the full dashboard for
 *    this combination (Express is only allowed when the platform collects
 *    fees and carries the losses — verified live 2026-10-01).
 *  - Charges are DIRECT charges (`stripeAccount` request option), so the
 *    money and the Stripe fee both sit on the tenant's account. No
 *    application_fee — ArrivePing takes nothing.
 *  - Tenants may onboard from Canada or the United States.
 *  - Exception: a tenant flagged `stripeUsePlatform` (superadmin-only; used
 *    for the ArrivePing tenant itself) charges directly on NVC360's own
 *    Stripe account — no connected account involved.
 */

export const CONNECT_COUNTRIES = ["CA", "US"] as const;
export type ConnectCountry = (typeof CONNECT_COUNTRIES)[number];

export type ConnectState = {
  /** true = charges go to NVC360's own Stripe account (ArrivePing tenant only) */
  usePlatform: boolean;
  connected: boolean; // has a connected account id
  accountId: string | null;
  country: string;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  /** true when the tenant can actually take card payments right now */
  ready: boolean;
  connectedAt: Date | null;
};

export function stateFromCompany(co: {
  stripeAccountId: string | null;
  stripeCountry: string;
  stripeDetailsSubmitted: boolean;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  stripeConnectedAt: Date | null;
  stripeUsePlatform: boolean;
}): ConnectState {
  return {
    usePlatform: co.stripeUsePlatform,
    connected: !!co.stripeAccountId,
    accountId: co.stripeAccountId,
    country: co.stripeCountry,
    detailsSubmitted: co.stripeDetailsSubmitted,
    chargesEnabled: co.stripeChargesEnabled,
    payoutsEnabled: co.stripePayoutsEnabled,
    ready: co.stripeUsePlatform || (!!co.stripeAccountId && co.stripeChargesEnabled),
    connectedAt: co.stripeConnectedAt,
  };
}

const companyCols = {
  id: schema.companies.id,
  name: schema.companies.name,
  contactEmail: schema.companies.contactEmail,
  stripeAccountId: schema.companies.stripeAccountId,
  stripeCountry: schema.companies.stripeCountry,
  stripeDetailsSubmitted: schema.companies.stripeDetailsSubmitted,
  stripeChargesEnabled: schema.companies.stripeChargesEnabled,
  stripePayoutsEnabled: schema.companies.stripePayoutsEnabled,
  stripeConnectedAt: schema.companies.stripeConnectedAt,
  stripeUsePlatform: schema.companies.stripeUsePlatform,
};

/** `companies` is a global (non-tenant) table — plain `db` is correct here. */
export async function loadCompanyConnect(companyId: string) {
  const [co] = await db.select(companyCols).from(schema.companies).where(eq(schema.companies.id, companyId));
  return co ?? null;
}

/** Stripe request options that route a call to the right account. */
export type PaymentAccount = { stripeAccount?: string };

/**
 * Where this tenant's card payments are processed:
 *  - `{ stripeAccount }`  → the tenant's connected account (direct charge)
 *  - `{}`                 → NVC360's own account (tenant flagged usePlatform)
 *  - `undefined`          → nowhere: the tenant can't take card payments.
 *    Callers must treat that as "card payments unavailable" and never
 *    silently fall back to the platform account — that would put a tenant's
 *    money in NVC360's bank.
 */
export async function paymentAccountFor(companyId: string): Promise<PaymentAccount | undefined> {
  const co = await loadCompanyConnect(companyId);
  if (!co) return undefined;
  if (co.stripeUsePlatform) return {};
  return co.stripeAccountId ? { stripeAccount: co.stripeAccountId } : undefined;
}

/** Can this tenant take a card payment right now? */
export function canTakeCards(co: Parameters<typeof stateFromCompany>[0] | null): boolean {
  return !!co && stripeEnabled && stateFromCompany(co).ready;
}

/** Superadmin-only: route a tenant's card payments through NVC360's own account. */
export async function setUsePlatform(companyId: string, enabled: boolean) {
  await db
    .update(schema.companies)
    .set({ stripeUsePlatform: enabled, updatedAt: new Date() })
    .where(eq(schema.companies.id, companyId));
}

/** Create the connected account for a tenant (idempotent per tenant). */
export async function ensureConnectedAccount(companyId: string, country: ConnectCountry) {
  if (!stripeEnabled) throw new Error("Stripe is not configured");
  const co = await loadCompanyConnect(companyId);
  if (!co) throw new Error("Company not found");
  if (co.stripeAccountId) return co.stripeAccountId;

  const stripe = getStripe();
  const acct = await stripe.accounts.create(
    {
      country,
      email: co.contactEmail || undefined,
      controller: {
        fees: { payer: "account" },
        losses: { payments: "stripe" },
        stripe_dashboard: { type: "full" },
        requirement_collection: "stripe",
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_profile: { name: co.name },
      metadata: { companyId },
    },
    { idempotencyKey: `connect_acct_v2_${companyId}` },
  );

  await db
    .update(schema.companies)
    .set({
      stripeAccountId: acct.id,
      stripeCountry: country,
      stripeChargesEnabled: !!acct.charges_enabled,
      stripePayoutsEnabled: !!acct.payouts_enabled,
      stripeDetailsSubmitted: !!acct.details_submitted,
      stripeConnectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.companies.id, companyId));

  log.info("stripe connect account created", { companyId, accountId: acct.id, country });
  return acct.id;
}

/** Stripe-hosted onboarding link (single use, expires in minutes). */
export async function createOnboardingLink(accountId: string, origin: string) {
  const stripe = getStripe();
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${origin}/admin/settings?section=payments&stripe=refresh`,
    return_url: `${origin}/admin/settings?section=payments&stripe=return`,
  });
  return link.url;
}

/**
 * Where the tenant manages payouts, balance, refunds and disputes. Full-dashboard
 * accounts sign in at dashboard.stripe.com with the login they created during
 * onboarding (login links only exist for Express accounts).
 */
export async function createDashboardLink(_accountId: string) {
  return "https://dashboard.stripe.com/";
}

/**
 * Pull the live account state from Stripe and mirror the flags we care about
 * onto `companies`. Used by the status endpoint (on return from onboarding)
 * and by the `account.updated` webhook. Runs on the system connection because
 * the webhook has no tenant context.
 */
export async function syncAccountFlags(acct: Pick<Stripe.Account, "id" | "charges_enabled" | "payouts_enabled" | "details_submitted" | "country">) {
  const [row] = await sdb
    .update(schema.companies)
    .set({
      stripeChargesEnabled: !!acct.charges_enabled,
      stripePayoutsEnabled: !!acct.payouts_enabled,
      stripeDetailsSubmitted: !!acct.details_submitted,
      stripeCountry: acct.country ?? "",
      updatedAt: new Date(),
    })
    .where(eq(schema.companies.stripeAccountId, acct.id))
    .returning({ id: schema.companies.id });
  return row?.id ?? null;
}

export async function refreshFromStripe(accountId: string) {
  const acct = await getStripe().accounts.retrieve(accountId);
  await syncAccountFlags(acct);
  return acct;
}

/** Human-readable list of what Stripe still needs from the tenant. */
export function describeRequirements(acct: Stripe.Account): string[] {
  const due = [
    ...(acct.requirements?.currently_due ?? []),
    ...(acct.requirements?.past_due ?? []),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of due) {
    const label = requirementLabel(key);
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

function requirementLabel(key: string): string {
  if (key.startsWith("external_account")) return "Bank account for payouts";
  if (key.startsWith("tos_acceptance")) return "Accept Stripe's terms";
  if (key.startsWith("business_profile")) return "Business details (name, website, what you sell)";
  if (key.startsWith("company.tax_id")) return "Business number / tax ID";
  if (key.startsWith("company")) return "Company details";
  if (key.startsWith("individual.verification") || key.includes("verification.document")) return "Government ID verification";
  if (key.startsWith("individual") || key.startsWith("representative") || key.startsWith("person_")) return "Owner / representative details";
  if (key.startsWith("settings.payments.statement_descriptor")) return "Statement descriptor";
  return key.replace(/[._]/g, " ");
}
