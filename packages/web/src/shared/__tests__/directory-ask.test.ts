/**
 * Directory AI search, the pure half: names in a question resolve to this
 * company's properties and team (typos and partial names included, and a name
 * that matches nothing says so instead of widening the answer); the filter
 * tests rows the way a property manager means; and the keyword reading answers
 * common questions when the model isn't there.
 */
import { describe, it, expect } from "bun:test";
import {
  AskInterpretation,
  DirectoryFilter,
  emptyInterpretation,
  filterChips,
  filterPredicate,
  hasStructure,
  heuristicInterpretation,
  matchNames,
  resolveInterpretation,
  UNMATCHED,
} from "../directory-ask";
import type { DirectoryRow } from "../directory-query";

const properties = [
  { id: "p-maple", name: "Maple Court" },
  { id: "p-maple-e", name: "Maple Court East" },
  { id: "p-birch", name: "Birch Towers" },
  { id: "p-pine", name: "Pine Row Townhomes" },
];
const staff = [
  { id: "s-jordan", name: "Jordan Patel" },
  { id: "s-sam", name: "Sam Ortiz" },
];

function row(p: Partial<DirectoryRow> & { id: string }): DirectoryRow {
  return {
    name: "", email: "", phone: "", role: "customer", kind: "customer", status: "active", isSample: false,
    propertyId: null, propertyName: "", propertyAddress: "", unit: "", managerId: null, managerName: "",
    managedCount: 0, address: "", city: "", company: "", createdAt: null, openJobs: 0, lastVisitAt: null, ...p,
  };
}
const filter = (p: Partial<DirectoryFilter> = {}): DirectoryFilter =>
  ({ ...resolveInterpretation(emptyInterpretation(), [], []).filter, ...p });

describe("matching names from a question", () => {
  it("exact, whatever the case or punctuation", () => {
    expect(matchNames("maple court", properties).map((p) => p.id)).toEqual(["p-maple"]);
    expect(matchNames("BIRCH-TOWERS!", properties).map((p) => p.id)).toEqual(["p-birch"]);
  });

  it("part of a name: every property it's a whole word of", () => {
    expect(matchNames("maple", properties).map((p) => p.id)).toEqual(["p-maple", "p-maple-e"]);
    expect(matchNames("pine row", properties).map((p) => p.id)).toEqual(["p-pine"]);
    // Not inside a word: "ape" isn't Maple.
    expect(matchNames("ape", properties)).toEqual([]);
  });

  it("a small typo", () => {
    expect(matchNames("Mapel Court", properties).map((p) => p.id)).toEqual(["p-maple"]);
    expect(matchNames("Jordon Patel", staff).map((p) => p.id)).toEqual(["s-jordan"]);
  });

  it("nothing for a name that isn't theirs", () => {
    expect(matchNames("Willow Gardens", properties)).toEqual([]);
    expect(matchNames("", properties)).toEqual([]);
  });
});

