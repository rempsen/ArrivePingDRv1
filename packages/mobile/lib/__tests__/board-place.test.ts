import { describe, expect, test } from "bun:test";
import { IDLE, canArm, canPlace, placeReducer, placedStart, placementRequest, type PlaceState } from "../board-place";
import { DEFAULT_RANGE } from "../timeline";

describe("placeReducer", () => {
  test("arm, tap a cell, confirm state carries the target", () => {
    let s: PlaceState = placeReducer(IDLE, { type: "arm", jobId: "j1" });
    expect(s).toEqual({ kind: "armed", jobId: "j1" });
    s = placeReducer(s, { type: "tapCell", techId: "t1", startMin: 600 });
    expect(s).toEqual({ kind: "confirm", jobId: "j1", techId: "t1", startMin: 600 });
  });
  test("tapping the armed job again disarms; another job re-arms", () => {
    const armed = placeReducer(IDLE, { type: "arm", jobId: "j1" });
    expect(placeReducer(armed, { type: "arm", jobId: "j1" })).toEqual(IDLE);
    expect(placeReducer(armed, { type: "arm", jobId: "j2" })).toEqual({ kind: "armed", jobId: "j2" });
  });
  test("a cell tap while idle does nothing; while confirming it retargets", () => {
    expect(placeReducer(IDLE, { type: "tapCell", techId: "t1", startMin: 600 })).toEqual(IDLE);
    const c: PlaceState = { kind: "confirm", jobId: "j1", techId: "t1", startMin: 600 };
    expect(placeReducer(c, { type: "tapCell", techId: "t2", startMin: 660 })).toEqual({ kind: "confirm", jobId: "j1", techId: "t2", startMin: 660 });
  });
  test("cancel and done return to idle", () => {
    const c: PlaceState = { kind: "confirm", jobId: "j1", techId: "t1", startMin: 600 };
    expect(placeReducer(c, { type: "cancel" })).toEqual(IDLE);
    expect(placeReducer(c, { type: "done" })).toEqual(IDLE);
  });
});

describe("guards", () => {
  test("finished jobs can't be armed", () => {
    expect(canArm({ status: "completed" })).toBe(false);
    expect(canArm({ status: "cancelled" })).toBe(false);
    expect(canArm({ status: "confirmed" })).toBe(true);
    expect(canArm({ status: "enroute" })).toBe(true);
  });
  test("a day off takes nothing", () => {
    expect(canPlace(true)).toBe(false);
    expect(canPlace(false)).toBe(true);
  });
  test("placedStart snaps and stays inside the window", () => {
    expect(placedStart(9 * 60 + 7, { durationMins: 60 }, DEFAULT_RANGE)).toBe(9 * 60);
    expect(placedStart(18 * 60 + 50, { durationMins: 60 }, DEFAULT_RANGE)).toBe(18 * 60);
    expect(placedStart(6 * 60, { durationMins: 30 }, DEFAULT_RANGE)).toBe(7 * 60);
  });
});

describe("placementRequest", () => {
  const tz = "America/Winnipeg";
  test("same technician, new time → schedule", () => {
    const r = placementRequest({ riderId: "t1" }, "t1", 9 * 60, "2026-10-23", tz);
    expect(r).toEqual({ kind: "schedule", scheduledAt: "2026-10-23T14:00:00.000Z" });
  });
  test("another technician → assign with the time and the expected current tech", () => {
    const r = placementRequest({ riderId: "t1" }, "t2", 9 * 60, "2026-10-23", tz);
    expect(r).toEqual({ kind: "assign", riderId: "t2", scheduledAt: "2026-10-23T14:00:00.000Z", expectRiderId: "t1" });
  });
  test("an unassigned job → assign expecting nobody", () => {
    const r = placementRequest({ riderId: null }, "t2", 9 * 60, "2026-10-23", tz);
    expect(r).toMatchObject({ kind: "assign", riderId: "t2", expectRiderId: null });
  });
});
