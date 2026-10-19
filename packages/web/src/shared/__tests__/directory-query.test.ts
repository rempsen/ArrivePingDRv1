/**
 * The Directory query (Dan, 2026-10-18): a property manager with thousands of
 * residents sorts them by property, by resident and by the property's
 * manager, groups them under section headers, and filters to one building or
 * one manager — and the server pages the result so nobody gets 2,500 rows.
 */
import { describe, it, expect } from "bun:test";
import { applyDirectoryQuery, matchesSearch, rowComparator, kindOfRole, MAX_IDS, type DirectoryRow } from "../directory-query";

function row(p: Partial<DirectoryRow> & { id: string }): DirectoryRow {
  return {
    name: "",
    email: "",
    phone: "",
    role: "customer",
    kind: "customer",
    status: "active",
    isSample: false,
    propertyId: null,
    propertyName: "",
    propertyAddress: "",
    unit: "",
    managerId: null,
    managerName: "",
    managedCount: 0,
    address: "",
    city: "",
    company: "",
    createdAt: null,
    openJobs: 0,
    lastVisitAt: null,
    ...p,
  };
}

const maple = { propertyId: "p-maple", propertyName: "Maple Court", propertyAddress: "12 Maple St", managerId: "s-jordan", managerName: "Jordan Patel" };
const birch = { propertyId: "p-birch", propertyName: "Birch Towers", propertyAddress: "400 Birch Ave", managerId: "s-sam", managerName: "Sam Ortiz" };
const cedar = { propertyId: "p-cedar", propertyName: "Cedar Lofts", propertyAddress: "", managerId: "s-jordan", managerName: "Jordan Patel" };

const people: DirectoryRow[] = [
  row({ id: "r1", name: "Zoe Adams", email: "zoe@x.ca", phone: "(204) 555-0101", unit: "10", ...maple, openJobs: 2, lastVisitAt: "2026-09-01T00:00:00.000Z" }),
  row({ id: "r2", name: "Ben Kowalczyk", email: "ben@x.ca", phone: "204-555-0102", unit: "2", ...maple }),
  row({ id: "r3", name: "Amy Chen", email: "amy@x.ca", unit: "4B", ...birch, openJobs: 1, lastVisitAt: "2026-10-01T00:00:00.000Z" }),
  row({ id: "r4", name: "Carl Diaz", email: "carl@x.ca", unit: "1", ...cedar }),
  row({ id: "r5", name: "Dana Ellis", email: "dana@x.ca" }), // no property
  row({ id: "s-jordan", name: "Jordan Patel", email: "jordan@co.ca", role: "rider", kind: "field", managedCount: 2 }),
  row({ id: "s-sam", name: "Sam Ortiz", email: "sam@co.ca", role: "dispatcher", kind: "office", managedCount: 1 }),
];

const ids = (rows: DirectoryRow[]) => rows.map((r) => r.id);

describe("kinds", () => {
  it("field staff, office staff and everyone else is a customer", () => {
    expect(kindOfRole("rider")).toBe("field");
    for (const r of ["admin", "superadmin", "manager", "dispatcher", "project_manager"]) expect(kindOfRole(r)).toBe("office");
    expect(kindOfRole("customer")).toBe("customer");
    expect(kindOfRole(null)).toBe("customer");
  });

  it("each tab's count comes back with any page of results", () => {
    const r = applyDirectoryQuery(people, { kind: "customer" });
    expect(r.facets.kinds).toEqual({ all: 7, customer: 5, field: 1, office: 1 });
    expect(r.total).toBe(5);
  });
});

