/**
 * Server-side entry for the build-time prerender of the public pages.
 *
 * vite/plugins/prerender-plugin.ts builds this file for Node, then calls
 * `render(path)` for every page in `seoPages` and writes the HTML into
 * dist/_pages. Crawlers and AI agents that don't run JavaScript (GPTBot,
 * ClaudeBot, PerplexityBot…) read that HTML; browsers then boot the app on top.
 */
import { renderToString } from "react-dom/server";
import { Router } from "wouter";
import type { ComponentType } from "react";
import Index from "../pages/index";
import PrivacyPage from "../pages/privacy";
import TermsPage from "../pages/terms";
import FeaturesPage from "../pages/marketing/features";
import SupportPage from "../pages/support";
import SupportArticlePage from "../pages/support-article";
import SupportVideosPage from "../pages/support-videos";
import { LandingRoute } from "../pages/marketing/landing";
import { CONTENT_UPDATED, landingByPath } from "../site/content/landing";
import { seoPages } from "../site/seo/pages";
import { headTags } from "../site/seo/head";
import { BlogIndexRoute, makeBlogCategory, makeBlogPost } from "../pages/marketing/blog";
import { posts } from "virtual:blog-index";
import bodies from "virtual:blog-bodies";
import { categoryBySlug } from "../site/blog/categories";
import { absolute, SITE_URL } from "../site/seo/schema";
import { buildLlmsFullTxt, buildLlmsTxt, notFoundBody, notFoundHead } from "./llms";

export { seoPages, notFoundBody, notFoundHead };

const fixed: Record<string, ComponentType> = {
  "/": Index,
  "/privacy": PrivacyPage,
  "/terms": TermsPage,
  "/features": FeaturesPage,
  "/support": SupportPage,
  "/support/videos": SupportVideosPage,
};

export function render(path: string): { body: string; head: string } {
  const seo = seoPages.find((p) => p.path === path);
  if (!seo) throw new Error(`No SEO entry for ${path}`);
  // Blog bodies are compiled HTML; expose them to the post component for this render.
  (globalThis as { __BLOG_BODIES__?: Record<string, string> }).__BLOG_BODIES__ = bodies;
  let Page: ComponentType | undefined = fixed[path];
  if (!Page && path.startsWith("/support/")) Page = SupportArticlePage;
  if (!Page && path === "/blog") Page = BlogIndexRoute;
  if (!Page && path.startsWith("/blog/category/")) Page = makeBlogCategory(path.slice("/blog/category/".length));
  if (!Page && path.startsWith("/blog/")) Page = makeBlogPost(path.slice("/blog/".length));
  const tree = Page ? <Page /> : landingByPath[path] ? <LandingRoute path={path} /> : null;
  if (!tree) throw new Error(`No page component for ${path}`);
  const body = renderToString(<Router ssrPath={path}>{tree}</Router>);
  return { body, head: headTags(seo) };
}

/* ------------------------------------------------------------------ */
/* Text files for search engines and AI agents                          */
/* ------------------------------------------------------------------ */

/**
 * sitemap.xml.
 *
 * `today` is the current date in America/Winnipeg (the business's own
 * calendar), supplied by the build. Every <lastmod> is a real content date
 * (blog `updated` or CONTENT_UPDATED) and is never allowed to be in the
 * future: Google ignores lastmod site-wide once it sees unreliable values.
 * <changefreq> and <priority> are omitted on purpose; Google ignores both.
 */
export function sitemapXml(today: string): string {
  const urls = seoPages
    .map((p) => {
      const lastmod = p.lastmod ?? CONTENT_UPDATED;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(lastmod)) throw new Error(`Sitemap lastmod for ${p.path} is not YYYY-MM-DD: ${lastmod}`);
      if (lastmod > today) throw new Error(`Sitemap lastmod for ${p.path} (${lastmod}) is in the future (today is ${today} in America/Winnipeg)`);
      return `  <url>\n    <loc>${absolute(p.path)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** llms.txt: the compact entity file for AI assistants (see ./llms.ts). `today` is the build date. */
export function llmsTxt(today: string): string {
  return buildLlmsTxt(today, posts);
}

/** llms-full.txt: every product, solution, comparison, pricing and features page in full (see ./llms.ts). */
export function llmsFullTxt(): string {
  return buildLlmsFullTxt(posts);
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rfc822 = (iso: string) => new Date(`${iso}T12:00:00Z`).toUTCString();

/** RSS 2.0 feed of the latest posts (/blog/rss.xml). */
export function rssXml(): string {
  const items = posts
    .slice(0, 50)
    .map((p) => {
      const url = absolute(`/blog/${p.slug}`);
      return [
        "    <item>",
        `      <title>${xmlEsc(p.title)}</title>`,
        `      <link>${url}</link>`,
        `      <guid isPermaLink="true">${url}</guid>`,
        `      <pubDate>${rfc822(p.date)}</pubDate>`,
        `      <dc:creator>${xmlEsc(p.author)}</dc:creator>`,
        `      <category>${xmlEsc(categoryBySlug[p.category]?.label ?? p.category)}</category>`,
        `      <description>${xmlEsc(p.description)}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>The ArrivePing blog</title>
    <link>${SITE_URL}/blog</link>
    <atom:link href="${SITE_URL}/blog/rss.xml" rel="self" type="application/rss+xml" />
    <description>Field service dispatch, technician tracking and customer communication, from the team at NVC360.</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}
