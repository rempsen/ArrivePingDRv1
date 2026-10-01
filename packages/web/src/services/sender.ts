/**
 * The one place that decides what a tenant's outbound mail may claim to be from.
 *
 * The rule (stated at the top of email-domains.ts): a tenant's
 * emailFromAddress is only honoured once that domain has a
 * tenant_email_domains row with status "verified". dispatch.ts enforced it;
 * email.ts's resolveFromAddress() did not, which left the Stripe receipt and
 * the password-reset email able to send as an unverified — or simply
 * unowned — domain. Both senders now call this.
 *
 * Pure on purpose: the DB read (verifiedDomainsForCompany) stays at the call
 * site so the decision itself is testable without credentials.
 */

export interface SenderConfig {
  emailFromName?: string | null;
  emailFromAddress?: string | null;
  emailReplyTo?: string | null;
}

export interface SenderIdentity {
  /** RFC 5322 "Name <addr>", or undefined to let the platform default apply. */
  from?: string;
  replyTo?: string;
}

/**
 * @param verifiedDomains lowercase domains this company has verified in Resend.
 *   Exact match only — a subdomain is a separate Resend domain, and suffix
 *   matching would let notbmdmaterials.com ride on bmdmaterials.com.
 */
/**
 * Mailbox providers nobody can verify DNS for. A tenant whose business runs on
 * ryler@icloud.com cannot send *as* icloud.com from any platform — Apple owns
 * the domain and Resend rejects it outright ("We don't allow free public
 * domains"). The supported path for them is the "via" sender below.
 */
export const FREE_MAILBOX_DOMAINS = new Set([
  "icloud.com", "me.com", "mac.com",
  "gmail.com", "googlemail.com",
  "outlook.com", "hotmail.com", "hotmail.ca", "hotmail.co.uk", "live.com", "live.ca", "msn.com",
  "yahoo.com", "yahoo.ca", "yahoo.co.uk", "ymail.com", "rogers.com",
  "aol.com", "protonmail.com", "proton.me", "pm.me",
  "shaw.ca", "telus.net", "sympatico.ca", "bell.net", "videotron.ca", "mts.net", "mymts.net",
  "comcast.net", "att.net", "verizon.net", "sbcglobal.net",
  "zoho.com", "mail.com", "gmx.com", "gmx.net", "fastmail.com", "hey.com",
]);

export function isFreeMailboxDomain(domain: string): boolean {
  return FREE_MAILBOX_DOMAINS.has((domain || "").trim().toLowerCase());
}

function splitAddress(addr: string): { local: string; domain: string } | null {
  const parts = addr.split("@");
  if (parts.length !== 2) return null;
  const local = (parts[0] || "").trim();
  const domain = (parts[1] || "").trim().toLowerCase();
  if (!local || !domain || !domain.includes(".")) return null;
  return { local, domain };
}

/** Bare address out of "Name <addr>" or "addr". */
function bareAddress(from: string): string {
  const m = /<([^>]+)>\s*$/.exec(from.trim());
  return (m ? m[1] : from).trim();
}

/**
 * @param verifiedDomains lowercase domains this company has verified in Resend.
 *   Exact match only — a subdomain is a separate Resend domain, and suffix
 *   matching would let notbmdmaterials.com ride on bmdmaterials.com.
 * @param platformFrom the platform's own verified sender ("Name <addr>" or
 *   bare addr). When given and the tenant has no verified domain of their own,
 *   mail goes out as "<Their name> via ArrivePing <platform addr>" with
 *   Reply-To pointing at their real inbox — so a solo operator on
 *   ryler@icloud.com still gets branded mail and still gets the replies.
 *   Omitted → legacy behaviour (from undefined, caller's default applies).
 */
export function pickSender(
  cfg: SenderConfig,
  verifiedDomains: string[],
  platformFrom?: string,
): SenderIdentity {
  // Reply-to is independent of the From guard: it is a header the recipient's
  // client honours, not an identity we assert, and several tenants set only
  // this so office replies land in the right inbox.
  const explicitReplyTo = cfg.emailReplyTo?.trim() || undefined;

  const addr = cfg.emailFromAddress?.trim() || "";
  const parsed = addr ? splitAddress(addr) : null;
  const name = (cfg.emailFromName || "").trim();

  if (parsed) {
    const allowed = new Set(verifiedDomains.map((d) => d.trim().toLowerCase()).filter(Boolean));
    if (allowed.has(parsed.domain)) {
      return { from: `${name || parsed.domain} <${addr}>`, replyTo: explicitReplyTo };
    }
  }

  // Not verified (or nothing set). If we know the platform's address, send
  // "via" it so the tenant's name still shows and replies reach them. Their
  // unverified From address is a perfectly good Reply-To — it is where they
  // read mail, we just can't send as it.
  const replyTo = explicitReplyTo || (parsed ? addr : undefined);
  if (platformFrom && name) {
    const platformAddr = bareAddress(platformFrom);
    if (platformAddr.includes("@")) {
      return { from: `${name} via ArrivePing <${platformAddr}>`, replyTo };
    }
  }
  return { replyTo };
}

/** The domain part of "Name <user@host>" or a bare "user@host", lowercased. */
export function senderDomain(addr: string | undefined | null): string {
  const m = /<([^>]+)>\s*$/.exec((addr || "").trim());
  const bare = (m ? m[1] : addr || "").trim();
  return (bare.split("@")[1] || "").trim().toLowerCase();
}

/**
 * When Resend rejects a send with "domain is not verified", who do we retry as?
 *
 * The old code retried with the global EMAIL_FROM whenever it differed from the
 * sender STRING. Observed live: a tenant sending as "NVC360
 * <contact@nvc360.com>" with EMAIL_FROM="contact@nvc360.com" retried on the
 * very same broken domain — a guaranteed second failure and a wasted API call.
 * Compare domains, not strings, and fall through to the shared test sender.
 *
 * Returns undefined when there is nowhere better to go.
 */
export function pickRetrySender(
  sender: string,
  envFrom: string,
  fallback: string,
): string | undefined {
  const bad = senderDomain(sender);
  for (const candidate of [envFrom, fallback]) {
    if (!candidate) continue;
    if (candidate === sender) continue;
    if (bad && senderDomain(candidate) === bad) continue;
    return candidate;
  }
  return undefined;
}
