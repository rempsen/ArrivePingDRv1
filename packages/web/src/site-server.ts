/**
 * Serving the web build: prerendered public pages, static files, and the SPA
 * shell for app routes. Kept separate from server.ts (which also starts the
 * background sweeps) so it can be exercised on its own.
 */
import { log } from "./api/lib/logger";
import { getRedis } from "./api/lib/redis";
import { landingPages } from "./web/site/content/landing";
import { articles } from "./web/site/support/articles";

const distDir = process.env.WEB_DIST_DIR ?? `${import.meta.dir}/../dist`;
const indexPath = `${distDir}/index.html`;
const pagesDir = `${distDir}/_pages`;
const SITE = "https://arriveping.com";

/** Old and alternative addresses for the legal pages (the Terms text cites /terms-conditions). */
const LEGAL_ALIASES: Record<string, string> = {
  "/terms-conditions": "/terms",
  "/terms-and-conditions": "/terms",
  "/terms-of-service": "/terms",
  "/privacy-policy": "/privacy",
};

export async function serveSite(request: Request, url: URL): Promise<Response> {
  if (url.pathname === "/index.html") {
    return new Response(null, { status: 301, headers: { Location: `/${url.search}` } });
  }
  const alias = LEGAL_ALIASES[url.pathname.replace(/\/+$/, "").toLowerCase()];
  if (alias) {
    return new Response(null, { status: 301, headers: { Location: alias + url.search } });
  }

    // Public marketing pages are prerendered to static HTML at build time
    // (vite/plugins/prerender-plugin.ts) so search engines and AI agents that
    // don't run JavaScript can read them.
    const page = await prerenderedPage(url.pathname);
    if (page) {
      if (page.redirect) {
        return new Response(null, { status: 301, headers: { Location: page.redirect + url.search } });
      }
      maybePingIndexNow(request);
      return new Response(page.file, { headers: htmlHeaders() });
    }

    const filePath = getStaticFilePath(url.pathname);
    const file = Bun.file(filePath);

    if (url.pathname !== "/" && !url.pathname.startsWith("/_pages") && (await file.exists())) {
      return await serveStatic(filePath, file, url.pathname, request);
    }

    const index = Bun.file(indexPath);
    if (await index.exists()) {
      // A public page (one the build prerendered, per the page manifest) is
      // served and never noindexed here, even if its HTML is missing, so a
      // failed prerender can't de-index it. App routes get the SPA shell and
      // are kept out of search results. Everything else, including made-up
      // /support/… and /blog/… addresses, is a real 404 with noindex, never a
      // 200 "soft 404" that carries the home page's title.
      const isPublic = (await publicPaths()).has(url.pathname);
      const known = isPublic || isAppRoute(url.pathname);
      const headers: Record<string, string> = htmlHeaders();
      if (!isPublic) headers["X-Robots-Tag"] = "noindex, nofollow";
      if (!known) {
        const notFound = Bun.file(`${pagesDir}/404.html`);
        return new Response((await notFound.exists()) ? notFound : index, { status: 404, headers });
      }
      return new Response(index, { status: 200, headers });
    }
    return new Response("Build output not found. Run `bun run build` first.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
}

function htmlHeaders(): Record<string, string> {
  // HTML must NEVER be cached (CDN, proxy, or browser) so every deploy is
  // picked up immediately and we can't serve an old document that references
  // stale, deleted asset hashes (the classic blank-page CDN-cache trap).
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "CDN-Cache-Control": "no-store",
    "Cloudflare-CDN-Cache-Control": "no-store",
  };
}

/** The prerendered HTML for a public page, or a redirect to its canonical path. */
async function prerenderedPage(pathname: string): Promise<{ file?: ReturnType<typeof Bun.file>; redirect?: string } | null> {
  if (pathname.includes("..") || pathname.includes(".")) return null;
  const clean = (pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname).toLowerCase() || "/";
  const name = clean === "/" ? "index" : clean.slice(1);
  if (name === "404") return null; // the not-found page is served with status 404, never as a page
  const file = Bun.file(`${pagesDir}/${name}.html`);
  if (!(await file.exists())) return null;
  if (clean !== pathname) return { redirect: clean };
  return { file };
}

