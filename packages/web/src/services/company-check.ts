/**
 * Company data check — the "second look" at a tenant's profile.
 *
 * Standard set 2026-10-09 after the BMD Materials dry run: for every tenant,
 * gather what the outside world says about the business, compare it against
 * what ArrivePing currently has, and show the admin a line-by-line diff they
 * approve or reject. Nothing is written without a tick.
 *
 * Sources are pluggable (`EnrichmentSource`). Today:
 *   - website: the existing Brand Scout crawl (homepage + about/contact/
 *     services/team pages, JSON-LD, AI read). Always on.
 *   - apollo:  Apollo.io organization enrichment (phone, HQ address, LinkedIn/
 *     Facebook, industry keywords). Activates only when APOLLO_API_KEY is set;
 *     otherwise skipped silently. 1 Apollo credit per company check.
 *
 * Output is a list of CheckItems. Each has a stable `key` that the apply step
 * maps back to exactly one allowed column (or one new bookable service), so
 * the client only ever sends `{ key, value }` pairs — never raw patches.
 */
import { eq } from "drizzle-orm";
import { db } from "../api/database";
import * as schema from "../api/database/schema";
import { tdb } from "../api/database/tenant";
import { usersForCompany } from "../api/lib/memberships";
import { log } from "../api/lib/logger";
import { scoutBrand, type BrandProposal } from "./brand-scout";
import { saveSiteCrawl } from "./site-crawl";
import { forwardGeocode } from "./geocode";
import { INDUSTRY_LABELS } from "./industry-presets";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckGroup = "profile" | "socials" | "services" | "team";
/** fill = we have nothing, they have something · conflict = both have a value and they differ · add = new row (service) */
export type CheckKind = "fill" | "conflict" | "add";

export interface CheckItem {
  key: string;
  group: CheckGroup;
  kind: CheckKind;
  label: string;
  current: string | null;
  proposed: string;
  source: string;
  /** Plain-English why / caveat shown under the row. */
  note?: string;
}

export interface CheckResult {
  companyId: string;
  website: string;
  checkedAt: string;
  sources: string[];
  /** How many bookable services the tenant already has — the UI pre-ticks new-service rows only when this is 0. */
  bookableCount: number;
  items: CheckItem[];
  /** Things worth knowing that aren't applyable (team found on site, head count, tools). */
  notes: string[];
  warnings: string[];
}

/** What any enrichment source can contribute. Every field optional. */
export interface EnrichmentFacts {
  source: string;
  name?: string | null;
  phone?: string | null;
  address?: string | null;
  email?: string | null;
  website?: string | null;
  socials?: Record<string, string>;
  industryHint?: string | null;
  /** Service / capability phrases — merged into service suggestions. */
  serviceKeywords?: string[];
  description?: string | null;
  tagline?: string | null;
  hours?: string | null;
  serviceArea?: string | null;
  logoUrl?: string | null;
  employeeCount?: number | null;
  foundedYear?: number | null;
  techStack?: string[];
  people?: { name: string; title: string | null }[];
  warnings?: string[];
}

