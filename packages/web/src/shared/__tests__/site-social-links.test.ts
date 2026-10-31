/**
 * The site footer links to every ArrivePing social profile, each with an
 * icon the footer knows how to draw (SiteFooter maps network → icon).
 */
import { describe, expect, it } from "bun:test";
import { brand, footer } from "../../web/site/config";
import { SOCIAL_ICONS } from "../../web/site/components/SocialIcon";

describe("footer social links", () => {
  it("lists YouTube, Facebook, Instagram, LinkedIn and X, in that order", () => {
    expect(footer.social.map((s) => s.network)).toEqual(["youtube", "facebook", "instagram", "linkedin", "x"]);
  });

  it("points each at the arriveping handle", () => {
    const by = Object.fromEntries(footer.social.map((s) => [s.network, s.href]));
    expect(by.youtube).toBe(brand.urls.youtube);
    expect(by.facebook).toBe("https://www.facebook.com/arriveping");
    expect(by.instagram).toBe("https://www.instagram.com/arriveping");
    expect(by.linkedin).toBe("https://www.linkedin.com/company/arriveping");
    expect(by.x).toBe("https://x.com/arriveping");
  });

  it("has an icon for every network it lists", () => {
    for (const s of footer.social) expect(SOCIAL_ICONS[s.network]).toBeString();
  });
});
