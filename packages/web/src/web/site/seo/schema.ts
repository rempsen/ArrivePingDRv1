/**
 * JSON-LD builders for the public marketing pages.
 *
 * Rules:
 *  - Structured data must describe what is visible on the page. FAQPage is
 *    only emitted from the same FAQ array the page renders.
 *  - No ratings or reviews until real ones exist.
 *  - Every node that other pages reference has a stable `@id`.
 */
import { brand, STARTER_PRICE, pricingBands } from "../config";

export const SITE_URL = "https://arriveping.com";
export const ORG_ID = `${SITE_URL}/#organization`;
export const SITE_ID = `${SITE_URL}/#website`;
export const APP_ID = `${SITE_URL}/#software`;

export type JsonLd = Record<string, unknown>;
export type Faq = { q: string; a: string };

export const absolute = (path: string) => (path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`);

export function organization(): JsonLd {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: brand.parent,
    url: SITE_URL,
    logo: `${SITE_URL}/apple-touch-icon.png`,
    email: brand.contactEmail,
    description:
      "NVC360 is a field service software company in Winnipeg, Manitoba. It makes ArrivePing, software for dispatching technicians and keeping customers updated with live arrival times.",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Winnipeg",
      addressRegion: "MB",
      addressCountry: "CA",
    },
    areaServed: ["CA", "US"],
    brand: { "@type": "Brand", name: brand.product },
    sameAs: ["https://nvc360.com"],
  };
}

export function website(): JsonLd {
  return {
    "@type": "WebSite",
    "@id": SITE_ID,
    url: `${SITE_URL}/`,
    name: brand.product,
    alternateName: brand.lockup,
    inLanguage: "en",
    publisher: { "@id": ORG_ID },
  };
}

export function softwareApplication(): JsonLd {
  const bandText = pricingBands
    .map((b) => (b.to === Infinity ? `drivers ${b.from}+ at $${b.rate}` : `drivers ${b.from}–${b.to} at $${b.rate}`))
    .join(", ");
  return {
    "@type": "SoftwareApplication",
    "@id": APP_ID,
    name: brand.product,
    alternateName: brand.lockup,
    url: `${SITE_URL}/`,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Field service management software",
    operatingSystem: "Web, iOS, Android",
    description:
      "Field service management software for HVAC, plumbing, electrical, construction and delivery teams. ArrivePing shows technicians and drivers on a live map, auto-assigns each work order to the closest qualified technician, sends the job to the technician app, and texts customers a live tracking link with an ETA.",
    featureList: [
      "Live map of technicians and drivers",
      "Custom work orders",
      "Automatic assignment by proximity, skill and availability",
      "Technician mobile app with job details and one-tap accept",
      "On-my-way texts with a live tracking page and ETA",
      "Text or call the technician from the tracking page",
      "Geofenced arrival and on-site time clock",
      "Scheduling, dispatch board and invoicing",
      "Exports to CSV, Excel, PDF and JSON; calendar feeds; webhooks; Zapier and Make; MCP server for AI agents",
      "AI setup agent that builds a workspace from your website",
    ],
    publisher: { "@id": ORG_ID },
    offers: {
      "@type": "Offer",
      url: `${SITE_URL}/pricing`,
      price: String(STARTER_PRICE),
      priceCurrency: "USD",
      description: `Starter: $${STARTER_PRICE} per month including the first driver. Graduated rates for added drivers: ${bandText} per driver per month.`,
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: String(STARTER_PRICE),
        priceCurrency: "USD",
        unitText: "MONTH",
      },
    },
  };
}

export function faqPage(path: string, faqs: readonly Faq[]): JsonLd {
  return {
    "@type": "FAQPage",
    "@id": `${absolute(path)}#faq`,
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

export function webPage(path: string, name: string, description: string, type = "WebPage"): JsonLd {
  return {
    "@type": type,
    "@id": `${absolute(path)}#webpage`,
    url: absolute(path),
    name,
    description,
    inLanguage: "en",
    isPartOf: { "@id": SITE_ID },
    about: { "@id": APP_ID },
    publisher: { "@id": ORG_ID },
  };
}

export function breadcrumbs(trail: { name: string; path: string }[]): JsonLd {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      item: absolute(t.path),
    })),
  };
}

export const graph = (nodes: JsonLd[]): JsonLd => ({ "@context": "https://schema.org", "@graph": nodes });
