/**
 * The public, indexable pages: one registry that drives the prerendered
 * <head>, the client-side head updates, sitemap.xml and llms.txt.
 *
 * Anything not listed here (the product console, tracking links, sign-in) is
 * not indexable.
 */
import { posts } from "virtual:blog-index";
import { faqs as homeFaqs } from "../config";
import { blogCategories, categoryBySlug } from "../blog/categories";
import { authorFor } from "../blog/meta";
import { landingPages, type LandingPage } from "../content/landing";
import { absolute, breadcrumbs, faqPage, graph, ORG_ID, organization, SITE_ID, SITE_URL, softwareApplication, webPage, website, type JsonLd } from "./schema";

export type SeoPage = {
  path: string;
  label: string;
  title: string;
  description: string;
  /** Short summary for llms.txt. */
  summary: string;
  section: "Product" | "Solutions" | "Compare" | "Company" | "Legal" | "Blog";
  priority: number;
  changefreq: "weekly" | "monthly" | "yearly";
  ogType: "website" | "article";
  jsonLd: JsonLd;
  /** Absolute or root-relative social image; defaults to the site image. */
  image?: string;
  imageAlt?: string;
  /** Real last-modified date for the sitemap (defaults to the build date). */
  lastmod?: string;
  article?: { published: string; modified: string; section: string; tags: string[]; author: string };
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

/* ---------------- Blog ---------------- */

const BLOG_TITLE = "Field Service Blog: Dispatch, Tracking & ETAs | ArrivePing";
const BLOG_DESCRIPTION =
  "Practical articles on dispatch, technician tracking, on-my-way texts and running a profitable field service business, from the team that ran 800+ technicians.";
const latest = posts[0]?.updated ?? undefined;

const blogIndex: SeoPage = {
  path: "/blog",
  label: "Blog",
  title: BLOG_TITLE,
  description: BLOG_DESCRIPTION,
  summary: "All ArrivePing blog articles on field service dispatch, technician tracking, customer communication, construction and growth.",
  section: "Blog",
  priority: 0.8,
  changefreq: "weekly",
  ogType: "website",
  lastmod: latest,
  jsonLd: graph([
    {
      "@type": "Blog",
      "@id": `${SITE_URL}/blog#blog`,
      url: `${SITE_URL}/blog`,
      name: "The ArrivePing blog",
      description: BLOG_DESCRIPTION,
      inLanguage: "en",
      isPartOf: { "@id": SITE_ID },
      publisher: { "@id": ORG_ID },
      blogPost: posts.slice(0, 20).map((p) => ({ "@id": `${absolute(`/blog/${p.slug}`)}#article` })),
    },
    breadcrumbs([
      { name: "ArrivePing", path: "/" },
      { name: "Blog", path: "/blog" },
    ]),
    organization(),
  ]),
};

const blogCategoryPages: SeoPage[] = blogCategories
  .filter((c) => posts.some((p) => p.category === c.slug))
  .map((c) => {
    const path = `/blog/category/${c.slug}`;
    const title = `${c.label}: Field Service Articles | ArrivePing Blog`;
    const list = posts.filter((p) => p.category === c.slug);
    return {
      path,
      label: c.label,
      title,
      description: c.description,
      summary: c.description,
      section: "Blog",
      priority: 0.5,
      changefreq: "weekly",
      ogType: "website",
      lastmod: list[0]?.updated,
      jsonLd: graph([
        {
          "@type": "CollectionPage",
          "@id": `${absolute(path)}#webpage`,
          url: absolute(path),
          name: title,
          isPartOf: { "@id": SITE_ID },
          mainEntity: {
            "@type": "ItemList",
            itemListElement: list.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: absolute(`/blog/${p.slug}`), name: p.title })),
          },
        },
        breadcrumbs([
          { name: "ArrivePing", path: "/" },
          { name: "Blog", path: "/blog" },
          { name: c.label, path },
        ]),
      ]),
    };
  });

const blogPostPages: SeoPage[] = posts.map((p) => {
  const path = `/blog/${p.slug}`;
  const cat = categoryBySlug[p.category];
  const author = authorFor(p.author);
  const title = p.title.length <= 52 ? `${p.title} | ArrivePing` : p.title;
  const image = p.image ? absolute(p.image) : `${SITE_URL}/og-image.png`;
  return {
    path,
    label: p.title,
    title,
    description: p.description,
    summary: p.description,
    section: "Blog",
    priority: 0.6,
    changefreq: "monthly",
    ogType: "article",
    image,
    imageAlt: p.imageAlt || p.title,
    lastmod: p.updated,
    article: { published: p.date, modified: p.updated, section: cat?.label ?? "Blog", tags: p.tags, author: author.name },
    jsonLd: graph([
      {
        "@type": "BlogPosting",
        "@id": `${absolute(path)}#article`,
        mainEntityOfPage: absolute(path),
        url: absolute(path),
        headline: p.title.slice(0, 110),
        description: p.description,
        image: [image],
        datePublished: p.date,
        dateModified: p.updated,
        inLanguage: "en",
        articleSection: cat?.label,
        keywords: p.tags.join(", "),
        wordCount: p.words,
        author: { "@type": "Person", name: author.name, jobTitle: author.role, url: author.url, worksFor: { "@id": ORG_ID } },
        publisher: { "@id": ORG_ID },
        isPartOf: { "@id": `${SITE_URL}/blog#blog` },
        about: { "@id": `${SITE_URL}/#software` },
      },
      breadcrumbs([
        { name: "ArrivePing", path: "/" },
        { name: "Blog", path: "/blog" },
        ...(cat ? [{ name: cat.label, path: `/blog/category/${cat.slug}` }] : []),
        { name: p.title, path },
      ]),
      organization(),
    ]),
  };
});

export const seoPages: SeoPage[] = [
  home,
  ...landingPages.map(fromLanding),
  blogIndex,
  ...blogCategoryPages,
  ...blogPostPages,
  legal("/privacy", "Privacy Policy", "How ArrivePing and NVC360 collect, use and protect personal information, including technician location data."),
  legal("/terms", "Terms & Conditions", "The terms that govern use of ArrivePing by NVC360."),
];

export const seoByPath: Record<string, SeoPage> = Object.fromEntries(seoPages.map((p) => [p.path, p]));
