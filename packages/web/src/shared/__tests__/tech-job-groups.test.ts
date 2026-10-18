import { describe, it, expect } from "bun:test";
import { groupTechJobs, jobClock } from "../tech-job-groups";

const TZ = "America/Winnipeg"; // UTC-5 in October
const now = new Date("2026-10-17T17:00:00Z"); // Sat Oct 17, noon in Winnipeg
const J = (id: string, status: string, scheduledAt: string | null) => ({ id, status, scheduledAt, title: id });

describe("groupTechJobs", () => {
  it("puts active work first, then overdue, today, tomorrow, later days, unscheduled", () => {
    const g = groupTechJobs(
      [
        J("later", "assigned", "2026-10-20T14:00:00Z"),
        J("none", "assigned", null),
        J("tmr", "assigned", "2026-10-18T13:00:00Z"),
        J("today2", "assigned", "2026-10-17T21:00:00Z"),
        J("today1", "assigned", "2026-10-17T18:00:00Z"),
        J("late", "assigned", "2026-10-16T14:00:00Z"),
        J("go", "enroute", "2026-10-17T16:00:00Z"),
      ],
      TZ,
      now,
    );
    expect(g.map((x) => x.label)).toEqual(["Now", "Overdue", "Today", "Tomorrow", "Tue, Oct 20", "Not scheduled"]);
    expect(g[2]!.jobs.map((j) => j.id)).toEqual(["today1", "today2"]);
  });

  it("uses the company's day, not UTC's: 9:30 PM Winnipeg is still today", () => {
    // 02:30 UTC on the 18th = 9:30 PM on the 17th in Winnipeg
    const g = groupTechJobs([J("evening", "assigned", "2026-10-18T02:30:00Z")], TZ, now);
    expect(g[0]!.label).toBe("Today");
    expect(jobClock("2026-10-18T02:30:00Z", TZ)).toBe("9:30 PM");
  });

  it("treats on-site, in-progress and paused jobs as happening now", () => {
    const g = groupTechJobs([J("a", "arrived", null), J("b", "in_progress", null), J("c", "paused", null)], TZ, now);
    expect(g.map((x) => x.label)).toEqual(["Now"]);
  });

  it("shows a dash for an unscheduled time", () => {
    expect(jobClock(null, TZ)).toBe("—");
  });
});
