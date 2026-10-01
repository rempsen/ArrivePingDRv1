/**
 * Brand Scout — the AI onboarding engine behind "Grab Brand Assets".
 *
 * Given a company website, it:
 *   1. fetches the homepage HTML
 *   1b. (item 3, 2026-10-01) follows up to MAX_SUBPAGES same-origin links
 *       that look like Services / Service Area / About pages — that's where
 *       the services list and coverage actually live on most trade sites,
 *       not the homepage hero — and parses any schema.org JSON-LD
 *       (LocalBusiness / Organization) as authoritative structured hints
 *   2. captures a full-page screenshot (headless Chrome)
 *   3. runs a vision model over the screenshot for brand COLORS + LOGO presence
 *   4. runs a text model over the HTML (homepage + sub-pages + JSON-LD) for
 *      worker-noun, tagline, services, hours, address, contact info, socials
 *   5. resolves the best logo candidate and hosts it on our own storage
 *
 * JSON-LD also acts as a deterministic fallback: if the text model fails or
 * leaves a field null, we fill phone/email/address/hours/services/socials/
 * serviceArea from the structured data directly.
 *
 * Everything degrades gracefully: if the site blocks us, JS-walls its content,
 * or a model call fails, we return whatever partial data we have so the admin
 * can finish by hand on the review screen.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateObject } from "ai";
import { z } from "zod";
import { gateway, MODELS } from "../api/agent/gateway";
import { putObject } from "../api/lib/storage";
import { log } from "../api/lib/logger";
import { formatPhone } from "../api/lib/validate";
import { INDUSTRY_LABELS } from "./industry-presets";

export interface BrandProposal {
  website: string;
  primaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null; // hosted on our storage (absolute), ready for emails
  logoSourceUrl: string | null; // where we found it on their site
  workerNoun: string | null;
  workerNounPlural: string | null;
  customerNoun: string | null;
  customerNounPlural: string | null;
  jobNoun: string | null;
  jobNounPlural: string | null;
  tagline: string | null;
  description: string | null;
  // Freeform "where do you do work" guess, read off a service-area page, an
  // "areas we serve" list, or city names mentioned in the footer/contact
  // section. Null when the site gives no signal either way.
  serviceArea: string | null;
  services: string[];
  hours: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  socials: Record<string, string>;
  // AI's best guess at which Primary Industry (ICP) preset fits this
  // business, from the same page-read pass that pulls terminology/services —
  // no extra model call. The admin reviews/overrides on the New Company form.
  suggestedIndustry: string | null; // one of INDUSTRY_LABELS ids, or "other"
  suggestedIndustryOther: string | null; // free-text guess when "other"
  suggestedIndustryRationale: string | null; // one short sentence why
  warnings: string[];
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Normalise a user-typed website into a fetchable absolute URL. */
export function normalizeUrl(raw: string): string {
  let u = (raw || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    return new URL(u).toString();
  } catch {
    return "";
  }
}

function absolutize(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

async function fetchHtml(
  url: string,
): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return { html, finalUrl: res.url || url };
  } catch (e) {
    log.warn("brand-scout: fetch failed", { url, err: String(e) });
    return null;
  }
}

