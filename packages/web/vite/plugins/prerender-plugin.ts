import { build, type Plugin, type ResolvedConfig } from "vite";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { imageSize } from "./image-size";
import { todayInSiteZone } from "./site-date";

/**
 * Build-time prerender of the public marketing pages.
 *
 * Why: the site is a client-rendered React app, so a crawler that doesn't run
 * JavaScript (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot and most other AI
 * agents) used to receive an empty <div id="root"></div>. After the normal
 * client build, this plugin:
 *   1. builds src/web/prerender/entry.tsx for Node,
 *   2. renders every page in seoPages to HTML with its own <head>
 *      (title, description, canonical, Open Graph, JSON-LD),
 *   3. writes dist/_pages/<path>.html, which src/server.ts serves first,
 *   4. writes sitemap.xml, robots.txt, llms.txt, llms-full.txt, a 404 page and
 *      a manifest (every public URL with a hash of its content) that the
 *      server uses to tell real pages from made-up ones and to submit only
 *      changed URLs to IndexNow.
 *
 * The browser still boots the normal app on top of the HTML (createRoot), so
 * nothing changes for visitors except that the page paints before JS loads.
 */

export const INDEXNOW_KEY = "50946c21ee60e1ddcc694f8e5faaafb9";
const SITE = "https://arriveping.com";

// Paths crawlers have no business in: the product, private links and the API.
// "/admin" also covers "/admin/…" (prefix match), so no "$" anchors are needed.
const PRIVATE = ["/api/", "/admin", "/app", "/rider", "/t/", "/pay/", "/s/", "/p/", "/f/", "/join/", "/join-company/", "/uploads/"];
// Search and AI crawlers, named explicitly so our intent is unambiguous. They get
// the same rules as "*"; the separate group exists because some operators only
// honour a group that names their agent. Tokens come from each operator's own
// crawler documentation. xAI (Grok) publishes no crawler user agent, so none is
// invented here: the "*" group is what applies to it.
export const AGENTS = [
  // Search engines
  "Googlebot",
  "Bingbot",
  "Applebot",
  "DuckDuckBot",
  "YandexBot",
  // Google AI and other Google products
  "Google-Extended",
  "GoogleOther",
  "Google-CloudVertexBot",
  // OpenAI
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "OAI-AdsBot",
  // Anthropic
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "anthropic-ai",
  // Perplexity
  "PerplexityBot",
  "Perplexity-User",
  // Apple, Meta, Amazon
  "Applebot-Extended",
  "Meta-ExternalAgent",
  "Meta-ExternalFetcher",
  "FacebookBot",
  "facebookexternalhit",
  "Amazonbot",
  // Other assistants and datasets
  "DuckAssistBot",
  "MistralAI-User",
  "cohere-ai",
  "cohere-training-data-crawler",
  "YouBot",
  "CCBot",
  // Link previews
  "LinkedInBot",
  "Twitterbot",
];

export function robotsTxt(): string {
  // /api/health/demo is public counts only (no customer data); allowing it lets the
  // daily demo health check read it. The longer Allow wins over "Disallow: /api/".
  const rules = ["Allow: /", "Allow: /api/health/demo", ...PRIVATE.map((p) => `Disallow: ${p}`)];
  return [
    "# ArrivePing by NVC360 — https://arriveping.com",
    "# Public marketing pages are open to search engines and AI assistants.",
    "# Private app, API and tracking-link paths are excluded.",
    "",
    "User-agent: *",
    ...rules,
    "",
    "# AI search and assistant crawlers: explicitly allowed (same rules as above).",
    ...AGENTS.map((a) => `User-agent: ${a}`),
    ...rules,
    "",
    `Sitemap: ${SITE}/sitemap.xml`,
    "",
  ].join("\n");
}

type Entry = {
  seoPages: { path: string }[];
  render: (path: string) => { body: string; head: string };
  notFoundHead: () => string;
  notFoundBody: () => string;
  sitemapXml: (lastmod: string) => string;
  llmsTxt: (today: string) => string;
  llmsFullTxt: () => string;
  rssXml: () => string;
};

const SEO_START = "<!--seo-->";
const SEO_END = "<!--/seo-->";

/**
 * Declare a page's own social image (a blog cover) at its real size: covers
 * come in many sizes, and a wrong og:image:width/height makes some link
 * previews crop or drop the image. The default image's size is set in head.ts.
 */
