import { describe, expect, test } from "bun:test";
import { crewGroups, dayAhead, hourRange, needsYou, pulseBlocks, pulseOf, upNext } from "../today";
import type { OfficeTech } from "../board";

const TZ = "America/Winnipeg"; // UTC-5 in late October (CDT)
// 2026-10-26 on the company clock; 13:00Z = 8:00 AM local.
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 26, h + 5, m)).toISOString();

const job = (p: Partial<{ id: string; scheduledAt: string; durationMins: number; status: string; riderId: string | null; assignStatus: string; late: boolean }>) => ({
  id: "j",
  scheduledAt: at(9),
  durationMins: 60,
  status: "confirmed",
  riderId: "r1" as string | null,
  assignStatus: "accepted",
  late: false,
  ...p,
});

const tech = (p: Partial<OfficeTech>): OfficeTech => ({
  id: "t",
  userId: "u",
  name: "Tech",
  phone: "",
  photoUrl: "",
  color: "",
  vehicle: "",
  status: "available",
  lat: null,
  lng: null,
  locationAt: null,
  stale: false,
  openJobs: 0,
  freeAt: null,
  currentJobId: null,
  nextJobIds: [],
  ...p,
});

describe("pulseOf", () => {
  test("counts each job once by state; cancelled is counted apart", () => {
    const p = pulseOf(
      [
        job({ id: "a", status: "completed", scheduledAt: at(8) }),
        job({ id: "b", status: "in_progress", scheduledAt: at(9) }),
        job({ id: "c", late: true, scheduledAt: at(10) }),
        job({ id: "d", riderId: null, assignStatus: "none", scheduledAt: at(10, 30), durationMins: 90 }),
        job({ id: "e", assignStatus: "offered", status: "pending", scheduledAt: at(14) }),
        job({ id: "f", status: "cancelled", scheduledAt: at(15) }),
      ],
      TZ,
    );
    expect(p).toMatchObject({ total: 5, done: 1, inProgress: 1, remaining: 3, late: 1, unassigned: 1, offered: 1, unconfirmed: 1, cancelled: 1, wrapped: false });
    expect(p.firstStart).toBe(8 * 60);
    expect(p.lastEnd).toBe(15 * 60);
    expect(p.busiestHour).toBe(10 * 60); // c and d overlap 10–11
  });

  test("a day with nothing left, or no jobs at all, is wrapped", () => {
    expect(pulseOf([job({ status: "completed" }), job({ status: "cancelled" })], TZ).wrapped).toBe(true);
    expect(pulseOf([], TZ)).toMatchObject({ wrapped: true, total: 0, firstStart: null, busiestHour: null });
  });

  test("a late job still running keeps the day open", () => {
    expect(pulseOf([job({ status: "enroute", late: true })], TZ).wrapped).toBe(false);
  });
});

describe("pulseBlocks", () => {
  test("window is at least 7 AM – 6 PM and grows to fit; blocks are fractions of it", () => {
    const r = pulseBlocks([job({ id: "a", scheduledAt: at(7), durationMins: 60 }), job({ id: "x", status: "cancelled" })], TZ);
    expect(r.startMin).toBe(420);
    expect(r.endMin).toBe(1080);
    expect(r.blocks).toEqual([{ id: "a", from: 0, to: 60 / 660, kind: "scheduled" }]);
    const wide = pulseBlocks([job({ id: "b", scheduledAt: at(6, 30), durationMins: 30 }), job({ id: "c", scheduledAt: at(18), durationMins: 90 })], TZ);
    expect([wide.startMin, wide.endMin]).toEqual([360, 1200]);
  });

  test("kind: done beats late beats active beats unassigned", () => {
    const k = (p: Parameters<typeof job>[0]) => pulseBlocks([job(p)], TZ).blocks[0]!.kind;
    expect(k({ status: "completed", late: true })).toBe("done");
    expect(k({ status: "enroute", late: true })).toBe("late");
    expect(k({ status: "onsite" })).toBe("active");
    expect(k({ riderId: null })).toBe("unassigned");
  });
});

