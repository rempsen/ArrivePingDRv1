/**
 * Post-build SEO sanity check for the public site.
 *
 *   bun run seo:check            # checks ./dist after `vite build`, through the real server code
 *   bun run seo:check --live     # checks https://arriveping.com instead (redirects are never followed)
 *
 * Fails (exit 1) when:
 *  - sitemap.xml is not well-formed or lists a URL that doesn't return 200
 *    directly (a redirect fails), or that carries noindex (meta or header);
 *  - any <lastmod> is in the future (America/Winnipeg) or not YYYY-MM-DD;
 *  - a page lacks exactly one <h1>, a canonical equal to its URL, a <title>
 *    (over 75 characters fails), a meta description (over 200 fails), or
 *    JSON-LD; or a JSON-LD block doesn't parse or lacks @context/@type;
 *  - the Organization or SoftwareApplication markup is wrong (see below);
 *  - a made-up URL (/support/…, /blog/…, /compare/…) doesn't return 404 + noindex;
 *  - robots.txt doesn't reference the sitemap, gives any named agent rules that
 *    differ from "*", or blocks a public page for any agent;
 *  - a stale phrase appears ("Launching November", "Book a demo", Cloudflare's
 *    "[email protected]") in a page or the llms files;
 *  - llms.txt / llms-full.txt are missing, too big, miss key links, repeat
 *    paragraphs, or claim an Android app while ANDROID_APP_LIVE is false;
 *  - the declared og:image size isn't the image's real size.
 *
 * Warns (exit 0) for titles outside 30–65 characters, descriptions outside
 * 70–170, and Android claims in page copy, so copy fixes can land separately.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ANDROID_APP_LIVE, ANDROID_CLAIM, OPERATING_SYSTEMS, ORG_ID, SOCIAL_PROFILES } from "../src/web/site/seo/schema";
import { imageSize } from "../vite/plugins/image-size";

const live = process.argv.includes("--live");
const SITE = "https://arriveping.com";
const distDir = process.env.WEB_DIST_DIR ?? path.resolve(import.meta.dir, "../dist");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Winnipeg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html) arriveping-seo-check";

const problems: string[] = [];
const warnings: string[] = [];
const fail = (msg: string) => problems.push(msg);
const warn = (msg: string) => warnings.push(msg);

/**
 * Pages already over the hard limits when this check was added (1 Nov 2026).
 * They warn instead of failing until the copy PR shortens them (seoTitle /
 * metaDescription); any other page over the limit fails. Remove entries as
 * they are fixed: an entry that is back under the limit is reported.
 */
const KNOWN_LONG_TITLE = new Set([
  "/blog/base-hit-software-small-business",
  "/blog/field-service-software-for-small-business",
  "/blog/field-service-software-cost",
  "/blog/ai-powered-dispatch-software",
  "/blog/12-hidden-costs-manual-field-service-operations",
  "/blog/field-service-software-real-time-visibility-2026",
  "/blog/real-time-technician-tracking-field-service-benefits",
  "/blog/ai-divide-in-construction",
  "/blog/construction-communication-rework-cost",
  "/blog/become-a-preferred-vendor",
  "/blog/phone-tag-cost-field-service",
  "/blog/uber-effect-field-service-price-sensitivity",
  "/blog/uber-effect-real-time-service",
  "/blog/uberize-your-field-service-business",
  "/blog/servicetitan-trends-what-they-mean",
  "/support/industry-terms",
  "/support/assignment-rules",
  "/support/address-not-found",
]);
const KNOWN_LONG_DESCRIPTION = new Set(["/canada", "/compare/onfleet"]);

