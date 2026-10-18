import { describe, expect, it } from "bun:test";
import { fmtDistance, fmtShortDistance, kmToUnit, mToUnit, parseDistanceUnit, perKmToUnit, unitRateToPerKm, unitToKm, unitToM } from "../units";

describe("distance units", () => {
  it("defaults anything unknown to metric", () => {
    expect(parseDistanceUnit(undefined)).toBe("metric");
    expect(parseDistanceUnit("nonsense")).toBe("metric");
    expect(parseDistanceUnit("imperial")).toBe("imperial");
  });
  it("shows mileage in km or mi from stored km", () => {
    expect(fmtDistance(10.74, "metric")).toBe("10.7 km");
    expect(fmtDistance(10.74, "imperial")).toBe("6.7 mi");
    expect(kmToUnit(1.609344, "imperial")).toBeCloseTo(1, 9);
    expect(unitToKm(1, "imperial")).toBeCloseTo(1.609344, 9);
  });
  it("round-trips a geofence typed in feet through whole metres", () => {
    for (const ft of [50, 100, 250, 500, 1000, 1640]) expect(mToUnit(unitToM(ft, "imperial"), "imperial")).toBe(ft);
    expect(unitToM(150, "metric")).toBe(150);
    expect(fmtShortDistance(150, "imperial")).toBe("490 ft");
    expect(fmtShortDistance(150, "metric")).toBe("150 m");
  });
  it("converts mileage rates without drift", () => {
    const perKm = unitRateToPerKm(0.68, "imperial");
    expect(perKmToUnit(perKm, "imperial")).toBeCloseTo(0.68, 9);
    expect(perKmToUnit(0.5, "metric")).toBe(0.5);
  });
  it("never produces NaN from bad input", () => {
    expect(kmToUnit(Number.NaN, "imperial")).toBe(0);
    expect(unitToM("x" as unknown as number, "imperial")).toBe(0);
  });
});
