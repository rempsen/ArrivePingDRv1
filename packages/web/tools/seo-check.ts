/**
 * Post-build SEO sanity check for the public site.
 *
 *   bun run seo:check            # checks ./dist after `vite build`
 *   bun run seo:check --live     # checks https://arriveping.com instead
 *
 * Fails (exit 1) when:
 *  - sitemap.xml is not well-formed or lists a URL with no prerendered page;
 *  - any <lastmod> is in the future (America/Winnipeg) or not YYYY-MM-DD;
 *  - a prerendered page lacks <h1>, a canonical equal to its sitemap URL,
 *    a <title>, a meta description, or JSON-LD, or carries noindex;
 *  - robots.txt does not reference the sitemap or blocks a public page.
 *  - (--live) any sitemap URL does not return 200.
 *
 * Google's "Couldn't fetch" / "has errors" states for a sitemap almost always
 * trace back to one of these, so this runs before we ask Search Console again.
 */
import fs from "node:fs/promises";
import path from "node:path";

const live = process.argv.includes("--live");
const SITE = "https://arriveping.com";
const distDir = process.env.WEB_DIST_DIR ?? path.resolve(import.meta.dir, "../dist");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Winnipeg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const problems: string[] = [];
const fail = (msg: string) => problems.push(msg);

async function read(urlPath: string): Promise<{ status: number; text: string }> {
  if (live) {
    const res = await fetch(`${SITE}${urlPath}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html) arriveping-seo-check" } });
    return { status: res.status, text: await res.text() };
  }
  const rel = urlPath === "/" ? "_pages/index.html" : /\.(xml|txt)$/.test(urlPath) ? urlPath.slice(1) : `_pages${urlPath}.html`;
  try {
    return { status: 200, text: await fs.readFile(path.join(distDir, rel), "utf8") };
  } catch {
    return { status: 404, text: "" };
  }
}

const sitemap = await read("/sitemap.xml");
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
  const page = await read(urlPath);
  if (page.status !== 200) {
    fail(`${loc}: HTTP ${page.status}`);
    continue;
  }
  const html = page.text;
  if (!/<h1[\s>]/.test(html)) fail(`${loc}: no <h1>`);
  if (!/<title>[^<]{10,}<\/title>/.test(html)) fail(`${loc}: missing or very short <title>`);
  if (!/<meta name="description" content="[^"]{50,}"/.test(html)) fail(`${loc}: missing or very short meta description`);
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  if (canonical !== loc) fail(`${loc}: canonical is ${canonical ?? "missing"}`);
  if (/<meta name="robots" content="[^"]*noindex/.test(html)) fail(`${loc}: page is noindex but listed in sitemap`);
  if (!html.includes('type="application/ld+json"')) fail(`${loc}: no JSON-LD`);
}

const robots = await read("/robots.txt");
if (robots.status !== 200) fail(`robots.txt: HTTP ${robots.status}`);
if (!robots.text.includes(`Sitemap: ${SITE}/sitemap.xml`)) fail("robots.txt: no Sitemap line");
const disallows = [...robots.text.matchAll(/^Disallow:\s*(\S+)/gm)].map((m) => m[1]!);
for (const { loc } of entries) {
  const p = loc.slice(SITE.length) || "/";
  for (const d of disallows) if (d !== "/" && p.startsWith(d)) fail(`${loc}: blocked by robots.txt rule "Disallow: ${d}"`);
}

for (const f of ["/llms.txt", "/llms-full.txt"]) {
  const r = await read(f);
  if (r.status !== 200 || r.text.length < 500) fail(`${f}: HTTP ${r.status} or too short`);
}

if (problems.length) {
  console.error(`seo-check: ${problems.length} problem(s) in ${live ? SITE : distDir}\n` + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(`seo-check: OK — ${entries.length} URLs in sitemap, all prerendered, canonical and indexable; no future lastmod; robots.txt consistent (${live ? "live" : "dist"})`);
