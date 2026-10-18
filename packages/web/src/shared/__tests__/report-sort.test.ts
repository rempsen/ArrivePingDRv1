import { describe, expect, it } from "bun:test";
import { firstSortDir, sortReportRows } from "../report-sort";

const rows = [
  { service: "Zone 10", revenue: 1200, last: "2026-09-01" },
  { service: "AC Repair", revenue: null, last: "2026-10-15" },
  { service: "zone 2", revenue: "349.5", last: "" },
  { service: "Furnace Repair", revenue: 12190, last: "2026-07-20" },
];

describe("sortReportRows", () => {
  it("sorts money numerically, biggest first, with empty values last", () => {
    const out = sortReportRows(rows, { key: "revenue", label: "Revenue", kind: "money" }, "desc");
    expect(out.map((r) => r.service)).toEqual(["Furnace Repair", "Zone 10", "zone 2", "AC Repair"]);
  });

  it("keeps empty values last when ascending too", () => {
    const out = sortReportRows(rows, { key: "revenue", label: "Revenue", kind: "money" }, "asc");
    expect(out.map((r) => r.service)).toEqual(["zone 2", "Zone 10", "Furnace Repair", "AC Repair"]);
  });

  it("sorts text naturally and case-insensitively", () => {
    const out = sortReportRows(rows, { key: "service", label: "Service" }, "asc");
    expect(out.map((r) => r.service)).toEqual(["AC Repair", "Furnace Repair", "zone 2", "Zone 10"]);
  });

  it("sorts dates by time", () => {
    const out = sortReportRows(rows, { key: "last", label: "Last job", kind: "date" }, "desc");
    expect(out.map((r) => r.service)).toEqual(["AC Repair", "Zone 10", "Furnace Repair", "zone 2"]);
  });

  it("does not change the input and keeps ties in their original order", () => {
    const tied = [{ k: "a", n: 1 }, { k: "b", n: 1 }, { k: "c", n: 2 }];
    const out = sortReportRows(tied, { key: "n", label: "N", kind: "num" }, "asc");
    expect(out.map((r) => r.k)).toEqual(["a", "b", "c"]);
    expect(tied.map((r) => r.k)).toEqual(["a", "b", "c"]);
  });
});

describe("firstSortDir", () => {
  it("starts numbers and dates biggest first, text A to Z", () => {
    expect(firstSortDir("money")).toBe("desc");
    expect(firstSortDir("date")).toBe("desc");
    expect(firstSortDir(undefined)).toBe("asc");
  });
});