/** Capture a homepage screenshot with headless Chrome. Returns PNG bytes. */
async function screenshot(url: string): Promise<Buffer | null> {
  let dir = "";
  try {
    dir = await mkdtemp(join(tmpdir(), "bscout-"));
    const out = join(dir, "shot.png");
    const bin = process.env.CHROME_BIN || "google-chrome";
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--window-size=1280,1600",
      "--virtual-time-budget=8000",
      `--screenshot=${out}`,
      url,
    ];
    await new Promise<void>((resolve, reject) => {
      const p = spawn(bin, args, { stdio: "ignore" });
      const timer = setTimeout(() => {
        p.kill("SIGKILL");
        reject(new Error("screenshot timeout"));
      }, 30_000);
      p.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      p.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    return await readFile(out);
  } catch (e) {
    log.warn("brand-scout: screenshot failed", { url, err: String(e) });
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Pick logo candidate URLs from the raw HTML, best-first. We look at
 * <link rel="icon">, og:image, apple-touch-icon, and <img> tags whose
 * attributes mention "logo". All resolved to absolute URLs.
 */
function logoCandidates(html: string, base: string): string[] {
  const out: string[] = [];
  const push = (href?: string | null) => {
    if (!href) return;
    const abs = absolutize(base, href);
    if (abs && !out.includes(abs)) out.push(abs);
  };

  // <img ... logo ...>
  const imgRe = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html))) {
    const tag = m[0];
    if (/logo/i.test(tag)) {
      const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      push(src);
    }
  }
  // og:image
  const og =
    /<meta[^>]+property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(
      html,
    )?.[1] ||
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image["']/i.exec(
      html,
    )?.[1];
  push(og);
  // apple-touch-icon + icon links
  const linkRe = /<link\b[^>]*>/gi;
  while ((m = linkRe.exec(html))) {
    const tag = m[0];
    if (/rel\s*=\s*["'][^"']*(apple-touch-icon|icon)[^"']*["']/i.test(tag)) {
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      push(href);
    }
  }
  return out;
}

/** Strip tags/scripts to give the text model a clean-ish content sample. */
function textSample(html: string): string {
  const head = html.slice(0, 60_000);
  return head
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12_000);
}

// ── Item 3: bounded crawl + schema.org ─────────────────────────────────

const MAX_SUBPAGES = 3;
const SUBPAGE_TEXT_CHARS = 5_000;
/** Hard wall-clock cap on the whole sub-page crawl (runs in parallel). */
const CRAWL_BUDGET_MS = 18_000;

/**
 * Score a link by how likely it is to hold services / coverage / about
 * content. Higher = fetch first. 0 = ignore.
 */
function subpageScore(path: string, anchorText: string): number {
  const hay = `${path} ${anchorText}`.toLowerCase();
  // pages that match a keyword but never hold the content we want
  if (/gallery|estimate|quote|schedule|book|contact|careers?|jobs?|blog|news|review|testimonial|privacy|terms|login|cart|faq|coupon|financing/.test(hay)) return 0;
  if (/\b(service|services|what-we-do|our-work|solutions|offerings|pricing|rates)\b/.test(hay)) return 3;
  if (/\b(service-?areas?|areas?-(we-)?serve|coverage|locations?|where-we-work|cities)\b/.test(hay)) return 3;
  if (/\b(about|about-us|our-story|who-we-are|company|team)\b/.test(hay)) return 2;
  return 0;
}

/**
 * Pick up to MAX_SUBPAGES same-origin links worth a second fetch. Skips the
 * homepage, fragments, files, mailto/tel, and anything on another host.
 */
