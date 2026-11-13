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
import { checkPublicUrl, pinnedGet, _setResolverForTests } from "./safe-net";

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
  | {
      ok: false;
      reason: FetchFailure;
      status: number | null;
      detail: string;
      /** We declined to request this address at all (internal, not a web address). Never retried another way. */
      refused?: boolean;
    };

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
/** Most we download for one page before hanging up. */
const MAX_HTML_BYTES = 5_000_000;
/** Redirects followed by hand, each one checked before it is requested. */
const MAX_REDIRECTS = 6;
/** Under this much visible text, a page is a shell worth rendering. */
export const THIN_TEXT_CHARS = 400;

const REFUSAL_STATUS = new Set([401, 403, 406, 429, 503]);

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
let fetchImpl: FetchFn = (...a) => fetch(...a);
/** True while a test has swapped the network out: page requests then go through `fetchImpl` too. */
let stubbed = false;
/** Tests swap the network out. */
export function _setSiteFetchForTests(f: FetchFn | null): void {
  fetchImpl = f ?? ((...a) => fetch(...a));
  stubbed = Boolean(f);
  // A stubbed network has no DNS either: made-up hosts resolve to a public
  // address unless the test installs its own resolver afterwards.
  _setResolverForTests(f ? async () => ["93.184.216.34"] : null);
}

/**
 * The page's text, at most MAX_HTML_BYTES of it, in the page's own encoding
 * (older sites are still windows-1252; read as UTF-8 their accents turn to
 * question marks and "Réparation" stops matching anything).
 */
async function readBody(res: Response): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      size += value.byteLength;
      if (size >= MAX_HTML_BYTES) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  }
  const bytes = new Uint8Array(Math.min(size, MAX_HTML_BYTES));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, bytes.byteLength - at);
    bytes.set(part, at);
    at += part.byteLength;
    if (at >= bytes.byteLength) break;
  }
  const header = /charset\s*=\s*["']?([\w-]+)/i.exec(res.headers.get("content-type") ?? "")?.[1];
  const sniff = new TextDecoder("latin1").decode(bytes.subarray(0, 2_048));
  const meta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(sniff)?.[1];
  for (const label of [header, meta, "utf-8"]) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      /* unknown label: try the next */
    }
  }
  return new TextDecoder().decode(bytes);
}

function canRender(): boolean {
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
    // One deadline for the whole chain, redirects included.
    const signal = AbortSignal.timeout(DIRECT_TIMEOUT_MS);
    let at = url;
    for (let hop = 0; ; hop++) {
      // Every hop is checked before it is requested: the first address was
      // validated as text only, and a public page can redirect anywhere.
      const safe = await checkPublicUrl(at);
      if (!safe.ok) {
        const detail = safe.why === "private" ? "private or internal address" : safe.why === "not_web" ? "not a web address" : "no such host";
        return { ok: false, reason: "unreachable", status: null, detail: hop ? `redirect to ${detail}` : detail, refused: safe.why !== "no_such_host" };
      }
      // Connect to the address that was just checked, not to whatever the
      // name answers a moment later (safe-net.ts `pinnedGet`).
      const res = stubbed
        ? await fetchImpl(at, { headers: BROWSER_HEADERS, redirect: "manual", signal })
        : await pinnedGet(at, safe.addresses, { headers: BROWSER_HEADERS, signal, maxBytes: MAX_HTML_BYTES });
      const status = res.status;
      if (status >= 300 && status < 400 && status !== 304) {
        const to = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!to || hop >= MAX_REDIRECTS) return { ok: false, reason: "unreachable", status, detail: to ? "too many redirects" : "redirect without a location" };
        try {
          at = new URL(to, at).toString();
        } catch {
          return { ok: false, reason: "unreachable", status, detail: "bad redirect" };
        }
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, reason: REFUSAL_STATUS.has(status) ? "blocked" : "unreachable", status, detail: `HTTP ${status}` };
      }
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      if (type && !/html|xml|text\/plain/.test(type)) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, reason: "not_html", status, detail: type.slice(0, 80) };
      }
      const html = (await readBody(res)).slice(0, MAX_HTML_CHARS);
      return { ok: true, html, finalUrl: at, via: "direct", status };
    }
  } catch (e) {
    return { ok: false, status: null, ...classifyError(e) };
  }
}

/** Firecrawl: a hosted browser. Returns the page's HTML after its scripts ran. */
async function render(url: string): Promise<FetchResult> {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) return { ok: false, reason: "unreachable", status: null, detail: "render not configured" };
  try {
    // The hosted browser runs outside our network, but an internal address
    // is still never ours to hand to anyone.
    const safe = await checkPublicUrl(url);
    if (!safe.ok && safe.why !== "no_such_host") return { ok: false, reason: "unreachable", status: null, detail: "not a public web address", refused: true };
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
  /** Plain files (a sitemap): a direct request or nothing. */
  noRender?: boolean;
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
  const renderAvailable = () => !opts.noRender && canRender();

  if (opts.prefer === "render" && renderAvailable()) {
    tried.push("render");
    const r = await render(url);
    if (r.ok) return done(r, tried);
  }

  tried.push("direct");
  let first = await direct(url);

  if (!first.ok && first.refused) return done(first, tried);

  if (!first.ok && first.reason === "unreachable" && first.status === null) {
    const alt = hostVariant(url);
    if (alt) {
      tried.push("variant");
      const r = await direct(alt);
      if (r.ok) first = r;
    }
  }

  if (first.ok) {
    // A bot check served with HTTP 200 is a refusal, not a page. A short page
    // is only worth rendering for the homepage (sub-pages: short is short).
    const challenge = looksLikeChallenge(first.html);
    const thin = challenge || (!opts.allowThin && visibleTextLength(first.html) < THIN_TEXT_CHARS);
    if (!thin) return done(first, tried);
    if (renderAvailable() && !tried.includes("render")) {
      tried.push("render");
      const r = await render(first.finalUrl);
      // Keep the rendered page only when it actually shows more.
      if (r.ok && !looksLikeChallenge(r.html) && visibleTextLength(r.html) > visibleTextLength(first.html)) return done(r, tried);
    }
    if (challenge) return done({ ok: false, reason: "blocked", status: first.status, detail: "bot check page" }, tried);
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

export function renderAvailable(): boolean {
  return canRender();
}
