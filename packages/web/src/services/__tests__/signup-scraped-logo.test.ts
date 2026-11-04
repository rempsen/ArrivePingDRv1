/**
 * Live, 2026-11-04 (Valley Fiber): self-serve signup failed AFTER the card was
 * saved, with "Logo source URL must be an https:// URL or an app path" under
 * the card form. The brand scout had read a `data:` URI off the site as the
 * logo's source, the page sends the scout's proposal back verbatim as `brand`,
 * and the signup route rejected the whole signup over that one scraped field.
 * No trial subscription was ever created in Stripe.
 *
 * Two guarantees:
 *  - the scout only ever reports http(s) logo links;
 *  - a bad scraped logo source is dropped at signup, never a 400.
 */
import { describe, expect, test } from "bun:test";
import { BrandProposal, CompanyCreateBody } from "../company-provisioning";
import { logoCandidates } from "../brand-scout";

describe("logoCandidates", () => {
  test("keeps only http(s) links", () => {
    const html = `
      <link rel="icon" href="data:;">
      <link rel="icon" href="data:;base64,=">
      <img class="logo" src="data:image/svg+xml;utf8,<svg></svg>">
      <img class="logo-lazy" src="blob:https://example.com/1234">
      <img class="custom-logo" src="/wp-content/uploads/logo.svg">
      <link rel="apple-touch-icon" href="https://cdn.example.com/touch.png">
    `;
    expect(logoCandidates(html, "https://example.com/")).toEqual([
      "https://example.com/wp-content/uploads/logo.svg",
      "https://cdn.example.com/touch.png",
    ]);
  });
});

describe("signup brand validation", () => {
  // The proposal the live scout returned for valleyfiber.ca, trimmed to the
  // fields that matter, as the signup page sends it back.
  const scouted = {
    website: "https://valleyfiber.ca/",
    companyName: "Valley Fiber",
    primaryColor: null,
    accentColor: null,
    logoUrl: null,
    logoSourceUrl: "data:;",
    workerNoun: "Technician",
    services: ["Fiber Internet", "Residential Internet", "Business Internet"],
    suggestedIndustry: "other",
    suggestedIndustryOther: "Internet Service Provider",
    pages: [{ url: "https://valleyfiber.ca/", title: "", text: "" }],
    excerpts: "",
    warnings: ["Found logo links but couldn't download one — add it manually."],
  };

  test("a non-http logo source is dropped, not rejected", () => {
    const r = BrandProposal.safeParse(scouted);
    expect(r.success).toBe(true);
    expect(r.success && "logoSourceUrl" in r.data).toBe(false);
    expect(r.success && r.data.companyName).toBe("Valley Fiber");
  });

  test("the Valley Fiber signup payload passes", () => {
    const body = CompanyCreateBody.omit({ plan: true, managerName: true, managerEmail: true, managerPassword: true });
    const r = body.safeParse({
      name: "Valley Fiber",
      website: "valleyfiber.ca",
      industry: "other",
      industryOther: "Internet Service Provider",
      adminName: "Test Person",
      adminEmail: "owner@example.test",
      adminPhone: "(204) 555-0100",
      adminPassword: "long-enough-1",
      brand: { ...scouted, phone: null, address: null, email: null },
    });
    expect(r.success ? "ok" : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)).toBe("ok");
  });

  test("a good logo source is kept", () => {
    const r = BrandProposal.safeParse({ logoSourceUrl: "https://valleyfiber.ca/wp-content/uploads/2023/12/valley-fiber-logo.svg" });
    expect(r.success && r.data.logoSourceUrl).toBe("https://valleyfiber.ca/wp-content/uploads/2023/12/valley-fiber-logo.svg");
  });
});
