import { describe, expect, test } from "bun:test";
import { asap, partsIn, slotLabel, toIso } from "../when";

describe("when", () => {
  test("asap rounds up to the next quarter hour and never stays in the past", () => {
    expect(asap(new Date("2026-10-21T15:07:00.000Z")).toISOString()).toBe("2026-10-21T15:15:00.000Z");
    expect(asap(new Date("2026-10-21T15:15:00.000Z")).toISOString()).toBe("2026-10-21T15:30:00.000Z");
    expect(asap(new Date("2026-10-21T15:59:30.000Z")).toISOString()).toBe("2026-10-21T16:00:00.000Z");
  });

  test("toIso builds the instant on the company's clock (CDT = UTC-5)", () => {
    expect(toIso("2026-10-21", 9, 30, "America/Winnipeg")).toBe("2026-10-21T14:30:00.000Z");
    // After the November change (CST = UTC-6).
    expect(toIso("2026-11-10", 9, 30, "America/Winnipeg")).toBe("2026-11-10T15:30:00.000Z");
    expect(toIso("2026-10-21", 9, 30, "UTC")).toBe("2026-10-21T09:30:00.000Z");
  });

  test("partsIn round-trips toIso", () => {
    const p = partsIn(new Date(toIso("2026-10-21", 14, 45, "America/Toronto")), "America/Toronto");
    expect(p).toMatchObject({ day: "2026-10-21", hour: 14, minute: 45, weekday: 3 });
  });

  test("slotLabel", () => {
    expect(slotLabel(0, 0)).toBe("12:00 AM");
    expect(slotLabel(9, 5)).toBe("9:05 AM");
    expect(slotLabel(12, 30)).toBe("12:30 PM");
    expect(slotLabel(17, 15)).toBe("5:15 PM");
  });
});

import { fmtInTz } from "../when";
describe("fmtInTz", () => {
  test("renders on the company's clock, not the device's", () => {
    expect(fmtInTz("2026-10-21T14:30:00.000Z", "America/Winnipeg")).toBe("Wed, Oct 21, 9:30 AM");
    expect(fmtInTz("2026-10-21T14:30:00.000Z", "America/Toronto")).toBe("Wed, Oct 21, 10:30 AM");
  });
});
