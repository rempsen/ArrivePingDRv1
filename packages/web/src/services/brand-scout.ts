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
import { existsSync } from "node:fs";
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
import { fetchGoogleReviewMentions, googlePlacesAvailable } from "./review-mentions";

export interface BrandProposal {
  website: string;
  // The business's own name as written on the site (JSON-LD name, else the
  // model's read of the header/footer). Pre-fills "Company name" on signup.
  companyName: string | null;
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
  // People named on the site's about / team / contact pages. Used to
  // pre-fill the onboarding roster ("I found Mike and Sarah on your Team
  // page — want me to set them up?"). Never creates accounts by itself.
  teamMembers: ScoutedTeamMember[];
  // Extra addresses found beyond the main contact email (e.g. dispatch@,
  // office@) — handy for matching staff to emails during onboarding.
  contactEmails: string[];
  // First names of staff that CUSTOMERS mention in testimonials / reviews
  // quoted on the site ("Mike was on time and explained everything"). Not
  // roster-grade — just prompts for the concierge ("your customers mention
  // a Mike and a Sarah — are they on the team?").
  mentionedStaff: string[];
  // Google Business Profile match (item F.2) — only when GOOGLE_MAPS_API_KEY
  // is configured. The review-request feature wants googleReviewUrl; the
  // rest is context for the concierge ("4.8 stars across 212 reviews").
  googleReviewUrl: string | null;
  googleReviews: { placeId: string; rating: number | null; count: number | null; mapsUri: string | null } | null;
  // ── Raw crawl (item E) ──────────────────────────────────────────────────
  // Everything the scout read, so it can be persisted (site_crawls) and
  // re-used after signup instead of re-fetching. Homepage first.
  pages: CrawledPage[];
  structured: StructuredHints | null;
  // ~3k-char plain-text digest of the most useful services/about copy —
  // handed to every downstream AI writer as the PRIMARY source of truth
  // about what this business does and how it talks.
  excerpts: string;
  warnings: string[];
}

export interface CrawledPage {
  url: string;
  title: string;
  /** Visible text, markup stripped, capped at PAGE_STORE_CHARS. */
  text: string;
}

export interface ScoutedTeamMember {
  name: string;
  /** Their title as written on the site, e.g. "Owner", "Lead Technician". */
  title: string | null;
  /** Our best bucket for what kind of account they'd need. */
  role: "tech" | "dispatcher" | "manager" | "owner" | "other";
  email: string | null;
  phone: string | null;
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

/**
 * Find a Chrome/Chromium binary we can drive headless. Production boxes
 * frequently have none (the oven/bun base image certainly doesn't), in which
 * case the screenshot is skipped and brand colors come from the stylesheet
 * instead (see `cssBrandColors`). `CHROME_BIN` wins when set.
 */
let chromeBinCache: string | null | undefined;
function findChrome(): string | null {
  if (chromeBinCache !== undefined) return chromeBinCache;
  const names = [
    process.env.CHROME_BIN,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter((n): n is string => !!n);
  const pathDirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const n of names) {
    const candidates = n.includes("/") ? [n] : pathDirs.map((d) => join(d, n));
    for (const c of candidates) {
      if (existsSync(c)) {
        chromeBinCache = c;
        return c;
      }
    }
  }
  chromeBinCache = null;
  return null;
}

/** Capture a homepage screenshot with headless Chrome. Returns PNG bytes. */
async function screenshot(url: string): Promise<Buffer | null> {
  const bin = findChrome();
  if (!bin) {
    log.warn("brand-scout: no Chrome binary on this host — skipping screenshot", { url });
    return null;
  }
  let dir = "";
  try {
    dir = await mkdtemp(join(tmpdir(), "bscout-"));
    const out = join(dir, "shot.png");
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

// ── Stylesheet-based brand colors (no browser needed) ─────────────────────
//
// When there's no screenshot (no Chrome on the box, site blocks headless
// browsers, timeout) we still owe the tenant a sensible primary/accent. The
// site's own CSS is a good proxy: the brand color is almost always the most
// repeated saturated color across the stylesheet (buttons, links, headings),
// and <meta name="theme-color"> is an explicit declaration when present.

function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.replace("#", "");
  const full =
    h.length === 3 || h.length === 4
      ? h.slice(0, 3).split("").map((c) => c + c).join("")
      : h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/** Hue (0-360), saturation and lightness (0-1) — enough to tell brand from grey. */
function hsl([r, g, b]: [number, number, number]): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return { h, s, l };
}

/** Pull every color literal out of a CSS/HTML blob as #rrggbb. */
export function extractCssColors(css: string): string[] {
  const out: string[] = [];
  const hexRe = /#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = hexRe.exec(css))) {
    const raw = m[1];
    // 8-digit = #rrggbbaa; 4-digit = #rgba. Drop the mostly-transparent ones.
    if (raw.length === 8 && parseInt(raw.slice(6), 16) < 128) continue;
    if (raw.length === 4 && parseInt(raw[3] + raw[3], 16) < 128) continue;
    const rgb = hexToRgb("#" + raw);
    if (rgb) out.push(rgbToHex(rgb));
  }
  const rgbRe = /rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?))?\s*\)/gi;
  while ((m = rgbRe.exec(css))) {
    if (m[4] !== undefined) {
      const a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (a < 0.5) continue;
    }
    out.push(rgbToHex([Number(m[1]), Number(m[2]), Number(m[3])]));
  }
  return out;
}