export interface EnrichmentSource {
  id: string;
  label: string;
  enabled(): boolean;
  run(input: { website: string; companyId: string; name: string }): Promise<EnrichmentFacts | null>;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const websiteSource: EnrichmentSource = {
  id: "website",
  label: "Website",
  enabled: () => true,
  async run({ website, companyId }) {
    if (!website) return null;
    const p: BrandProposal = await scoutBrand(website, companyId);
    // Same crawl store as "Re-scan website": the newest site_crawls row feeds
    // the concierge and AI writers, so a check keeps it fresh too. Best-effort.
    try {
      await saveSiteCrawl(companyId, p as unknown as Record<string, any>, "rescan");
    } catch (e) {
      console.error("[company-check] site-crawl save failed", e);
    }
    return {
      source: "Website",
      phone: p.phone,
      address: p.address,
      email: p.email,
      website: p.website,
      socials: p.socials,
      industryHint: p.suggestedIndustry,
      serviceKeywords: p.services,
      description: p.description,
      tagline: p.tagline,
      hours: p.hours,
      serviceArea: p.serviceArea,
      logoUrl: p.logoUrl,
      people: p.teamMembers.map((m) => ({ name: m.name, title: m.title })),
      warnings: p.warnings,
    };
  },
};

/**
 * Apollo.io organization enrichment. Gated on APOLLO_API_KEY; with no key the
 * source reports disabled and the check runs website-only. Kept deliberately
 * small: one GET, defensive parsing, no people lookups (those cost 1–9
 * credits each and inviting staff should stay a human decision).
 */
const apolloSource: EnrichmentSource = {
  id: "apollo",
  label: "Apollo",
  enabled: () => Boolean(process.env.APOLLO_API_KEY),
  async run({ website }) {
    const key = process.env.APOLLO_API_KEY;
    if (!key || !website) return null;
    let domain = "";
    try {
      domain = new URL(website).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
    const url = new URL("https://api.apollo.io/api/v1/organizations/enrich");
    url.searchParams.set("domain", domain);
    let data: any;
    try {
      const res = await fetch(url, {
        headers: { "x-api-key": key, accept: "application/json", "cache-control": "no-cache" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        log.warn("company-check: apollo non-200", { status: res.status, domain });
        return { source: "Apollo", warnings: [`Apollo lookup failed (HTTP ${res.status}).`] };
      }
      data = await res.json();
    } catch (e: any) {
      log.warn("company-check: apollo failed", { error: e?.message, domain });
      return { source: "Apollo", warnings: ["Apollo lookup timed out."] };
    }
    const o = data?.organization;
    if (!o) return { source: "Apollo", warnings: ["Apollo has no record for this domain."] };
    const socials: Record<string, string> = {};
    if (typeof o.linkedin_url === "string" && o.linkedin_url) socials.linkedin = o.linkedin_url;
    if (typeof o.facebook_url === "string" && o.facebook_url) socials.facebook = o.facebook_url;
    if (typeof o.twitter_url === "string" && o.twitter_url) socials.twitter = o.twitter_url;
    return {
      source: "Apollo",
      name: typeof o.name === "string" ? o.name : null,
      phone: typeof o.phone === "string" ? o.phone : (typeof o.primary_phone?.number === "string" ? o.primary_phone.number : null),
      address: typeof o.raw_address === "string" ? o.raw_address : null,
      website: typeof o.website_url === "string" ? o.website_url : null,
      socials,
      industryHint: typeof o.industry === "string" ? o.industry : null,
      serviceKeywords: Array.isArray(o.keywords) ? o.keywords.filter((k: unknown) => typeof k === "string") : [],
      description: typeof o.short_description === "string" ? o.short_description : null,
      employeeCount: typeof o.estimated_num_employees === "number" ? o.estimated_num_employees : null,
      foundedYear: typeof o.founded_year === "number" ? o.founded_year : null,
      techStack: Array.isArray(o.technology_names) ? o.technology_names.filter((k: unknown) => typeof k === "string") : [],
    };
  },
};

export const SOURCES: EnrichmentSource[] = [websiteSource, apolloSource];

// ---------------------------------------------------------------------------
// Normalisers
// ---------------------------------------------------------------------------

export function digits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}
export function normText(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\b(street|st\.?)\b/g, "st")
    .replace(/\b(avenue|ave\.?)\b/g, "ave")
    .replace(/\b(road|rd\.?)\b/g, "rd")
    .replace(/\bcanada\b|\bca\b|\busa?\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function normUrl(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}
function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
const STOP = new Set(["and", "the", "of", "for", "a", "an", "to", "in", "with", "services", "service", "supply", "install", "installation", "commercial", "residential"]);
function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((t) => t.length > 2 && !STOP.has(t))
      .map((t) => t.replace(/s$/, "")),
  );
}
/** True when the proposed service is already covered by an existing name. */
export function serviceCovered(proposed: string, existing: string[]): boolean {
  const p = tokens(proposed);
  if (p.size === 0) return true;
  for (const e of existing) {
    const et = tokens(e);
    if (et.size === 0) continue;
    let hit = 0;
    for (const t of p) if (et.has(t)) hit++;
    const ratio = hit / Math.min(p.size, et.size);
    if (ratio >= 0.6) return true;
  }
  return false;
}
function titleCase(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(And|Or|Of|For|The|In|With)\b/g, (m) => m.toLowerCase());
}
export function slugKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}
/** A service keyword is only a service if it reads like work someone books. */
const SERVICE_HINT = /(install|repair|replac|clean|maint|inspect|service|consult|coverings|flooring|decking|tile|roof|plumb|hvac|electric|paint|landscap|design|procure|logistic|budget|engineer|window|door|drywall|concrete|fenc|siding|gutter|snow|lawn|pest|lock|glass|cabinet|counter|measur|estimate|treatment|shade|blind)/i;

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export async function runCompanyCheck(companyId: string): Promise<CheckResult> {
  const t = tdb(companyId);
  const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  if (!co) throw new Error("Company not found");
  const settings = await t.selectOne(schema.companySettings);
  const bookable = await t.select(schema.services);
  const team = await usersForCompany(companyId);

  const website = (settings?.website || "").trim();
  const warnings: string[] = [];
  const notes: string[] = [];
  const items: CheckItem[] = [];
  const sourcesUsed: string[] = [];

  if (!website) {
    warnings.push("No website on file — add one under Settings → Company and run the check again.");
    return { companyId, website: "", checkedAt: new Date().toISOString(), sources: [], bookableCount: bookable.length, items, notes, warnings };
  }

  const facts: EnrichmentFacts[] = [];
  for (const src of SOURCES) {
    if (!src.enabled()) continue;
    try {
      const f = await src.run({ website, companyId, name: settings?.name ?? co.name });
      if (f) {
        facts.push(f);
        sourcesUsed.push(src.label);
        for (const w of f.warnings ?? []) warnings.push(`${src.label}: ${w}`);
      }
    } catch (e: any) {
      warnings.push(`${src.label}: ${e?.message ?? "failed"}`);
    }
  }
  if (!SOURCES.find((s) => s.id === "apollo")!.enabled()) {
    notes.push("Second-source lookup (Apollo) is off — set APOLLO_API_KEY to cross-check against a company database.");
  }

  const first = <K extends keyof EnrichmentFacts>(k: K): { v: NonNullable<EnrichmentFacts[K]>; src: string } | null => {
    for (const f of facts) {
      const v = f[k];
      if (v == null) continue;
      if (typeof v === "string" && !v.trim()) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
      return { v: v as NonNullable<EnrichmentFacts[K]>, src: f.source };
    }
    return null;
  };

  // ---- profile scalars -------------------------------------------------------
  const cur = {
    phone: settings?.phone || co.phone || "",
    email: settings?.email || co.contactEmail || "",
    address: settings?.address || "",
    officeAddress: co.officeAddress || "",
    tagline: settings?.tagline || "",
    description: settings?.description || "",
    hours: settings?.hours || "",
    serviceArea: settings?.serviceArea || "",
    logo: settings?.logo || "",
    industry: co.industry || "",
  };

  const phone = first("phone");
  if (phone) {
    const p = String(phone.v);
    if (!digits(cur.phone)) items.push({ key: "settings.phone", group: "profile", kind: "fill", label: "Phone", current: null, proposed: p, source: phone.src });
    else if (digits(cur.phone) !== digits(p))
      items.push({ key: "settings.phone", group: "profile", kind: "conflict", label: "Phone", current: cur.phone, proposed: p, source: phone.src, note: "Customers see this number on booking pages and in texts. Pick the main line, not a cell." });
    // Second source disagreeing with the first is worth a flag too.
    for (const f of facts) {
      if (f.source !== phone.src && f.phone && digits(f.phone) !== digits(p) && digits(f.phone) !== digits(cur.phone))
        notes.push(`${f.source} lists a different phone (${f.phone}) than ${phone.src} (${p}).`);
    }
  }

  const email = first("email");
  if (email) {
    const e = String(email.v).toLowerCase();
    if (!cur.email) items.push({ key: "settings.email", group: "profile", kind: "fill", label: "Contact email", current: null, proposed: e, source: email.src });
    else if (cur.email.toLowerCase() !== e)
      items.push({ key: "settings.email", group: "profile", kind: "conflict", label: "Contact email", current: cur.email, proposed: e, source: email.src, note: "Only switch if the public inbox changed." });
  }

  const address = first("address");
  if (address) {
    const a = String(address.v);
    if (!cur.address || normText(cur.address) === normText("423 Main Street, Winnipeg, Manitoba, Canada"))
      items.push({ key: "settings.address", group: "profile", kind: "fill", label: "Business address", current: cur.address || null, proposed: a, source: address.src, note: "Also re-pins the map location." });
    else if (normText(cur.address) !== normText(a))
      items.push({ key: "settings.address", group: "profile", kind: "conflict", label: "Business address", current: cur.address, proposed: a, source: address.src, note: "Usually an old vs. new office. Applying re-pins the map location." });
    if (!cur.officeAddress)
      items.push({ key: "companies.officeAddress", group: "profile", kind: "fill", label: "Office location (fleet map centre)", current: null, proposed: a, source: address.src });
  }

  const site = first("website");
  if (site && !settings?.website) items.push({ key: "settings.website", group: "profile", kind: "fill", label: "Website", current: null, proposed: String(site.v), source: site.src });

  // Prose fields: fill-only. Flagging "conflicts" on taglines is noise.
  const prose: [keyof typeof cur & ("tagline" | "description" | "hours" | "serviceArea"), string][] = [
    ["tagline", "Tagline"],
    ["description", "About / description"],
    ["hours", "Business hours"],
    ["serviceArea", "Service area"],
  ];
  for (const [k, label] of prose) {
    const got = first(k);
    if (got && !cur[k]) items.push({ key: `settings.${k}`, group: "profile", kind: "fill", label, current: null, proposed: String(got.v), source: got.src });
  }

  const logo = first("logoUrl");
  if (logo && !cur.logo) items.push({ key: "settings.logo", group: "profile", kind: "fill", label: "Logo", current: null, proposed: String(logo.v), source: logo.src, note: "Found on the website. You can replace it any time." });

  const ind = first("industryHint");
  if (ind && !cur.industry) {
    const id = String(ind.v);
    const known = INDUSTRY_LABELS.find((x) => x.id === id);
    if (known) items.push({ key: "companies.industry", group: "profile", kind: "fill", label: "Primary industry", current: null, proposed: known.id, source: ind.src, note: known.label });
    else notes.push(`${ind.src} describes the business as “${id}” — pick the closest ArrivePing industry under Settings → Company.`);
  }

  // ---- socials -------------------------------------------------------------
  const curSocials = parseJson<Record<string, string>>(settings?.socials, {});
  const merged: Record<string, { url: string; src: string }> = {};
  for (const f of facts) for (const [k, v] of Object.entries(f.socials ?? {})) if (v && !merged[k]) merged[k] = { url: v, src: f.source };
  const SOCIAL_LABEL: Record<string, string> = { linkedin: "LinkedIn", facebook: "Facebook", instagram: "Instagram", twitter: "X / Twitter", youtube: "YouTube", tiktok: "TikTok", yelp: "Yelp", google: "Google Business" };
  for (const [k, { url, src }] of Object.entries(merged)) {
    const label = SOCIAL_LABEL[k] ?? titleCase(k);
    const have = curSocials[k];
    if (!have) items.push({ key: `settings.socials.${k}`, group: "socials", kind: "fill", label, current: null, proposed: url, source: src });
    else if (normUrl(have) !== normUrl(url)) items.push({ key: `settings.socials.${k}`, group: "socials", kind: "conflict", label, current: have, proposed: url, source: src });
  }

  // ---- services ------------------------------------------------------------
  const existingNames = [
    ...bookable.map((s) => s.name),
    ...parseJson<string[]>(settings?.services, []).filter((s) => typeof s === "string"),
  ];
  const seen = new Set<string>();
  for (const f of facts) {
    for (const kw of f.serviceKeywords ?? []) {
      const name = titleCase(kw);
      if (name.length < 4 || name.length > 70) continue;
      if (f.source !== "Website" && !SERVICE_HINT.test(name)) continue; // Apollo keywords include "procurement logistics", "hubspot" etc.
      const k = slugKey(name);
      if (!k || seen.has(k)) continue;
      if (serviceCovered(name, [...existingNames, ...[...seen].map((s) => s.replace(/-/g, " "))])) continue;
      seen.add(k);
      items.push({ key: `service.${k}`, group: "services", kind: "add", label: "New bookable service", current: null, proposed: name, source: f.source, note: "Added at $0 / 60 min — set price and duration under Services." });
    }
  }
  if (bookable.length === 0 && items.every((i) => i.group !== "services")) notes.push("No bookable services yet and none could be read from the website — add them under Services.");

  // ---- team (notes only — never creates accounts) ----------------------------
  const teamNames = new Set(team.map((u) => normText(u.name ?? "")));
  const people = first("people");
  if (people) {
    const missing = (people.v as { name: string; title: string | null }[]).filter((p) => p.name && !teamNames.has(normText(p.name)));
    if (missing.length)
      notes.push(`Found on the website but not on your team: ${missing.map((p) => (p.title ? `${p.name} (${p.title})` : p.name)).join(", ")}. Invite them from Team if they should have access.`);
  }
  const emp = first("employeeCount");
  if (emp) notes.push(`${emp.src} estimates ${emp.v} employees; you have ${team.length} people in ArrivePing.`);
  const tech = first("techStack");
  if (tech) {
    const interesting = (tech.v as string[]).filter((x) => /hubspot|salesforce|quickbooks|xero|microsoft|google workspace|outlook|zoho|pipedrive|mailchimp/i.test(x));
    if (interesting.length) notes.push(`Tools in use per ${tech.src}: ${interesting.slice(0, 5).join(", ")} — worth checking Settings → Integrations.`);
  }

  log.info("company-check: done", { companyId, items: items.length, sources: sourcesUsed });
  return { companyId, website, checkedAt: new Date().toISOString(), sources: sourcesUsed, bookableCount: bookable.length, items, notes, warnings };
}

