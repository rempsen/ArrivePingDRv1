/**
 * Shared prompt fragments for the provisioning "scouts" (forms, templates,
 * notification copy, services, catalog).
 *
 * Item D of the scrape audit: the tenant's OWN website is the primary source
 * of truth and the ICP preset / deep research is the fallback. Every scout
 * injects the same verbatim-excerpt block so the writers see the real page
 * text (services named the way the company names them, their actual claims,
 * their voice) instead of only a 2-4 sentence summary.
 */

export const SITE_BLOCK_CHARS = 3_500;

/** Verbatim-excerpt block for a scout prompt, or "" when there's nothing. */
export function siteBlock(excerpts: string | null | undefined, max = SITE_BLOCK_CHARS): string {
  const text = typeof excerpts === "string" ? excerpts.trim() : "";
  if (!text) return "";
  const clipped = text.length > max ? `${text.slice(0, max).trimEnd()}\n[…truncated]` : text;
  return `\n\nTHE COMPANY'S OWN WEBSITE (verbatim excerpts, most relevant pages first — this is the PRIMARY source of truth about what they offer, how they describe it, and how they talk):\n<<<\n${clipped}\n>>>`;
}

/**
 * The "who wins" sentence. When we have site text the website leads and the
 * preset is the fallback; otherwise fall back to the caller's preset-first
 * wording (unchanged from before item D so preset-only tenants are not
 * affected).
 */
export function sourcePriority(hasSite: boolean, presetFirst: string, what: string): string {
  if (!hasSite) return presetFirst;
  return `SOURCE PRIORITY: the company's OWN WEBSITE excerpts above are the primary driver of ${what} — name the services THEY actually list (their wording, not the preset's), mirror the specific claims they make (24/7, free estimates, financing, licensed & insured, family-owned, brands carried, years in business) and match their voice. The PRIMARY INDUSTRY (ICP) preset and tone guidance are the FALLBACK for anything the site doesn't cover. Never invent a service or claim the website doesn't make.`;
}
