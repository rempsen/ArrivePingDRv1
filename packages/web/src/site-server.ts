/**
 * Serving the web build: prerendered public pages, static files, and the SPA
 * shell for app routes. Kept separate from server.ts (which also starts the
 * background sweeps) so it can be exercised on its own.
 */
import { log } from "./api/lib/logger";
import { landingPages } from "./web/site/content/landing";

const distDir = process.env.WEB_DIST_DIR ?? `${import.meta.dir}/../dist`;
const indexPath = `${distDir}/index.html`;

export async function serveSite(request: Request, url: URL): Promise<Response> {
  if (url.pathname === "/index.html") {
    return new Response(null, { status: 301, headers: { Location: `/${url.search}` } });
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
      // App routes get the SPA shell and are kept out of search results.
      // Anything the app doesn't know returns a real 404 (it used to be a 200
      // "soft 404"). The public pages never get noindex here, even if their
      // prerendered HTML is missing, so a failed prerender can't de-index them.
      const known = isAppRoute(url.pathname);
      const headers: Record<string, string> = htmlHeaders();
      if (!known || isPrivateRoute(url.pathname)) headers["X-Robots-Tag"] = "noindex, nofollow";
      return new Response(index, { status: known ? 200 : 404, headers });
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

const pagesDir = `${distDir}/_pages`;

/** The prerendered HTML for a public page, or a redirect to its canonical path. */
async function prerenderedPage(pathname: string): Promise<{ file?: ReturnType<typeof Bun.file>; redirect?: string } | null> {
  if (pathname.includes("..") || pathname.includes(".")) return null;
  const clean = (pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname).toLowerCase() || "/";
  const name = clean === "/" ? "index" : clean.slice(1);
  const file = Bun.file(`${pagesDir}/${name}.html`);
  if (!(await file.exists())) return null;
  if (clean !== pathname) return { redirect: clean };
  return { file };
}

// Client-side routes in src/web/app.tsx that legitimately serve the SPA shell.
const PUBLIC_PAGES = ["/", "/privacy", "/terms", ...landingPages.map((p) => p.path)];
const APP_EXACT = new Set([...PUBLIC_PAGES, "/sign-in", "/sign-up", "/get-started", "/forgot-password", "/reset-password"]);
const APP_PREFIX = ["/app", "/rider", "/admin", "/t/", "/s/", "/p/", "/f/", "/join/", "/join-company/"];
const PUBLIC_EXACT = new Set(PUBLIC_PAGES);
function isPrivateRoute(pathname: string): boolean {
  return !PUBLIC_EXACT.has(pathname) && pathname !== "/blog";
}
function isAppRoute(pathname: string): boolean {
  if (APP_EXACT.has(pathname) || pathname === "/blog") return true;
  return APP_PREFIX.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

// IndexNow: tell Bing (which feeds ChatGPT search, Copilot and others), Yandex,
// Naver and Seznam about the public pages once per deploy. Only fires on the
// live arriveping.com host, so local and preview servers never submit.
let indexNowDone = false;
function maybePingIndexNow(request: Request) {
  if (indexNowDone) return;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  if (host !== "arriveping.com" && host !== "www.arriveping.com") return;
  indexNowDone = true;
  void (async () => {
    try {
      const manifest = await Bun.file(`${pagesDir}/manifest.json`).json();
      const marker = Bun.file(`${pagesDir}/.indexnow-${manifest.builtAt}`);
      if (await marker.exists()) return;
      const res = await fetch("https://api.indexnow.org/indexnow", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          host: "arriveping.com",
          key: manifest.indexNowKey,
          keyLocation: `https://arriveping.com/${manifest.indexNowKey}.txt`,
          urlList: manifest.urls,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      log.info("indexnow submitted", { status: res.status, urls: manifest.urls.length });
      await Bun.write(marker, String(res.status));
    } catch (e) {
      console.warn("[indexnow] submit failed (non-fatal)", e);
    }
  })();
}

function getStaticFilePath(pathname: string) {
  const cleanPath = decodeURIComponent(pathname)
    .replace(/^\/+/, "")
    .replaceAll("..", "");

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
  const etag = `"${size.toString(16)}-${Bun.hash(filePath).toString(16)}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl },
    });
  }
  return new Response(file, {
    headers: {
      ...baseHeaders,
      ETag: etag,
      Vary: "Accept-Encoding",
    },
  });
}