/**
 * Rank the colors in a stylesheet and pick a primary + accent. Greys, near-
 * white and near-black are ignored; near-identical shades are merged so a
 * button hover state counts toward its base color. `themeColor` (from
 * <meta name="theme-color">) is the site's own declaration and wins the
 * primary slot when it's a real color.
 */
export function pickBrandColorsFromCss(
  colors: string[],
  themeColor?: string | null,
): { primary: string | null; accent: string | null } {
  type Bucket = { hex: string; rgb: [number, number, number]; count: number };
  const buckets: Bucket[] = [];
  for (const hex of colors) {
    const rgb = hexToRgb(hex);
    if (!rgb) continue;
    const { s, l } = hsl(rgb);
    if (s < 0.25 || l < 0.12 || l > 0.9) continue; // grey / black / white
    const near = buckets.find(
      (b) => Math.abs(b.rgb[0] - rgb[0]) + Math.abs(b.rgb[1] - rgb[1]) + Math.abs(b.rgb[2] - rgb[2]) < 60,
    );
    if (near) near.count += 1;
    else buckets.push({ hex: rgbToHex(rgb), rgb, count: 1 });
  }
  buckets.sort((a, b) => b.count - a.count);

  let primary: string | null = null;
  const theme = themeColor ? hexToRgb(themeColor.trim()) : null;
  if (theme) {
    const { s, l } = hsl(theme);
    if (s >= 0.25 && l >= 0.12 && l <= 0.9) primary = rgbToHex(theme);
  }
  if (!primary) primary = buckets[0]?.hex ?? null;
  if (!primary) return { primary: null, accent: null };

  const pRgb = hexToRgb(primary)!;
  const pHue = hsl(pRgb).h;
  const accent =
    buckets.find((b) => {
      if (b.hex === primary) return false;
      const dist = Math.abs(b.rgb[0] - pRgb[0]) + Math.abs(b.rgb[1] - pRgb[1]) + Math.abs(b.rgb[2] - pRgb[2]);
      if (dist < 90) return false; // a shade of the primary, not an accent
      const dh = Math.abs(hsl(b.rgb).h - pHue);
      return Math.min(dh, 360 - dh) >= 25;
    })?.hex ?? null;
  return { primary, accent };
}