// ---------------------------------------------------------------------------
// Apply — client sends { key, value }; the server maps key → ONE allowed write.
// ---------------------------------------------------------------------------

export interface ApplyInput {
  key: string;
  value: string;
}
export interface ApplyResult {
  applied: string[];
  skipped: { key: string; reason: string }[];
}

const SETTINGS_TEXT_KEYS = new Set(["phone", "email", "website", "tagline", "description", "hours", "serviceArea", "logo"]);

export async function applyCompanyCheck(companyId: string, picks: ApplyInput[]): Promise<ApplyResult> {
  const t = tdb(companyId);
  const applied: string[] = [];
  const skipped: ApplyResult["skipped"] = [];
  const settingsPatch: Record<string, unknown> = {};
  const companyPatch: Record<string, unknown> = {};
  let socialsPatch: Record<string, string> | null = null;
  const newServices: string[] = [];

  const settings = await t.selectOne(schema.companySettings);
  const bookable = await t.select(schema.services);

  for (const pick of picks) {
    const key = String(pick.key ?? "");
    const value = String(pick.value ?? "").trim();
    if (!value || value.length > 4000) {
      skipped.push({ key, reason: "empty or too long" });
      continue;
    }
    const [scope, field, sub] = key.split(".");
    if (scope === "settings" && field && SETTINGS_TEXT_KEYS.has(field) && !sub) {
      settingsPatch[field] = value;
      applied.push(key);
    } else if (scope === "settings" && field === "address" && !sub) {
      settingsPatch.address = value;
      const hit = await forwardGeocode(value).catch(() => null);
      if (hit) {
        settingsPatch.lat = hit.lat;
        settingsPatch.lng = hit.lng;
      }
      applied.push(key);
    } else if (scope === "settings" && field === "socials" && sub && /^[a-z]{2,20}$/.test(sub)) {
      if (!/^https?:\/\//i.test(value)) {
        skipped.push({ key, reason: "not a URL" });
        continue;
      }
      socialsPatch ??= parseJson<Record<string, string>>(settings?.socials, {});
      socialsPatch[sub] = value;
      applied.push(key);
    } else if (scope === "companies" && field === "officeAddress" && !sub) {
      companyPatch.officeAddress = value;
      const hit = await forwardGeocode(value).catch(() => null);
      if (hit) {
        companyPatch.officeLat = hit.lat;
        companyPatch.officeLng = hit.lng;
      }
      applied.push(key);
    } else if (scope === "companies" && field === "industry" && !sub) {
      if (!INDUSTRY_LABELS.some((x) => x.id === value)) {
        skipped.push({ key, reason: "unknown industry" });
        continue;
      }
      companyPatch.industry = value;
      applied.push(key);
    } else if (scope === "service" && field && !sub) {
      const name = titleCase(value).slice(0, 80);
      if (serviceCovered(name, [...bookable.map((s) => s.name), ...newServices])) {
        skipped.push({ key, reason: "already exists" });
        continue;
      }
      newServices.push(name);
      applied.push(key);
    } else {
      skipped.push({ key, reason: "unknown field" });
    }
  }

  if (socialsPatch) settingsPatch.socials = JSON.stringify(socialsPatch);
  if (Object.keys(settingsPatch).length) {
    settingsPatch.updatedAt = new Date();
    if (settings) await t.update(schema.companySettings, settingsPatch as any, undefined);
    else await t.insert(schema.companySettings, { id: companyId, ...settingsPatch } as any);
  }
  if (Object.keys(companyPatch).length) {
    companyPatch.updatedAt = new Date();
    await db.update(schema.companies).set(companyPatch as any).where(eq(schema.companies.id, companyId));
  }
  for (const name of newServices) {
    await t.insert(schema.services, {
      name,
      category: slugKey(name.split(/[/,(]/)[0]!.trim()).split("-").slice(0, 3).join("-") || "general",
      basePrice: 0,
      durationMins: 60,
    } as any);
  }
  return { applied, skipped };
}