describe("resolving the model's answer", () => {
  it("names become ids; asking about a property means its residents", () => {
    const { filter: f, notes } = resolveInterpretation({ ...emptyInterpretation(), properties: ["Maple Court"], managers: ["Sam Ortiz"] }, properties, staff);
    expect(f.propertyIds).toEqual(["p-maple"]);
    expect(f.managerIds).toEqual(["s-sam"]);
    expect(f.kind).toBe("customer");
    expect(notes).toEqual([]);
  });

  it("a name that matches nothing says so, and matches nobody (never everybody)", () => {
    const { filter: f, notes } = resolveInterpretation({ ...emptyInterpretation(), properties: ["Willow Gardens"] }, properties, staff);
    expect(f.propertyIds).toEqual([UNMATCHED]);
    expect(notes).toEqual(["No property called “Willow Gardens”."]);
    expect(filterPredicate(f, null)(row({ id: "r", propertyId: "p-maple" }))).toBe(false);
  });

  it("and offers the names it might have meant", () => {
    const { notes } = resolveInterpretation({ ...emptyInterpretation(), properties: ["Maple Annex"], managers: ["Jordan Smith"] }, properties, staff);
    expect(notes).toEqual([
      "No property called “Maple Annex”. Did you mean Maple Court or Maple Court East?",
      "Nobody on the team called “Jordan Smith”. Did you mean Jordan Patel?",
    ]);
  });

  it("no property / no manager", () => {
    const { filter: f } = resolveInterpretation({ ...emptyInterpretation(), noProperty: true, noManager: true }, properties, staff);
    expect(f.propertyIds).toEqual(["none"]);
    expect(f.managerIds).toEqual(["none"]);
  });

  it("drops dates that aren't dates, trims words, dedupes units", () => {
    const i = { ...emptyInterpretation(), lastVisitBefore: "2026-13-45", keywords: "  smith ", units: ["4B", " 4B", ""] };
    expect(AskInterpretation.safeParse(i).success).toBe(true);
    const { filter: f } = resolveInterpretation(i, properties, staff);
    expect(f.lastVisitBefore).toBeNull();
    expect(f.keywords).toBe("smith");
    expect(f.units).toEqual(["4B"]);
  });

  it("the model can't send a sort or kind that doesn't exist", () => {
    expect(AskInterpretation.safeParse({ ...emptyInterpretation(), sort: "salary" }).success).toBe(false);
    expect(AskInterpretation.safeParse({ ...emptyInterpretation(), kind: "admins" }).success).toBe(false);
  });
});

describe("the filter on rows", () => {
  const zoe = row({ id: "zoe", email: "zoe@x.ca", phone: "204-555-0101", propertyId: "p-maple", managerId: "s-jordan", unit: "4B", openJobs: 2, lastVisitAt: "2026-09-01T17:00:00.000Z", createdAt: "2024-01-10T00:00:00.000Z", city: "Winnipeg" });
  const ben = row({ id: "ben", email: "ben@co.import.local", phone: "", propertyId: "p-birch", managerId: null, unit: "", openJobs: 0, lastVisitAt: null, createdAt: "2026-05-01T00:00:00.000Z", status: "invited" });
  const amy = row({ id: "amy", email: "amy@x.ca", phone: "1", propertyId: null, unit: "", openJobs: 0, lastVisitAt: "2025-12-20T00:00:00.000Z", address: "12 Elm St, Brandon MB" });
  const jordan = row({ id: "s-jordan", role: "rider", kind: "field", email: "j@co.ca", phone: "" });
  const all = [zoe, ben, amy, jordan];
  const pick = (f: DirectoryFilter, jobs: Set<string> | null = null) => all.filter(filterPredicate(f, jobs)).map((r) => r.id);

  it("property, no property, and a manager's residents (not the manager)", () => {
    expect(pick(filter({ propertyIds: ["p-maple", "p-birch"] }))).toEqual(["zoe", "ben"]);
    expect(pick(filter({ propertyIds: ["none"] }))).toEqual(["amy"]);
    expect(pick(filter({ managerIds: ["s-jordan"] }))).toEqual(["zoe"]);
    expect(pick(filter({ managerIds: ["none"] }))).toEqual(["ben", "amy"]);
  });

  it("unit and city (the city of their address or their property's)", () => {
    expect(pick(filter({ units: ["4b"] }))).toEqual(["zoe"]);
    expect(pick(filter({ city: "brandon" }))).toEqual(["amy"]);
  });

  it("missing details: a placeholder email is no email", () => {
    expect(pick(filter({ missing: ["email"] }))).toEqual(["ben"]);
    expect(pick(filter({ missing: ["phone"] }))).toEqual(["ben", "s-jordan"]);
    expect(pick(filter({ missing: ["unit"] }))).toEqual(["ben", "amy"]);
  });

  it("open requests and visits", () => {
    expect(pick(filter({ openRequests: "some" }))).toEqual(["zoe"]);
    expect(pick(filter({ openRequests: "none", kind: "customer" })).filter((x) => x !== "s-jordan")).toEqual(["ben", "amy"]);
    expect(pick(filter({ minOpenRequests: 2 }))).toEqual(["zoe"]);
    expect(pick(filter({ neverVisited: true })).filter((x) => x !== "s-jordan")).toEqual(["ben"]);
    expect(pick(filter({ lastVisitBefore: "2026-01-01" }))).toEqual(["amy"]);
    expect(pick(filter({ lastVisitAfter: "2026-01-01" }))).toEqual(["zoe"]);
  });

  it("days start at midnight in the company's zone (Codex on #116)", () => {
    // 9 pm Dec 31 in Winnipeg is already Jan 1 in UTC.
    const late = row({ id: "late", lastVisitAt: "2026-01-01T03:00:00.000Z" });
    const before = filter({ lastVisitBefore: "2026-01-01" });
    expect(filterPredicate(before, null, "America/Winnipeg")(late)).toBe(true);
    expect(filterPredicate(before, null, "UTC")(late)).toBe(false);
  });

  it("joined, status, and who had a matching work order", () => {
    expect(pick(filter({ joinedAfter: "2026-01-01" }))).toEqual(["ben"]);
    expect(pick(filter({ status: "invited" }))).toEqual(["ben"]);
    expect(pick(filter({ jobText: "leak" }), new Set(["amy"]))).toEqual(["amy"]);
  });

  it("knows when there's more to a filter than its words", () => {
    expect(hasStructure(filter({ keywords: "zoe" }))).toBe(false);
    expect(hasStructure(filter({ keywords: "zoe", openRequests: "some" }))).toBe(true);
  });
});

