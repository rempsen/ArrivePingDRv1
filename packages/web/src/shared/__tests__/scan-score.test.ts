/** The rubric the reference set is scored with (tools/scan-eval.ts). */
import { describe, expect, test } from "bun:test";
import { AREA_MAX, sameName, scoreScan, summarizeSet } from "../scan-score";

const full = {
  scan: { status: "ok", via: "render", pagesRead: 6 },
  companyName: "Valley Fiber",
  phone: "800-958-5698",
  email: "info@valleyfiber.ca",
  address: "Winkler, MB",
  description: "Rural internet.",
  logoUrl: "/api/files/x.png",
  primaryColor: "#E4002B",
  suggestedIndustry: "telecom-internet-installation",
  services: ["Residential Fiber Internet", "Business Fiber Internet", "Fixed Wireless Internet", "Managed Wi-Fi", "Valley TV", "Phone", "Hosted PBX", "Dark Fiber"],
  pages: [1, 2, 3, 4, 5, 6],
};

describe("scoreScan", () => {
  test("the areas add up to 100", () => {
    expect(Object.values(AREA_MAX).reduce((a, b) => a + b, 0)).toBe(100);
  });

  test("a complete scan scores 100 with nothing missing", () => {
    expect(scoreScan(full)).toMatchObject({ total: 100, grade: "excellent", missing: [] });
  });

  test("a site that was not read scores poor and says why", () => {
    const s = scoreScan({ scan: { status: "blocked", via: null, pagesRead: 0 } });
    expect(s.total).toBe(0);
    expect(s.grade).toBe("poor");
    expect(s.missing[0]).toBe("the site was not read (blocked)");
  });

  test("checked against what we know: a wrong name, phone or industry loses the points", () => {
    const truth = { name: "Valley Fiber", phone: "1-800-958-5698", industry: "telecom-internet-installation", services: ["Fiber Internet", "Wireless Internet", "Security Cameras"] };
    const right = scoreScan(full, truth);
    expect(right.areas.identity).toBe(25);
    expect(right.areas.industry).toBe(15);
    // two of the three known services were listed
    expect(right.areas.services).toBe(13);
    expect(right.missing).toEqual(["services not found: Security Cameras"]);

    const wrong = scoreScan({ ...full, companyName: "Home", phone: "204-555-0100", suggestedIndustry: "other" }, truth);
    expect(wrong.areas.identity).toBe(13);
    expect(wrong.areas.industry).toBe(0);
    expect(wrong.missing).toEqual(expect.arrayContaining(['name is "Home", expected "Valley Fiber"', "phone is 204-555-0100, expected 1-800-958-5698", 'industry is "other", expected "telecom-internet-installation"']));
  });

  test("a fragment of the name is not the name", () => {
    expect(sameName("Valley Fiber", "Valley Fiber")).toBe(true);
    expect(sameName("Valley Fiber Ltd.", "Valley Fiber")).toBe(true);
    expect(sameName("Valley Fiber", "The Valley Fiber Company Inc.")).toBe(true);
    expect(sameName("Valley Fiber | Rural Internet", "Valley Fiber")).toBe(true);
    expect(sameName("Fiber", "Valley Fiber")).toBe(false);
    expect(sameName("Valley", "Valley Fiber")).toBe(false);
    expect(sameName("ValleyFiber", "Valley Fiber")).toBe(true);
    expect(sameName("Ltd.", "Acme Ltd.")).toBe(false);
    expect(scoreScan({ ...full, companyName: "Fiber" }, { name: "Valley Fiber" }).areas.identity).toBe(18);
  });

  test("the fallback colour and 'other' are not counted as finds", () => {
    const s = scoreScan({ ...full, primaryColor: "#06B6D4", suggestedIndustry: "other", suggestedIndustryOther: "Sign maker" });
    expect(s.areas.brand).toBe(5);
    expect(s.areas.industry).toBe(7);
  });

  test("grades", () => {
    expect(scoreScan({ ...full, email: null, services: full.services.slice(0, 5) }).grade).toBe("excellent"); // 92
    expect(scoreScan({ ...full, email: null, address: null, logoUrl: null, services: full.services.slice(0, 3), pages: [1, 2, 3] }).grade).toBe("good"); // 74
    const thin = scoreScan({ scan: { status: "partial" }, companyName: "Acme", phone: "2045550100", address: "1 Main St", description: "Plumber.", suggestedIndustry: "plumbing", services: ["Drains"], pages: [1] });
    expect(thin).toMatchObject({ total: 55, grade: "thin" }); // read 10, identity 22, industry 15, services 5, pages 3
    expect(scoreScan({ scan: { status: "partial" }, companyName: "Acme", pages: [1] }).grade).toBe("poor");
  });
});

describe("summarizeSet", () => {
  test("average, share read, and where the points went", () => {
    const sum = summarizeSet([scoreScan(full), scoreScan({ scan: { status: "blocked" } }), scoreScan({ ...full, services: [], pages: [1] })]);
    expect(sum.sites).toBe(3);
    expect(sum.readPct).toBe(67);
    expect(sum.average).toBe(Math.round((100 + 0 + 73) / 3));
    expect(sum.byGrade).toEqual({ excellent: 1, good: 1, thin: 0, poor: 1 });
    expect(sum.weakest[0]).toEqual({ area: "services", lostPct: 67 });
  });
  test("an empty set", () => {
    expect(summarizeSet([])).toMatchObject({ sites: 0, average: 0, readPct: 0 });
  });
});
