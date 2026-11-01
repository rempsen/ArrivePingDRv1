/**
 * ENTITY FACTS FOR SEARCH ENGINES AND AI ASSISTANTS
 *   The site's Organization is ArrivePing (an NVC360 company), the app claims
 *   only the platforms that are live (no Android until ANDROID_APP_LIVE), and
 *   llms.txt / llms-full.txt stay compact, accurate and free of stale claims.
 */
import { describe, expect, it } from "bun:test";
import { buildLlmsFullTxt, buildLlmsTxt, withoutAndroidClaims } from "../prerender/llms";
import {
  ANDROID_APP_LIVE,
  ANDROID_CLAIM,
  APP_STORE_URL,
  isoDuration,
  LEGAL_NAME,
  organization,
  PARENT_ORG_ID,
  softwareApplication,
  SOCIAL_PROFILES,
} from "../site/seo/schema";
import { landingPages } from "../site/content/landing";
import { terms } from "../site/legal/terms";

const posts = [
  { slug: "field-service-software-cost", title: "How Much Does Field Service Software Cost?", description: "List prices for 4-, 12- and 28-person teams.", category: "growth" },
  { slug: "some-other-post", title: "Another post", description: "Another description. With a second sentence.", category: "growth" },
];

describe("structured data", () => {
  it("makes the site's Organization ArrivePing, with NVC360 as its parent", () => {
    const org = organization() as Record<string, any>;
    expect(org["@id"]).toBe("https://arriveping.com/#organization");
    expect(org.name).toBe("ArrivePing");
    expect(org.alternateName).toBe("ArrivePing by NVC360");
    expect(org.sameAs).toEqual(SOCIAL_PROFILES);
    expect(org.sameAs).toHaveLength(5);
    expect(org.parentOrganization["@id"]).toBe(PARENT_ORG_ID);
    expect(org.parentOrganization.url).toBe("https://nvc360.com");
    expect(org.parentOrganization.founder.name).toBe("Dan Rosenblat");
  });

  it("uses the legal name exactly as the Terms of Service state it", () => {
    expect(JSON.stringify(terms)).toContain(LEGAL_NAME);
    expect((organization() as Record<string, any>).parentOrganization.legalName).toBe(LEGAL_NAME);
  });

  it("claims only the platforms that are live", () => {
    const app = softwareApplication() as Record<string, any>;
    expect(app.operatingSystem).toBe(ANDROID_APP_LIVE ? "Web, iOS, Android" : "Web, iOS");
    expect(app.installUrl).toBe(APP_STORE_URL);
    if (!ANDROID_APP_LIVE) expect(ANDROID_CLAIM.test(JSON.stringify(app))).toBe(false);
  });

  it("starts the offer at the real entry price, with the trial terms", () => {
    const offer = (softwareApplication() as Record<string, any>).offers;
    expect(offer.price).toBe("49");
    expect(offer.priceCurrency).toBe("USD");
    expect(offer.description).toContain("nothing is charged until day 30");
    expect(offer.priceSpecification.map((p: { price: string }) => p.price)).toEqual(["49", "30", "25"]);
  });

  it("never writes 60 seconds in a video duration", () => {
    expect(isoDuration(59.6)).toBe("PT1M0S");
    expect(isoDuration(125)).toBe("PT2M5S");
  });
});

describe("Android claims", () => {
  it("recognises claims, not mentions", () => {
    expect(ANDROID_CLAIM.test("ArrivePing runs on the iPhone, iPad or Android phone your techs carry.")).toBe(true);
    expect(ANDROID_CLAIM.test("Technician app for iOS and Android")).toBe(true);
    expect(ANDROID_CLAIM.test("Web, iOS, Android")).toBe(true);
    expect(ANDROID_CLAIM.test("The app is for iPhone and iPad. If you carry an Android phone, use the browser.")).toBe(false);
  });

  it.skipIf(ANDROID_APP_LIVE)("drops only the sentence that makes the claim", () => {
    expect(withoutAndroidClaims("No. ArrivePing runs on the iPhone, iPad or Android phone your techs already carry. Techs tap Start Driving.")).toBe(
      "No. Techs tap Start Driving.",
    );
  });
});

describe("llms.txt", () => {
  const txt = buildLlmsTxt("2026-11-01", posts);

  it("is a compact entity file", () => {
    expect(txt.length).toBeLessThan(20_000);
    expect(txt).toContain("Last updated: 2026-11-01");
    expect(txt).toContain("## What ArrivePing is");
    expect(txt).toContain("## Official channels");
    expect(txt).toContain("## When not to recommend ArrivePing");
  });

  it("has the facts assistants are asked for", () => {
    expect(txt).toContain("https://arriveping.com/get-started");
    expect(txt).toContain(APP_STORE_URL);
    expect(txt).toContain("NVC360");
    expect(txt).toContain("Winnipeg");
    expect(txt).toContain("Arrivy");
    expect(txt).toContain("ParkWhiz/Arrive");
    expect(txt).toContain("$49");
    expect(txt).toContain("nothing is charged until day 30");
    expect(txt).toContain("No GPS hardware");
    expect(txt).toContain("live in under an hour (typical)");
    expect(txt).toContain('marks "on the way"');
    for (const u of SOCIAL_PROFILES) expect(txt).toContain(u);
  });

  it("groups help pages under Help Center, not Company", () => {
    expect(txt).toContain("## Help Center");
    expect(txt).not.toMatch(/^## Company$/m);
    for (const g of ["Product", "Solutions", "Compare", "Pricing", "Blog"]) expect(txt).toContain(`## ${g}\n`);
  });

  it.skipIf(ANDROID_APP_LIVE)("does not claim an Android app", () => {
    expect(ANDROID_CLAIM.test(txt)).toBe(false);
  });

  it("has no stale phrases", () => {
    expect(txt).not.toMatch(/launching november|book a demo|\[email protected\]/i);
  });
});

describe("llms-full.txt", () => {
  const full = buildLlmsFullTxt(posts);

  it("covers every product, solution, comparison, pricing and features page", () => {
    expect(full).toContain("URL: https://arriveping.com/features");
    for (const p of landingPages) expect(full).toContain(`URL: https://arriveping.com${p.path}`);
    expect(full).toContain("## Help Center");
    expect(full).toContain("https://arriveping.com/blog/some-other-post");
  });

  it("states shared answers once", () => {
    const counts = new Map<string, number>();
    for (const para of full.split(/\n{2,}/)) {
      const key = para.trim();
      if (key.length >= 80 && !key.startsWith("|") && !key.startsWith("Also answered")) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect([...counts.values()].every((n) => n <= 2)).toBe(true);
  });

  it.skipIf(ANDROID_APP_LIVE)("does not claim an Android app", () => {
    expect(ANDROID_CLAIM.test(full)).toBe(false);
  });
});
