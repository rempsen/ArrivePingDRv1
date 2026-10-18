/**
 * JSON exports (Reports → Export → JSON, and the raw data exports): rows keep
 * only the requested columns, in that order, with dates as ISO strings and
 * missing values as null — the same shape as the Jobs list's JSON export.
 */
import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { toJson, tidyNumbers } = await import("../export");

describe("toJson", () => {
  test("keeps the chosen columns in order and nulls what's missing", () => {
    const rows = [
      { service: "Furnace Repair", jobs: 11, revenue: 12190, internal: "x" },
      { service: "AC Repair", jobs: 4 },
    ];
    const out = JSON.parse(toJson(rows, ["service", "revenue", "jobs"]));
    expect(out).toEqual([
      { service: "Furnace Repair", revenue: 12190, jobs: 11 },
      { service: "AC Repair", revenue: null, jobs: 4 },
    ]);
    expect(Object.keys(out[0])).toEqual(["service", "revenue", "jobs"]);
  });

  test("dates become ISO strings, and it is readable (pretty-printed)", () => {
    const text = toJson([{ issued: new Date("2026-10-17T15:00:00Z") }], ["issued"]);
    expect(JSON.parse(text)).toEqual([{ issued: "2026-10-17T15:00:00.000Z" }]);
    expect(text).toContain("\n  ");
  });

  test("an empty report is an empty array", () => {
    expect(JSON.parse(toJson([], ["service"]))).toEqual([]);
  });
});

describe("tidyNumbers", () => {
  test("rounds money to cents and percentages to one decimal, leaving the rest alone", () => {
    const cols = [{ key: "service" }, { key: "revenue", kind: "money" }, { key: "share", kind: "pct" }, { key: "jobs", kind: "num" }];
    const out = tidyNumbers([{ service: "Furnace Repair", revenue: 50675.099999999984, share: 33.33333, jobs: 61 }], cols);
    expect(out).toEqual([{ service: "Furnace Repair", revenue: 50675.1, share: 33.3, jobs: 61 }]);
  });

  test("does not touch the caller's rows or non-numeric values", () => {
    const rows = [{ revenue: "n/a" }, { revenue: 1.005 }];
    const out = tidyNumbers(rows, [{ key: "revenue", kind: "money" }]);
    expect(out[0]).toEqual({ revenue: "n/a" });
    expect(rows[1]!.revenue).toBe(1.005);
  });
});
