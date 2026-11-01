/**
 * JSON-LD builders for the public marketing pages.
 *
 * Rules:
 *  - Structured data must describe what is visible on the page. FAQPage is
 *    only emitted from the same FAQ array the page renders.
 *  - No ratings or reviews until real ones exist.
 *  - Every node that other pages reference has a stable `@id`.
 */
import { brand, pricing, pricingBands, STARTER_DRIVERS, STARTER_PRICE } from "../config";
import { support } from "../support/articles";

export const SITE_URL = "https://arriveping.com";
/** The site's Organization: ArrivePing (the brand). The @id is unchanged so every existing reference stays valid. */
export const ORG_ID = `${SITE_URL}/#organization`;
/** NVC360, the company that makes ArrivePing (same @id that nvc360.com uses for itself). */
export const PARENT_ORG_ID = "https://nvc360.com/#organization";
export const SITE_ID = `${SITE_URL}/#website`;
export const APP_ID = `${SITE_URL}/#software`;

/* ------------------------------------------------------------------ */
/* App availability: the one switch for "which phones does it run on"  */
/* ------------------------------------------------------------------ */

/**
 * Is the Android app publicly listed on Google Play?
 *
 * Checked 2026-11-01: the listing below returns 404 (not public yet). While
 * this is false, nothing generated from this repo (JSON-LD, llms.txt,
 * llms-full.txt) may claim Android, and `bun run seo:check` fails if it does.
 * Flip it to true the day the listing is public; the schema, the llms files and
 * the check all follow.
 */
export const ANDROID_APP_LIVE = false;
/** Google Play listing (package id from packages/mobile/app.json). Only published while ANDROID_APP_LIVE is true. */
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.nvc360.uberize";
/** The live iOS app (iPhone and iPad). */
export const APP_STORE_URL = brand.urls.appStore;
/** Platforms the product really runs on today. */
export const OPERATING_SYSTEMS = ANDROID_APP_LIVE ? "Web, iOS, Android" : "Web, iOS";
/** Store listings that are live today. */
export const APP_DOWNLOAD_URLS: string[] = ANDROID_APP_LIVE ? [APP_STORE_URL, PLAY_STORE_URL] : [APP_STORE_URL];

/**
 * Text that claims an Android app, e.g. "iOS and Android", "iPhone, iPad or
 * Android phone", "Web, iOS, Android", or a Google Play store link. Mentions
 * that aren't claims ("if you carry an Android phone, use the browser") don't match.
 */
export const ANDROID_CLAIM = /\b(?:iOS|iPhones?|iPads?)\b[^.;:\n]{0,40}?(?:\band\b|\bor\b|&|,)\s*Android\b|play\.google\.com\/store/i;

/** The social profiles ArrivePing runs (same links as the site footer). */
export const SOCIAL_PROFILES: string[] = [brand.urls.youtube, brand.urls.linkedin, brand.urls.facebook, brand.urls.instagram, brand.urls.x];

/** Who ArrivePing is for, in one phrase. Kept general on purpose: no list of "supported industries". */
export const AUDIENCE =
  "any business that sends people to customers: trades such as HVAC, plumbing and electrical, plus home cleaning, security, delivery and home services";

/** The legal entity, exactly as named in the Terms of Service and Privacy Policy (site/legal). */
export const LEGAL_NAME = "10161758 Manitoba Ltd.";

/** Free-trial terms (same facts as the pricing page and config.ts). */
export const TRIAL_TERMS = "30-day free trial with as many users as you like. A card is required, nothing is charged until day 30, and you can cancel any time.";

export const DISAMBIGUATION =
  "ArrivePing (one word) is field service software made by NVC360 in Winnipeg, Canada. It is not affiliated with Arrivy, Arrive Logistics, Arrive AI, ParkWhiz/Arrive or arrive.gg.";

export type JsonLd = Record<string, unknown>;
export type Faq = { q: string; a: string };