function themeColorMeta(html: string): string | null {
  const m = /<meta\b[^>]*name=["']theme-color["'][^>]*>/i.exec(html);
  if (!m) return null;
  const c = /content=["']([^"']+)["']/i.exec(m[0]);
  return c?.[1] ?? null;
}

/** Same-origin-ish stylesheet hrefs from <link rel="stylesheet">, best-first. */
function stylesheetUrls(html: string, base: string, max = 4): string[] {
  const out: string[] = [];
  const re = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < max) {
    const tag = m[0];
    if (!/rel=["'][^"']*stylesheet/i.test(tag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    const abs = href ? absolutize(base, href) : null;
    if (abs && !out.includes(abs)) out.push(abs);
  }
  return out;
}

const CSS_FETCH_LIMIT = 400_000; // chars per stylesheet — enough for a theme bundle

/**
 * Brand colors from the page's CSS: inline <style> blocks, inline style=""
 * attributes, and up to four linked stylesheets. Network failures are
 * tolerated per-sheet; whatever we did get is ranked.
 */
async function cssBrandColors(
  html: string,
  base: string,
): Promise<{ primary: string | null; accent: string | null }> {
  const blobs: string[] = [];
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleRe.exec(html))) blobs.push(m[1]);
  const attrRe = /style=["']([^"']+)["']/gi;
  while ((m = attrRe.exec(html))) blobs.push(m[1]);

  const sheets = stylesheetUrls(html, base);
  const fetched = await Promise.allSettled(
    sheets.map(async (u) => {
      const res = await fetch(u, {
        headers: { "user-agent": UA, accept: "text/css,*/*;q=0.1" },
        redirect: "follow",
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return "";
      return (await res.text()).slice(0, CSS_FETCH_LIMIT);
    }),
  );
  for (const f of fetched) if (f.status === "fulfilled" && f.value) blobs.push(f.value);

  const colors = extractCssColors(blobs.join("\n"));
  return pickBrandColorsFromCss(colors, themeColorMeta(html));
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
  // Strip the noise BEFORE windowing. The old version sliced the first 60k
  // chars of raw HTML first, which on sites with big inline-SVG navs and
  // script bundles in <head> left almost no visible text at all — whole
  // About/Staff pages were coming back as "<200 chars" and being dropped.
  //
  // 2026-10-08: the window moved AFTER the strip. Some franchise sites (Mr
  // Rooter, Tailwind builds) inline an 800 KB <style> block in <head>; the
  // old 600k pre-slice cut it in half, so the closing </style> was gone, the
  // regex never matched, and the "page text" we stored and sent to the model
  // was 6,000 chars of CSS — the Meet-the-Team page read as nothing but
  // `--tw-ring-offset-shadow`. Unclosed <style>/<script> openers are now
  // stripped to end-of-document as well, so a truncated block can never leak.
  //
  // Same day, second half of the bug: once the CSS was gone, the first 6,000
  // chars of a franchise page were the mega-menu (every service link twice),
  // so the people on a Meet-the-Team page still fell past the per-page cap.
  // Site chrome (<header>/<nav>/<footer>) is dropped and, when the page has a
  // <main> with real text in it, only <main> is kept.
  const head = html.slice(0, 3_000_000);
  const noCode = head
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(script|style)\b[\s\S]*$/i, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const main = /<main\b[\s\S]*?<\/main>/i.exec(noCode)?.[0];
  const body = main && main.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").length > 600 ? main : noCode;
  return body
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12_000);
}

// ── Item 3: bounded crawl + schema.org ─────────────────────────────────

const MAX_SUBPAGES = 5;
const SUBPAGE_TEXT_CHARS = 5_000;
/** Per-page cap for what we persist in site_crawls (the model sees less). */
const PAGE_STORE_CHARS = 6_000;
/** Target size of the `excerpts` digest handed to downstream writers. */
const EXCERPT_CHARS = 3_000;
/** Hard wall-clock cap on the whole sub-page crawl (runs in parallel). */
const CRAWL_BUDGET_MS = 22_000;

/**
 * Score a link by how likely it is to hold services / coverage / about
 * content. Higher = fetch first. 0 = ignore.
 */
function subpageScore(path: string, anchorText: string): number {
  const hay = `${path} ${anchorText}`.toLowerCase();
  // pages that match a keyword but never hold the content we want
  if (/gallery|estimate|quote|schedule|book|careers?|jobs?|blog|news|review|testimonial|privacy|terms|login|cart|faq|coupon|financing/.test(hay)) return 0;
  if (/\b(service|services|what-we-do|our-work|solutions|offerings|pricing|rates)\b/.test(hay)) return 3;
  if (/\b(service-?areas?|areas?-(we-)?serve|coverage|locations?|where-we-work|cities)\b/.test(hay)) return 3;
  // team / staff pages name the people we want to put on the roster
  if (/\b(team|our-team|meet-the-team|meet|staff|our-people|people|crew|technicians|leadership)\b/.test(hay)) return 3;
  if (/\b(about|about-us|our-story|who-we-are|company)\b/.test(hay)) return 2;
  // contact pages carry the office email/phone and often the owner's name
  if (/\b(contact|contact-us|get-in-touch|reach-us)\b/.test(hay)) return 2;
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
    const href = m[1]!.trim();
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
    const text = m[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    const score = subpageScore(path, text);
    if (!score) continue;
    scored.set(key, Math.max(scored.get(key) ?? 0, score));
  }
  // Prefer variety: at most one services page, one coverage page, one about
  // page, one team page, one contact page — a site with 12 service sub-pages
  // shouldn't eat the whole budget.
  const buckets: Record<string, string[]> = { svc: [], area: [], about: [], team: [], contact: [] };
  // highest score first; within a score, shortest path first so a section
  // landing page (/services/) beats one of its children (/services/drains).
  const ordered = [...scored.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
  for (const [url, score] of ordered) {
    const p = url.toLowerCase();
    const bucket = /area|serve|coverage|location|cities|where-we-work/.test(p)
      ? "area"
      : /team|staff|meet|people|crew|technicians|leadership/.test(p)
        ? "team"
        : /contact|get-in-touch|reach-us/.test(p)
          ? "contact"
          : /about|story|who-we-are|company/.test(p)
            ? "about"
            : "svc";
    buckets[bucket]!.push(url);
    void score;
  }
  const out: string[] = [];
  const order = ["svc", "area", "about", "team", "contact"];
  for (const b of order) if (buckets[b]![0]) out.push(buckets[b]![0]);
  // top up from leftover pages if a bucket was empty
  for (const b of order)
    for (const u of buckets[b]!.slice(1)) if (out.length < MAX_SUBPAGES && !out.includes(u)) out.push(u);
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

/** Sites often ship JSON-LD text HTML-escaped (`Sewer &amp; Drain`). */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
}

function ldStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return decodeEntities(v).trim() || null;
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
    const raw = m[1]!.trim();
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
type FetchedPage = { url: string; title: string; text: string; html: string };

async function crawlSubpages(urls: string[], budgetMs = CRAWL_BUDGET_MS, minChars = 200): Promise<FetchedPage[]> {
  if (!urls.length) return [];
  const budget = new Promise<null>((r) => setTimeout(() => r(null), budgetMs));
  const results = await Promise.all(
    urls.map((u) =>
      Promise.race([fetchHtml(u), budget]).then((r) =>
        r ? { url: r.finalUrl, title: pageTitle(r.html), html: r.html, text: textSample(r.html).slice(0, SUBPAGE_TEXT_CHARS) } : null,
      ),
    ),
  );
  return results.filter((r): r is FetchedPage => Boolean(r && r.text.length > minChars));
}

/** `<title>` of a page, entity-light, or "" when absent. */
export function pageTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return (m?.[1] ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** Which kind of page a URL path most likely is — used to rank excerpts. */
const TEAM_RE = /team|staff|meet|people|crew|technicians|leadership|our-plumbers|our-techs|our-electricians|who-we-are/i;
/** Level-3 team/contact pages: how many to follow and how long to wait. */
const MAX_TEAM_PAGES = 3;
const TEAM_HOP_MS = 8_000;
/** Level-4 staff profile pages: small pages, so more of them, less text each. */
const MAX_PROFILE_PAGES = 8;
const PROFILE_TEXT_CHARS = 1_500;
/** A team card or a profile can legitimately be "Jane Doe — Owner, 20 years": keep short pages. */
const PEOPLE_MIN_CHARS = 40;

/** Same-origin links on a page, deduped, no files / mailto / fragments. */
function sameOriginLinks(html: string, base: string): string[] {
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    return [];
  }
  const out = new Set<string>();
  const aRe = /<a\b[^>]*href\s*=\s*["']([^"'#]+)[^"']*["']/gi;
  let m: RegExpExecArray | null;
  while ((m = aRe.exec(html))) {
    const href = m[1]!.trim();
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
    u.hash = "";
    u.search = "";
    out.add(u.toString());
  }
  return [...out];
}

/**
 * Does `candidate` look like one person's profile page hanging off `teamUrl`?
 * Either a direct child of the team page (/team/ -> /team/jane-doe) or a path
 * that reads like /staff/<slug>, /our-team/<slug>. Section landing pages,
 * pagination and obvious non-person slugs are rejected.
 */
function looksLikeProfile(candidate: string, teamUrl: string): boolean {
  let c: URL;
  let t: URL;
  try {
    c = new URL(candidate);
    t = new URL(teamUrl);
  } catch {
    return false;
  }
  const cp = c.pathname.replace(/\/+$/, "");
  const tp = t.pathname.replace(/\/+$/, "");
  if (!cp || cp === tp) return false;
  const last = cp.split("/").pop() ?? "";
  if (!/^[a-z][a-z0-9-]{2,60}$/i.test(last)) return false;
  if (/^(page|p)-?\d+$|^\d+$|join|career|apply|contact|about|service|review|blog|news|gallery|location|faq/i.test(last)) return false;
  const child = tp !== "" && cp.startsWith(tp + "/") && cp.slice(tp.length + 1).split("/").length === 1;
  const named = /\/(team|our-team|meet-the-team|meet|staff|our-people|people|crew|technicians|leadership|employees?|members?)\/[^/]+$/i.test(cp);
  return child || named;
}

/**
 * Levels 3 and 4 of the crawl — see the caller for the level map. Returns the
 * extra team pages (full pages, merged into `subpages` by the caller) and the
 * individual staff profile pages (short text only). Bounded: at most
 * MAX_TEAM_PAGES + MAX_PROFILE_PAGES fetches, two parallel hops of
 * TEAM_HOP_MS each, and it never throws.
 */
async function crawlPeoplePages(
  homeHtml: string,
  homeUrl: string,
  level2: FetchedPage[],
): Promise<{ teamPages: FetchedPage[]; profilePages: FetchedPage[] }> {
  const seen = new Set<string>([homeUrl, ...level2.map((s) => s.url)]);
  const norm = (u: string) => u.replace(/\/+$/, "");
  const seenNorm = new Set([...seen].map(norm));
  const isSeen = (u: string) => seenNorm.has(norm(u));
  const mark = (u: string) => {
    seen.add(u);
    seenNorm.add(norm(u));
  };

  // level 3: team / staff / leadership links from the homepage and every
  // level-2 page. Always runs — /about-us/meet-the-team is a different page
  // from the /about-us we already have, even when level 2 found a /team.
  const haveContact = level2.some((x) => /contact/i.test(new URL(x.url).pathname));
  const hop3: string[] = [];
  const sources: { html: string; url: string }[] = [{ html: homeHtml, url: homeUrl }, ...level2];
  for (const src of sources) {
    for (const u of sameOriginLinks(src.html, src.url)) {
      if (isSeen(u) || hop3.includes(u)) continue;
      const path = new URL(u).pathname;
      if (TEAM_RE.test(path) && !/career|join|hiring|apply/i.test(path)) hop3.push(u);
      else if (!haveContact && /contact/i.test(path)) hop3.push(u);
    }
  }
  // shortest path first: a section page beats one of its children here
  hop3.sort((a, b) => a.length - b.length);
  const teamPages = await crawlSubpages(hop3.slice(0, MAX_TEAM_PAGES), TEAM_HOP_MS, PEOPLE_MIN_CHARS);
  for (const p of teamPages) mark(p.url);

  // level 4: one page per person, linked from any team-ish page we hold.
  const teamish = [...level2, ...teamPages].filter((p) => TEAM_RE.test(new URL(p.url).pathname));
  const hop4: string[] = [];
  for (const tp of teamish) {
    for (const u of sameOriginLinks(tp.html, tp.url)) {
      if (isSeen(u) || hop4.includes(u)) continue;
      if (looksLikeProfile(u, tp.url)) hop4.push(u);
    }
  }
  const fetched = await crawlSubpages(hop4.slice(0, MAX_PROFILE_PAGES), TEAM_HOP_MS, PEOPLE_MIN_CHARS);
  const profilePages = fetched.map((p) => ({ ...p, text: p.text.slice(0, PROFILE_TEXT_CHARS) }));
  return { teamPages, profilePages };
}

function pageKind(url: string): "home" | "svc" | "about" | "area" | "team" | "contact" | "other" {
  let p = "";
  try {
    p = new URL(url).pathname.toLowerCase().replace(/\/+$/, "");
  } catch {
    return "other";
  }
  if (!p || p === "/" || /^\/(index|home)(\.\w+)?$/.test(p)) return "home";
  if (/area|serve|coverage|location|cities|where-we-work/.test(p)) return "area";
  if (/team|staff|meet|people|crew|technicians|leadership/.test(p)) return "team";
  if (/contact|get-in-touch|reach-us/.test(p)) return "contact";
  if (/about|story|who-we-are|company/.test(p)) return "about";
  if (/service|what-we-do|our-work|solutions|offerings|pricing|rates/.test(p)) return "svc";
  return "other";
}

/**
 * Build the ~3k-char digest downstream writers get. Services copy first
 * (that's what forms/templates/catalog need), then the about/home story
 * (tone, differentiators), then whatever else fits. Each page is labelled
 * so the model knows which claims came from where.
 */
export function buildExcerpts(pages: CrawledPage[], max = EXCERPT_CHARS): string {
  if (!pages.length) return "";
  const rank: Record<ReturnType<typeof pageKind>, number> = { svc: 0, about: 1, home: 2, area: 3, team: 4, contact: 5, other: 6 };
  const ordered = [...pages]
    .filter((p) => p.text.trim().length > 80)
    .sort((a, b) => rank[pageKind(a.url)] - rank[pageKind(b.url)])
    .slice(0, 4);
  if (!ordered.length) return "";
  // services + about get a bigger share than the rest
  const weights = ordered.map((p) => (["svc", "about"].includes(pageKind(p.url)) ? 2 : 1));
  const totalW = weights.reduce((a, b) => a + b, 0);
  const parts: string[] = [];
  const boiler = sharedBoilerplate(pages.map((p) => p.text));
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i]!;
    const budget = Math.max(350, Math.floor((max * weights[i]!) / totalW) - 60);
    let t = stripBoilerplate(p.text.replace(/\s+/g, " ").trim(), boiler);
    if (t.length > budget) {
      const cut = t.slice(0, budget);
      t = `${cut.slice(0, Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(" "), budget - 80))}…`;
    }
    const label = p.title ? `${p.title} (${p.url})` : p.url;
    parts.push(`[${label}]\n${t}`);
  }
  return parts.join("\n\n").slice(0, max + 400);
}

/**
 * Nav menus, phone banners and footers repeat verbatim on every page, and on
 * a service-heavy site they can eat the whole excerpt budget before a single
 * sentence of real copy shows up. Any run of N consecutive words that appears
 * on most pages is boilerplate; `stripBoilerplate` drops the words covered by
 * those runs. Position-independent, so a page title in front of the menu
 * doesn't defeat it.
 */
const SHINGLE = 6;
function sharedBoilerplate(texts: string[]): Set<string> {
  const docs = texts.map((t) => t.replace(/\s+/g, " ").trim().split(" ")).filter((w) => w.length > 40);
  const out = new Set<string>();
  if (docs.length < 2) return out;
  const need = Math.max(2, Math.ceil(docs.length * 0.6));
  const counts = new Map<string, number>();
  for (const d of docs) {
    const seen = new Set<string>();
    for (let i = 0; i + SHINGLE <= d.length; i++) seen.add(d.slice(i, i + SHINGLE).join(" ").toLowerCase());
    for (const k of seen) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const [k, n] of counts) if (n >= need) out.add(k);
  return out;
}

function stripBoilerplate(text: string, boiler: Set<string>): string {
  if (!boiler.size) return text;
  const words = text.split(" ");
  const drop: boolean[] = Array.from({ length: words.length }, () => false);
  for (let i = 0; i + SHINGLE <= words.length; i++) {
    if (boiler.has(words.slice(i, i + SHINGLE).join(" ").toLowerCase())) {
      for (let j = i; j < i + SHINGLE; j++) drop[j] = true;
    }
  }
  const kept = words.filter((_, i) => !drop[i]);
  const out = kept.join(" ").trim();
  return out.length > 80 ? out : text;
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
  companyName: z
    .string()
    .describe("The business's official name as it writes it (header, footer, copyright line) — no tagline, no city suffix unless part of the name, no 'Welcome to'.")
    .nullable(),
  companyDescription: z
    .string()
    .describe(
      "Two to four sentences, in plain prose, on what this business actually does: the trade(s), who they serve (residential / commercial / both), any specialties or differentiators the site leans on (24/7 emergency, licensed & insured, family-owned since…, same-day, specific brands or systems). Written as the company would describe itself, not marketing fluff. Max ~600 characters.",
    )
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
  email: z.string().describe("Main contact email").nullable(),
  phone: z.string().describe("Main contact phone").nullable(),
  contactEmails: z
    .array(z.string())
    .describe("Every other email address printed on the pages (dispatch@, office@, a person's address), excluding the main one. Empty if none.")
    .default([]),
  mentionedStaff: z
    .array(z.string())
    .describe(
      "First names (or 'First L.') of STAFF that customers mention inside testimonials / reviews quoted on the pages — e.g. 'Mike showed up on time', 'Sarah in the office was great'. These are the people doing the work, NOT the reviewers themselves. Only names that clearly refer to an employee. Skip anyone already listed in teamMembers. Empty if none.",
    )
    .default([]),
  teamMembers: z
    .array(
      z.object({
        name: z.string().describe("Person's full name as written"),
        title: z.string().describe("Their title as written on the site, e.g. 'Owner', 'Lead Technician', 'Office Manager'").nullable(),
        role: z
          .enum(["tech", "dispatcher", "manager", "owner", "other"])
          .describe(
            "tech = goes out to customers' sites (technician, plumber, installer, driver, cleaner); dispatcher = schedules/answers phones (dispatcher, CSR, receptionist, office admin); manager = runs operations (office manager, operations/service manager, general manager); owner = owner/founder/president; other = anything else (accountant, marketing).",
          ),
        email: z.string().describe("Their personal work email if printed next to them").nullable(),
        phone: z.string().describe("Their direct phone if printed next to them").nullable(),
      }),
    )
    .describe(
      "Real, named people who work at THIS business, found on About / Team / Meet-the-team / Contact pages or a founder story. Up to 15. Do NOT include customers quoted in testimonials, review authors, blog authors from other companies, or generic 'our team' with no names.",
    )
    .default([]),
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
    companyName: null,
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
    teamMembers: [],
    contactEmails: [],
    mentionedStaff: [],
    googleReviewUrl: null,
    googleReviews: null,
    pages: [],
    structured: null,
    excerpts: "",
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
  const t0 = Date.now();
  const subpageUrls = pickSubpages(html, finalUrl);
  const shotPromise = screenshot(finalUrl); // runs alongside crawl + text model
  const subpages = await crawlSubpages(subpageUrls);
  const tLevel2 = Date.now() - t0;

  // People crawl (2026-10-07, deepened 2026-10-08). Staff names live on
  // pages the homepage nav rarely links directly, so the roster crawl goes
  // deeper than the brand crawl:
  //   level 1  homepage
  //   level 2  the section pages picked above (services/areas/about/team/contact)
  //   level 3  every team/staff/leadership link found on levels 1-2 (up to 3),
  //            plus the contact page if level 2 didn't have one
  //   level 4  individual staff profile pages linked from any team page
  //            (/team/jane-doe, /our-team/mike/) — up to 8, short text each
  const { teamPages, profilePages } = await crawlPeoplePages(html, finalUrl, subpages);
  const tPeople = Date.now() - t0 - tLevel2;
  for (const p of teamPages) subpages.push(p);
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
    profilePages: profilePages.map((s) => s.url),
    jsonLd: Boolean(structured),
    ldTypes: structured?.types ?? [],
    ms: { level2: tLevel2, people: tPeople },
  });

  const subpageBlock =
    subpages.map((sp) => `\n\nSUB-PAGE (${sp.url}):\n${sp.text}`).join("") +
    profilePages.map((sp) => `\n\nSTAFF PROFILE PAGE (${sp.url}):\n${sp.text}`).join("");

  // Item E: what we persist. Homepage first, then sub-pages in crawl order.
  const pages: CrawledPage[] = [
    { url: finalUrl, title: pageTitle(html), text: textSample(html).slice(0, PAGE_STORE_CHARS) },
    ...subpages.map((sp) => ({ url: sp.url, title: sp.title, text: textSample(sp.html).slice(0, PAGE_STORE_CHARS) })),
    ...profilePages.map((sp) => ({ url: sp.url, title: sp.title, text: sp.text })),
  ].slice(0, 20);
  const excerpts = buildExcerpts(pages);

  const tModel = Date.now();
  const [shot, textResult] = await Promise.allSettled([
    shotPromise,
    generateObject({
      model: gateway(MODELS.text),
      schema: TextSchema,
      prompt: `You are analysing a field-service / trade / delivery business's website to onboard them into a dispatch & customer-management platform. From the page text below, extract the brand details, classify their Primary Industry (ICP), AND list the named staff (teamMembers) so we can pre-fill their team roster. Be accurate; use null when unknown. Only list people who clearly work at this business as teamMembers — never testimonial authors. Separately, under mentionedStaff, list the first names of EMPLOYEES that customers praise inside quoted testimonials/reviews (the worker being described, not the reviewer). Homepage URL: ${finalUrl}

ALLOWED INDUSTRY CATEGORIES (pick the single best fit, or "other" if genuinely none fit):
${INDUSTRY_LABELS.map((i) => `- ${i.id}: ${i.label}`).join("\n")}

${hintsBlock(structured)}HOMEPAGE TEXT:\n${textSample(html)}${subpageBlock}`,
    }),
  ]);

  log.info("brand-scout: text model + screenshot done", { url: finalUrl, ms: Date.now() - tModel });

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
  }
  // No screenshot (no Chrome on this host, site blocked the headless browser,
  // timeout) or the vision pass failed: fall back to the stylesheet. Only warn
  // when even that comes back empty — a warning the user can't act on is noise.
  if (!vision?.primaryColor) {
    const css = await cssBrandColors(html, finalUrl).catch((e) => {
      log.warn("brand-scout: css color fallback failed", { err: String(e) });
      return { primary: null, accent: null };
    });
    if (css.primary) {
      vision = { primaryColor: css.primary, accentColor: css.accent ?? vision?.accentColor ?? null };
      log.info("brand-scout: brand colors from stylesheet", { url: finalUrl, ...css, hadScreenshot: shot.status === "fulfilled" && !!shot.value });
    } else if (shot.status !== "fulfilled" || !shot.value) {
      warnings.push(
        "Couldn't screenshot the site or find brand colors in its stylesheet — set the colors by hand if the ones here look off.",
      );
    }
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

  // Item F.2 — Google reviews are where crews actually get named. Optional
  // (needs GOOGLE_MAPS_API_KEY), best-effort, one request, ~1s.
  const bizName = structured?.name || text?.tagline?.split(/[|–—-]/)[0]?.trim() || hostOf(finalUrl);
  const reviews = googlePlacesAvailable()
    ? await fetchGoogleReviewMentions({
        name: bizName,
        address: pickAddress(text?.address, structured?.address),
        area: text?.serviceArea ?? structured?.areaServed ?? null,
        website: finalUrl,
      }).catch(() => null)
    : null;
  const teamForMentions = text?.teamMembers ?? [];
  const mentionedStaff = cleanMentioned(
    [...(text?.mentionedStaff ?? []), ...(reviews?.mentionedStaff ?? [])],
    teamForMentions,
  );

  return {
    website: finalUrl,
    companyName: cleanCompanyName(text?.companyName ?? structured?.name ?? null),
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
    address: pickAddress(text?.address, structured?.address),
    email: text?.email ?? structured?.email ?? null,
    phone: formatPhone(text?.phone ?? structured?.phone ?? null),
    socials,
    suggestedIndustry: text?.suggestedIndustry ?? null,
    suggestedIndustryOther: text?.suggestedIndustryOther ?? null,
    suggestedIndustryRationale: text?.suggestedIndustryRationale ?? null,
    teamMembers: cleanTeam(text?.teamMembers ?? [], text?.email ?? structured?.email ?? null),
    contactEmails: cleanEmails(text?.contactEmails ?? [], text?.email ?? structured?.email ?? null),
    mentionedStaff,
    googleReviewUrl: reviews?.writeReviewUrl ?? null,
    googleReviews: reviews
      ? { placeId: reviews.placeId, rating: reviews.rating, count: reviews.userRatingCount, mapsUri: reviews.googleMapsUri }
      : null,
    pages,
    structured,
    excerpts,
    warnings,
  };
}