describe("crewGroups", () => {
  test("groups in a fixed order, break counts as busy, names sorted; soonest free time and ETA", () => {
    const g = crewGroups(
      [
        tech({ id: "1", name: "Zed", status: "available" }),
        tech({ id: "2", name: "Amy", status: "available" }),
        tech({ id: "3", name: "Bo", status: "onsite", freeAt: "2026-10-26T16:00:00Z" }),
        tech({ id: "4", name: "Cy", status: "onsite", freeAt: "2026-10-26T15:00:00Z" }),
        tech({ id: "5", name: "Di", status: "break" }),
        tech({ id: "6", name: "Ed", status: "enroute", nextJobIds: ["j9"] }),
        tech({ id: "7", name: "Fy", status: "weird" }),
      ],
      [{ id: "j9", etaMins: 12 }],
    );
    expect(g.map((x) => x.key)).toEqual(["available", "enroute", "onsite", "busy", "offline"]);
    expect(g[0]!.techs.map((t) => t.name)).toEqual(["Amy", "Zed"]);
    expect(g[1]!.etaMins).toBe(12);
    expect(g[2]!.freeAt).toBe("2026-10-26T15:00:00Z");
    expect(g[3]!.techs[0]!.name).toBe("Di");
  });
});

describe("needsYou", () => {
  test("each job once under its most urgent reason; stale on-shift techs too; severity then time", () => {
    const n = needsYou(
      [
        job({ id: "late-unassigned", late: true, riderId: null, scheduledAt: at(11) }),
        job({ id: "late", late: true, scheduledAt: at(9) }),
        job({ id: "open", riderId: null, scheduledAt: at(10) }),
        job({ id: "offer", assignStatus: "offered", status: "pending", scheduledAt: at(8) }),
        job({ id: "pending", status: "pending", scheduledAt: at(12) }),
        job({ id: "fine" }),
        job({ id: "gone", status: "completed", late: true }),
      ],
      [tech({ id: "s", stale: true, status: "available" }), tech({ id: "home", stale: true, status: "offline" })],
    );
    expect(n.map((x) => `${x.kind}:${x.jobId ?? x.techId}`)).toEqual([
      "late:late",
      "late:late-unassigned",
      "unassigned:open",
      "offered:offer",
      "stale:s",
      "unconfirmed:pending",
    ]);
  });
});

describe("upNext", () => {
  const now = new Date(at(9));
  test("assigned, not started, not already flagged, inside the horizon", () => {
    const jobs = [
      job({ id: "past", scheduledAt: at(8) }),
      job({ id: "grace", scheduledAt: at(8, 50) }),
      job({ id: "soon", scheduledAt: at(10) }),
      job({ id: "far", scheduledAt: at(15) }),
      job({ id: "open", riderId: null, scheduledAt: at(9, 30) }),
      job({ id: "flagged", scheduledAt: at(9, 30), late: true }),
      job({ id: "going", status: "enroute", scheduledAt: at(9, 30) }),
    ];
    const needs = needsYou(jobs, []);
    expect(upNext(jobs, now, needs).map((j) => j.id)).toEqual(["grace", "soon"]);
  });

  test("an empty horizon falls back to the next jobs at all", () => {
    expect(upNext([job({ id: "far", scheduledAt: at(15) })], now, []).map((j) => j.id)).toEqual(["far"]);
  });
});

describe("dayAhead", () => {
  test("tomorrow's numbers, who is off, and unassigned later in the range", () => {
    const tomorrow = "2026-10-27";
    const t = (h: number, d = 27) => new Date(Date.UTC(2026, 9, d, h + 5)).toISOString();
    const r = dayAhead(
      [
        job({ id: "a", scheduledAt: t(8) }),
        job({ id: "b", scheduledAt: t(7, 27), riderId: null }),
        job({ id: "c", scheduledAt: t(10), status: "pending" }),
        job({ id: "d", scheduledAt: t(9), status: "cancelled" }),
        job({ id: "e", scheduledAt: t(9, 28), riderId: null }),
        job({ id: "f", scheduledAt: t(9, 29), riderId: null }),
      ],
      [tech({ id: "1", name: "Amy" }), tech({ id: "2", name: "Bo" })],
      [{ techId: "2", day: tomorrow }, { techId: "1", day: "2026-10-28" }],
      tomorrow,
      TZ,
    );
    expect(r.tomorrow).toEqual({ day: tomorrow, total: 3, unassigned: 1, unconfirmed: 1, firstStart: 7 * 60, onRoster: 1, offNames: ["Bo"] });
    expect(r.laterUnassigned).toBe(2);
  });
});

test("hourRange", () => {
  expect(hourRange(10 * 60)).toBe("10–11 AM");
  expect(hourRange(11 * 60)).toBe("11 AM–12 PM");
  expect(hourRange(13 * 60)).toBe("1–2 PM");
});
