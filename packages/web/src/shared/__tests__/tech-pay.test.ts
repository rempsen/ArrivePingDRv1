import { describe, it, expect } from "bun:test";
import { computeTechPay, type TechPayInput } from "../tech-pay";
import type { LineItem } from "../catalog";

const unitLine = (cost: number): LineItem =>
  ({ id: crypto.randomUUID(), kind: "unit", name: "Install", unit: "sqft", qty: 1, unitCost: cost, unitPrice: 0, taxable: true, cost, price: 0 }) as unknown as LineItem;

const catalogLine = (cost: number): LineItem =>
  ({ id: crypto.randomUUID(), kind: "product", name: "Filter", unit: "each", qty: 1, unitCost: cost, unitPrice: 0, taxable: true, cost, price: 0 }) as unknown as LineItem;

const base: TechPayInput = { onSiteMinutes: 0, payRatePerHour: 0, lineItems: [] };

describe("computeTechPay — hourly on-site time + per-unit pay", () => {
  it("pays the hourly rate for the time actually spent on site", () => {
    const r = computeTechPay({ ...base, onSiteMinutes: 90, payRatePerHour: 40 });
    expect(r.hours).toBe(1.5);
    expect(r.hourlyPay).toBe(60);
    expect(r.unitPay).toBe(0);
    expect(r.techPay).toBe(60);
  });

  it("adds per-unit line pay on top of the hourly pay", () => {
    const r = computeTechPay({ ...base, onSiteMinutes: 60, payRatePerHour: 30, lineItems: [unitLine(120)] });
    expect(r.hourlyPay).toBe(30);
    expect(r.unitPay).toBe(120);
    expect(r.techPay).toBe(150);
  });

  it("ignores catalog product cost — that is company COGS, not tech pay", () => {
    const r = computeTechPay({ ...base, onSiteMinutes: 60, payRatePerHour: 30, lineItems: [catalogLine(500), unitLine(20)] });
    expect(r.unitPay).toBe(20);
    expect(r.techPay).toBe(50);
  });

  it("rounds money to cents, never to a fraction of a cent", () => {
    // 50 min @ $37/h = 0.83h * 37 = 30.71 (0.8333.. rounded to 2dp first)
    const r = computeTechPay({ ...base, onSiteMinutes: 50, payRatePerHour: 37 });
    expect(r.hours).toBe(0.83);
    expect(r.hourlyPay).toBe(30.71);
  });

  it("flags a job as unrated when there is no hourly rate and no per-unit pay", () => {
    const r = computeTechPay({ ...base, onSiteMinutes: 120, payRatePerHour: 0 });
    expect(r.techPay).toBe(0);
    expect(r.unrated).toBe(true);
  });

  it("does not flag a job that is paid purely per unit with no hourly rate", () => {
    const r = computeTechPay({ ...base, onSiteMinutes: 0, payRatePerHour: 0, lineItems: [unitLine(200)] });
    expect(r.techPay).toBe(200);
    expect(r.unrated).toBe(false);
  });

  it("does not flag a rated tech who simply finished in zero recorded minutes", () => {
    const r = computeTechPay({ ...base, onSiteMinutes: 0, payRatePerHour: 45 });
    expect(r.techPay).toBe(0);
    expect(r.unrated).toBe(false);
  });

  it("treats a garbage rate or garbage minutes as zero instead of producing NaN pay", () => {
    const r = computeTechPay({
      onSiteMinutes: Number("nonsense"),
      payRatePerHour: undefined as unknown as number,
      lineItems: [],
    });
    expect(Number.isNaN(r.techPay)).toBe(false);
    expect(r.techPay).toBe(0);
    expect(r.unrated).toBe(true);
  });

  it("never produces negative pay from a negative rate or negative minutes", () => {
    const r = computeTechPay({ ...base, onSiteMinutes: -60, payRatePerHour: -50, lineItems: [unitLine(-10)] });
    expect(r.hourlyPay).toBe(0);
    expect(r.unitPay).toBe(0);
    expect(r.techPay).toBe(0);
  });
});

import { jobTechPay, parseTechPayModel } from "../tech-pay";
import { computeSubtotal, EMPTY_RATE_MODEL, mileageFor } from "../pricing";

describe("jobTechPay — mileage, flat and workflow overrides", () => {
  const job = { onSiteMinutes: 90, mileageKm: 20, mileageToJobKm: 12, lineItems: "[]" };
  it("uses the technician's own hourly and per-km rates by default (round trip)", () => {
    const r = jobTechPay(job, { payRatePerHour: 40, payRatePerKm: 0.5 });
    expect(r.hourlyPay).toBe(60);
    expect(r.paidKm).toBe(20);
    expect(r.mileagePay).toBe(10);
    expect(r.techPay).toBe(70);
  });
  it("lets the workflow pay a different rate than the tech's default", () => {
    const model = JSON.stringify({ hourlyRate: 30, perKmRate: 0.6, flatPay: 25, mileageBasis: "to_job", includedKm: 2 });
    const r = jobTechPay({ ...job, techPayModel: model }, { payRatePerHour: 40, payRatePerKm: 0.5 });
    expect(r.hourlyPay).toBe(45);
    expect(r.paidKm).toBe(10);
    expect(r.mileagePay).toBe(6);
    expect(r.flatPay).toBe(25);
    expect(r.techPay).toBe(76);
  });
  it("treats a blank override as 'use the tech's rate', never as $0", () => {
    const m = parseTechPayModel(JSON.stringify({ hourlyRate: "", perKmRate: null }))!;
    expect(m.hourlyRate).toBeNull();
    expect(jobTechPay({ ...job, techPayModel: JSON.stringify(m) }, { payRatePerHour: 40 }).hourlyPay).toBe(60);
  });
  it("pays mileage-only and flat-only setups, and flags truly unrated jobs", () => {
    expect(jobTechPay(job, { payRatePerKm: 1 }).unrated).toBe(false);
    expect(jobTechPay({ ...job, techPayModel: JSON.stringify({ flatPay: 50 }) }, {}).techPay).toBe(50);
    expect(jobTechPay(job, {}).unrated).toBe(true);
  });
  it("charges the client on its own rate and basis, independent of tech pay", () => {
    const rm = { ...EMPTY_RATE_MODEL, kmRate: 1.2, includedKm: 5, kmBasis: "to_job" as const };
    const km = mileageFor(rm.kmBasis, job.mileageKm, job.mileageToJobKm);
    const metric = computeSubtotal(rm, 0, km);
    expect(metric.subtotal).toBe(8.4);
    const imperial = computeSubtotal(rm, 0, km, "imperial");
    expect(imperial.subtotal).toBe(8.4);
    expect(imperial.items[0]!.unit).toBe("mi");
  });
});

describe("client pricing — $150 service fee that includes the first 60 minutes", () => {
  const rule = { ...EMPTY_RATE_MODEL, flatRate: 150, includedMinutes: 60, timeRate: 90, timeUnit: "hour" as const };
  it("charges the full $150 even when the job takes less than an hour", () => {
    expect(computeSubtotal(rule, 40, 0).subtotal).toBe(150);
    expect(computeSubtotal(rule, 60, 0).subtotal).toBe(150);
  });
  it("charges the hourly rate only for time past the included hour", () => {
    // 85 min: $150 + 25 min (0.42 h) x $90
    expect(computeSubtotal(rule, 85, 0).subtotal).toBe(187.8);
  });
});
