/**
 * Control Hub → Features → "Switch for many": which companies a switch will
 * reach. A group (all customers / demos / tests / everyone, narrowed by
 * industry), or specific companies ticked by name from a searchable list.
 */
import { describe, expect, it } from "bun:test";
import { pickCompanies, searchCompanies } from "../lib/hub-bulk-pick";

const t = (id: string, name: string, kind = "customer", industry = "hvac", status = "active") => ({ id, name, kind, industry, status }) as any;
const all = [
  t("bmd", "BMD Materials", "customer", "flooring"),
  t("baker", "Baker Plumbing", "customer", "plumbing"),
  t("local", "Local Heating & Cooling"),
  t("prairie", "Prairie Comfort HVAC", "demo"),
  t("ap", "ArrivePing", "internal"),
  t("review", "ArrivePing Review Co", "test"),
  t("gone", "Closed Co", "customer", "hvac", "closed"),
];
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("pickCompanies", () => {
  it("picks a whole group, never closed or internal companies", () => {
    expect(ids(pickCompanies(all, { who: "customer", industry: "", ids: [] }))).toEqual(["bmd", "baker", "local"]);
    expect(ids(pickCompanies(all, { who: "all", industry: "", ids: [] }))).toEqual(["bmd", "baker", "local", "prairie", "review"]);
    expect(ids(pickCompanies(all, { who: "customer", industry: "flooring", ids: [] }))).toEqual(["bmd"]);
  });

  it("picks exactly the ticked companies — one is enough", () => {
    expect(ids(pickCompanies(all, { who: "pick", industry: "", ids: ["bmd"] }))).toEqual(["bmd"]);
    expect(ids(pickCompanies(all, { who: "pick", industry: "", ids: ["baker", "prairie", "bmd"] }))).toEqual(["bmd", "baker", "prairie"]);
  });

  it("ignores ticks that are stale, closed or internal, and an industry that does not match", () => {
    expect(ids(pickCompanies(all, { who: "pick", industry: "", ids: ["gone", "ap", "nope", "local"] }))).toEqual(["local"]);
    expect(ids(pickCompanies(all, { who: "pick", industry: "plumbing", ids: ["bmd", "baker"] }))).toEqual(["baker"]);
  });
});

describe("searchCompanies", () => {
  it("matches the first letter, then any part of the name, names starting with the text first", () => {
    expect(ids(searchCompanies(all, "b"))).toEqual(["baker", "bmd"]);
    expect(ids(searchCompanies(all, "BMD Materials"))).toEqual(["bmd"]);
    expect(ids(searchCompanies(all, "heat"))).toEqual(["local"]);
    expect(ids(searchCompanies(all, "co"))).toEqual(["review", "local", "prairie"]);
  });

  it("lists every pickable company, alphabetically, when nothing is typed", () => {
    expect(ids(searchCompanies(all, "  "))).toEqual(["review", "baker", "bmd", "local", "prairie"]);
  });
});