describe("chips", () => {
  it("say how the question was read, in the company's words", () => {
    const f = filter({ kind: "customer", propertyIds: ["p-maple"], managerIds: ["s-jordan"], openRequests: "some", missing: ["email"], lastVisitBefore: "2026-03-01", jobText: "leak", sort: "unit", groupBy: "property" });
    expect(filterChips(f, { properties, staff, customerNounPlural: "Residents", workerNounPlural: "Property Managers" })).toEqual([
      "Residents",
      "Maple Court",
      "Manager: Jordan Patel",
      "No email",
      "Open requests",
      "Last visit before Mar 1, 2026",
      "Work orders mentioning “leak”",
      "Grouped by property",
      "Sorted by unit",
    ]);
  });
});

describe("the keyword reading (no AI)", () => {
  const read = (q: string) => heuristicInterpretation(q, properties, staff);

  it("finds property names, the longest first", () => {
    expect(read("residents at Maple Court East").properties).toEqual(["Maple Court East"]);
    expect(read("who lives at maple court?").properties).toEqual(["Maple Court"]);
  });

  it("a team member's residents only when the question says manager", () => {
    expect(read("residents managed by Jordan Patel").managers).toEqual(["Jordan Patel"]);
    const direct = read("Jordan Patel phone");
    expect(direct.managers).toEqual([]);
    expect(direct.keywords).toBe("jordan patel");
  });

  it("common phrases", () => {
    const r = read("Birch Towers tenants with open requests and no email, by unit");
    expect(r).toMatchObject({ kind: "customer", properties: ["Birch Towers"], openRequests: "some", missing: ["email"], sort: "unit", keywords: "" });
    expect(read("residents without a property").noProperty).toBe(true);
    expect(read("never visited").neverVisited).toBe(true);
    expect(read("unit 4b at pine row townhomes")).toMatchObject({ units: ["4B"], properties: ["Pine Row Townhomes"] });
  });

  it("what's left is the keyword search", () => {
    expect(read("find Zoe Adams").keywords).toBe("zoe adams");
    expect(read("show me all the residents").keywords).toBe("");
  });

  it("always a valid interpretation", () => {
    for (const q of ["", "???", "a".repeat(300), "residents at Maple Court with open requests"]) {
      expect(AskInterpretation.safeParse(read(q)).success).toBe(true);
    }
  });
});
