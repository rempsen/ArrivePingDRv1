import { describe, expect, test } from "bun:test";
import { monthlyPrice, pricing, pricingBands, STARTER_PRICE } from "../../web/site/config";

/** Independent reference: $49 Starter (dispatcher + 2 drivers), $30 for drivers 3–29, $25 from driver 30. */
function expected(n: number) {
  let total = 49;
  for (let d = 3; d <= n; d++) total += d <= 29 ? 30 : 25;
  return total;
}

describe("ArrivePing pricing calculator", () => {
  test("two bands: drivers 3–29 at $30, 30+ at $25", () => {
    expect(STARTER_PRICE).toBe(49);
    expect(pricingBands.map((b) => [b.from, b.to, b.rate])).toEqual([
      [3, 29, 30],
      [30, Infinity, 25],
    ]);
  });

  test.each([
    [1, 49, "Starter"],
    [2, 49, "Starter"],
    [3, 79, "Growing team"],
    [5, 139, "Growing team"],
    [10, 289, "Growing team"],
    [11, 319, "Growing team"],
    [29, 859, "Growing team"],
    [30, 884, "Fleet"],
    [50, 1384, "Fleet"],
    [100, 2634, "Fleet"],
  ])("%i drivers → $%i (%s)", (n, total, plan) => {
    const r = monthlyPrice(n);
    expect(r.total).toBe(total);
    expect(r.total).toBe(expected(n));
    expect(r.plan).toBe(plan);
  });

  test("every driver count 1–100 matches the reference and never decreases", () => {
    let prev = 0;
    for (let n = 1; n <= 100; n++) {
      const t = monthlyPrice(n).total;
      expect(t).toBe(expected(n));
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  test("breakdown shows the arithmetic", () => {
    expect(monthlyPrice(2).breakdown).toBe("Starter: 1 dispatcher + 2 drivers");
    expect(monthlyPrice(10).breakdown).toBe("Starter $49 + 8 × $30");
    expect(monthlyPrice(50).breakdown).toBe("Starter $49 + 27 × $30 + 21 × $25");
  });

  test("tier cards and ladder no longer mention a $27 band", () => {
    const text = JSON.stringify(pricing);
    expect(text).not.toContain("$27");
    expect(text).not.toContain("11–29");
  });
});