export function pickSubpages(html: string, base: string): string[] {
  let origin: string;
  let basePath: string;
  try {
    const u = new URL(base);
    origin = u.origin;
    basePath = u.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return [];
  }
  const scored = new Map<string, number>();
  const aRe = /<a\b[^>]*href\s*=\s*["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = aRe.exec(html))) {
    const href = m[1].trim();
    if (!href || /^(mailto:|tel:|javascript:|sms:)/i.test(href)) continue;
    const abs = absolutize(base, href);
    if (!abs) continue;
    let u: URL;
    try {
      u = new URL(abs);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    if (/\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|mp4)$/i.test(u.pathname)) continue;
    const path = u.pathname.replace(/\/+$/, "") || "/";
    if (path === basePath || path === "/") continue;
    u.hash = "";
    u.search = "";
    const key = u.toString();
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    const score = subpageScore(path, text);
    if (!score) continue;
    scored.set(key, Math.max(scored.get(key) ?? 0, score));
  }
  // Prefer variety: at most one services page, one coverage page, one about
  // page — a site with 12 service sub-pages shouldn't eat the whole budget.
  const buckets: Record<string, string[]> = { svc: [], area: [], about: [] };
  // highest score first; within a score, shortest path first so a section
  // landing page (/services/) beats one of its children (/services/drains).
  const ordered = [...scored.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
  for (const [url, score] of ordered) {
    const p = url.toLowerCase();
    const bucket = /area|serve|coverage|location|cities|where-we-work/.test(p)
      ? "area"
      : /about|story|who-we-are|company|team/.test(p)
        ? "about"
        : "svc";
    buckets[bucket].push(url);
    void score;
  }
  const out: string[] = [];
  for (const b of ["svc", "area", "about"]) if (buckets[b][0]) out.push(buckets[b][0]);
  // top up from leftover services pages if a bucket was empty
  for (const b of ["svc", "area", "about"])
    for (const u of buckets[b].slice(1)) if (out.length < MAX_SUBPAGES && !out.includes(u)) out.push(u);
  return out.slice(0, MAX_SUBPAGES);
}

export interface StructuredHints {
  name: string | null;
  description: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  hours: string | null;
  areaServed: string | null;
  services: string[];
  socials: Record<string, string>;
  logo: string | null;
  types: string[];
}

const BUSINESS_TYPE_RE =
  /Business|Organization|Corporation|Store|Service|Plumber|Electrician|HVACBusiness|HousePainter|Locksmith|MovingCompany|RoofingContractor|GeneralContractor|AutoRepair|Dentist|Physician|MedicalBusiness|HomeAndConstructionBusiness|ProfessionalService|LegalService|FoodEstablishment|SportsActivityLocation/;

function flattenLd(node: unknown, out: any[], depth = 0): void {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) {
    for (const n of node) flattenLd(n, out, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  const types = ([] as unknown[]).concat(o["@type"] ?? []).map(String);
  if (types.some((t) => BUSINESS_TYPE_RE.test(t))) out.push(o);
  if (o["@graph"]) flattenLd(o["@graph"], out, depth + 1);
  for (const k of ["mainEntity", "mainEntityOfPage", "publisher", "provider", "parentOrganization"])
    if (o[k] && typeof o[k] === "object") flattenLd(o[k], out, depth + 1);
}

function ldStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(ldStr).filter(Boolean).join(", ") || null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return ldStr(o.name ?? o["@id"] ?? o.url ?? null);
  }
  return null;
}

function ldAddress(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v.trim() || null;
  if (Array.isArray(v)) return ldAddress(v[0]);
  if (typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry]
    .map(ldStr)
    .filter(Boolean);
  return parts.join(", ") || null;
}

