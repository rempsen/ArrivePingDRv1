import { build, type Plugin, type ResolvedConfig } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
 *   4. writes sitemap.xml, robots.txt, llms.txt, llms-full.txt and a manifest
 *      used for IndexNow.
 *
 * The browser still boots the normal app on top of the HTML (createRoot), so
 * nothing changes for visitors except that the page paints before JS loads.
 */

export const INDEXNOW_KEY = "50946c21ee60e1ddcc694f8e5faaafb9";
const SITE = "https://arriveping.com";

// Paths crawlers have no business in: the product, private links and the API.
const PRIVATE = ["/api/", "/admin/", "/admin$", "/app/", "/app$", "/rider/", "/rider$", "/t/", "/s/", "/p/", "/f/", "/join/", "/join-company/", "/uploads/"];
// Named explicitly so our intent is unambiguous to every search and AI crawler.
const AGENTS = [
  "*",
  "Googlebot",
  "Bingbot",
  "Google-Extended",
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Applebot",
  "Applebot-Extended",
  "Meta-ExternalAgent",
  "Amazonbot",
  "DuckAssistBot",
  "cohere-ai",
  "MistralAI-User",
  "CCBot",
];

function robotsTxt(): string {
  return [
    "# ArrivePing by NVC360 — https://arriveping.com",
    "# Public pages are open to search engines and AI assistants.",
    "",
    ...AGENTS.map((a) => `User-agent: ${a}`),
    "Allow: /",
    ...PRIVATE.map((p) => `Disallow: ${p}`),
    "",
    `Sitemap: ${SITE}/sitemap.xml`,
    "",
  ].join("\n");
}

type Entry = {
  seoPages: { path: string }[];
  render: (path: string) => { body: string; head: string };
  sitemapXml: (lastmod: string) => string;
  llmsTxt: () => string;
  llmsFullTxt: () => string;
};

const SEO_START = "<!--seo-->";
const SEO_END = "<!--/seo-->";

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
      for (const { path: route } of mod.seoPages) {
        const { body, head } = mod.render(route);
        if (!body.includes("<h1")) throw new Error(`Prerendered ${route} has no <h1>`);
        const html =
          shell.slice(0, a) +
          head +
          shell.slice(b + SEO_END.length).replace('<div id="root"></div>', `<div id="root" data-prerendered="${route}">${body}</div>`);
        const file = path.join(pagesDir, route === "/" ? "index.html" : `${route.slice(1)}.html`);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, html);
        urls.push(route === "/" ? `${SITE}/` : `${SITE}${route}`);
      }

      const today = new Date().toISOString().slice(0, 10);
      await fs.writeFile(path.join(outDir, "sitemap.xml"), mod.sitemapXml(today));
      await fs.writeFile(path.join(outDir, "robots.txt"), robotsTxt());
      await fs.writeFile(path.join(outDir, "llms.txt"), mod.llmsTxt());
      await fs.writeFile(path.join(outDir, "llms-full.txt"), mod.llmsFullTxt());
      await fs.writeFile(
        path.join(pagesDir, "manifest.json"),
        JSON.stringify({ builtAt: new Date().toISOString(), indexNowKey: INDEXNOW_KEY, urls }, null, 2),
      );
      config.logger.info(`\n[prerender] ${urls.length} pages + sitemap.xml, robots.txt, llms.txt, llms-full.txt`);
    },
  };
}
