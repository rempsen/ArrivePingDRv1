import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RANGE,
  HOUR_W,
  bookedMinutes,
  clampStart,
  durationOf,
  hoursIn,
  instantFor,
  jobMinutes,
  loadLevel,
  minLabel,
  minuteAtX,
  packLanes,
  snapMinutes,
  spansFor,
  timelineRange,
  xOf,
} from "../timeline";

describe("timelineRange", () => {
  test("defaults to 7–19 and widens to whole hours around outliers", () => {
    expect(timelineRange([])).toEqual(DEFAULT_RANGE);
    expect(timelineRange([{ id: "a", startMin: 6 * 60 + 30, endMin: 7 * 60 }])).toEqual({ startMin: 6 * 60, endMin: 19 * 60 });
    expect(timelineRange([{ id: "b", startMin: 18 * 60, endMin: 20 * 60 + 10 }])).toEqual({ startMin: 7 * 60, endMin: 21 * 60 });
  });
  test("never leaves the day", () => {
    expect(timelineRange([{ id: "n", startMin: 0, endMin: 23 * 60 + 50 }])).toEqual({ startMin: 0, endMin: 24 * 60 });
  });
  test("hoursIn lists each hour column", () => {
    expect(hoursIn(DEFAULT_RANGE)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });
});

describe("packLanes", () => {
  test("non-overlapping jobs share lane 0 with no conflict", () => {
    const r = packLanes([
      { id: "a", startMin: 540, endMin: 600 },
      { id: "b", startMin: 600, endMin: 660 },
    ]);
    expect(r.map((x) => [x.id, x.lane, x.conflict])).toEqual([
      ["a", 0, false],
      ["b", 0, false],
    ]);
  });
  test("an overlap goes to lane 1 and both are flagged", () => {
    const r = packLanes([
      { id: "a", startMin: 540, endMin: 660 },
      { id: "b", startMin: 600, endMin: 660 },
    ]);
    expect(r.find((x) => x.id === "b")).toMatchObject({ lane: 1, lanes: 2, conflict: true });
    expect(r.find((x) => x.id === "a")).toMatchObject({ lane: 0, lanes: 2, conflict: true });
  });
});

describe("snapping and clamping", () => {
  test("snapMinutes rounds to the quarter hour", () => {
    expect(snapMinutes(37)).toBe(30);
    expect(snapMinutes(38)).toBe(45);
    expect(snapMinutes(600)).toBe(600);
  });
  test("clampStart keeps the job inside the window", () => {
    expect(clampStart(6 * 60, 60, DEFAULT_RANGE)).toBe(7 * 60);
    expect(clampStart(18 * 60 + 45, 60, DEFAULT_RANGE)).toBe(18 * 60);
    expect(clampStart(10 * 60, 60, DEFAULT_RANGE)).toBe(10 * 60);
  });
  test("xOf and minuteAtX invert each other", () => {
    expect(xOf(9 * 60, DEFAULT_RANGE)).toBe(2 * HOUR_W);
    expect(minuteAtX(2 * HOUR_W, DEFAULT_RANGE)).toBe(9 * 60);
    expect(minuteAtX(2 * HOUR_W + HOUR_W / 4, DEFAULT_RANGE)).toBe(9 * 60 + 15);
  });
});

describe("durations and load", () => {
  test("a job with no duration is an hour", () => {
    expect(durationOf({ durationMins: null })).toBe(60);
    expect(durationOf({ durationMins: 0 })).toBe(60);
    expect(durationOf({ durationMins: 90 })).toBe(90);
    expect(bookedMinutes([{ durationMins: 30 }, { durationMins: null }])).toBe(90);
  });
  test("loadLevel", () => {
    expect(loadLevel(200)).toBe("ok");
    expect(loadLevel(420)).toBe("high");
    expect(loadLevel(481)).toBe("over");
  });
});

describe("company-clock conversions", () => {
  const tz = "America/Winnipeg";
  test("jobMinutes reads the company's clock", () => {
    expect(jobMinutes("2026-10-23T14:30:00.000Z", tz)).toEqual({ day: "2026-10-23", min: 9 * 60 + 30 });
  });
  test("spansFor keeps only that day's jobs, with durations", () => {
    const jobs = [
      { id: "a", scheduledAt: "2026-10-23T14:30:00.000Z", durationMins: 45 },
      { id: "b", scheduledAt: "2026-10-24T14:30:00.000Z", durationMins: 45 },
      { id: "c", scheduledAt: "2026-10-23T03:00:00.000Z", durationMins: null }, // 10 PM the day before, company time
    ];
    expect(spansFor(jobs, "2026-10-23", tz).map((s) => [s.id, s.startMin, s.endMin])).toEqual([["a", 570, 615]]);
  });
  test("instantFor round-trips through jobMinutes", () => {
    const iso = instantFor("2026-10-23", 9 * 60 + 15, tz);
    expect(jobMinutes(iso, tz)).toEqual({ day: "2026-10-23", min: 9 * 60 + 15 });
  });
  test("minLabel", () => {
    expect(minLabel(0)).toBe("12:00 AM");
    expect(minLabel(9 * 60 + 15)).toBe("9:15 AM");
    expect(minLabel(12 * 60)).toBe("12:00 PM");
    expect(minLabel(18 * 60 + 30)).toBe("6:30 PM");
  });
});