export const absolute = (path: string) => (path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`);

const WINNIPEG = {
  "@type": "PostalAddress",
  addressLocality: "Winnipeg",
  addressRegion: "MB",
  addressCountry: "CA",
};

const FOUNDER = { "@type": "Person", name: "Dan Rosenblat", jobTitle: "Founder & CEO" };

/** NVC360, the parent company (referenced from the ArrivePing Organization). */
export function parentOrganization(): JsonLd {
  return {
    "@type": "Organization",
    "@id": PARENT_ORG_ID,
    name: brand.parent,
    legalName: LEGAL_NAME,
    url: "https://nvc360.com",
    description:
      "NVC360 is a software company in Winnipeg, Manitoba, Canada that builds AI software tooling and automations, custom AI solutions and software, and provides consulting. Its first commercial product is ArrivePing.",
    address: { ...WINNIPEG, streetAddress: "423 Main St., 8th Floor", postalCode: "R3B 1B3" },
    foundingDate: "2023",
    founder: FOUNDER,
    knowsAbout: ["AI software tooling and automation", "Custom AI solutions", "Software development"],
    sameAs: ["https://nvc360.com"],
  };
}

/** The site's Organization: ArrivePing, an NVC360 company. */
export function organization(): JsonLd {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: brand.product,
    alternateName: brand.lockup,
    url: SITE_URL,
    logo: { "@type": "ImageObject", url: `${SITE_URL}/apple-touch-icon.png`, width: 180, height: 180 },
    image: `${SITE_URL}/apple-touch-icon.png`,
    description: `ArrivePing is field service software for ${AUDIENCE}. It shows technicians and drivers on a live map, assigns each job to the closest qualified person and texts customers a live ETA. ArrivePing is made by NVC360 in Winnipeg, Manitoba, Canada.`,
    disambiguatingDescription: DISAMBIGUATION,
    email: brand.contactEmail,
    address: WINNIPEG,
    areaServed: ["CA", "US"],
    founder: FOUNDER,
    parentOrganization: parentOrganization(),
    contactPoint: [
      { "@type": "ContactPoint", contactType: "sales", email: brand.contactEmail, areaServed: ["CA", "US"], availableLanguage: ["en"] },
      { "@type": "ContactPoint", contactType: "customer support", email: support.email, areaServed: ["CA", "US"], availableLanguage: ["en"] },
    ],
    knowsAbout: [
      "Field service management software",
      "Technician dispatch and scheduling",
      "Last-mile delivery and driver dispatch",
      "Customer arrival notifications and live ETA tracking",
    ],
    sameAs: SOCIAL_PROFILES,
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

const perMonth = { "@type": "QuantitativeValue", value: 1, unitCode: "MON" };
export function softwareApplication(): JsonLd {
  const bandText = pricingBands
    .map((b) => (b.to === Infinity ? `drivers ${b.from}+ at $${b.rate}` : `drivers ${b.from}–${b.to} at $${b.rate}`))
    .join(", ");
  // The paid tiers after Starter, in the same order as the bands (pricing page: Growing team, Fleet).
  const bandTiers = pricing.tiers.slice(1);
  return {
    "@type": "SoftwareApplication",
    "@id": APP_ID,
    name: brand.product,
    alternateName: brand.lockup,
    url: `${SITE_URL}/`,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Field service management software",
    operatingSystem: OPERATING_SYSTEMS,
    installUrl: APP_STORE_URL,
    downloadUrl: APP_DOWNLOAD_URLS.length === 1 ? APP_DOWNLOAD_URLS[0] : APP_DOWNLOAD_URLS,
    description: `Field service management software for ${AUDIENCE}. ArrivePing shows technicians and drivers on a live map, auto-assigns each work order to the closest qualified technician, sends the job to the technician app, and texts customers a live tracking link with an ETA.`,
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
    // One offer whose price is the real entry price ($49 Starter), with the
    // graduated driver rates as further price specifications, so no engine can
    // read a band rate ($30, $25) as the starting price.
    offers: {
      "@type": "Offer",
      name: "ArrivePing subscription",
      url: `${SITE_URL}/pricing`,
      price: String(STARTER_PRICE),
      priceCurrency: "USD",
      eligibleRegion: ["CA", "US"],
      description: `From US$${STARTER_PRICE} per month: Starter includes 1 dispatcher and ${STARTER_DRIVERS} drivers. Added drivers are graduated: ${bandText} per driver per month. ${TRIAL_TERMS}`,
      priceSpecification: [
        {
          "@type": "UnitPriceSpecification",
          name: "Starter",
          price: String(STARTER_PRICE),
          priceCurrency: "USD",
          unitText: "MONTH",
          referenceQuantity: perMonth,
        },
        ...pricingBands.map((b, i) => ({
          "@type": "UnitPriceSpecification",
          name: bandTiers[i]?.name ?? (b.to === Infinity ? `Drivers ${b.from}+` : `Drivers ${b.from}–${b.to}`),
          price: String(b.rate),
          priceCurrency: "USD",
          unitText: "per driver per month",
          referenceQuantity: perMonth,
          eligibleQuantity:
            b.to === Infinity
              ? { "@type": "QuantitativeValue", minValue: b.from, unitText: "drivers" }
              : { "@type": "QuantitativeValue", minValue: b.from, maxValue: b.to, unitText: "drivers" },
        })),
      ],
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

/** ISO 8601 duration ("PT2M5S"). Rounds first, so 59.6 s is "PT1M0S", never "PT0M60S". */
export function isoDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `PT${Math.floor(total / 60)}M${total % 60}S`;
}

/** schema.org VideoObject for a Help Center video (embedded on our pages, hosted on YouTube). */
export function videoObject(v: {
  youtubeId: string;
  title: string;
  summary: string;
  seconds: number;
  poster: string;
  uploaded: string;
}): JsonLd {
  return {
    "@type": "VideoObject",
    "@id": `https://www.youtube.com/watch?v=${v.youtubeId}`,
    name: v.title,
    description: v.summary,
    thumbnailUrl: absolute(v.poster),
    uploadDate: v.uploaded,
    duration: isoDuration(v.seconds),
    embedUrl: `https://www.youtube-nocookie.com/embed/${v.youtubeId}`,
    url: `https://www.youtube.com/watch?v=${v.youtubeId}`,
    inLanguage: "en",
    publisher: { "@id": ORG_ID },
  };
}
