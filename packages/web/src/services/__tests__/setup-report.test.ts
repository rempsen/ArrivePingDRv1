/**
 * The record of what signup built and from what. It exists so the product
 * never says "built from your website" about a starter set, and so a price
 * the scan made up is always labelled as an estimate.
 */
import { describe, expect, test } from "bun:test";
import { groupSections, parseSetupReport, setupOneLine, setupRecorder, setupSummary } from "../setup-report";
import { ESTIMATE_LABEL, estimateLabelled } from "../catalog-scout";
import { signupRows } from "../signup-notify";

const read = { status: "ok", via: "render", pagesRead: 6 } as const;

describe("setupRecorder", () => {
  test("a section is 'website' only when its writer said so", () => {
    const rec = setupRecorder(true);
    rec.mark("services")("website");
    rec.mark("forms")("starter");
    rec.count("services", 9);
    rec.count("forms", 3);
    rec.count("catalog", 14); // never marked: the preset
    rec.count("options", 0); // nothing seeded: left out
    const r = rec.report(read);
    expect(r.sections).toEqual({
      services: { from: "website", count: 9 },
      forms: { from: "industry", count: 3 },
      catalog: { from: "industry", count: 14 },
    });
  });

  test("without an industry preset, a starter set is 'general'", () => {
    const rec = setupRecorder(false);
    rec.count("templates", 4);
    expect(rec.report({ status: "none", via: null, pagesRead: 0 }).sections.templates).toEqual({ from: "general", count: 4 });
  });

  test("a later mark wins (a writer that fell back after trying)", () => {
    const rec = setupRecorder(true);
    const mark = rec.mark("templates");
    mark("website");
    mark("starter");
    rec.count("templates", 4);
    expect(rec.report(read).sections.templates!.from).toBe("industry");
  });
});

describe("summaries", () => {
  const rec = setupRecorder(true);
  rec.mark("services")("website");
  rec.mark("notifications")("website");
  for (const k of ["services", "templates", "forms", "catalog", "notifications"] as const) rec.count(k, 3);
  const r = rec.report(read);

  test("for the person: what is theirs, what is a starter set, and that prices are estimates", () => {
    expect(setupSummary(r)).toEqual([
      "Written from your website: services and customer messages.",
      "Starter set for your industry: work-order templates, intake forms and price catalog. Rename or replace these to match how you work.",
      "Catalog prices are starting estimates. Check them before you quote.",
    ]);
  });

  test("nothing from the website is never worded as if something was", () => {
    const none = setupRecorder(false);
    none.count("templates", 4);
    const lines = setupSummary(none.report({ status: "blocked", via: null, pagesRead: 0 }));
    expect(lines.join(" ")).not.toContain("from your website");
    expect(lines[0]).toStartWith("General starter set: work-order templates.");
  });

  test("for staff: one line that makes a failed scan obvious", () => {
    expect(setupOneLine(r)).toBe("site read (6 pages, hosted browser); from website: services, notifications; starter set: templates, forms, catalog");
    const blocked = setupRecorder(true);
    blocked.count("catalog", 10);
    expect(setupOneLine(blocked.report({ status: "blocked", via: null, pagesRead: 0 }))).toStartWith("site NOT read (blocked); from website: nothing;");
  });

  test("round-trips through the stored JSON, and tolerates junk", () => {
    expect(groupSections(parseSetupReport(JSON.stringify(r))!).website).toEqual(["services", "notifications"]);
    expect(parseSetupReport("")).toBeNull();
    expect(parseSetupReport("{not json")).toBeNull();
    expect(parseSetupReport('{"v":2}')).toBeNull();
  });

  test("the new-signup notice carries it without moving the Admin row", () => {
    const base = { companyId: "c", companyName: "Acme", website: "acme.com", industry: "", adminName: "A", adminEmail: "a@acme.com", adminPhone: "", trialEndsAt: null };
    expect(signupRows(base).length).toBe(8);
    const rows = signupRows({ ...base, setup: setupOneLine(r) });
    expect(rows[7]![0]).toBe("Admin");
    expect(rows[8]).toEqual(["Setup", setupOneLine(r)]);
  });
});

describe("estimateLabelled", () => {
  test("adds the label when the model left it off", () => {
    expect(estimateLabelled("Fibre drop to the home.")).toBe(`Fibre drop to the home. ${ESTIMATE_LABEL}`);
  });
  test("keeps exactly one label, in one spelling", () => {
    for (const d of ["Install (estimated — verify pricing)", "Install (estimated, verify pricing).", "Install (Estimated - verify pricing)", "Install  (estimated verify pricing) "]) {
      expect(estimateLabelled(d)).toBe(`Install ${ESTIMATE_LABEL}`);
    }
  });
  test("never exceeds the description limit, and survives an empty description", () => {
    const out = estimateLabelled("x".repeat(900));
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.endsWith(ESTIMATE_LABEL)).toBe(true);
    expect(estimateLabelled("  ")).toBe(ESTIMATE_LABEL);
  });
});
