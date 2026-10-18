import { describe, it, expect } from "bun:test";
import { classifyFit, listJoin, type FitInput } from "../dispatch-fit";

const TZ = "America/Winnipeg";
// 2026-10-17 19:00 UTC = 2:00 PM in Winnipeg (CDT, UTC-5)
const NOW = Date.UTC(2026, 9, 17, 19, 0);
const MIN = 60_000;

const base = (over: Partial<FitInput> = {}): FitInput => ({
  name: "Tom Rivera",
  status: "available",
  qualification: { qualified: true, missing: [], matched: ["HVAC"], basis: "required" },
  overlap: null,
  timeoff: null,
  inField: false,
  freeAt: null,
  jobStart: NOW + 60 * MIN,
  now: NOW,
  tz: TZ,
  ...over,
});

describe("listJoin", () => {
  it("reads naturally", () => {
    expect(listJoin([])).toBe("");
    expect(listJoin(["HVAC"])).toBe("HVAC");
    expect(listJoin(["HVAC", "Boiler"])).toBe("HVAC and Boiler");
    expect(listJoin(["HVAC", "Boiler", "Gas"])).toBe("HVAC, Boiler and Gas");
  });
});

describe("classifyFit", () => {
  it("is ready with nothing in the way", () => {
    expect(classifyFit(base())).toEqual({ fit: "ready", clash: null });
  });

  it("stops for an offline technician first", () => {
    const r = classifyFit(base({ status: "offline", qualification: { qualified: false, missing: ["HVAC"], matched: [], basis: "required" } }));
    expect(r).toEqual({ fit: "offline", clash: { kind: "offline", message: "Tom Rivera is offline right now." } });
  });

  it("names what's missing when not qualified", () => {
    const r = classifyFit(base({ qualification: { qualified: false, missing: ["HVAC", "Boiler"], matched: [], basis: "required" }, timeoff: "x", overlap: "y" }));
    expect(r).toEqual({ fit: "unqualified", clash: { kind: "unqualified", message: "Tom Rivera isn't set up for HVAC and Boiler." } });
  });

  it("puts time off ahead of a double booking", () => {
    expect(classifyFit(base({ timeoff: "Tom is off today.", overlap: "Tom is booked 2–3 PM." })).clash).toEqual({ kind: "timeoff", message: "Tom is off today." });
    expect(classifyFit(base({ overlap: "Tom is booked 2–3 PM." }))).toEqual({ fit: "busy", clash: { kind: "overlap", message: "Tom is booked 2–3 PM." } });
  });

  it("calls a technician on a job busy until they're free, in company time", () => {
    const r = classifyFit(base({ inField: true, freeAt: NOW + 70 * MIN, jobStart: NOW - 30 * MIN }));
    expect(r.fit).toBe("busy");
    expect(r.clash?.kind).toBe("busy");
    expect(r.clash?.message).toMatch(/^Tom Rivera is on a job until 3:10\s?PM\.$/);
  });

  it("doesn't call them busy for a job that starts after they're free", () => {
    expect(classifyFit(base({ inField: true, freeAt: NOW + 70 * MIN, jobStart: NOW + 120 * MIN })).fit).toBe("ready");
  });

  it("doesn't call them busy when they aren't in the field", () => {
    expect(classifyFit(base({ inField: false, freeAt: NOW + 70 * MIN, jobStart: NOW })).fit).toBe("ready");
  });
});