async function withImageSize(head: string, outDir: string): Promise<string> {
  if (head.includes('property="og:image:width"')) return head;
  const m = head.match(/<meta property="og:image" content="([^"]+)" \/>/);
  if (!m || !m[1]!.startsWith(`${SITE}/`)) return head;
  const rel = decodeURIComponent(new URL(m[1]!.replace(/&amp;/g, "&")).pathname).replace(/^\/+/, "");
  const bytes = await fs.readFile(path.join(outDir, rel)).catch(() => null);
  const size = bytes ? imageSize(new Uint8Array(bytes)) : null;
  if (!size) return head;
  return head.replace(
    m[0],
    `${m[0]}\n\t\t<meta property="og:image:width" content="${size.width}" />\n\t\t<meta property="og:image:height" content="${size.height}" />`,
  );
}

export default function prerenderPlugin(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "arriveping-prerender",
    apply: "build",
    configResolved(c) {
      config = c;
    },
    async closeBundle() {
      if (config.build.ssr) return; // this hook also runs for the nested SSR build below
      const root = config.root;
      const outDir = path.resolve(root, config.build.outDir);
      const ssrOut = path.resolve(root, "node_modules/.cache/arriveping-prerender");
      const stub = path.resolve(root, "src/web/prerender/use-auth.stub.ts");

      await build({
        configFile: config.configFile,
        mode: config.mode,
        logLevel: "warn",
        resolve: {
          alias: [{ find: /^.*\/hooks\/use-auth$/, replacement: stub }],
        },
        build: {
          ssr: path.resolve(root, "src/web/prerender/entry.tsx"),
          outDir: ssrOut,
          emptyOutDir: true,
          copyPublicDir: false,
          rollupOptions: { output: { format: "esm", entryFileNames: "entry.mjs" } },
        },
      });

      const mod = (await import(`${pathToFileURL(path.join(ssrOut, "entry.mjs")).href}?t=${Date.now()}`)) as Entry;
      const shell = await fs.readFile(path.join(outDir, "index.html"), "utf8");
      const a = shell.indexOf(SEO_START);
      const b = shell.indexOf(SEO_END);
      if (a < 0 || b < 0) throw new Error("index.html is missing the <!--seo--> … <!--/seo--> markers");
      if (!shell.includes('<div id="root"></div>')) throw new Error('index.html is missing <div id="root"></div>');

      const pagesDir = path.join(outDir, "_pages");
      await fs.rm(pagesDir, { recursive: true, force: true });
      const urls: string[] = [];
      const pages: { url: string; hash: string }[] = [];
      for (const { path: route } of mod.seoPages) {
        const { body, head: rawHead } = mod.render(route);
        const head = await withImageSize(rawHead, outDir);
        if (!body.includes("<h1")) throw new Error(`Prerendered ${route} has no <h1>`);
        const html =
          shell.slice(0, a) +
          head +
          shell.slice(b + SEO_END.length).replace('<div id="root"></div>', `<div id="root" data-prerendered="${route}">${body}</div>`);
        const file = path.join(pagesDir, route === "/" ? "index.html" : `${route.slice(1)}.html`);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, html);
        const url = route === "/" ? `${SITE}/` : `${SITE}${route}`;
        urls.push(url);
        // Hash the page's own content (head + body), not the shell: the shell's
        // asset hashes change on every code deploy, the content doesn't.
        pages.push({ url, hash: createHash("sha256").update(head).update("\n").update(body).digest("hex").slice(0, 16) });
      }

      // The 404 page: same shell (so the app still boots and shows its own
      // "not found"), but with its own title and noindex instead of the home
      // page's metadata, and a readable body for agents that don't run JS.
      await fs.writeFile(
        path.join(pagesDir, "404.html"),
        shell.slice(0, a) +
          mod.notFoundHead() +
          shell.slice(b + SEO_END.length).replace('<div id="root"></div>', `<div id="root" data-prerendered="/404">${mod.notFoundBody()}</div>`),
      );

      // Today's date on the business's own calendar, not UTC (a build after
      // 18:00 CT used to stamp pages with tomorrow's date). Shared with the blog
      // plugin so "published" and "not in the future" agree.
      const today = todayInSiteZone();
      await fs.writeFile(path.join(outDir, "sitemap.xml"), mod.sitemapXml(today));
      await fs.writeFile(path.join(outDir, "robots.txt"), robotsTxt());
      await fs.writeFile(path.join(outDir, "llms.txt"), mod.llmsTxt(today));
      await fs.writeFile(path.join(outDir, "llms-full.txt"), mod.llmsFullTxt());
      await fs.mkdir(path.join(outDir, "blog"), { recursive: true });
      await fs.writeFile(path.join(outDir, "blog", "rss.xml"), mod.rssXml());
      await fs.writeFile(
        path.join(pagesDir, "manifest.json"),
        JSON.stringify({ builtAt: new Date().toISOString(), indexNowKey: INDEXNOW_KEY, urls, pages }, null, 2),
      );
      config.logger.info(`\n[prerender] ${urls.length} pages + 404, sitemap.xml, robots.txt, llms.txt, llms-full.txt, blog/rss.xml`);
    },
  };
}
