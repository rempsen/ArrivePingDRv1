import { describe, it, expect } from "bun:test";
import { groupTechJobs } from "../tech-job-groups";

const now = new Date(2026, 9, 17, 12, 0); // Sat Oct 17, noon local
const at = (d: number, h: number) => new Date(2026, 9, 17 + d, h, 0).toISOString();
const J = (id: string, status: string, scheduledAt: string | null) => ({ id, status, scheduledAt, title: id });

describe("groupTechJobs", () => {
  it("puts active work first, then overdue, today, tomorrow, later days, unscheduled", () => {
    const g = groupTechJobs(
      [J("later", "assigned", at(3, 9)), J("none", "assigned", null), J("tmr", "assigned", at(1, 8)), J("today2", "assigned", at(0, 16)), J("today1", "assigned", at(0, 13)), J("late", "assigned", at(-1, 9)), J("go", "enroute", at(0, 11))],
      now,
    );
    expect(g.map((x) => x.label)).toEqual(["Now", "Overdue", "Today", "Tomorrow", new Date(2026, 9, 20).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }), "Not scheduled"]);
    expect(g[2]!.jobs.map((j) => j.id)).toEqual(["today1", "today2"]);
  });

  it("treats on-site, in-progress and paused jobs as happening now", () => {
    const g = groupTechJobs([J("a", "arrived", at(0, 9)), J("b", "in_progress", at(0, 10)), J("c", "paused", null)], now);
    expect(g).toHaveLength(1);
    expect(g[0]!.label).toBe("Now");
  });
});
