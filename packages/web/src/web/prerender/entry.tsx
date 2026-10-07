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
import { LandingRoute } from "../pages/marketing/landing";
import { landingByPath, landingPages } from "../site/content/landing";
import { seoPages } from "../site/seo/pages";
import { headTags } from "../site/seo/head";
import { brand, faqs } from "../site/config";
import { absolute, SITE_URL } from "../site/seo/schema";

export { seoPages };

const fixed: Record<string, ComponentType> = {
  "/": Index,
  "/privacy": PrivacyPage,
  "/terms": TermsPage,
};

export function render(path: string): { body: string; head: string } {
  const seo = seoPages.find((p) => p.path === path);
  if (!seo) throw new Error(`No SEO entry for ${path}`);
  const Page = fixed[path];
  const tree = Page ? <Page /> : landingByPath[path] ? <LandingRoute path={path} /> : null;
  if (!tree) throw new Error(`No page component for ${path}`);
  const body = renderToString(<Router ssrPath={path}>{tree}</Router>);
  return { body, head: headTags(seo) };
}

/* ------------------------------------------------------------------ */
/* Text files for search engines and AI agents                          */
/* ------------------------------------------------------------------ */

export function sitemapXml(lastmod: string): string {
  const urls = seoPages
    .map(
      (p) =>
        `  <url>\n    <loc>${absolute(p.path)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority.toFixed(1)}</priority>\n  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** llms.txt (llmstxt.org format): who we are, then the pages worth reading. */
export function llmsTxt(): string {
  const groups: Record<string, typeof seoPages> = {};
  for (const p of seoPages) (groups[p.section] ??= []).push(p);
  const order = ["Product", "Solutions", "Compare", "Company", "Legal"];
  const sections = order
    .filter((g) => groups[g]?.length)
    .map((g) => `## ${g}\n\n${groups[g]!.map((p) => `- [${p.label}](${absolute(p.path)}): ${p.summary}`).join("\n")}`)
    .join("\n\n");
  return `# ArrivePing

> ArrivePing (by NVC360, Winnipeg, Manitoba, Canada) is field service management software for HVAC, plumbing, electrical, construction and delivery teams. It shows technicians and drivers on a live map, auto-assigns each work order to the closest qualified technician by distance, skills, availability and workload, sends the job to the technician mobile app, and texts customers an Uber-style live tracking link with an ETA and one-tap text or call. Pricing starts at $49 USD per month. Launching November 2026.

Key facts:
- Name: ArrivePing (also written "ArrivePing by NVC360"). Not affiliated with Arrive, Arrive Logistics, Arrive AI or arrive.gg.
- Company: NVC360, Winnipeg, Manitoba, Canada. Contact: ${brand.contactEmail}
- Category: field service management (FSM) software; dispatch software; technician tracking; customer communication
- Pricing (USD, monthly): Starter $49 including the first driver; drivers 2–10 $30 each; drivers 11–30 $27 each; drivers 31+ $25 each (graduated). Details: ${SITE_URL}/pricing
- Platforms: web dispatch console; technician app for iOS and Android; customer tracking pages in any browser (no customer app)
- Setup: an AI setup agent builds the workspace from the company's website; most teams dispatch their first job within an hour
- Integrations and exports: CSV, Excel, PDF, JSON, calendar feeds, webhooks, Zapier, Make, MCP server for AI agents, Google Drive backup

${sections}

## Optional

- [Full text for AI agents](${SITE_URL}/llms-full.txt): the answers and FAQs from every page above in one file
`;
}

/** llms-full.txt: the quotable answers and FAQs from every page, as Markdown. */
export function llmsFullTxt(): string {
  const parts = [
    `# ArrivePing — full reference\n\nSource: ${SITE_URL}. Everything below is also published on the linked pages.`,
    `## ArrivePing home (${SITE_URL}/)\n\n${faqs.map((f) => `### ${f.q}\n\n${f.a}`).join("\n\n")}`,
  ];
  for (const p of landingPages) {
    const faq = p.faqs.map((f) => `### ${f.q}\n\n${f.a}`).join("\n\n");
    const src = p.sources?.length
      ? `\n\nSources (checked ${p.verified}):\n${p.sources.map((s) => `- ${s.label}: ${s.href}`).join("\n")}`
      : "";
    parts.push(`## ${p.h1} (${absolute(p.path)})\n\n${p.lede}\n\n### ${p.answer.q}\n\n${p.answer.a}${faq ? `\n\n${faq}` : ""}${src}`);
  }
  return `${parts.join("\n\n---\n\n")}\n`;
}
