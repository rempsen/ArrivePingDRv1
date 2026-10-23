import { describe, expect, test } from "bun:test";
import { addDays, ageLabel, bucketOf, dayKey, jobsForTech, needsAttention, nextUp, tallies } from "../board";

const job = (p: Partial<{ id: string; late: boolean; riderId: string | null; status: string; scheduledAt: string }>) => ({
  id: "j",
  late: false,
  riderId: null as string | null,
  status: "confirmed",
  scheduledAt: "2026-10-21T15:00:00.000Z",
  ...p,
});

describe("tallies", () => {
  test("counts each status; break is busy; unknown is offline", () => {
    const t = tallies([
      { status: "enroute" },
      { status: "enroute" },
      { status: "onsite" },
      { status: "available" },
      { status: "busy" },
      { status: "break" },
      { status: "offline" },
      { status: "weird" },
    ]);
    expect(t).toEqual({ enroute: 2, onsite: 1, available: 1, busy: 2, offline: 2 });
  });
});

describe("needsAttention", () => {
  test("late first, then unassigned, each once, soonest first", () => {
    const a = job({ id: "a", late: true, riderId: "r1", scheduledAt: "2026-10-21T16:00:00.000Z" });
    const b = job({ id: "b", late: true, riderId: null, scheduledAt: "2026-10-21T14:00:00.000Z" });
    const c = job({ id: "c", riderId: null, scheduledAt: "2026-10-21T18:00:00.000Z" });
    const d = job({ id: "d", riderId: null, scheduledAt: "2026-10-21T17:00:00.000Z" });
    const done = job({ id: "e", riderId: null, status: "cancelled" });
    const fine = job({ id: "f", riderId: "r2" });
    expect(needsAttention([a, b, c, d, done, fine]).map((j) => j.id)).toEqual(["b", "a", "d", "c"]);
  });
});

describe("nextUp", () => {
  test("skips finished and in-field jobs, orders by time, caps the list", () => {
    const now = new Date("2026-10-21T15:30:00.000Z");
    const jobs = [
      job({ id: "past", scheduledAt: "2026-10-21T15:00:00.000Z" }),
      job({ id: "field", status: "enroute", scheduledAt: "2026-10-21T16:00:00.000Z" }),
      job({ id: "c", scheduledAt: "2026-10-21T18:00:00.000Z" }),
      job({ id: "b", scheduledAt: "2026-10-21T17:00:00.000Z" }),
      job({ id: "done", status: "completed", scheduledAt: "2026-10-21T19:00:00.000Z" }),
    ];
    expect(nextUp(jobs, now, 1).map((j) => j.id)).toEqual(["b"]);
    expect(nextUp(jobs, now).map((j) => j.id)).toEqual(["b", "c"]);
  });
});

describe("bucketOf", () => {
  test("maps status and assignment to the Jobs segments", () => {
    expect(bucketOf({ riderId: null, status: "pending" })).toBe("unassigned");
    expect(bucketOf({ riderId: "r", status: "assigned" })).toBe("scheduled");
    expect(bucketOf({ riderId: "r", status: "onsite" })).toBe("in_progress");
    expect(bucketOf({ riderId: "r", status: "completed" })).toBe("done");
    expect(bucketOf({ riderId: null, status: "cancelled" })).toBe("done");
  });
});

describe("dates", () => {
  test("dayKey follows the company clock", () => {
    // 03:30Z is still the previous evening in Winnipeg.
    expect(dayKey(new Date("2026-10-22T03:30:00.000Z"), "America/Winnipeg")).toBe("2026-10-21");
    expect(dayKey(new Date("2026-10-22T03:30:00.000Z"), "UTC")).toBe("2026-10-22");
  });
  test("addDays crosses month ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
  });
  test("ageLabel", () => {
    const now = new Date("2026-10-21T15:00:00.000Z");
    expect(ageLabel(null, now)).toBe("no location");
    expect(ageLabel("2026-10-21T14:59:40.000Z", now)).toBe("just now");
    expect(ageLabel("2026-10-21T14:48:00.000Z", now)).toBe("12 min ago");
    expect(ageLabel("2026-10-21T12:00:00.000Z", now)).toBe("3 h ago");
    expect(ageLabel("2026-10-20T10:00:00.000Z", now)).toBe("yesterday");
  });
});

describe("jobsForTech", () => {
  const jobs = [
    { id: "late", riderId: "t1", status: "confirmed", scheduledAt: "2026-10-23T20:00:00.000Z" },
    { id: "early", riderId: "t1", status: "completed", scheduledAt: "2026-10-23T14:00:00.000Z" },
    { id: "gone", riderId: "t1", status: "cancelled", scheduledAt: "2026-10-23T16:00:00.000Z" },
    { id: "other", riderId: "t2", status: "confirmed", scheduledAt: "2026-10-23T15:00:00.000Z" },
    { id: "open", riderId: null, status: "pending", scheduledAt: "2026-10-23T15:30:00.000Z" },
  ];
  test("only that technician's jobs, soonest first, cancelled left out", () => {
    expect(jobsForTech(jobs, "t1").map((j) => j.id)).toEqual(["early", "late"]);
  });
  test("a technician with nothing gets an empty list", () => {
    expect(jobsForTech(jobs, "t9")).toEqual([]);
  });
});
