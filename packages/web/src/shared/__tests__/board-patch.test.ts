import { describe, it, expect } from "bun:test";
import { applyJobPatch, applyLocations } from "../board-patch";
import type { Board, BoardJob, BoardTech } from "../../services/dispatch-board";

const tech = (id: string, extra: Partial<BoardTech> = {}): BoardTech => ({
  id, userId: `u-${id}`, name: id, phone: "", photoUrl: "", color: "#0ea5e9", vehicle: "", status: "available",
  skills: [], skillClass: "", lat: 49.9, lng: -97.1, locationAt: "2026-10-17T19:00:00.000Z", stale: false,
  openJobs: 0, freeAt: null, currentJobId: null, nextJobIds: [], ...extra,
});
const job = (id: string, extra: Partial<BoardJob> = {}): BoardJob => ({
  id, title: id, service: "", category: "", durationMins: 60, status: "pending", assignStatus: "none", priority: "normal",
  lat: 49.9, lng: -97.1, address: "", scheduledAt: "2026-10-17T20:00:00.000Z", riderId: null, customerName: "",
  requiredSkillClass: "", requiredSkills: [], etaMins: null, late: false, isSample: false, ...extra,
});
const board = (techs: BoardTech[], jobs: BoardJob[]): Board => ({
  day: "2026-10-17", tz: "America/Winnipeg", workerNoun: "Technician", jobNoun: "Job", office: null, mapV2Default: false,
  truncated: false, generatedAt: "2026-10-17T19:00:00.000Z", techs, jobs,
});

describe("applyLocations", () => {
  const T0 = Date.parse("2026-10-17T19:00:00.000Z");
  const NOW = T0 + 10_000;
  it("moves the pin, clears stale, and stamps the time", () => {
    const b = board([tech("a", { stale: true }), tech("b")], []);
    const n = applyLocations(b, [{ techId: "a", lat: 50, lng: -98, at: T0 + 5_000 }], NOW);
    expect(n.techs[0]).toMatchObject({ lat: 50, lng: -98, stale: false, locationAt: new Date(T0 + 5_000).toISOString() });
    expect(n.techs[1]).toBe(b.techs[1]!);
  });

  it("keeps the newest frame per technician and ignores a frame older than what it has", () => {
    const b = board([tech("a")], []);
    const n = applyLocations(b, [
      { techId: "a", lat: 50, lng: -98, at: T0 + 9_000 },
      { techId: "a", lat: 51, lng: -99, at: T0 + 3_000 },
    ], NOW);
    expect(n.techs[0]).toMatchObject({ lat: 50, lng: -98 });
    expect(applyLocations(n, [{ techId: "a", lat: 1, lng: 1, at: T0 }], NOW)).toBe(n);
  });

  it("returns the same board when nothing changes or the frame is junk", () => {
    const b = board([tech("a")], []);
    expect(applyLocations(b, [], NOW)).toBe(b);
    expect(applyLocations(b, [{ techId: "zzz", lat: 50, lng: -98, at: T0 + 1 }], NOW)).toBe(b);
    expect(applyLocations(b, [{ techId: "a", lat: Number.NaN, lng: -98, at: T0 + 1 }], NOW)).toBe(b);
    expect(applyLocations(b, [{ techId: "a", lat: 95, lng: -98, at: T0 + 1 }], NOW)).toBe(b);
    expect(applyLocations(b, [{ techId: "a", lat: 49.9, lng: -97.1, at: T0 + 1 }], NOW)).toBe(b);
  });

  it("an old fix arriving now moves the pin but stays grey", () => {
    const b = board([tech("a", { locationAt: new Date(T0 - 30 * 60_000).toISOString() })], []);
    const n = applyLocations(b, [{ techId: "a", lat: 50, lng: -98, at: T0 - 15 * 60_000 }], NOW);
    expect(n.techs[0]).toMatchObject({ lat: 50, lng: -98, stale: true });
  });

  it("a fresh fix at the same spot clears grey", () => {
    const b = board([tech("a", { stale: true, locationAt: new Date(T0 - 30 * 60_000).toISOString() })], []);
    const n = applyLocations(b, [{ techId: "a", lat: 49.9, lng: -97.1, at: T0 }], NOW);
    expect(n.techs[0]).toMatchObject({ stale: false, locationAt: new Date(T0).toISOString() });
  });

  it("places a technician who had no location", () => {
    const b = board([tech("n", { lat: null, lng: null, locationAt: null })], []);
    const n = applyLocations(b, [{ techId: "n", lat: 50, lng: -98, at: T0 }], NOW);
    expect(n.techs[0]).toMatchObject({ lat: 50, lng: -98 });
  });
});

describe("applyJobPatch", () => {
  it("assigns: the job takes the rider and that technician has one more job", () => {
    const b = board([tech("a", { openJobs: 1 }), tech("b")], [job("j1")]);
    const n = applyJobPatch(b, { id: "j1", status: "assigned", assignStatus: "offered", riderId: "a" });
    expect(n.jobs[0]).toMatchObject({ riderId: "a", status: "assigned", assignStatus: "offered" });
    expect(n.techs.map((t) => t.openJobs)).toEqual([2, 0]);
    expect(b.jobs[0]!.riderId).toBeNull();
  });

  it("undo puts it back and takes the count back", () => {
    const b = board([tech("a", { openJobs: 2 })], [job("j1", { riderId: "a", status: "assigned", assignStatus: "offered" })]);
    const n = applyJobPatch(b, { id: "j1", status: "confirmed", assignStatus: "released", riderId: null });
    expect(n.jobs[0]).toMatchObject({ riderId: null, status: "confirmed", assignStatus: "released" });
    expect(n.techs[0]!.openJobs).toBe(1);
  });

  it("moving a job between technicians shifts the count and never goes below zero", () => {
    const b = board([tech("a", { openJobs: 0 }), tech("b", { openJobs: 1 })], [job("j1", { riderId: "b", status: "assigned" })]);
    const n = applyJobPatch(b, { id: "j1", status: "assigned", assignStatus: "offered", riderId: "a" });
    expect(n.techs.map((t) => t.openJobs)).toEqual([1, 0]);
    const z = board([tech("a", { openJobs: 0 })], [job("j1", { riderId: "a", status: "assigned" })]);
    expect(applyJobPatch(z, { id: "j1", status: "pending", assignStatus: "none", riderId: null }).techs[0]!.openJobs).toBe(0);
  });

  it("does not count a finished job against a technician", () => {
    const b = board([tech("a", { openJobs: 1 })], [job("j1", { riderId: "a", status: "completed" })]);
    expect(applyJobPatch(b, { id: "j1", status: "completed", assignStatus: "accepted", riderId: "a" }).techs[0]!.openJobs).toBe(1);
    const c = applyJobPatch(b, { id: "j1", status: "assigned", assignStatus: "offered", riderId: "a" });
    expect(c.techs[0]!.openJobs).toBe(2);
  });

  it("is a no-op for an unknown job or an identical state", () => {
    const b = board([tech("a")], [job("j1")]);
    expect(applyJobPatch(b, { id: "nope", status: "assigned", assignStatus: "offered", riderId: "a" })).toBe(b);
    expect(applyJobPatch(b, { id: "j1", status: "pending", assignStatus: "none", riderId: null })).toBe(b);
  });
});
