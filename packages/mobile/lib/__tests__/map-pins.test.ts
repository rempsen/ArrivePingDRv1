import { describe, expect, test } from "bun:test";
import { CONTINENT, fitRegion, pinKind, visibleJobs, visibleTechs } from "../map-pins";

describe("pinKind", () => {
  test("by who has it and where it is", () => {
    expect(pinKind({ riderId: null, assignStatus: "none", status: "pending" })).toBe("unassigned");
    expect(pinKind({ riderId: "t", assignStatus: "offered", status: "confirmed" })).toBe("offered");
    expect(pinKind({ riderId: "t", assignStatus: "accepted", status: "confirmed" })).toBe("scheduled");
    expect(pinKind({ riderId: "t", assignStatus: "accepted", status: "enroute" })).toBe("active");
  });
  test("finished jobs have no pin", () => {
    expect(pinKind({ riderId: "t", assignStatus: "accepted", status: "completed" })).toBeNull();
    expect(pinKind({ riderId: null, assignStatus: "none", status: "cancelled" })).toBeNull();
  });
});

describe("visibility", () => {
  const techs = [
    { id: "a", status: "available", lat: 49.9, lng: -97.1 },
    { id: "b", status: "offline", lat: 49.8, lng: -97.2 },
    { id: "c", status: "enroute", lat: null, lng: null },
  ];
  test("technicians need a position; offline ones only on request", () => {
    expect(visibleTechs(techs, false).map((t) => t.id)).toEqual(["a"]);
    expect(visibleTechs(techs, true).map((t) => t.id)).toEqual(["a", "b"]);
  });
  test("jobs need a position and must still be open", () => {
    const jobs = [
      { id: "1", riderId: null, assignStatus: "none", status: "pending", lat: 49.9, lng: -97.1 },
      { id: "2", riderId: null, assignStatus: "none", status: "pending", lat: null, lng: null },
      { id: "3", riderId: "t", assignStatus: "accepted", status: "completed", lat: 49.9, lng: -97.1 },
    ];
    expect(visibleJobs(jobs).map((j) => [j.id, j.kind])).toEqual([["1", "unassigned"]]);
  });
});

describe("fitRegion", () => {
  test("nothing to show → the office, else the continent", () => {
    expect(fitRegion([])).toEqual(CONTINENT);
    expect(fitRegion([], { lat: 49.9, lng: -97.1 })).toMatchObject({ latitude: 49.9, longitude: -97.1, latitudeDelta: 0.08 });
  });
  test("one point gets the minimum span", () => {
    expect(fitRegion([{ lat: 49.9, lng: -97.1 }])).toEqual({ latitude: 49.9, longitude: -97.1, latitudeDelta: 0.02, longitudeDelta: 0.02 });
  });
  test("many points are centred with padding", () => {
    const r = fitRegion([
      { lat: 49.8, lng: -97.3 },
      { lat: 50.0, lng: -97.1 },
      { lat: null, lng: null },
    ]);
    expect(r.latitude).toBeCloseTo(49.9);
    expect(r.longitude).toBeCloseTo(-97.2);
    expect(r.latitudeDelta).toBeCloseTo(0.28);
    expect(r.longitudeDelta).toBeCloseTo(0.28);
  });
});
