import { describe, expect, it } from "bun:test";
import {
  addDays,
  bookedMinutes,
  clampStart,
  driveMinutes,
  durationOf,
  instantFor,
  jobMinutes,
  loadLevel,
  mondayOf,
  packLanes,
  pct,
  rankSlots,
  snapMinutes,
  timelineRange,
} from "../schedule-layout";

const TZ = "America/Winnipeg";
const span = (id: string, startMin: number, endMin: number) => ({ id, startMin, endMin });

describe("packLanes", () => {
  it("keeps back-to-back jobs on one lane with no conflict", () => {
    const r = packLanes([span("a", 540, 600), span("b", 600, 660)]);
    expect(r.every((x) => x.lane === 0 && x.lanes === 1 && !x.conflict)).toBe(true);
  });

  it("splits an overlap into two lanes and flags both", () => {
    const r = packLanes([span("a", 540, 630), span("b", 600, 660)]);
    expect(r).toEqual([
      { id: "a", lane: 0, lanes: 2, conflict: true },
      { id: "b", lane: 1, lanes: 2, conflict: true },
    ]);
  });

  it("never uses more than two lanes, and flags a third overlapping job", () => {
    const r = packLanes([span("a", 540, 700), span("b", 560, 700), span("c", 580, 700)]);
    expect(r.every((x) => x.lanes === 2 && x.conflict)).toBe(true);
    expect(r.find((x) => x.id === "c")!.lane).toBe(1);
  });

  it("only gives two lanes to the rows that overlap", () => {
    const r = packLanes([span("a", 540, 600), span("b", 700, 760), span("c", 720, 780)]);
    expect(r.find((x) => x.id === "a")).toEqual({ id: "a", lane: 0, lanes: 1, conflict: false });
  });
});

describe("timelineRange, clamping and snapping", () => {
  it("defaults to 7 AM to 7 PM", () => {
    expect(timelineRange([])).toEqual({ startMin: 420, endMin: 1140 });
  });
  it("widens to whole hours around early and late jobs", () => {
    expect(timelineRange([span("a", 375, 435), span("b", 1150, 1210)])).toEqual({ startMin: 360, endMin: 1260 });
  });
  it("clamps a drop so the job ends inside the window", () => {
    expect(clampStart(1130, 60, { startMin: 420, endMin: 1140 })).toBe(1080);
    expect(clampStart(300, 60, { startMin: 420, endMin: 1140 })).toBe(420);
  });
  it("snaps to 15 minutes", () => {
    expect(snapMinutes(547)).toBe(540);
    expect(snapMinutes(553)).toBe(555);
  });
  it("maps minutes to a percentage of the window", () => {
    expect(pct(780, { startMin: 420, endMin: 1140 })).toBe(50);
  });
});

describe("company-time conversions", () => {
  it("round-trips a time on the day daylight saving ends", () => {
    const at = instantFor("2026-11-01", 90, TZ);
    expect(jobMinutes(at, TZ)).toBe(90);
    expect(jobMinutes(instantFor("2026-11-01", 14 * 60, TZ), TZ)).toBe(14 * 60);
  });
  it("reads ISO strings in company time, not UTC", () => {
    expect(jobMinutes("2026-10-20T15:00:00.000Z", TZ)).toBe(10 * 60);
  });
  it("does day arithmetic on keys", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(mondayOf("2026-10-18")).toBe("2026-10-12");
    expect(mondayOf("2026-10-20")).toBe("2026-10-19");
  });
});

describe("durations, drive and load", () => {
  it("treats a missing or zero duration as an hour", () => {
    expect(durationOf({})).toBe(60);
    expect(durationOf({ durationMins: 0 })).toBe(60);
    expect(durationOf({ durationMins: 45 })).toBe(45);
    expect(bookedMinutes([{ durationMins: 90 }, {}])).toBe(150);
  });
  it("has no drive estimate without coordinates", () => {
    expect(driveMinutes({ lat: null, lng: null }, { lat: 49.9, lng: -97.1 })).toBeNull();
    expect(driveMinutes(null, { lat: 49.9, lng: -97.1 })).toBeNull();
  });
  it("rounds drive estimates up to 5 minutes, never below 5", () => {
    expect(driveMinutes({ lat: 49.9, lng: -97.1 }, { lat: 49.9, lng: -97.1 })).toBe(5);
    const m = driveMinutes({ lat: 49.85, lng: -97.2 }, { lat: 49.95, lng: -97.05 })!;
    expect(m % 5).toBe(0);
    expect(m).toBeGreaterThan(15);
  });
  it("grades the day's load", () => {
    expect(loadLevel(240)).toBe("ok");
    expect(loadLevel(420)).toBe("high");
    expect(loadLevel(500)).toBe("over");
  });
});

