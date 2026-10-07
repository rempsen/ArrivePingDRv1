/**
 * The public, indexable pages: one registry that drives the prerendered
 * <head>, the client-side head updates, sitemap.xml and llms.txt.
 *
 * Anything not listed here (the product console, tracking links, sign-in) is
 * not indexable.
 */
import { faqs as homeFaqs } from "../config";
import { landingPages, type LandingPage } from "../content/landing";
import { breadcrumbs, faqPage, graph, organization, softwareApplication, webPage, website, type JsonLd } from "./schema";

export type SeoPage = {
  path: string;
  label: string;
  title: string;
  description: string;
  /** Short summary for llms.txt. */
  summary: string;
  section: "Product" | "Solutions" | "Compare" | "Company" | "Legal";
  priority: number;
  changefreq: "weekly" | "monthly" | "yearly";
  ogType: "website" | "article";
  jsonLd: JsonLd;
};

const HOME_TITLE = "ArrivePing: Field Service Software with Live Tech Tracking";
const HOME_DESCRIPTION =
  "Field service software for HVAC, plumbing, electrical and trade teams. Auto-dispatch the closest qualified tech and text customers a live ETA. From $49/mo.";

const home: SeoPage = {
  path: "/",
  label: "Home",
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  summary:
    "Overview of ArrivePing: live map of technicians and drivers, custom work orders, automatic assignment by proximity and skill, technician app, and Uber-style customer tracking links with live ETA.",
  section: "Product",
  priority: 1,
  changefreq: "weekly",
  ogType: "website",
  jsonLd: graph([
    organization(),
    website(),
    softwareApplication(),
    webPage("/", HOME_TITLE, HOME_DESCRIPTION),
    faqPage("/", homeFaqs),
  ]),
};

function sectionFor(p: LandingPage): SeoPage["section"] {
  if (p.path.startsWith("/compare")) return "Compare";
  if (p.path === "/about") return "Company";
  if (p.path === "/pricing") return "Product";
  return "Solutions";
}

function fromLanding(p: LandingPage): SeoPage {
  const trail = [{ name: "ArrivePing", path: "/" }];
  if (p.parent) trail.push({ name: p.parent.label, path: p.parent.path });
  trail.push({ name: p.label, path: p.path });
  const type = p.path === "/about" ? "AboutPage" : "WebPage";
  const nodes: JsonLd[] = [webPage(p.path, p.meta.title, p.meta.description, type), breadcrumbs(trail)];
  if (p.faqs.length) nodes.push(faqPage(p.path, p.faqs));
  if (p.path === "/pricing" || p.path === "/about") nodes.push(softwareApplication(), organization());
  return {
    path: p.path,
    label: p.label,
    title: p.meta.title,
    description: p.meta.description,
    summary: p.answer.a,
    section: sectionFor(p),
    priority: p.path === "/pricing" ? 0.9 : p.parent ? 0.7 : 0.8,
    changefreq: "monthly",
    ogType: "website",
    jsonLd: graph(nodes),
  };
}

const legal = (path: string, label: string, summary: string): SeoPage => ({
  path,
  label,
  title: `${label} | ArrivePing`,
  description: summary,
  summary,
  section: "Legal",
  priority: 0.2,
  changefreq: "yearly",
  ogType: "article",
  jsonLd: graph([webPage(path, `${label} | ArrivePing`, summary), breadcrumbs([{ name: "ArrivePing", path: "/" }, { name: label, path }])]),
});

export const seoPages: SeoPage[] = [
  home,
  ...landingPages.map(fromLanding),
  legal("/privacy", "Privacy Policy", "How ArrivePing and NVC360 collect, use and protect personal information, including technician location data."),
  legal("/terms", "Terms & Conditions", "The terms that govern use of ArrivePing by NVC360."),
];

export const seoByPath: Record<string, SeoPage> = Object.fromEntries(seoPages.map((p) => [p.path, p]));