function ldHours(o: Record<string, unknown>): string | null {
  const direct = ldStr(o.openingHours);
  if (direct) return direct;
  const spec = o.openingHoursSpecification;
  if (!spec) return null;
  const arr = Array.isArray(spec) ? spec : [spec];
  const lines = arr
    .map((s: any) => {
      const days = ([] as unknown[])
        .concat(s?.dayOfWeek ?? [])
        .map((d) => String(ldStr(d) ?? "").replace(/^.*\//, "").slice(0, 3))
        .filter(Boolean);
      if (!days.length || !s?.opens) return null;
      return `${days.join(", ")} ${s.opens}–${s.closes ?? ""}`.trim();
    })
    .filter(Boolean);
  return lines.join("; ") || null;
}

function ldServices(o: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    const s = ldStr(v);
    if (s && !out.includes(s)) out.push(s.slice(0, 80));
  };
  const cat = o.hasOfferCatalog as any;
  const items = ([] as any[]).concat(cat?.itemListElement ?? []);
  for (const it of items) {
    push(it?.itemOffered ?? it?.name ?? it);
    for (const sub of ([] as any[]).concat(it?.itemListElement ?? [])) push(sub?.itemOffered ?? sub?.name ?? sub);
  }
  for (const off of ([] as any[]).concat(o.makesOffer ?? [])) push(off?.itemOffered ?? off?.name);
  if (typeof o.knowsAbout !== "undefined") for (const k of ([] as unknown[]).concat(o.knowsAbout)) push(k);
  return out.slice(0, 12);
}

/**
 * Parse every <script type="application/ld+json"> block and merge the
 * LocalBusiness / Organization nodes into one hint object. Malformed JSON
 * is skipped silently. Pure function — safe to unit test.
 */
export function extractJsonLd(html: string, base: string): StructuredHints | null {
  const nodes: any[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      flattenLd(JSON.parse(raw), nodes);
    } catch {
      // some sites wrap in CDATA or leave trailing commas — try a loose cleanup once
      try {
        flattenLd(JSON.parse(raw.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "").replace(/,\s*([}\]])/g, "$1")), nodes);
      } catch {
        /* skip */
      }
    }
  }
  if (!nodes.length) return null;
  const h: StructuredHints = {
    name: null,
    description: null,
    phone: null,
    email: null,
    address: null,
    hours: null,
    areaServed: null,
    services: [],
    socials: {},
    logo: null,
    types: [],
  };
  const socialHost: [RegExp, string][] = [
    [/facebook\.com/i, "facebook"],
    [/instagram\.com/i, "instagram"],
    [/(twitter|x)\.com/i, "twitter"],
    [/linkedin\.com/i, "linkedin"],
    [/youtube\.com|youtu\.be/i, "youtube"],
    [/tiktok\.com/i, "tiktok"],
  ];
  for (const o of nodes) {
    for (const t of ([] as unknown[]).concat(o["@type"] ?? []).map(String)) if (!h.types.includes(t)) h.types.push(t);
    h.name ||= ldStr(o.name);
    h.description ||= ldStr(o.description);
    h.phone ||= ldStr(o.telephone);
    h.email ||= ldStr(o.email)?.replace(/^mailto:/i, "") ?? null;
    h.address ||= ldAddress(o.address);
    h.hours ||= ldHours(o);
    h.areaServed ||= ldStr(o.areaServed);
    for (const s of ldServices(o)) if (!h.services.includes(s)) h.services.push(s);
    const logo = ldStr((o.logo as any)?.url ?? o.logo) ?? ldStr((o.image as any)?.url ?? o.image);
    if (logo && !h.logo) h.logo = absolutize(base, logo);
    for (const u of ([] as unknown[]).concat(o.sameAs ?? []).map(String)) {
      for (const [re2, k] of socialHost) if (re2.test(u) && !h.socials[k]) h.socials[k] = u;
    }
  }
  h.services = h.services.slice(0, 12);
  return h;
}

function hintsBlock(h: StructuredHints | null): string {
  if (!h) return "";
  const lines = [
    h.name && `name: ${h.name}`,
    h.types.length && `schema types: ${h.types.join(", ")}`,
    h.description && `description: ${h.description}`,
    h.phone && `phone: ${h.phone}`,
    h.email && `email: ${h.email}`,
    h.address && `address: ${h.address}`,
    h.hours && `hours: ${h.hours}`,
    h.areaServed && `areaServed: ${h.areaServed}`,
    h.services.length && `services: ${h.services.join(" | ")}`,
    Object.keys(h.socials).length && `socials: ${Object.values(h.socials).join(" ")}`,
  ].filter(Boolean);
  return lines.length
    ? `STRUCTURED DATA (schema.org JSON-LD published by the site — treat as authoritative where present):\n${lines.join("\n")}\n\n`
    : "";
}

/**
 * Fetch the chosen sub-pages in parallel under one wall-clock budget.
 * Failures are logged, never surfaced as warnings — these are bonus signal.
 */
async function crawlSubpages(urls: string[]): Promise<{ url: string; text: string; html: string }[]> {
  if (!urls.length) return [];
  const budget = new Promise<null>((r) => setTimeout(() => r(null), CRAWL_BUDGET_MS));
  const results = await Promise.all(
    urls.map((u) =>
      Promise.race([fetchHtml(u), budget]).then((r) =>
        r ? { url: r.finalUrl, html: r.html, text: textSample(r.html).slice(0, SUBPAGE_TEXT_CHARS) } : null,
      ),
    ),
  );
  return results.filter((r): r is { url: string; text: string; html: string } => Boolean(r && r.text.length > 200));
}

