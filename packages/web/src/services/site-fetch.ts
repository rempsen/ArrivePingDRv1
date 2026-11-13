/**
 * Fetching a company's website for the signup scan (services/brand-scout.ts).
 *
 * One plain request used to be the whole story: any refusal, timeout or
 * JavaScript-only page came back as "nothing found" and the user was told
 * their site was thin. This module is a ladder instead:
 *
 *   1. direct    a normal browser request from our server
 *   2. variant   the www / bare-domain twin, when the host itself didn't answer
 *   3. render    Firecrawl (FIRECRAWL_API_KEY): a hosted browser that runs the
 *                page's JavaScript and gets through most bot protection
 *
 * The render rung is also used when the direct fetch worked but the page has
 * almost no visible text (a JavaScript shell, a cookie wall, a challenge page).
 *
 * Every outcome is typed and logged, so a failed scan says WHY it failed and
 * the failure rate can be measured.
 */
import { log } from "../api/lib/logger";

export type FetchFailure =
  /** The site answered with a refusal (401/403/429/503) or cut the connection. */
  | "blocked"
  /** No such host, connection refused, or another HTTP error. */
  | "unreachable"
  | "timeout"
  /** It answered, but not with a web page (a PDF, an image, a download). */
  | "not_html";

export type FetchVia = "direct" | "render";

export type FetchResult =
  | { ok: true; html: string; finalUrl: string; via: FetchVia; status: number }
  | { ok: false; reason: FetchFailure; status: number | null; detail: string };

/** A current desktop Chrome, with the headers a real one sends on a first visit. */
export const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-CA,en-US;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
  "upgrade-insecure-requests": "1",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
};

const DIRECT_TIMEOUT_MS = 15_000;
const RENDER_TIMEOUT_MS = 45_000;
/** Largest page we keep; a homepage is rarely over 1 MB of HTML. */
const MAX_HTML_CHARS = 3_000_000;
/** Under this much visible text, a page is a shell worth rendering. */
export const THIN_TEXT_CHARS = 400;

const REFUSAL_STATUS = new Set([401, 403, 406, 429, 503]);

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchFn = (...a) => fetch(...a);
/** Tests swap the network out. */
export function _setSiteFetchForTests(f: FetchFn | null): void {
  fetchImpl = f ?? ((...a) => fetch(...a));
}

export function renderAvailable(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY?.trim());
}

/** Rough count of the text a visitor would see: tags, scripts and styles removed. */
export function visibleTextLength(html: string): number {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

/** Pages that are a bot check or a consent wall, not the site. */
const CHALLENGE_MARKERS =
  /(just a moment\.\.\.|checking your browser|verify you are human|enable javascript and cookies|attention required|access denied|request blocked|are you a robot|captcha)/i;

export function looksLikeChallenge(html: string): boolean {
  if (visibleTextLength(html) > 2_500) return false;
  const head = html.slice(0, 20_000);
  return CHALLENGE_MARKERS.test(head) || /cf-chl-|__cf_chl|challenge-platform|px-captcha|datadome/i.test(head);
}

function classifyError(e: unknown): { reason: FetchFailure; detail: string } {
  const err = e as { name?: string; code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = err?.code ?? err?.cause?.code ?? "";
  const detail = `${err?.name ?? "Error"} ${code} ${err?.message ?? ""}`.trim().slice(0, 200);
  if (err?.name === "TimeoutError" || err?.name === "AbortError" || /timed? ?out/i.test(detail)) return { reason: "timeout", detail };
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|DNS|getaddrinfo|Unable to connect/i.test(`${code} ${detail}`))
    return { reason: "unreachable", detail };
  // The host exists and took the connection, then dropped it (reset, protocol
  // error, TLS alert): that is what bot protection looks like from outside.
  return { reason: "blocked", detail };
}

async function direct(url: string): Promise<FetchResult> {
  try {
    const res = await fetchImpl(url, { headers: BROWSER_HEADERS, redirect: "follow", signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS) });
    const status = res.status;
    if (!res.ok) {
      return { ok: false, reason: REFUSAL_STATUS.has(status) ? "blocked" : "unreachable", status, detail: `HTTP ${status}` };
    }
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (type && !/html|xml|text\/plain/.test(type)) return { ok: false, reason: "not_html", status, detail: type.slice(0, 80) };
    const html = (await res.text()).slice(0, MAX_HTML_CHARS);
    return { ok: true, html, finalUrl: res.url || url, via: "direct", status };
  } catch (e) {
    return { ok: false, status: null, ...classifyError(e) };
  }
}