/* ------------------------------------------------------------------ */
/* Which paths exist                                                    */
/* ------------------------------------------------------------------ */

/** One public page in the build manifest (vite/plugins/prerender-plugin.ts). */
export type ManifestPage = { url: string; hash: string };
export type PageManifest = { builtAt: string; indexNowKey: string; urls: string[]; pages?: ManifestPage[] };

let manifestCache: Promise<PageManifest | null> | null = null;
/** dist/_pages/manifest.json, read once per process (a deploy is a new process). */
function loadManifest(): Promise<PageManifest | null> {
  manifestCache ??= Bun.file(`${pagesDir}/manifest.json`)
    .json()
    .then((m) => m as PageManifest)
    .catch(() => null);
  return manifestCache;
}

// Public pages the app renders itself. The build manifest is the source of
// truth (every page in seo/pages.ts, including each blog post and help
// article); this list only keeps the core pages and the help articles public
// if the manifest is ever missing.
const PUBLIC_FALLBACK = [
  "/",
  "/features",
  "/privacy",
  "/terms",
  "/blog",
  "/support",
  "/support/videos",
  ...landingPages.map((p) => p.path),
  ...articles.map((a) => `/support/${a.slug}`),
];

let publicCache: Promise<Set<string>> | null = null;
async function publicPaths(): Promise<Set<string>> {
  publicCache ??= loadManifest().then((m) => {
    const set = new Set(PUBLIC_FALLBACK);
    for (const u of m?.urls ?? []) set.add(new URL(u).pathname);
    return set;
  });
  return publicCache;
}