describe("rankSlots", () => {
  const range = { startMin: 420, endMin: 1140 };
  const here = { lat: 49.88, lng: -97.15 };
  const far = { lat: 50.05, lng: -96.9 };

  it("skips unqualified and unavailable technicians", () => {
    const r = rankSlots({
      job: { durationMins: 60, ...here },
      techs: [
        { id: "x", qualified: false, available: true, dayJobs: [] },
        { id: "y", qualified: true, available: false, dayJobs: [] },
      ],
      earliestMin: 480,
      range,
    });
    expect(r).toEqual([]);
  });

  it("never offers a slot that overlaps an existing job, and leaves slack", () => {
    const r = rankSlots({
      job: { durationMins: 60, ...here },
      techs: [{ id: "a", qualified: true, available: true, dayJobs: [{ startMin: 480, endMin: 600, ...here }, { startMin: 660, endMin: 720, ...here }] }],
      earliestMin: 480,
      range,
    });
    expect(r).toHaveLength(1);
    const s = r[0]!;
    expect(s.startMin >= 720 || s.startMin + 60 + 10 <= 660).toBe(true);
    expect(s.startMin).toBeGreaterThanOrEqual(600);
  });

  it("doesn't treat the end of a job inside a longer one as free time", () => {
    const r = rankSlots({
      job: { durationMins: 60, ...here },
      techs: [{ id: "a", qualified: true, available: true, dayJobs: [{ startMin: 480, endMin: 720, ...here }, { startMin: 540, endMin: 600, ...here }] }],
      earliestMin: 480,
      range,
    });
    expect(r[0]!.startMin).toBeGreaterThanOrEqual(720);
  });

  it("waits for a technician still on a job that is running long", () => {
    const r = rankSlots({
      job: { durationMins: 60, ...here },
      techs: [{ id: "a", qualified: true, available: true, earliestMin: 800, dayJobs: [{ startMin: 600, endMin: 660, ...here }] }],
      earliestMin: 690,
      range,
    });
    expect(r[0]!.startMin).toBeGreaterThanOrEqual(800);
  });

  it("counts the drive to the first job from where they start", () => {
    const r = rankSlots({
      job: { durationMins: 60, ...here },
      techs: [
        { id: "far", qualified: true, available: true, origin: { ...far, atMin: 600 }, dayJobs: [] },
        { id: "near", qualified: true, available: true, origin: { ...here, atMin: 600 }, dayJobs: [] },
      ],
      earliestMin: 630,
      range,
    });
    expect(r.map((s) => s.techId)).toEqual(["near", "far"]);
    const f = r.find((s) => s.techId === "far")!;
    expect(f.driveMins).toBeGreaterThanOrEqual(40);
    expect(f.startMin).toBeGreaterThanOrEqual(600 + f.driveMins!);
  });

  it("leaves time to drive on to the next job", () => {
    // 555–615 here would leave 25 minutes to reach a job ~25 km away at 640.
    const r = rankSlots({
      job: { durationMins: 60, ...here },
      techs: [{ id: "a", qualified: true, available: true, dayJobs: [{ startMin: 480, endMin: 540, ...here }, { startMin: 640, endMin: 700, ...far }] }],
      earliestMin: 480,
      range,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.startMin).toBeGreaterThanOrEqual(700);
  });

  it("puts the closer, emptier technician first", () => {
    const r = rankSlots({
      job: { durationMins: 60, ...here },
      techs: [
        { id: "busyfar", qualified: true, available: true, dayJobs: [{ startMin: 420, endMin: 600, ...far }] },
        { id: "near", qualified: true, available: true, dayJobs: [{ startMin: 420, endMin: 480, ...here }] },
      ],
      earliestMin: 480,
      range,
    });
    expect(r[0]!.techId).toBe("near");
    expect(r[0]!.bookedAfter).toBe(120);
  });

  it("returns nothing when nobody has a gap before the day ends", () => {
    const r = rankSlots({
      job: { durationMins: 120, ...here },
      techs: [{ id: "a", qualified: true, available: true, dayJobs: [{ startMin: 420, endMin: 1100, ...here }] }],
      earliestMin: 480,
      range,
    });
    expect(r).toEqual([]);
  });
});
