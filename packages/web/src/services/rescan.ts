/**
 * Website re-scan (item G of the scrape audit).
 *
 * Signup runs the brand scout exactly once. Tenants who signed up before the
 * deeper crawl shipped have an empty description / hours / service area and
 * no `site_crawls` row at all; tenants who redesign their site have stale
 * copy. `rescanWebsite()` re-runs the scout against the tenant's recorded
 * website and:
 *
 *   1. persists a fresh `site_crawls` row (newest wins — the concierge and
 *      every AI writer read the newest one),
 *   2. fills EMPTY company_settings fields from the new proposal (never
 *      overwrites a value an admin typed, unless `overwrite` is set),
 *   3. merges the scouted team / contact emails / customer-mentioned staff
 *      into qualifying_profile so the onboarding chat can use them.
 *
 * Callers: admin Settings ("Re-scan website"), the onboarding concierge's
 * `rescan_website` tool, and superadmin `POST /companies/:id/rescan` +
 * `POST /companies/rescan-all` (the backfill for the 11 pre-crawl tenants).
 */
import * as schema from "../api/database/schema";
import { tdb } from "../api/database/tenant";
import { scoutBrand, type BrandProposal } from "./brand-scout";
import { scoutedTeamProfile } from "./company-provisioning";
import { saveSiteCrawl, type CrawlSource } from "./site-crawl";

export interface RescanOptions {
  /** Explicit URL; defaults to company_settings.website. */
  website?: string | null;
  /** Replace non-empty settings fields too. Default false (fill-empty only). */
  overwrite?: boolean;
  source?: CrawlSource;
}

export interface RescanResult {
  ok: boolean;
  website: string;
  pageCount: number;
  crawlId: string | null;
  /** company_settings columns that were written. */
  filled: string[];
  /** Columns that had a value and were left alone (only when !overwrite). */
  kept: string[];
  teamFound: number;
  mentionedStaff: string[];
  warnings: string[];
  error?: string;
}

/** proposal field → settings column, for the plain-string fields. */
const FIELD_MAP: [keyof BrandProposal, keyof typeof schema.companySettings.$inferSelect][] = [
  ["description", "description"],
  ["tagline", "tagline"],
  ["hours", "hours"],
  ["serviceArea", "serviceArea"],
  ["address", "address"],
  ["email", "email"],
  ["phone", "phone"],
  ["logoUrl", "logo"],
  ["primaryColor", "brandColor"],
  ["accentColor", "accentColor"],
  ["workerNoun", "workerNoun"],
  ["workerNounPlural", "workerNounPlural"],
  ["customerNoun", "customerNoun"],
  ["customerNounPlural", "customerNounPlural"],
  ["jobNoun", "jobNoun"],
  ["jobNounPlural", "jobNounPlural"],
  ["googleReviewUrl", "googleReviewUrl"],
];

/**
 * Columns whose schema default is a real-looking value rather than "" — the
 * "is it empty?" test treats the default as empty so a never-edited tenant
 * still gets filled.
 */
const DEFAULT_LIKE: Partial<Record<string, string[]>> = {
  brandColor: ["#06B6D4"],
  address: ["423 Main Street, Winnipeg, Manitoba, Canada"],
  workerNoun: ["Technician"],
  workerNounPlural: ["Technicians"],
  customerNoun: ["Customer"],
  customerNounPlural: ["Customers"],
  jobNoun: ["Job"],
  jobNounPlural: ["Jobs"],
};

function isEmpty(col: string, v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim();
  if (!s) return true;
  if (col === "services" || col === "socials") {
    // JSON-ish columns: "[]", "{}", "null" all count as empty.
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.length === 0;
      if (parsed && typeof parsed === "object") return Object.keys(parsed).length === 0;
      return !parsed;
    } catch {
      return false;
    }
  }
  return (DEFAULT_LIKE[col] ?? []).includes(s);
}

