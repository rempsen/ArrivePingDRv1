import { describe, it, expect } from "bun:test";
import { jobKind, queueOrder, techRoute } from "../job-kind";

const NOW = Date.parse("2026-10-17T19:00:00Z");
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString();

describe("jobKind", () => {
  it("classifies by who holds the job and where it is", () => {
    expect(jobKind({ status: "pending", riderId: null, scheduledAt: at(60) }, NOW)).toBe("wait");
    expect(jobKind({ status: "confirmed", riderId: null, scheduledAt: at(-5) }, NOW)).toBe("late");
    expect(jobKind({ status: "assigned", riderId: "t1", scheduledAt: at(-30) }, NOW)).toBe("assigned");
    for (const s of ["enroute", "arrived", "onsite", "in_progress", "paused"])
      expect(jobKind({ status: s, riderId: "t1", scheduledAt: at(-30) }, NOW)).toBe("live");
    expect(jobKind({ status: "completed", riderId: "t1", scheduledAt: at(-30) }, NOW)).toBe("done");
    expect(jobKind({ status: "cancelled", riderId: null, scheduledAt: at(-30) }, NOW)).toBe("done");
  });
});

describe("queueOrder", () => {
  const j = (id: string, priority: string, mins: number) => ({ id, priority, scheduledAt: at(mins) });
  it("puts urgent first, then the soonest, overdue before upcoming", () => {
    const list = [j("c", "normal", 30), j("b", "normal", -45), j("a", "urgent", 300), j("d", "low", -200), j("e", "high", 10)];
    expect(list.sort(queueOrder).map((x) => x.id)).toEqual(["a", "e", "b", "c", "d"]);
  });
  it("is stable for the same time", () => {
    const list = [j("z", "normal", 5), j("m", "normal", 5), j("a", "normal", 5)];
    expect(list.sort(queueOrder).map((x) => x.id)).toEqual(["a", "m", "z"]);
  });
  it("treats an unknown priority as normal", () => {
    expect([j("x", "weird", 5), j("y", "normal", 1)].sort(queueOrder).map((v) => v.id)).toEqual(["y", "x"]);
  });
});

describe("techRoute", () => {
  const job = (id: string, riderId: string | null, status: string, mins: number) => ({ id, riderId, status, scheduledAt: at(mins) });
  it("lists what they're on, then the rest by time, with overdue first, and leaves out finished and others' work", () => {
    const jobs = [
      job("later", "t1", "assigned", 240),
      job("now", "t1", "in_progress", -20),
      job("overdue", "t1", "assigned", -90),
      job("done", "t1", "completed", -300),
      job("theirs", "t2", "assigned", 10),
      job("soon", "t1", "assigned", 30),
    ];
    expect(techRoute(jobs, "t1", NOW).map((j) => j.id)).toEqual(["now", "overdue", "soon", "later"]);
    expect(techRoute(jobs, "nobody", NOW)).toEqual([]);
  });
  it("does not change the jobs it is given", () => {
    const jobs = [job("b", "t1", "assigned", 30), job("a", "t1", "assigned", 10)];
    techRoute(jobs, "t1", NOW);
    expect(jobs.map((j) => j.id)).toEqual(["b", "a"]);
  });
});