// Client-side app routes in src/web/app.tsx that legitimately serve the SPA
// shell (noindexed). No public prefix here: a public page is known only if the
// build produced it.
const APP_EXACT = new Set(["/sign-in", "/sign-up", "/get-started", "/forgot-password", "/reset-password"]);
const APP_PREFIX = ["/app", "/rider", "/admin", "/t/", "/pay/", "/s/", "/p/", "/f/", "/join/", "/join-company/"];
function isAppRoute(pathname: string): boolean {
  if (APP_EXACT.has(pathname)) return true;
  return APP_PREFIX.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

/* ------------------------------------------------------------------ */
/* IndexNow                                                             */
/* ------------------------------------------------------------------ */

// IndexNow tells Bing (which feeds ChatGPT search, Copilot and others), Yandex,
// Naver and Seznam what changed. Rules:
//  - only on the live arriveping.com host, so local and preview servers never submit;
//  - only the URLs whose prerendered content changed since the last submitted
//    build (manifest hashes, remembered in Redis), plus URLs that were removed;
//  - with nothing to compare against (no Redis, or the first run), every public
//    URL in the manifest (capped at IndexNow's 10,000), once per deploy per
//    process: a page the engines have never been told about is the bigger loss
//    than resubmitting a few unchanged ones;
//  - a non-2xx response is an error: logged, not recorded as done, retried later.
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const SITEMAP_URL = `${SITE}/sitemap.xml`;
const HASHES_KEY = "indexnow:pages";
const RETRY_MS = 60 * 60 * 1000;

/** What to submit for this build, given the hashes submitted last time (null = unknown). */
export function planIndexNow(
  manifest: PageManifest,
  previous: Record<string, string> | null,
): { urls: string[]; reason: "changed" | "no-previous-build" | "no-hashes" } {
  const all = (manifest.pages?.length ? manifest.pages.map((p) => p.url) : manifest.urls ?? []).slice(0, 10_000);
  if (!manifest.pages?.length) return { urls: all.length ? all : [SITEMAP_URL], reason: "no-hashes" };
  if (!previous) return { urls: all, reason: "no-previous-build" };
  const current = new Set(manifest.pages.map((p) => p.url));
  const changed = manifest.pages.filter((p) => previous[p.url] !== p.hash).map((p) => p.url);
  const removed = Object.keys(previous).filter((u) => !current.has(u));
  return { urls: [...changed, ...removed], reason: "changed" };
}

let indexNowDone = false;
let indexNowInFlight = false;
let indexNowRetryAt = 0;
function maybePingIndexNow(request: Request) {
  if (indexNowDone || indexNowInFlight || Date.now() < indexNowRetryAt) return;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  if (host !== "arriveping.com" && host !== "www.arriveping.com") return;
  indexNowInFlight = true;
  void submitIndexNow()
    .then((ok) => {
      if (ok) indexNowDone = true;
      else indexNowRetryAt = Date.now() + RETRY_MS;
    })
    .catch((e) => {
      indexNowRetryAt = Date.now() + RETRY_MS;
      log.error("indexnow submit failed", { err: e instanceof Error ? e.message : String(e) });
    })
    .finally(() => {
      indexNowInFlight = false;
    });
}

/** Submit this build's changes once. Returns true when there is nothing left to do. */
export async function submitIndexNow(opts: { fetchImpl?: typeof fetch } = {}): Promise<boolean> {
  const doFetch = opts.fetchImpl ?? fetch;
  const manifest = await loadManifest();
  if (!manifest) {
    log.warn("indexnow skipped: no page manifest");
    return true;
  }
  const redis = getRedis();
  // One submission per deploy across all machines (Redis), or per machine and
  // process start (marker file, when there is no Redis).
  const claimKey = `indexnow:deploy:${manifest.builtAt}`;
  const marker = Bun.file(`${pagesDir}/.indexnow-${manifest.builtAt}`);
  if (redis) {
    const claimed = await redis.set(claimKey, "1", "EX", 60 * 60 * 24 * 30, "NX");
    if (!claimed) return true;
  } else if (await marker.exists()) {
    return true;
  }
  const release = async () => {
    if (redis) await redis.del(claimKey).catch(() => undefined);
  };

  let previous: Record<string, string> | null = null;
  if (redis) {
    const raw = await redis.get(HASHES_KEY).catch(() => null);
    if (raw) {
      try {
        previous = JSON.parse(raw) as Record<string, string>;
      } catch {
        previous = null;
      }
    }
  }
  const plan = planIndexNow(manifest, previous);
  const remember = async () => {
    if (redis && manifest.pages?.length) {
      await redis.set(HASHES_KEY, JSON.stringify(Object.fromEntries(manifest.pages.map((p) => [p.url, p.hash]))));
    }
    if (!redis) await Bun.write(marker, new Date().toISOString());
  };
  if (plan.urls.length === 0) {
    log.info("indexnow: no page content changed in this deploy", { builtAt: manifest.builtAt });
    await remember();
    return true;
  }

  let res: Response;
  try {
    res = await doFetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: "arriveping.com",
        key: manifest.indexNowKey,
        keyLocation: `${SITE}/${manifest.indexNowKey}.txt`,
        urlList: plan.urls,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    await release();
    log.error("indexnow request failed", { err: e instanceof Error ? e.message : String(e), urls: plan.urls.length });
    return false;
  }
  if (res.status !== 200 && res.status !== 202) {
    // 400 bad request, 403 key not valid, 422 URLs not on this host, 429 too many requests.
    const body = (await res.text().catch(() => "")).slice(0, 300);
    await release();
    log.error("indexnow rejected", { status: res.status, body, urls: plan.urls.length, reason: plan.reason });
    return false;
  }
  await remember();
  log.info("indexnow submitted", { status: res.status, urls: plan.urls.length, reason: plan.reason, builtAt: manifest.builtAt });
  return true;
}

function getStaticFilePath(pathname: string) {
  const cleanPath = decodeURIComponent(pathname)
    .replace(/^\/+/, "")
    .replace(/\.\./g, "");

  return cleanPath ? `${distDir}/${cleanPath}` : indexPath;
}

// ---------------------------------------------------------------------------
// Static asset serving: long-lived, immutable caching for content-hashed build
// assets. Repeat visits hit the browser cache instead of re-downloading.
//
// IMPORTANT: We DO NOT compress (gzip/brotli) at the origin. This app is served
// behind Cloudflare + Google front-end proxies (see `via: 1.1 google` on prod
// responses) which apply their own on-the-fly compression. When the origin ALSO
// sets `Content-Encoding: gzip`, the edge double-handles the body: the response
// reaches the browser tagged `content-encoding: gzip` but with a body that is
// NOT valid gzip. The browser fails to decode it, the JS bundle is garbage, the
// module never evaluates, React never mounts -> BLANK WHITE PAGE. (This was the
// real root cause of the uberize.ai blank-page outage.)
//
// Fix / rule: serve raw, uncompressed bytes from origin and let the CDN compress.
// CDNs negotiate Accept-Encoding correctly and compress text assets edge-side.
// NEVER set Content-Encoding at the origin when behind a compressing CDN.
// ---------------------------------------------------------------------------

function cacheControlFor(pathname: string): string {
  // Vite emits content-hashed files under /assets (e.g. index-CkEh9DlZ.js).
  // These are immutable: a new build changes the hash, so cache forever.
  if (pathname.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }
  // HTML documents (the SPA shell, served for "/" and any .html) must NEVER be
  // cached by CDN/proxy/browser. A stale index.html references deleted asset
  // hashes and produces a blank white page. This is the classic SPA cache trap.
  if (pathname === "/" || pathname === "" || pathname.endsWith(".html")) {
    return "no-store, no-cache, max-age=0, must-revalidate";
  }
  // The admin service worker must be re-checked on every load, or a fixed
  // worker can't reach people who already have the old one.
  if (pathname === "/admin/sw.js") {
    return "no-cache, max-age=0, must-revalidate";
  }
  // Other static files (favicon, manifest, etc.) — short cache, revalidate.
  return "public, max-age=3600, must-revalidate";
}

async function serveStatic(
  filePath: string,
  file: ReturnType<typeof Bun.file>,
  pathname: string,
  request: Request,
): Promise<Response> {
  const type = file.type || "application/octet-stream";
  const size = file.size;
  const cacheControl = cacheControlFor(pathname);
  const baseHeaders: Record<string, string> = {
    "Content-Type": type,
    "Cache-Control": cacheControl,
  };
  // For no-store responses (HTML shell), also tell Cloudflare's CDN explicitly
  // and add legacy proxy hints, so no edge layer can hold a stale document.
  if (cacheControl.includes("no-store")) {
    baseHeaders["CDN-Cache-Control"] = "no-store";
    baseHeaders["Cloudflare-CDN-Cache-Control"] = "no-store";
    baseHeaders["Pragma"] = "no-cache";
    baseHeaders["Expires"] = "0";
  }

  // Serve raw bytes only. We intentionally DO NOT set Content-Encoding here —
  // the CDN (Cloudflare/Google) compresses text assets on the fly and negotiates
  // Accept-Encoding correctly. Setting it at origin behind the CDN produces a
  // body tagged gzip but not actually gzipped -> browser decode failure -> blank
  // page. See the block comment above. `Vary: Accept-Encoding` lets the CDN cache
  // per-encoding variants of the (uncompressed) origin response.
  const etag = `"${size.toString(16)}-${Math.floor(file.lastModified).toString(16)}-${Bun.hash(filePath).toString(16)}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl },
    });
  }
  const headers: Record<string, string> = { ...baseHeaders, ETag: etag, Vary: "Accept-Encoding" };
  // Crawler text files (sitemap.xml, robots.txt, llms.txt, the IndexNow key,
  // blog/rss.xml) are read by machines, not downloaded by people. Serve them
  // with an explicit, correct media type and as inline documents, so no layer
  // in front of us turns them into a "save as" attachment (the live sitemap
  // used to carry a Content-Disposition filename header).
  const crawlerType = crawlerTextType(pathname);
  if (crawlerType) {
    headers["Content-Type"] = crawlerType;
    headers["Content-Disposition"] = "inline";
    headers["X-Content-Type-Options"] = "nosniff";
    // The llms files are for AI tools to fetch, not pages to rank in search results.
    if (pathname === "/llms.txt" || pathname === "/llms-full.txt") headers["X-Robots-Tag"] = "noindex";
    return new Response(await file.bytes(), { headers });
  }
  return new Response(file, { headers });
}

function crawlerTextType(pathname: string): string | null {
  if (pathname === "/sitemap.xml") return "application/xml; charset=utf-8";
  if (pathname === "/blog/rss.xml") return "application/rss+xml; charset=utf-8";
  if (pathname === "/robots.txt" || pathname === "/llms.txt" || pathname === "/llms-full.txt") return "text/plain; charset=utf-8";
  if (/^\/[0-9a-f]{32}\.txt$/.test(pathname)) return "text/plain; charset=utf-8"; // IndexNow key file
  return null;
}
