/**
 * Live eval for the Directory's AI search against the real small model.
 *
 *   AI_GATEWAY_BASE_URL=… AI_GATEWAY_API_KEY=… [AI_SMALL_MODEL=…] bun run directory-ask:eval
 *
 * Asks 16 property-manager questions against a made-up company (no real
 * people) and checks the parts of the model's reading each one depends on:
 * the property and manager names, open requests, missing details, job words,
 * dates, order and grouping. The bar is 14 of 16 (exit 1 below it). It also
 * prints the time each answer took.
 *
 * Without AI_GATEWAY_API_KEY it says so and exits 0, so CI can call it safely.
 */
import { modelInterpretation } from "../src/services/directory-ask";
import { resolveInterpretation, type AskInterpretation } from "../src/shared/directory-ask";
import type { DirectoryRow } from "../src/shared/directory-query";
import type { PropertyItem } from "../src/services/directory";

if (!process.env.AI_GATEWAY_API_KEY) {
  console.log("Directory ask eval skipped: set AI_GATEWAY_API_KEY (and AI_GATEWAY_BASE_URL) to run it against the real model.");
  process.exit(0);
}

const TODAY = "2026-10-18";
const prop = (id: string, name: string, managerName = ""): PropertyItem => ({ id, name, address: "", notes: "", managerId: null, managerName, residents: 0, openJobs: 0, createdAt: null });
const properties = [
  prop("maple", "Maple Court", "Jordan Patel"),
  prop("birch", "Birch Towers", "Avery Chen"),
  prop("cedar", "Cedar Lofts", "Jordan Patel"),
  prop("harbour", "Harbour View", "Lee Wong"),
  prop("pine", "Pine Row Townhomes", "Riley Martin"),
];
const person = (id: string, name: string, kind: "field" | "office"): DirectoryRow =>
  ({ id, name, kind, role: kind === "field" ? "rider" : "dispatcher" }) as DirectoryRow;
const staff = [person("jordan", "Jordan Patel", "field"), person("avery", "Avery Chen", "field"), person("riley", "Riley Martin", "field"), person("lee", "Lee Wong", "office")];
const nouns = { customer: "Resident", customers: "Residents", worker: "Property Manager", workers: "Property Managers" };

type Check = (i: AskInterpretation, f: ReturnType<typeof resolveInterpretation>["filter"]) => boolean;
const cases: { q: string; checks: Record<string, Check> }[] = [
  { q: "residents at Maple Court with open requests", checks: { property: (_, f) => f.propertyIds.join() === "maple", open: (i) => i.openRequests === "some" || (i.minOpenRequests ?? 0) >= 1 } },
  { q: "who lives in birch towers", checks: { property: (_, f) => f.propertyIds.join() === "birch", kind: (_, f) => f.kind === "customer" } },
  { q: "Jordan's residents", checks: { manager: (_, f) => f.managerIds.join() === "jordan" } },
  { q: "residents managed by Avery, sorted by unit", checks: { manager: (_, f) => f.managerIds.join() === "avery", sort: (i) => i.sort === "unit" } },
  { q: "tenants with no email on file", checks: { missing: (i) => i.missing.includes("email") } },
  { q: "residents without a phone number at Harbour View", checks: { missing: (i) => i.missing.includes("phone"), property: (_, f) => f.propertyIds.join() === "harbour" } },
  { q: "who hasn't been visited since March", checks: { before: (i) => i.lastVisitBefore === "2026-03-01" || i.neverVisited } },
  { q: "residents never visited", checks: { never: (i) => i.neverVisited } },
  { q: "anyone who had a leak", checks: { job: (i) => /leak/i.test(i.jobText) } },
  { q: "open furnace work orders", checks: { job: (i) => /furnace/i.test(i.jobText), open: (i) => i.jobOpenOnly || i.openRequests === "some" } },
  { q: "residents with 3 or more open requests", checks: { min: (i) => i.minOpenRequests === 3 } },
  { q: "residents not assigned to any property", checks: { none: (i) => i.noProperty || i.missing.includes("property") } },
  { q: "Jordan Patel's phone number", checks: { keywords: (i) => /jordan/i.test(i.keywords), notManager: (i) => i.managers.length === 0 } },
  { q: "unit 4B at pine row", checks: { unit: (i) => i.units.map((u) => u.toUpperCase()).includes("4B"), property: (_, f) => f.propertyIds.join() === "pine" } },
  { q: "residents at Willow Gardens", checks: { unmatched: (_, f) => f.propertyIds.join() === "unmatched" } },
  { q: "group Cedar Lofts and Maple Court residents by property", checks: { both: (_, f) => [...f.propertyIds].sort().join() === "cedar,maple", group: (i) => i.groupBy === "property" } },
];

let passed = 0;
for (const c of cases) {
  const t0 = Date.now();
  try {
    const i = await modelInterpretation(c.q, { nouns, properties, staff, today: TODAY });
    const { filter } = resolveInterpretation(i, properties, staff);
    const failed = Object.entries(c.checks).filter(([, check]) => !check(i, filter)).map(([k]) => k);
    if (!failed.length) passed++;
    console.log(`${failed.length ? "FAIL" : "PASS"} ${c.q} · ${Date.now() - t0} ms${failed.length ? `\n     missed: ${failed.join(", ")}` : ""}\n     ${JSON.stringify({ ...i, summary: undefined })}`);
  } catch (e) {
    console.log(`FAIL ${c.q}\n     error: ${(e as Error).message}`);
  }
}
console.log(`\n${passed} of ${cases.length} passed (bar: 14)`);
process.exit(passed >= 14 ? 0 : 1);