/** Firecrawl: a hosted browser. Returns the page's HTML after its scripts ran. */
async function render(url: string): Promise<FetchResult> {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) return { ok: false, reason: "unreachable", status: null, detail: "render not configured" };
  try {
    const res = await fetchImpl("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["rawHtml"],
        onlyMainContent: false,
        proxy: "auto",
        blockAds: true,
        timeout: RENDER_TIMEOUT_MS - 5_000,
        // A copy from the last day is fine for a signup scan and comes back fast.
        maxAge: 86_400_000,
      }),
      signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 200);
      // 402 = out of credits, 401 = bad key: ours to fix, so make it loud.
      if (res.status === 401 || res.status === 402) log.error("site-fetch: Firecrawl account problem", { status: res.status, body });
      return { ok: false, reason: res.status === 408 ? "timeout" : "blocked", status: res.status, detail: `render HTTP ${res.status} ${body}` };
    }
    const json = (await res.json()) as {
      success?: boolean;
      data?: { rawHtml?: string; html?: string; metadata?: { statusCode?: number; url?: string; sourceURL?: string; error?: string | null } };
    };
    const html = (json.data?.rawHtml ?? json.data?.html ?? "").slice(0, MAX_HTML_CHARS);
    const pageStatus = json.data?.metadata?.statusCode ?? 200;
    if (!json.success || !html) return { ok: false, reason: "blocked", status: pageStatus, detail: `render: ${json.data?.metadata?.error ?? "no content"}`.slice(0, 200) };
    if (pageStatus >= 400) return { ok: false, reason: REFUSAL_STATUS.has(pageStatus) ? "blocked" : "unreachable", status: pageStatus, detail: `render saw HTTP ${pageStatus}` };
    return { ok: true, html, finalUrl: json.data?.metadata?.url || json.data?.metadata?.sourceURL || url, via: "render", status: pageStatus };
  } catch (e) {
    return { ok: false, status: null, ...classifyError(e) };
  }
}

/** `https://example.com/x` <-> `https://www.example.com/x`; null for IPs and deeper subdomains. */
export function hostVariant(url: string): string | null {
  try {
    const u = new URL(url);
    if (/^\d+(\.\d+){3}$/.test(u.hostname) || u.hostname.includes(":")) return null;
    if (u.hostname.startsWith("www.")) u.hostname = u.hostname.slice(4);
    else if (u.hostname.split(".").length === 2) u.hostname = `www.${u.hostname}`;
    else return null;
    return u.toString();
  } catch {
    return null;
  }
}

export interface FetchOptions {
  /**
   * How the homepage was reached. Sub-pages of a site that only answered the
   * hosted browser go straight there instead of being refused one by one.
   */
  prefer?: FetchVia;
  /** Skip the thin-page upgrade (sub-pages: a short page is just a short page). */
  allowThin?: boolean;
}

/**
 * Get a page by whatever means works. Never throws.
 */
export async function fetchPage(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const t0 = Date.now();
  const done = (r: FetchResult, tried: string[]): FetchResult => {
    const base = { url, tried, ms: Date.now() - t0 };
    if (r.ok) log.info("site-fetch: ok", { ...base, via: r.via, status: r.status, chars: r.html.length });
    else log.warn("site-fetch: failed", { ...base, reason: r.reason, status: r.status, detail: r.detail });
    return r;
  };
  const tried: string[] = [];

  if (opts.prefer === "render" && renderAvailable()) {
    tried.push("render");
    const r = await render(url);
    if (r.ok) return done(r, tried);
  }

  tried.push("direct");
  let first = await direct(url);

  if (!first.ok && first.reason === "unreachable" && first.status === null) {
    const alt = hostVariant(url);
    if (alt) {
      tried.push("variant");
      const r = await direct(alt);
      if (r.ok) first = r;
    }
  }

  if (first.ok) {
    const thin = !opts.allowThin && (visibleTextLength(first.html) < THIN_TEXT_CHARS || looksLikeChallenge(first.html));
    if (!thin || !renderAvailable() || tried.includes("render")) return done(first, tried);
    tried.push("render");
    const r = await render(first.finalUrl);
    // Keep the rendered page only when it actually shows more.
    if (r.ok && visibleTextLength(r.html) > visibleTextLength(first.html)) return done(r, tried);
    return done(first, tried);
  }

  if (first.reason !== "not_html" && renderAvailable() && !tried.includes("render")) {
    tried.push("render");
    const r = await render(url);
    if (r.ok) return done(r, tried);
    // Report the more specific of the two failures.
    if (first.reason === "unreachable" && r.reason === "blocked") return done(first, tried);
    if (r.reason === "blocked" || r.reason === "timeout") return done({ ...first, detail: `${first.detail}; ${r.detail}`.slice(0, 300) }, tried);
  }
  return done(first, tried);
}