describe("sorting by what a property manager asks for", () => {
  it("by resident name, A–Z and Z–A", () => {
    expect(ids(applyDirectoryQuery(people, { kind: "customer", sort: "name" }).rows)).toEqual(["r3", "r2", "r4", "r5", "r1"]);
    expect(ids(applyDirectoryQuery(people, { kind: "customer", sort: "name", dir: "desc" }).rows)).toEqual(["r1", "r5", "r4", "r2", "r3"]);
  });

  it("by property name, with people at the same property by name, and no property last", () => {
    expect(ids(applyDirectoryQuery(people, { kind: "customer", sort: "property" }).rows)).toEqual(["r3", "r4", "r2", "r1", "r5"]);
    // Descending still puts the blanks last: nobody wants "no property" at the top.
    expect(ids(applyDirectoryQuery(people, { kind: "customer", sort: "property", dir: "desc" }).rows)).toEqual(["r2", "r1", "r4", "r3", "r5"]);
  });

  it("by the property's manager", () => {
    expect(ids(applyDirectoryQuery(people, { kind: "customer", sort: "manager" }).rows)).toEqual(["r2", "r4", "r1", "r3", "r5"]);
  });

  it("by unit, in number order (2 before 10)", () => {
    const r = applyDirectoryQuery(people, { kind: "customer", propertyId: "p-maple", sort: "unit" });
    expect(ids(r.rows)).toEqual(["r2", "r1"]);
  });

  it("by open requests and last visit", () => {
    expect(ids(applyDirectoryQuery(people, { kind: "customer", sort: "openJobs", dir: "desc" }).rows).slice(0, 2)).toEqual(["r1", "r3"]);
    expect(ids(applyDirectoryQuery(people, { kind: "customer", sort: "lastVisit", dir: "desc" }).rows).slice(0, 2)).toEqual(["r3", "r1"]);
  });

  it("an unknown sort falls back to name", () => {
    expect(applyDirectoryQuery(people, { sort: "nope" as any }).sort).toBe("name");
  });

  it("the comparator breaks ties by name, then unit, then id", () => {
    const a = row({ id: "a", name: "Same", unit: "2" });
    const b = row({ id: "b", name: "Same", unit: "10" });
    expect([b, a].sort(rowComparator("property", "asc")).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("grouping", () => {
  it("by property: buildings A–Z, the no-property bucket last, with address and manager on the header", () => {
    const r = applyDirectoryQuery(people, { kind: "customer", groupBy: "property" });
    expect(r.groups.map((g) => [g.label, g.count])).toEqual([
      ["Birch Towers", 1],
      ["Cedar Lofts", 1],
      ["Maple Court", 2],
      ["No property", 1],
    ]);
    expect(r.groups[2]!.sublabel).toBe("12 Maple St · Manager: Jordan Patel");
    expect(r.groups[1]!.sublabel).toBe("Manager: Jordan Patel");
    expect(ids(r.rows)).toEqual(["r3", "r4", "r2", "r1", "r5"]);
  });

  it("by property, sorted within each building by the chosen sort", () => {
    const r = applyDirectoryQuery(people, { kind: "customer", groupBy: "property", sort: "unit" });
    expect(ids(r.rows)).toEqual(["r3", "r4", "r2", "r1", "r5"]);
    const byName = applyDirectoryQuery(people, { kind: "customer", groupBy: "property", sort: "name", dir: "desc" });
    expect(ids(byName.rows)).toEqual(["r3", "r4", "r1", "r2", "r5"]);
  });

  it("by manager: each manager's residents together, with how many properties they have", () => {
    const r = applyDirectoryQuery(people, { kind: "customer", groupBy: "manager" });
    expect(r.groups.map((g) => [g.label, g.count, g.sublabel])).toEqual([
      ["Jordan Patel", 3, "2 properties"],
      ["Sam Ortiz", 1, "1 property"],
      ["No manager", 1, ""],
    ]);
  });

  it("groups run across pages: page 2 picks up where page 1 stopped", () => {
    const p1 = applyDirectoryQuery(people, { kind: "customer", groupBy: "property", pageSize: 3, page: 1 });
    const p2 = applyDirectoryQuery(people, { kind: "customer", groupBy: "property", pageSize: 3, page: 2 });
    expect([...ids(p1.rows), ...ids(p2.rows)]).toEqual(["r3", "r4", "r2", "r1", "r5"]);
    expect(p2.groups).toEqual(p1.groups);
  });
});

describe("filters", () => {
  it("one property, or the people with none", () => {
    expect(ids(applyDirectoryQuery(people, { propertyId: "p-maple" }).rows)).toEqual(["r2", "r1"]);
    expect(ids(applyDirectoryQuery(people, { propertyId: "none" }).rows)).toEqual(["r5"]);
  });

  it("one manager: the residents of every property they manage, not the manager themselves", () => {
    expect(ids(applyDirectoryQuery(people, { managerId: "s-jordan" }).rows)).toEqual(["r2", "r4", "r1"]);
    expect(ids(applyDirectoryQuery(people, { managerId: "none" }).rows)).toEqual(["r5"]);
  });

  it("the property and manager pickers list what's in the tab, with counts, no-property last", () => {
    const r = applyDirectoryQuery(people, { kind: "customer" });
    expect(r.facets.properties).toEqual([
      { id: "p-birch", name: "Birch Towers", count: 1 },
      { id: "p-cedar", name: "Cedar Lofts", count: 1 },
      { id: "p-maple", name: "Maple Court", count: 2 },
      { id: "none", name: "No property", count: 1 },
    ]);
    expect(r.facets.managers.map((m) => [m.id, m.count])).toEqual([
      ["s-jordan", 3],
      ["s-sam", 1],
      ["none", 1],
    ]);
  });

  it("the pickers don't shrink when you pick one (you can switch building)", () => {
    expect(applyDirectoryQuery(people, { kind: "customer", propertyId: "p-maple" }).facets.properties).toHaveLength(4);
  });

  it("an id list (what the AI search will resolve a question to)", () => {
    expect(ids(applyDirectoryQuery(people, { ids: ["r3", "r1", "nobody"] }).rows)).toEqual(["r3", "r1"]);
  });
});

describe("search", () => {
  it("every word has to match: name, property, unit, manager, email", () => {
    expect(ids(applyDirectoryQuery(people, { q: "maple" }).rows)).toEqual(["r2", "r1"]);
    expect(ids(applyDirectoryQuery(people, { q: "maple zoe" }).rows)).toEqual(["r1"]);
    expect(ids(applyDirectoryQuery(people, { q: "jordan", kind: "customer" }).rows)).toEqual(["r2", "r4", "r1"]);
    expect(ids(applyDirectoryQuery(people, { q: "4b" }).rows)).toEqual(["r3"]);
    expect(ids(applyDirectoryQuery(people, { q: "BIRCH ave" }).rows)).toEqual(["r3"]);
  });

  it("a phone number however it's typed", () => {
    expect(matchesSearch(people[0]!, "555-0101")).toBe(true);
    expect(matchesSearch(people[0]!, "2045550101")).toBe(true);
    expect(matchesSearch(people[0]!, "0101")).toBe(true);
    // Two digits are too few to mean a phone number.
    expect(matchesSearch(people[1]!, "01")).toBe(false);
  });

  it("counts on the tabs are within the search", () => {
    expect(applyDirectoryQuery(people, { q: "jordan" }).facets.kinds).toEqual({ all: 4, customer: 3, field: 1, office: 0 });
  });
});

describe("pages", () => {
  const many = Array.from({ length: 2500 }, (_, i) =>
    row({ id: `m${i}`, name: `Resident ${String(i).padStart(4, "0")}`, ...(i % 2 ? maple : birch), unit: String(i) }),
  );

  it("2,500 residents come back 25 at a time", () => {
    const r = applyDirectoryQuery(many, { kind: "customer" });
    expect(r.rows).toHaveLength(25);
    expect(r.total).toBe(2500);
    expect(r.totalPages).toBe(100);
  });

  it("a page past the end shows the last page; page size is kept between 1 and 500", () => {
    expect(applyDirectoryQuery(many, { page: 999 }).page).toBe(100);
    expect(applyDirectoryQuery(many, { pageSize: 10_000 }).pageSize).toBe(500);
    expect(applyDirectoryQuery(many, { pageSize: 0 }).pageSize).toBe(1);
    expect(applyDirectoryQuery(many, { pageSize: Number.NaN }).pageSize).toBe(25);
  });

  it("select-all returns every matching id in order, only when asked", () => {
    expect(applyDirectoryQuery(many, { propertyId: "p-maple" }).ids).toBeUndefined();
    const r = applyDirectoryQuery(many, { propertyId: "p-maple", withIds: true, sort: "unit" });
    expect(r.ids).toHaveLength(1250);
    expect(r.ids!.slice(0, 2)).toEqual(["m1", "m3"]);
    expect(MAX_IDS).toBeGreaterThanOrEqual(2500);
  });

  it("is quick at that size", () => {
    const t = performance.now();
    applyDirectoryQuery(many, { kind: "customer", groupBy: "property", sort: "unit", q: "resident" });
    expect(performance.now() - t).toBeLessThan(250);
  });
});
