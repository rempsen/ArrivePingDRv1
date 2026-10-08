/**
 * Site crawl persistence (item E of the scrape audit).
 *
 * The brand scout reads a tenant's website once, at signup, and until now
 * everything but a dozen summary fields was thrown away the moment the
 * proposal was returned. This module keeps the raw crawl in `site_crawls`
 * (one row per scan, newest wins) so that:
 *   - the onboarding concierge can quote the tenant's own pages,
 *   - every AI writer (forms / templates / notification copy / service
 *     library / catalog) gets the actual page text, not a one-liner,
 *   - "Re-scan website" (item G) has a baseline to compare against,
 *   - support can see exactly what the scout saw when a tenant says
 *     "it got my services wrong".
 *
 * Best-effort everywhere: a failure to save/load a crawl must never block
 * provisioning or a chat turn.
 */
import { desc } from "drizzle-orm";
import * as schema from "../api/database/schema";
import { tdb } from "../api/database/tenant";
import type { BrandProposal, CrawledPage, StructuredHints } from "./brand-scout";
import { buildExcerpts } from "./brand-scout";

export type CrawlSource = "signup" | "rescan" | "backfill" | "superadmin";

export interface SiteCrawl {
  id: string;
  website: string;
  pages: CrawledPage[];
  structured: StructuredHints | null;
  excerpts: string;
  proposal: Partial<BrandProposal>;
  pageCount: number;
  source: string;
  createdAt: Date;
}

/** Hard cap on what one row may hold — 20 pages (home + sections + team + staff profiles) × 6k chars + proposal. */
const MAX_PAGES = 20;
const MAX_PAGE_CHARS = 6_000;

function normalizePages(raw: unknown): CrawledPage[] {
  if (!Array.isArray(raw)) return [];
  const out: CrawledPage[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const url = String((p as any).url ?? "").trim();
    const text = String((p as any).text ?? "").trim();
    if (!url || text.length < 40) continue;
    out.push({ url: url.slice(0, 500), title: String((p as any).title ?? "").slice(0, 160), text: text.slice(0, MAX_PAGE_CHARS) });
    if (out.length >= MAX_PAGES) break;
  }
  return out;
}

/**
 * Persist a crawl for a tenant. Accepts the loosely-typed `brand` object the
 * signup/superadmin forms post back (it's been through the zod BrandProposal
 * schema, but the crawl fields are kept permissive there on purpose).
 * Returns the row id, or null when there was nothing worth saving.
 */
export async function saveSiteCrawl(
  companyId: string,
  brand: Record<string, any>,
  source: CrawlSource,
): Promise<string | null> {
  const pages = normalizePages(brand?.pages);
  if (!pages.length) return null;
  const structured = brand?.structured && typeof brand.structured === "object" ? brand.structured : null;
  const excerpts = typeof brand?.excerpts === "string" && brand.excerpts.trim() ? brand.excerpts.trim().slice(0, 4_000) : buildExcerpts(pages);
  // Strip the bulky/transient bits from the stored proposal.
  const { pages: _p, structured: _s, excerpts: _e, warnings: _w, ...rest } = brand ?? {};
  void _p;
  void _s;
  void _e;
  void _w;
  const website = String(brand?.website ?? pages[0]?.url ?? "").slice(0, 300);
  const [row] = await tdb(companyId).insert(schema.siteCrawls, {
    website,
    pages: JSON.stringify(pages),
    structured: JSON.stringify(structured),
    excerpts,
    proposal: JSON.stringify(rest),
    pageCount: pages.length,
    source,
  });
  return row?.id ?? null;
}

/** Newest crawl for a tenant, or null when the site was never scanned. */
export async function loadSiteCrawl(companyId: string): Promise<SiteCrawl | null> {
  const t = tdb(companyId);
  const rows = await t.transaction((tx) =>
    tx.select().from(schema.siteCrawls).where(t.scope(schema.siteCrawls)).orderBy(desc(schema.siteCrawls.createdAt)).limit(1),
  );
  const r = rows[0];
  if (!r) return null;
  const parse = <T>(s: string, fb: T): T => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return fb;
    }
  };
  return {
    id: r.id,
    website: r.website,
    pages: normalizePages(parse<unknown>(r.pages, [])),
    structured: parse<StructuredHints | null>(r.structured, null),
    excerpts: r.excerpts,
    proposal: parse<Partial<BrandProposal>>(r.proposal, {}),
    pageCount: r.pageCount,
    source: r.source,
    createdAt: r.createdAt,
  };
}

/**
 * The excerpt digest for a tenant, for prompt building. Empty string when
 * there's no crawl — callers treat that as "no website signal".
 */
export async function loadSiteExcerpts(companyId: string): Promise<string> {
  try {
    const c = await loadSiteCrawl(companyId);
    return c?.excerpts ?? "";
  } catch {
    return "";
  }
}
