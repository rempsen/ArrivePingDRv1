import { describe, it, expect } from "bun:test";
import {
  computeSubtotal,
  parseRateModel,
  describeRateModel,
  EMPTY_RATE_MODEL,
  type RateModel,
} from "../pricing";

const rm = (over: Partial<RateModel>): RateModel => ({ ...EMPTY_RATE_MODEL, ...over });

describe("computeSubtotal — flat rate", () => {
  it("charges only the flat rate when there is no overage", () => {
    const r = computeSubtotal(rm({ flatRate: 100, includedMinutes: 60, includedKm: 20 }), 45, 10);
    expect(r.subtotal).toBe(100);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.label).toContain("incl. 60 min + 20 km");
  });

  it("labels flat rate without inclusions when none configured", () => {
    const r = computeSubtotal(rm({ flatRate: 80 }), 0, 0);
    expect(r.items[0]!.label).toBe("Flat rate");
    expect(r.subtotal).toBe(80);
  });
});

describe("computeSubtotal — time overage", () => {
  it("bills hourly overage beyond included minutes", () => {
    // 90 actual min, 60 included => 30 billable min = 0.5 hr @ $120/hr = $60
    const r = computeSubtotal(rm({ flatRate: 50, includedMinutes: 60, timeRate: 120, timeUnit: "hour" }), 90, 0);
    expect(r.subtotal).toBe(110);
    const time = r.items.find((i) => i.label === "Additional time")!;
    expect(time.qty).toBe(0.5);
    expect(time.amount).toBe(60);
  });

  it("bills per-minute overage when timeUnit is minute", () => {
    const r = computeSubtotal(rm({ includedMinutes: 30, timeRate: 2, timeUnit: "minute" }), 50, 0);
    // 20 billable min * $2 = $40
    expect(r.subtotal).toBe(40);
  });

  it("never bills negative time when actual is below included", () => {
    const r = computeSubtotal(rm({ flatRate: 50, includedMinutes: 60, timeRate: 100, timeUnit: "hour" }), 10, 0);
    expect(r.subtotal).toBe(50);
    expect(r.items.find((i) => i.label === "Additional time")).toBeUndefined();
  });
});

describe("computeSubtotal — mileage overage", () => {
  it("bills km beyond included distance", () => {
    const r = computeSubtotal(rm({ flatRate: 40, includedKm: 10, kmRate: 1.5 }), 0, 25);
    // 15 billable km * 1.5 = 22.5
    expect(r.subtotal).toBe(62.5);
    expect(r.items.find((i) => i.label === "Mileage")!.amount).toBe(22.5);
  });
});

describe("computeSubtotal — minimum charge floor", () => {
  it("raises subtotal to the minimum charge and records the adjustment", () => {
    const r = computeSubtotal(rm({ flatRate: 20, minCharge: 75 }), 0, 0);
    expect(r.subtotal).toBe(75);
    const adj = r.items.find((i) => i.label === "Minimum charge adjustment")!;
    expect(adj.amount).toBe(55);
  });

  it("does not apply the floor when subtotal already exceeds it", () => {
    const r = computeSubtotal(rm({ flatRate: 200, minCharge: 75 }), 0, 0);
    expect(r.subtotal).toBe(200);
    expect(r.items.find((i) => i.label === "Minimum charge adjustment")).toBeUndefined();
  });
});

describe("computeSubtotal — rounding", () => {
  it("rounds money to 2 decimals", () => {
    const r = computeSubtotal(rm({ kmRate: 0.333 }), 0, 10);
    // 10 * 0.333 = 3.33
    expect(r.subtotal).toBe(3.33);
  });

  it("combines flat + time + km correctly", () => {
    const r = computeSubtotal(
      rm({ flatRate: 100, includedMinutes: 60, includedKm: 10, timeRate: 60, timeUnit: "hour", kmRate: 2 }),
      120, // +60 min = 1hr * 60 = 60
      20,  // +10 km * 2 = 20
    );
    expect(r.subtotal).toBe(180);
  });
});

describe("parseRateModel", () => {
  it("returns null for empty input", () => {
    expect(parseRateModel(null)).toBeNull();
    expect(parseRateModel(undefined)).toBeNull();
    expect(parseRateModel("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseRateModel("{not json")).toBeNull();
  });

  it("merges partial JSON over the empty model", () => {
    const m = parseRateModel('{"flatRate":50}')!;
    expect(m.flatRate).toBe(50);
    expect(m.timeUnit).toBe("hour");
    expect(m.kmRate).toBe(0);
  });
});

describe("describeRateModel", () => {
  it("describes a full model", () => {
    const s = describeRateModel(rm({ flatRate: 100, includedMinutes: 60, timeRate: 50, kmRate: 1 }));
    expect(s).toContain("$100.00 flat");
    expect(s).toContain("+$50.00/hr");
    expect(s).toContain("+$1.00/km");
  });

  it("returns a sentinel when nothing is set", () => {
    expect(describeRateModel(EMPTY_RATE_MODEL)).toBe("No pricing set");
  });
});
