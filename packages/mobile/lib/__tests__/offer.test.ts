import { describe, expect, test } from "bun:test";
import { fmtMins, fmtMinsShort, offerPath, offerPushStep, pushAgeMs } from "../offer";

describe("offer push buttons", () => {
  const offer = { event: "assigned", bookingId: "b1" };

  test("Accept accepts, Decline opens the reasons, Details or a tap opens the details", () => {
    expect(offerPushStep(offer, "accept")).toEqual({ kind: "accept", bookingId: "b1" });
    expect(offerPushStep(offer, "decline")).toEqual({ kind: "open", path: "/offer/b1?decline=1" });
    expect(offerPushStep(offer, "details")).toEqual({ kind: "open", path: "/offer/b1" });
    expect(offerPushStep(offer, "expo.modules.notifications.actions.DEFAULT")).toEqual({ kind: "open", path: "/offer/b1" });
  });

  test("other pushes are left to normal routing", () => {
    expect(offerPushStep({ event: "enroute", bookingId: "b1" }, "accept")).toEqual({ kind: "none" });
    expect(offerPushStep({ event: "assigned" }, "accept")).toEqual({ kind: "none" });
    expect(offerPushStep(undefined, undefined)).toEqual({ kind: "none" });
  });

  test("paths and durations", () => {
    expect(offerPath("a b")).toBe("/offer/a%20b");
    expect(fmtMins(45)).toBe("45 min");
    expect(fmtMins(60)).toBe("1 h");
    expect(fmtMins(85)).toBe("1 h 25 min");
    expect(fmtMins(null)).toBe("0 min");
    expect(fmtMinsShort(95)).toBe("1h 35m");
    expect(fmtMinsShort(21)).toBe("21 min");
  });
});

describe("push age", () => {
  const now = 1_800_000_000_000;
  test("reads iOS seconds and Android milliseconds alike", () => {
    expect(pushAgeMs(1_800_000_000 - 60, now)).toBe(60_000);
    expect(pushAgeMs(now - 60_000, now)).toBe(60_000);
    expect(pushAgeMs(0, now)).toBe(0);
    expect(pushAgeMs(undefined, now)).toBe(0);
  });
});
