/**
 * The scanner's output is posted back to signup verbatim. The two used to
 * disagree (the scan returned up to 20 pages, signup accepted 15), so the
 * richest sites were the ones rejected. Whatever the scan returns must parse.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BrandProposal, _scan, scanIfMissing } from "../company-provisioning";
import { fitProposal, PROPOSAL_MAX_PAGES, scoutBrand, type BrandProposal as Proposal } from "../brand-scout";

const long = (n: number) => "x".repeat(n);
function maximal(): Proposal {
  return {
    website: "https://acme.test/" + long(600),
    companyName: long(500),
    primaryColor: "#112233",
    accentColor: "#445566",
    logoUrl: "/api/files/logo.png",
    logoSourceUrl: "https://acme.test/logo.png",
    workerNoun: long(90), workerNounPlural: " ", customerNoun: "Customer", customerNounPlural: "Customers", jobNoun: "Job", jobNounPlural: "Jobs",
    tagline: long(900), description: long(5000), serviceArea: long(900),
    services: Array.from({ length: 400 }, (_, i) => `Service ${i}`),
    hours: long(900), address: long(900), email: "not an email", phone: "204-555-0100",
    socials: {},
    suggestedIndustry: "other", suggestedIndustryOther: "Internet provider", suggestedIndustryRationale: "They sell internet.",
    teamMembers: Array.from({ length: 80 }, (_, i) => ({ name: long(200) + i, title: long(200), role: "tech", email: null, phone: null })) as never,
    contactEmails: Array.from({ length: 60 }, (_, i) => `a${i}@acme.test`),
    mentionedStaff: Array.from({ length: 60 }, (_, i) => `Person ${i}`),
    googleReviewUrl: null,
    pages: Array.from({ length: 90 }, (_, i) => ({ url: `https://acme.test/p${i}`, title: long(900), text: long(30_000) })),
    excerpts: long(20_000),
    warnings: [],
    scan: { status: "ok", via: "direct", httpStatus: 200, pagesRead: 90 },
  } as unknown as Proposal;
}

describe("scan → signup contract", () => {
  test("the largest proposal the scanner can produce is accepted by signup", () => {
    const fitted = fitProposal(maximal());
    const parsed = BrandProposal.safeParse(fitted);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 5)));
    expect(fitted.pages.length).toBe(PROPOSAL_MAX_PAGES);
    expect(fitted.email).toBeNull();
    expect(fitted.workerNounPlural).toBeNull();
  });

  test("an empty (failed) scan is accepted too", async () => {
    const { _setSiteFetchForTests } = await import("../site-fetch");
    const key = process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    _setSiteFetchForTests(async () => new Response("no", { status: 403 }));
    try {
      const p = await scoutBrand("acme.test", "t");
      expect(BrandProposal.safeParse(p).success).toBe(true);
    } finally {
      _setSiteFetchForTests(null);
      if (key !== undefined) process.env.FIRECRAWL_API_KEY = key;
    }
  });
});

describe("scanIfMissing", () => {
  const real = _scan.scoutBrand;
  const realRecord = _scan.record;
  let recorded: Parameters<typeof _scan.record>[0][] = [];
  beforeEach(() => {
    recorded = [];
    _scan.record = async (r) => void recorded.push(r);
  });
  afterEach(() => {
    _scan.scoutBrand = real;
    _scan.record = realRecord;
  });
  const good = (): Proposal => ({
    ...fitProposal(maximal()),
    companyName: "Valley Fiber",
    phone: "1-800-958-5698",
    suggestedIndustry: "telecom-internet-installation",
    suggestedIndustryOther: null,
  });

  test("skips when the browser already sent a scan", async () => {
    let called = false;
    _scan.scoutBrand = async () => ((called = true), good());
    const b: any = { website: "valleyfiber.ca", brand: { pages: [{ url: "u", title: "t", text: "x" }] } };
    expect(await scanIfMissing(b, "vf")).toBe("skipped");
    expect(called).toBe(false);
  });

  test("skips when there is no website", async () => {
    expect(await scanIfMissing({ name: "X" } as any, "x")).toBe("skipped");
  });

  test("never fetches a private, loopback or non-web address", async () => {
    let called = 0;
    _scan.scoutBrand = async () => (called++, good());
    for (const website of ["http://127.0.0.1:4200/api/health", "http://10.0.0.5/", "http://169.254.169.254/latest/meta-data", "localhost", "javascript:alert(1)", "file:///etc/passwd"]) {
      expect(await scanIfMissing({ website } as any, "x")).toBe("skipped");
    }
    expect(called).toBe(0);
  });

  test("fills the brand and a blank industry from a server-side scan", async () => {
    _scan.scoutBrand = async () => good();
    const b: any = { website: "valleyfiber.ca", industry: "", brand: undefined };
    expect(await scanIfMissing(b, "vf")).toBe("filled");
    expect(b.brand.pages.length).toBeGreaterThan(0);
    expect(b.brand.phone).toBe("1-800-958-5698");
    expect(b.industry).toBe("telecom-internet-installation");
  });

  test("what the person typed wins over what the scan found", async () => {
    _scan.scoutBrand = async () => good();
    const b: any = { website: "valleyfiber.ca", industry: "electrical", brand: { companyName: "VF Inc", phone: "", pages: [] } };
    await scanIfMissing(b, "vf");
    expect(b.brand.companyName).toBe("VF Inc");
    expect(b.brand.phone).toBe("1-800-958-5698");
    expect(b.industry).toBe("electrical");
  });

  test("a scan that still reads nothing leaves the signup untouched", async () => {
    _scan.scoutBrand = async () => ({ ...good(), pages: [], scan: { status: "blocked", via: null, httpStatus: 403, pagesRead: 0 } });
    const b: any = { website: "valleyfiber.ca", industry: "" };
    expect(await scanIfMissing(b, "vf")).toBe("empty");
    // Nothing is filled in; only the reason is kept, for the setup report.
    expect(b.brand).toEqual({ scan: { status: "blocked", via: null, httpStatus: 403, pagesRead: 0 } });
  });

  test("the record says what signup got: a scan that outlives the deadline is a timeout", async () => {
    let asked: unknown;
    let finish: (p: Proposal) => void = () => {};
    _scan.scoutBrand = (_w, _c, run) => ((asked = run), new Promise<Proposal>((r) => (finish = r)));
    const realSetTimeout = globalThis.setTimeout;
    // Fire the 40 s deadline at once.
    globalThis.setTimeout = ((fn: () => void) => realSetTimeout(fn, 0)) as typeof setTimeout;
    try {
      const b: any = { website: "valleyfiber.ca", industry: "" };
      expect(await scanIfMissing(b, "vf")).toBe("empty");
      expect(b.brand.scan.status).toBe("timeout");
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    // The scan was told not to write its own record...
    expect(asked).toMatchObject({ source: "fallback", record: false });
    // ...so its late success adds nothing, and the one record is the timeout.
    finish(good());
    await new Promise((r) => realSetTimeout(r, 5));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ status: "timeout", source: "fallback", companyId: "vf", pagesRead: 0 });
  });

  test("a scan that finishes in time is recorded with its result, against the company", async () => {
    _scan.scoutBrand = async () => good();
    await scanIfMissing({ website: "valleyfiber.ca", industry: "" } as any, "vf");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ status: "ok", via: "direct", source: "fallback", companyId: "vf" });
  });

  test("a scan that throws never fails the signup", async () => {
    _scan.scoutBrand = async () => {
      throw new Error("boom");
    };
    expect(await scanIfMissing({ website: "valleyfiber.ca" } as any, "vf")).toBe("empty");
  });
});
