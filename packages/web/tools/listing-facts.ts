/**
 * Listing kit facts: the canonical facts a directory listing (G2, Capterra,
 * AlternativeTo, Crunchbase …) may state about ArrivePing and NVC360, generated
 * from the same constants that feed the site, its schema and llms.txt, so the
 * listings can't drift from the site.
 *
 *   bun run listing:facts                 # prints JSON to stdout
 *   bun run listing:facts --out facts.json
 *
 * Rules:
 *  - Nothing here is typed by hand that the site already states elsewhere:
 *    prices, trial terms, platforms, legal name and people come from config,
 *    schema and the about page.
 *  - Android claims are dropped while ANDROID_APP_LIVE is false (same filter as
 *    llms.txt), so a listing never says there is a Google Play app before there is.
 */
import fs from "node:fs/promises";
import { execSync } from "node:child_process";
import { brand, monthlyPrice, pricing, pricingBands, STARTER_DRIVERS, STARTER_PRICE, TECH_APP_LINE } from "../src/web/site/config";
import { LEADERSHIP } from "../src/web/site/content/landing";
import { chapters } from "../src/web/site/content/features";
import { support } from "../src/web/site/support/articles";
import { keyFacts, withoutAndroidClaims } from "../src/web/prerender/llms";
import {
  ANDROID_APP_LIVE,
  APP_DOWNLOAD_URLS,
  APP_STORE_URL,
  AUDIENCE,
  DISAMBIGUATION,
  LEGAL_NAME,
  OPERATING_SYSTEMS,
  organization,
  parentOrganization,
  SITE_URL,
  SOCIAL_PROFILES,
  TRIAL_TERMS,
} from "../src/web/site/seo/schema";

const commit = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
})();

const org = organization() as Record<string, unknown>;
const parent = parentOrganization() as Record<string, unknown> & { address: Record<string, string> };

/** The competitor pages the site publishes, i.e. the products ArrivePing is listed "as an alternative to". */
const ALTERNATIVE_TO = [
  { name: "Jobber", page: `${SITE_URL}/compare/jobber`, alt: `${SITE_URL}/alternatives/jobber` },
  { name: "Housecall Pro", page: `${SITE_URL}/compare/housecall-pro`, alt: `${SITE_URL}/alternatives/housecall-pro` },
  { name: "ServiceTitan", page: `${SITE_URL}/compare/servicetitan` },
  { name: "Workiz", page: `${SITE_URL}/compare/workiz` },
  { name: "Arrivy", page: `${SITE_URL}/compare/arrivy` },
  { name: "Glympse", page: `${SITE_URL}/compare/glympse` },
  { name: "Onfleet", page: `${SITE_URL}/compare/onfleet` },
  { name: "Routific", page: `${SITE_URL}/compare/routific` },
];

const band = (b: (typeof pricingBands)[number]) => ({
  drivers: b.to === Infinity ? `${b.from}+` : `${b.from}-${b.to}`,
  usd_per_driver_per_month: b.rate,
});

export function listingFacts() {
  return {
    generated_from: { repo: "rempsen/ArrivePingDRv1", commit, note: "Regenerate with `bun run listing:facts`; never edit by hand." },
    product: {
      name: brand.product,
      also_written: brand.lockup,
      website: SITE_URL,
      tagline: brand.tagline,
      status: brand.launch,
      description: withoutAndroidClaims(String(org.description)),
      audience: AUDIENCE,
      disambiguation: DISAMBIGUATION,
      markets: ["Canada", "United States"],
      languages: ["English"],
      operating_systems: OPERATING_SYSTEMS,
      technician_app: TECH_APP_LINE,
      android_app_live: ANDROID_APP_LIVE,
      app_download_urls: APP_DOWNLOAD_URLS,
      app_store_url: APP_STORE_URL,
      sign_up_url: `${SITE_URL}${brand.urls.signUp}`,
      sign_in_url: `${SITE_URL}${brand.urls.signIn}`,
      pricing_url: `${SITE_URL}/pricing`,
      features_url: `${SITE_URL}/features`,
      support_url: `${SITE_URL}/support`,
      privacy_url: `${SITE_URL}${brand.urls.privacy}`,
      terms_url: `${SITE_URL}${brand.urls.terms}`,
      logo_url: `${SITE_URL}/apple-touch-icon.png`,
      knows_about: org.knowsAbout,
    },
    pricing: {
      currency: "USD",
      billing: "monthly",
      model: "per driver (technician) per month, graduated like tax brackets",
      starter: { usd_per_month: STARTER_PRICE, includes: `1 dispatcher + ${STARTER_DRIVERS} drivers` },
      bands: pricingBands.map(band),
      extra_office_user: "a second dispatcher or a manager is priced like a driver",
      tiers: pricing.tiers.map((t) => ({ name: t.name, range: t.range, price: t.price, unit: t.unit, features: t.features })),
      examples: [5, 10, 30].map((n) => ({ drivers: n, ...monthlyPrice(n) })),
      free_trial: TRIAL_TERMS,
      free_plan: false,
      setup_fee: false,
      contract: "none; cancel any time",
      assurances: pricing.assurances,
    },
    features: chapters.map((c) => ({
      stage: c.label,
      title: c.title,
      promise: withoutAndroidClaims(c.promise),
      items: c.tiles.map((t) => ({ title: t.title, text: withoutAndroidClaims(t.text) })),
    })),
    alternative_to: ALTERNATIVE_TO,
    company: {
      name: brand.parent,
      legal_name: LEGAL_NAME,
      website: String(parent.url),
      description: String(parent.description),
      founded: String(parent.foundingDate),
      address: {
        street: parent.address.streetAddress,
        city: parent.address.addressLocality,
        region: parent.address.addressRegion,
        postal_code: parent.address.postalCode,
        country: parent.address.addressCountry,
      },
      leadership: LEADERSHIP.map((p) => ({ name: p.name, role: p.role, bio: p.bio, profile_url: `${SITE_URL}/about#${p.id}`, photo_url: `${SITE_URL}/img/site/team/${p.id}.jpg` })),
      contact: {
        sales_email: brand.contactEmail,
        support_email: support.email,
        privacy_email: support.privacyEmail,
        support_hours: support.hours,
        support_response: support.response,
      },
    },
    social_profiles: SOCIAL_PROFILES,
    key_facts: keyFacts(),
  };
}

if (import.meta.main) {
  const json = `${JSON.stringify(listingFacts(), null, 2)}\n`;
  const i = process.argv.indexOf("--out");
  if (i > -1 && process.argv[i + 1]) {
    await fs.writeFile(process.argv[i + 1], json);
    console.error(`[listing-facts] wrote ${process.argv[i + 1]}`);
  } else {
    process.stdout.write(json);
  }
}