/** A JSON-LD PostalAddress with a street number beats the model's read of
 * the page ("Near Polo Park, Winnipeg"); otherwise whichever one actually
 * has a street number; otherwise whatever we've got. */
function pickAddress(fromText: string | null | undefined, fromLd: string | null | undefined): string | null {
  const t = fromText?.trim() || null;
  const l = fromLd?.trim() || null;
  if (l && /\d/.test(l)) return l;
  if (t && /\d/.test(t)) return t;
  return t ?? l;
}

/** "Acme HVAC | Winnipeg's #1 Furnace Repair" → "Acme HVAC"; junk → null. */
function cleanCompanyName(raw: string | null): string | null {
  if (!raw) return null;
  let n = raw.replace(/\s+/g, " ").trim();
  n = n.split(/\s[|–—]\s|\s-\s(?=[A-Z])/)[0]!.trim();
  n = n.replace(/^(welcome to|home)\s+/i, "").replace(/[.,;:]+$/, "").trim();
  if (n.length < 2 || n.length > 120) return null;
  if (/^(home|welcome|website|untitled)$/i.test(n)) return null;
  return n;
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

/** Tidy the testimonial-name list: real-looking first names, deduped, not already on the roster. */
function cleanMentioned(list: string[], team: { name: string }[]): string[] {
  const rosterFirst = new Set(team.map((m) => (m.name || "").trim().split(/\s+/)[0]?.toLowerCase() ?? ""));
  const out: string[] = [];
  for (const raw of list) {
    const n = (raw || "").replace(/[^a-z' .-]/gi, "").replace(/\s+/g, " ").trim();
    if (n.length < 2 || n.length > 30) continue;
    if (!/^[A-Z][a-z]/.test(n)) continue; // must look like a name
    if (/^(our|the|team|staff|crew|guys|tech|technician|owner|office|everything|everyone|anyone|someone|service|customer|great|thanks?|highly|very|they|he|she|we|it)\b/i.test(n)) continue;
    const first = n.split(" ")[0]!.toLowerCase();
    if (rosterFirst.has(first)) continue;
    if (out.some((o) => o.toLowerCase() === n.toLowerCase())) continue;
    out.push(n);
    if (out.length >= 12) break;
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmails(list: string[], main: string | null): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const e = (raw || "").trim().toLowerCase();
    if (!EMAIL_RE.test(e)) continue;
    if (main && e === main.trim().toLowerCase()) continue;
    if (!out.includes(e)) out.push(e);
  }
  return out.slice(0, 10);
}

/** Drop junk the model sometimes returns (empty names, "Our Team", dupes). */
function cleanTeam(list: z.infer<typeof TextSchema>["teamMembers"], mainEmail: string | null): ScoutedTeamMember[] {
  const out: ScoutedTeamMember[] = [];
  const seen = new Set<string>();
  for (const m of list) {
    const name = (m.name || "").replace(/\s+/g, " ").trim();
    if (name.length < 3 || name.length > 60) continue;
    // needs at least one letter and shouldn't be a generic heading
    if (!/[a-z]/i.test(name) || /^(our|the|meet)\b|team$|staff$/i.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const email = m.email && EMAIL_RE.test(m.email.trim()) ? m.email.trim().toLowerCase() : null;
    out.push({
      name,
      title: m.title?.trim() || null,
      role: m.role,
      // a shared office address isn't a personal login — leave it blank
      email: email && mainEmail && email === mainEmail.trim().toLowerCase() ? null : email,
      phone: formatPhone(m.phone ?? null),
    });
    if (out.length >= 15) break;
  }
  return out;
}