/** Stale or broken phrases that must never ship. */
const BANNED = /launching november|book a demo|\[email(?:&#160;|&nbsp;| | )protected\]/i;

type Res = { status: number; text: string; headers: Headers; location: string | null };

// In dist mode every request goes through the real server code (src/site-server.ts)
// pointed at ./dist, so status codes, redirects and headers are checked too.
process.env.WEB_DIST_DIR ??= distDir;
const { serveSite } = live ? { serveSite: null } : await import("../src/site-server");

async function get(urlPath: string): Promise<Res> {
  if (live) {
    const res = await fetch(`${SITE}${urlPath}`, { redirect: "manual", headers: { "User-Agent": UA } });
    return { status: res.status, text: await res.text(), headers: res.headers, location: res.headers.get("location") };
  }
  const url = new URL(`http://seo-check.local${urlPath}`);
  const res = await serveSite!(new Request(url), url);
  return { status: res.status, text: await res.text(), headers: res.headers, location: res.headers.get("location") };
}

const noindexHeader = (r: Res) => /noindex/i.test(r.headers.get("x-robots-tag") ?? "");
const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const visibleText = (html: string) =>
  decode(
    (html.match(/<body[\s\S]*<\/body>/)?.[0] ?? html)
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  );

/* ------------------------------------------------------------------ */
/* Image sizes (og:image must declare its real size)                    */
/* ------------------------------------------------------------------ */

const imageCache = new Map<string, Promise<{ width: number; height: number; bytes: number } | null>>();
function realImage(url: string) {
  if (!imageCache.has(url)) {
    imageCache.set(
      url,
      (async () => {
        let bytes: Uint8Array;
        if (live) {
          const r = await fetch(url, { headers: { "User-Agent": UA } });
          if (!r.ok) return null;
          bytes = new Uint8Array(await r.arrayBuffer());
        } else {
          const rel = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, "");
          bytes = new Uint8Array(await fs.readFile(path.join(distDir, rel)).catch(() => Buffer.alloc(0)));
          if (!bytes.length) return null;
        }
        const size = imageSize(bytes);
        return size ? { ...size, bytes: bytes.length } : null;
      })(),
    );
  }
  return imageCache.get(url)!;
}

/* ------------------------------------------------------------------ */
/* JSON-LD                                                              */
/* ------------------------------------------------------------------ */

type Node = Record<string, unknown>;
function checkJsonLd(loc: string, html: string) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  if (blocks.length === 0) return fail(`${loc}: no JSON-LD`);
  for (const raw of blocks) {
    let data: Node;
    try {
      data = JSON.parse(raw) as Node;
    } catch (e) {
      fail(`${loc}: JSON-LD does not parse (${(e as Error).message})`);
      continue;
    }
    if (!data["@context"]) fail(`${loc}: JSON-LD block has no @context`);
    const nodes = Array.isArray(data["@graph"]) ? (data["@graph"] as Node[]) : [data];
    for (const n of nodes) if (!n["@type"]) fail(`${loc}: JSON-LD node without @type (${JSON.stringify(n).slice(0, 80)}…)`);
    for (const n of nodes) {
      if (n["@type"] === "Organization" && n["@id"] === ORG_ID) {
        if (n.name !== "ArrivePing") fail(`${loc}: Organization ${ORG_ID} is named "${n.name}", expected "ArrivePing"`);
        if (!n.url || !n.logo) fail(`${loc}: Organization lacks url or logo`);
        const same = (n.sameAs as string[] | undefined) ?? [];
        for (const u of SOCIAL_PROFILES) if (!same.includes(u)) fail(`${loc}: Organization sameAs is missing ${u}`);
        const parent = n.parentOrganization as Node | undefined;
        if (!parent?.["@id"] || !parent.url) fail(`${loc}: Organization has no parentOrganization (NVC360)`);
      }
      if (n["@type"] === "SoftwareApplication") {
        if (n.operatingSystem !== OPERATING_SYSTEMS) fail(`${loc}: SoftwareApplication operatingSystem "${n.operatingSystem}" ≠ "${OPERATING_SYSTEMS}" (ANDROID_APP_LIVE=${ANDROID_APP_LIVE})`);
        if (!ANDROID_APP_LIVE && ANDROID_CLAIM.test(JSON.stringify(n))) fail(`${loc}: SoftwareApplication claims Android while ANDROID_APP_LIVE is false`);
        const offers = ([] as Node[]).concat((n.offers as Node | Node[] | undefined) ?? []);
        if (!offers.length) fail(`${loc}: SoftwareApplication has no offers`);
        for (const o of offers) if (!o.price || !o.priceCurrency) fail(`${loc}: SoftwareApplication offer without price/priceCurrency`);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Sitemap and pages                                                    */
/* ------------------------------------------------------------------ */

const sitemap = await get("/sitemap.xml");
if (sitemap.status !== 200) fail(`sitemap.xml: HTTP ${sitemap.status}`);
if (!sitemap.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) fail("sitemap.xml: missing XML declaration at byte 0 (BOM or whitespace?)");
if (!sitemap.text.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')) fail("sitemap.xml: wrong or missing namespace");
if (/<(changefreq|priority)>/.test(sitemap.text)) fail("sitemap.xml: contains changefreq/priority (ignored by Google; removed on purpose)");

const entries = [...sitemap.text.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => ({ loc: m[1]!, lastmod: m[2] }));
if (entries.length === 0) fail("sitemap.xml: no <url> entries parsed");
const seen = new Set<string>();
for (const { loc, lastmod } of entries) {
  if (!loc.startsWith(`${SITE}/`)) fail(`${loc}: not under ${SITE}`);
  if (seen.has(loc)) fail(`${loc}: duplicate entry`);
  seen.add(loc);
  if (!lastmod) fail(`${loc}: missing <lastmod>`);
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(lastmod)) fail(`${loc}: lastmod "${lastmod}" is not YYYY-MM-DD`);
  else if (lastmod > today) fail(`${loc}: lastmod ${lastmod} is in the future (today ${today} America/Winnipeg)`);

  const urlPath = loc.slice(SITE.length) || "/";
  const page = await get(urlPath);
  if (page.status !== 200) {
    fail(`${loc}: HTTP ${page.status}${page.location ? ` → ${page.location}` : ""} (sitemap URLs must answer 200 directly)`);
    continue;
  }
  if (noindexHeader(page)) fail(`${loc}: X-Robots-Tag noindex on a sitemap URL`);
  const html = page.text;
  const h1s = html.match(/<h1[\s>]/g)?.length ?? 0;
  if (h1s !== 1) fail(`${loc}: ${h1s} <h1> elements (expected exactly 1)`);

  const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
  if (title.length < 10) fail(`${loc}: missing or very short <title>`);
  else if (title.length > 75) (KNOWN_LONG_TITLE.has(urlPath) ? warn : fail)(`${loc}: title is ${title.length} characters (over 75): "${title}"`);
  else if (title.length < 30 || title.length > 65) warn(`${loc}: title is ${title.length} characters (aim for 30–65)`);
  if (KNOWN_LONG_TITLE.has(urlPath) && title.length <= 75) warn(`${urlPath}: title is now ${title.length} characters; remove it from KNOWN_LONG_TITLE`);

  const description = decode(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "");
  if (description.length < 50) fail(`${loc}: missing or very short meta description`);
  else if (description.length > 200) (KNOWN_LONG_DESCRIPTION.has(urlPath) ? warn : fail)(`${loc}: description is ${description.length} characters (over 200)`);
  else if (description.length < 70 || description.length > 170) warn(`${loc}: description is ${description.length} characters (aim for 70–170)`);
  if (KNOWN_LONG_DESCRIPTION.has(urlPath) && description.length <= 200) warn(`${urlPath}: description is now ${description.length} characters; remove it from KNOWN_LONG_DESCRIPTION`);

  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  if (canonical !== loc) fail(`${loc}: canonical is ${canonical ?? "missing"}`);
  if (/<meta name="robots" content="[^"]*noindex/.test(html)) fail(`${loc}: page is noindex but listed in sitemap`);
  checkJsonLd(loc, html);

  const banned = html.match(BANNED)?.[0];
  if (banned) fail(`${loc}: contains the stale phrase "${banned}"`);
  if (!ANDROID_APP_LIVE) {
    const claim = visibleText(html).match(new RegExp(`[^.]{0,40}(?:${ANDROID_CLAIM.source})[^.]{0,20}`, "i"))?.[0];
    if (claim) warn(`${loc}: page copy claims Android while ANDROID_APP_LIVE is false: "…${claim.trim()}…"`);
  }

  const ogImage = decode(html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? "");
  const ogW = Number(html.match(/<meta property="og:image:width" content="(\d+)"/)?.[1]);
  const ogH = Number(html.match(/<meta property="og:image:height" content="(\d+)"/)?.[1]);
  if (!ogImage) fail(`${loc}: no og:image`);
  else {
    const real = await realImage(ogImage);
    if (!real) fail(`${loc}: og:image ${ogImage} is missing or unreadable`);
    else {
      if (real.width !== ogW || real.height !== ogH) fail(`${loc}: og:image is ${real.width}×${real.height} but declared ${ogW || "?"}×${ogH || "?"} (${ogImage})`);
      if (real.bytes > 600_000) fail(`${loc}: og:image is ${Math.round(real.bytes / 1024)} KB (over 600 KB): ${ogImage}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Made-up URLs must be real 404s (no soft 404s)                        */
/* ------------------------------------------------------------------ */

const probe = live ? `zz-seo-check-${Date.now()}` : "zz-seo-check-probe";
for (const p of [`/support/${probe}`, `/blog/${probe}`, `/blog/category/${probe}`, `/compare/${probe}`, `/${probe}`, `/support/${probe}/deeper`]) {
  const r = await get(p);
  if (r.status !== 404) fail(`${p}: made-up URL returned ${r.status}${r.location ? ` → ${r.location}` : ""}, expected 404`);
  if (!noindexHeader(r)) fail(`${p}: 404 without X-Robots-Tag noindex`);
}

/* ------------------------------------------------------------------ */
/* robots.txt                                                           */
/* ------------------------------------------------------------------ */

const robots = await get("/robots.txt");
if (robots.status !== 200) fail(`robots.txt: HTTP ${robots.status}`);
if (!robots.text.includes(`Sitemap: ${SITE}/sitemap.xml`)) fail("robots.txt: no Sitemap line");

type Group = { agents: string[]; allow: string[]; disallow: string[] };
// The groups as a crawler sees them: a run of User-agent lines starts a group;
// the most specific group naming an agent applies (else "*"); the longest
// matching rule wins and Allow beats Disallow on a tie. A bare "Disallow: /"
// is just another rule here, so it is caught like any other.
function robotsGroups(text: string): Group[] {
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" && val) cur.allow.push(val);
    if (key === "disallow" && val) cur.disallow.push(val);
  }
  return groups;
}
function robotsAllows(p: string, g: { allow: string[]; disallow: string[] }): boolean {
  const matches = (rule: string) => (rule.endsWith("$") ? p === rule.slice(0, -1) : p.startsWith(rule));
  const bestAllow = Math.max(-1, ...g.allow.filter(matches).map((r) => r.length));
  const bestDisallow = Math.max(-1, ...g.disallow.filter(matches).map((r) => r.length));
  return bestAllow >= bestDisallow;
}
const groups = robotsGroups(robots.text);
const star = groups.find((g) => g.agents.includes("*"));
if (!star) fail('robots.txt: no "User-agent: *" group');
const rulesOf = (g: Group) => JSON.stringify([[...g.allow].sort(), [...g.disallow].sort()]);
for (const g of groups) {
  if (star && rulesOf(g) !== rulesOf(star)) fail(`robots.txt: the group for ${g.agents.join(", ")} has different rules from "*"`);
  for (const { loc } of entries) {
    const p = loc.slice(SITE.length) || "/";
    if (!robotsAllows(p, g)) fail(`${loc}: blocked by robots.txt for ${g.agents.join(", ")}`);
  }
  if (!robotsAllows("/api/health/demo", g)) fail(`robots.txt: /api/health/demo must stay readable (group ${g.agents[0]})`);
  for (const must of ["/admin", "/app", "/api/x", "/api/health", "/t/abc"]) {
    if (robotsAllows(must, g)) fail(`robots.txt: private path ${must} is NOT disallowed for ${g.agents[0]}`);
  }
}

/* ------------------------------------------------------------------ */
/* llms.txt and llms-full.txt                                           */
/* ------------------------------------------------------------------ */

const llms = await get("/llms.txt");
const llmsFull = await get("/llms-full.txt");
for (const [name, r] of [["/llms.txt", llms], ["/llms-full.txt", llmsFull]] as const) {
  if (r.status !== 200 || r.text.length < 500) fail(`${name}: HTTP ${r.status} or too short`);
  if (!noindexHeader(r)) fail(`${name}: should be served with X-Robots-Tag: noindex (fetchable by AI tools, not ranked as a page)`);
  const banned = r.text.match(BANNED)?.[0];
  if (banned) fail(`${name}: contains the stale phrase "${banned}"`);
  if (!ANDROID_APP_LIVE) {
    const claim = r.text.match(new RegExp(`[^\\n.]{0,40}(?:${ANDROID_CLAIM.source})[^\\n.]{0,20}`, "i"))?.[0];
    if (claim) fail(`${name}: claims Android while ANDROID_APP_LIVE is false: "…${claim.trim()}…"`);
  }
}
if (llms.text.length > 20_000) fail(`/llms.txt: ${llms.text.length} bytes (keep it under 20 KB; the full text belongs in llms-full.txt)`);
for (const must of [`${SITE}/get-started`, "https://apps.apple.com/app/arriveping/id6776464675", `${SITE}/pricing`, `${SITE}/support`, "Last updated:", "Arrivy"]) {
  if (!llms.text.includes(must)) fail(`/llms.txt: missing "${must}"`);
}
if (/^## Company$/m.test(llms.text)) fail('/llms.txt: help pages belong under "## Help Center", not "## Company"');
const corePaths = entries.map((e) => e.loc).filter((u) => !/\/(blog|support)(\/|$)/.test(u) && !/\/(privacy|terms)$/.test(u));
for (const u of corePaths) if (!llmsFull.text.includes(u)) fail(`/llms-full.txt: no section for ${u}`);
const paragraphCounts = new Map<string, number>();
for (const para of llmsFull.text.split(/\n{2,}/)) {
  const key = para.trim();
  // Tables and the short "also answered on this page" pointers may repeat; prose may not.
  if (key.length >= 80 && !key.startsWith("|") && !key.startsWith("Also answered on this page")) paragraphCounts.set(key, (paragraphCounts.get(key) ?? 0) + 1);
}
for (const [para, n] of paragraphCounts) if (n > 2) fail(`/llms-full.txt: paragraph repeated ${n} times: "${para.slice(0, 80)}…"`);

/* ------------------------------------------------------------------ */

if (warnings.length) {
  const shown = warnings.slice(0, 60);
  console.warn(
    `seo-check: ${warnings.length} warning(s) (not failing the build):\n` +
      shown.map((w) => `  ~ ${w}`).join("\n") +
      (warnings.length > shown.length ? `\n  ~ …and ${warnings.length - shown.length} more` : ""),
  );
}
if (problems.length) {
  console.error(`seo-check: ${problems.length} problem(s) in ${live ? SITE : distDir}\n` + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(
  `seo-check: OK — ${entries.length} URLs in sitemap answer 200 directly with one H1, a matching canonical and valid JSON-LD; made-up URLs are 404 + noindex; robots.txt consistent for every agent; llms files accurate (${live ? "live" : "dist"})`,
);