/** Download a remote image and host it on our storage. Returns hosted URL. */
async function hostLogo(
  candidates: string[],
  companyId: string,
): Promise<{ url: string; source: string } | null> {
  for (const src of candidates.slice(0, 6)) {
    try {
      const res = await fetch(src, {
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") || "";
      if (!/image\//i.test(ct) && !/\.(png|jpe?g|svg|webp|gif)$/i.test(src))
        continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength < 200) continue; // junk / 1px
      if (buf.byteLength > 5_000_000) continue; // too big to embed in email
      const ext =
        ct.includes("svg") || /\.svg/i.test(src)
          ? "svg"
          : ct.includes("png") || /\.png/i.test(src)
            ? "png"
            : ct.includes("webp") || /\.webp/i.test(src)
              ? "webp"
              : "jpg";
      const key = `brand/${companyId}/logo-${Date.now()}.${ext}`;
      const stored = await putObject(
        key,
        buf,
        ct || `image/${ext === "jpg" ? "jpeg" : ext}`,
      );
      return { url: stored.url, source: src };
    } catch {
      // try next candidate
    }
  }
  return null;
}

const VisionSchema = z.object({
  primaryColor: z
    .string()
    .describe("Dominant brand hex color, e.g. #1e3932")
    .nullable(),
  accentColor: z
    .string()
    .describe("Secondary/accent hex color used for buttons or highlights")
    .nullable(),
});

const INDUSTRY_ID_LIST = INDUSTRY_LABELS.map((i) => i.id) as [string, ...string[]];

const TextSchema = z.object({
  companyDescription: z
    .string()
    .describe("One or two sentences on what the business does")
    .nullable(),
  tagline: z.string().describe("Marketing slogan if present").nullable(),
  workerNoun: z
    .string()
    .describe(
      "The SINGULAR job title this company uses for its field staff who go to customers — e.g. Technician, Plumber, Electrician, Driver, Cleaner, Pro, Contractor, Stylist. Infer from their trade if not stated.",
    )
    .nullable(),
  workerNounPlural: z.string().describe("Plural of workerNoun").nullable(),
  customerNoun: z
    .string()
    .describe(
      "The SINGULAR word this business (or its industry) uses for the people it serves — e.g. Customer, Client, Patient, Passenger, Resident, Family, Guest. Infer from their industry if not stated.",
    )
    .nullable(),
  customerNounPlural: z.string().describe("Plural of customerNoun").nullable(),
  jobNoun: z
    .string()
    .describe(
      "The SINGULAR word this business's industry uses for a unit of work — e.g. Job, Visit, Ride, Delivery, Route, Appointment, Order, Ticket, Project. Infer from their trade if not stated.",
    )
    .nullable(),
  jobNounPlural: z.string().describe("Plural of jobNoun").nullable(),
  services: z
    .array(z.string())
    .describe("Up to 8 services they offer")
    .default([]),
  hours: z.string().describe("Business hours as plain text").nullable(),
  serviceArea: z
    .string()
    .describe(
      "Where this business actually does work, in plain English — e.g. 'Winnipeg and the Capital Region, up to 50km out' or 'Greater Toronto Area'. Read off a service-area/coverage page, an 'areas we serve' list, or city names mentioned in the footer/contact section. Null if the site gives no signal either way — do not guess from the mailing address alone.",
    )
    .nullable(),
  address: z.string().describe("Physical address").nullable(),
  email: z.string().describe("Contact email").nullable(),
  phone: z.string().describe("Contact phone").nullable(),
  socials: z
    .object({
      facebook: z.string().nullable(),
      instagram: z.string().nullable(),
      twitter: z.string().nullable(),
      linkedin: z.string().nullable(),
      youtube: z.string().nullable(),
      tiktok: z.string().nullable(),
    })
    .partial()
    .describe("Social profile URLs found on the page"),
  suggestedIndustry: z
    .enum(["other", ...INDUSTRY_ID_LIST])
    .describe(
      "Best-fit Primary Industry (ICP) category id for this business from the allowed list. Use 'other' if none genuinely fit — do not force a bad match.",
    )
    .nullable(),
  suggestedIndustryOther: z
    .string()
    .describe(
      "Only when suggestedIndustry is 'other': a short (2-5 word) label for what kind of business this actually is, e.g. 'Wedding Photography', 'Pest Control'.",
    )
    .nullable(),
  suggestedIndustryRationale: z
    .string()
    .describe("One short sentence explaining the industry guess, shown to the admin for review.")
    .nullable(),
});

/** Main entry — run the full brand-scout pipeline. */
export async function scoutBrand(
  rawWebsite: string,
  companyId: string,
): Promise<BrandProposal> {
  const website = normalizeUrl(rawWebsite);
  const warnings: string[] = [];
  const empty: BrandProposal = {
    website,
    primaryColor: null,
    accentColor: null,
    logoUrl: null,
    logoSourceUrl: null,
    workerNoun: null,
    workerNounPlural: null,
    customerNoun: null,
    customerNounPlural: null,
    jobNoun: null,
    jobNounPlural: null,
    tagline: null,
    description: null,
    serviceArea: null,
    services: [],
    hours: null,
    address: null,
    email: null,
    phone: null,
    socials: {},
    suggestedIndustry: null,
    suggestedIndustryOther: null,
    suggestedIndustryRationale: null,
    warnings,
  };
  if (!website) {
    warnings.push("Invalid website URL.");
    return empty;
  }

  const page = await fetchHtml(website);
  if (!page) {
    warnings.push(
      "Couldn't load the website (it may block bots or be offline). Fill in the brand details manually.",
    );
    return empty;
  }
  const { html, finalUrl } = page;

  // Item 3: bounded crawl of services / coverage / about pages, in parallel
  // with the screenshot. Sub-page text and any JSON-LD go into ONE text-model
  // call — no extra model round-trips.
  const subpageUrls = pickSubpages(html, finalUrl);
  const shotPromise = screenshot(finalUrl); // runs alongside crawl + text model
  const subpages = await crawlSubpages(subpageUrls);
  const structured = (() => {
    let h = extractJsonLd(html, finalUrl);
    for (const sp of subpages) {
      const more = extractJsonLd(sp.html, sp.url);
      if (!more) continue;
      if (!h) {
        h = more;
        continue;
      }
      for (const k of ["name", "description", "phone", "email", "address", "hours", "areaServed", "logo"] as const)
        (h as any)[k] ||= more[k];
      for (const s of more.services) if (!h.services.includes(s)) h.services.push(s);
      for (const [k, v] of Object.entries(more.socials)) if (!h.socials[k]) h.socials[k] = v;
    }
    return h;
  })();
  log.info("brand-scout: crawl", {
    url: finalUrl,
    subpages: subpages.map((s) => s.url),
    jsonLd: Boolean(structured),
    ldTypes: structured?.types ?? [],
  });

  const subpageBlock = subpages
    .map((sp) => `\n\nSUB-PAGE (${sp.url}):\n${sp.text}`)
    .join("");

  const [shot, textResult] = await Promise.allSettled([
    shotPromise,
    generateObject({
      model: gateway(MODELS.text),
      schema: TextSchema,
      prompt: `You are analysing a field-service / trade / delivery business's website to onboard them into a dispatch & customer-management platform. From the page text below, extract the brand details AND classify their Primary Industry (ICP). Be accurate; use null when unknown. Homepage URL: ${finalUrl}

ALLOWED INDUSTRY CATEGORIES (pick the single best fit, or "other" if genuinely none fit):
${INDUSTRY_LABELS.map((i) => `- ${i.id}: ${i.label}`).join("\n")}

${hintsBlock(structured)}HOMEPAGE TEXT:\n${textSample(html)}${subpageBlock}`,
    }),
  ]);

  // vision pass on the screenshot for colors
  let vision: z.infer<typeof VisionSchema> | null = null;
  if (shot.status === "fulfilled" && shot.value) {
    try {
      const { object } = await generateObject({
        model: gateway(MODELS.vision),
        schema: VisionSchema,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analyse this website screenshot. Identify the company's primary brand color and a secondary/accent color (used on buttons, links or highlights). Return hex codes.",
              },
              {
                type: "image",
                image: new Uint8Array(shot.value),
              },
            ],
          },
        ],
      });
      vision = object;
    } catch (e) {
      warnings.push("Couldn't analyse brand colors from the screenshot.");
      log.warn("brand-scout: vision failed", { err: String(e) });
    }
  } else {
    warnings.push(
      "Couldn't screenshot the site — brand colors may be incomplete.",
    );
  }

  let text: z.infer<typeof TextSchema> | null = null;
  if (textResult.status === "fulfilled") {
    text = textResult.value.object;
  } else {
    warnings.push("Couldn't read company details from the page.");
    log.warn("brand-scout: text failed", { err: String(textResult.reason) });
  }

  // logo: gather candidates from HTML, host the best one
  const candidates = logoCandidates(html, finalUrl);
  if (structured?.logo && !candidates.includes(structured.logo)) candidates.unshift(structured.logo);
  const hosted = candidates.length
    ? await hostLogo(candidates, companyId)
    : null;
  if (!hosted && candidates.length)
    warnings.push("Found logo links but couldn't download one — add it manually.");
  if (!candidates.length)
    warnings.push("No logo detected on the homepage.");

  const clamp = (v: string | null | undefined, max: number): string | null => {
    if (!v) return null;
    const t = v.trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max - 1);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(","), cut.lastIndexOf(" "), 40))}…`;
  };
  const normHex = (h: string | null | undefined): string | null => {
    if (!h) return null;
    const v = h.trim();
    return /^#?[0-9a-f]{6}$/i.test(v) ? (v.startsWith("#") ? v : `#${v}`) : null;
  };

  const socials: Record<string, string> = {};
  if (text?.socials) {
    for (const [k, v] of Object.entries(text.socials)) {
      if (v && typeof v === "string") socials[k] = v;
    }
  }
  for (const [k, v] of Object.entries(structured?.socials ?? {})) if (!socials[k]) socials[k] = v;

  // Deterministic fallback: anything the model left null that the site's
  // own JSON-LD states outright.
  const services = text?.services?.length ? text.services : structured?.services.slice(0, 8) ?? [];

  return {
    website: finalUrl,
    primaryColor: normHex(vision?.primaryColor),
    accentColor: normHex(vision?.accentColor),
    logoUrl: hosted?.url ?? null,
    logoSourceUrl: hosted?.source ?? candidates[0] ?? null,
    workerNoun: text?.workerNoun ?? null,
    workerNounPlural: text?.workerNounPlural ?? null,
    customerNoun: text?.customerNoun ?? null,
    customerNounPlural: text?.customerNounPlural ?? null,
    jobNoun: text?.jobNoun ?? null,
    jobNounPlural: text?.jobNounPlural ?? null,
    tagline: text?.tagline ?? null,
    description: text?.companyDescription ?? structured?.description ?? null,
    // CompanyCreateBody caps brand.serviceArea at 300 chars; the crawl can
    // now surface long "areas we serve" lists, so clamp here rather than fail
    // signup validation downstream.
    serviceArea: clamp(text?.serviceArea ?? structured?.areaServed ?? null, 300),
    services,
    hours: text?.hours ?? structured?.hours ?? null,
    address: text?.address ?? structured?.address ?? null,
    email: text?.email ?? structured?.email ?? null,
    phone: formatPhone(text?.phone ?? structured?.phone ?? null),
    socials,
    suggestedIndustry: text?.suggestedIndustry ?? null,
    suggestedIndustryOther: text?.suggestedIndustryOther ?? null,
    suggestedIndustryRationale: text?.suggestedIndustryRationale ?? null,
    warnings,
  };
}