function parseProfile(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function uniqNames(a: unknown, b: unknown, max: number): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const list of [a, b]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const key =
        typeof item === "string"
          ? item.trim().toLowerCase()
          : item && typeof item === "object"
            ? String((item as any).email || (item as any).name || "").trim().toLowerCase()
            : "";
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= max) return out;
    }
  }
  return out;
}

export async function rescanWebsite(companyId: string, opts: RescanOptions = {}): Promise<RescanResult> {
  const t = tdb(companyId);
  const row = await t.selectOne(schema.companySettings);
  const website = String(opts.website ?? row?.website ?? "").trim();
  const base: RescanResult = {
    ok: false,
    website,
    pageCount: 0,
    crawlId: null,
    filled: [],
    kept: [],
    teamFound: 0,
    mentionedStaff: [],
    warnings: [],
  };
  if (!row) return { ...base, error: "No company_settings row for this tenant" };
  if (!website) return { ...base, error: "No website on file — add one under Settings → Company first" };

  let proposal: BrandProposal;
  try {
    proposal = await scoutBrand(website, companyId);
  } catch (e: any) {
    return { ...base, error: `Scan failed: ${e?.message ?? "unknown error"}` };
  }
  base.warnings = proposal.warnings ?? [];
  base.pageCount = proposal.pages?.length ?? 0;
  base.website = proposal.website || website;

  // 1) persist the crawl (newest wins).
  try {
    base.crawlId = await saveSiteCrawl(companyId, proposal as unknown as Record<string, any>, opts.source ?? "rescan");
  } catch (e) {
    console.error("[rescan] site-crawl save failed", e);
    base.warnings.push("Could not store the raw crawl");
  }

  // 2) fill settings.
  const set: Record<string, unknown> = {};
  const consider = (col: string, next: unknown) => {
    if (next == null) return;
    const v = typeof next === "string" ? next.trim() : next;
    if (typeof v === "string" && !v) return;
    if (!opts.overwrite && !isEmpty(col, (row as any)[col])) {
      base.kept.push(col);
      return;
    }
    // Same value as before (e.g. the scout also said "Technician") — not a change worth reporting.
    if (typeof v === "string" && typeof (row as any)[col] === "string" && (row as any)[col].trim() === v) return;
    set[col] = v;
    base.filled.push(col);
  };
  for (const [src, col] of FIELD_MAP) consider(col, proposal[src]);
  if (proposal.services?.length) consider("services", JSON.stringify(proposal.services));
  if (proposal.socials && Object.keys(proposal.socials).length) consider("socials", JSON.stringify(proposal.socials));
  if (proposal.logoSourceUrl && isEmpty("logoSourceUrl", (row as any).logoSourceUrl)) set.logoSourceUrl = proposal.logoSourceUrl;
  // The settings website is normalised to whatever the scout actually
  // fetched (scheme added, trailing slash dropped) only when it was blank.
  if (isEmpty("website", row.website) && base.website) {
    set.website = base.website;
    base.filled.push("website");
  }

  // 3) team / mentions → qualifying_profile (merge, never drop).
  const scouted = scoutedTeamProfile(proposal as unknown as Record<string, any>);
  const existing = parseProfile(row.qualifyingProfile);
  const merged: Record<string, unknown> = { ...existing };
  if (scouted.scoutedTeam) merged.scoutedTeam = uniqNames(existing.scoutedTeam, scouted.scoutedTeam, 30);
  if (scouted.scoutedEmails) merged.scoutedEmails = uniqNames(existing.scoutedEmails, scouted.scoutedEmails, 10);
  if (scouted.mentionedStaff) merged.mentionedStaff = uniqNames(existing.mentionedStaff, scouted.mentionedStaff, 12);
  merged.lastRescanAt = new Date().toISOString();
  set.qualifyingProfile = JSON.stringify(merged);
  base.teamFound = Array.isArray(merged.scoutedTeam) ? merged.scoutedTeam.length : 0;
  base.mentionedStaff = Array.isArray(merged.mentionedStaff) ? (merged.mentionedStaff as string[]) : [];

  set.updatedAt = new Date();
  await t.update(schema.companySettings, set as any);
  base.ok = true;
  return base;
}
