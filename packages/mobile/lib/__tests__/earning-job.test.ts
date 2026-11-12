import { describe, expect, mock, test } from "bun:test";
import type { EarnJob } from "../earning-job";

// lib/theme.ts (money, fmtDate) pulls in react-native and expo-constants, which bun can't load.
mock.module("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
mock.module("react-native", () => ({ Platform: { OS: "ios", select: (o: any) => o.ios ?? o.default }, StyleSheet: { create: (x: any) => x }, Dimensions: { get: () => ({ width: 390, height: 844 }) }, PixelRatio: { get: () => 3 } }));
const { fmtHours, payLines, paySummary, quickbooksNote } = await import("../earning-job");

const job: EarnJob = {
  id: "b1", companyId: "c1", company: "Acme", title: "Fix", service: "Repair", customerName: "Sam",
  scheduledAt: null, finishedAt: 1_700_000_000_000, price: 200, pay: 90, onSiteMinutes: 105,
  payRatePerHour: 40, hourlyPay: 70, unitPay: 0, unrated: false,
};

describe("fmtHours", () => {
  test("formats minutes", () => {
    expect(fmtHours(105)).toBe("1h 45m");
    expect(fmtHours(45)).toBe("45m");
    expect(fmtHours(0)).toBe("0m");
    expect(fmtHours(-5)).toBe("0m");
  });
});

describe("payLines", () => {
  test("always has on-site time, omits zero parts", () => {
    const l = payLines(job);
    expect(l.length).toBe(1);
    expect(l[0]!.hint).toContain("1h 45m");
    expect(l[0]!.hint).toContain("/h");
  });
  test("adds mileage, flat and per-unit when paid", () => {
    const l = payLines({ ...job, mileagePay: 12, paidKm: 24.04, flatPay: 8, unitPay: 5 });
    expect(l.map((x) => x.label)).toEqual(["On-site time", "Mileage", "Flat per job", "Per-unit work"]);
    expect(l[1]!.hint).toBe("24 km");
  });
});

describe("paySummary", () => {
  test("hourly job", () => {
    expect(paySummary(job)).toContain("1h 45m on site");
  });
  test("unrated job tells the tech to ask the office", () => {
    expect(paySummary({ ...job, hourlyPay: 0, payRatePerHour: 0, pay: 0, unrated: true })).toContain("ask the office");
  });
  test("appends the extra parts", () => {
    const s = paySummary({ ...job, mileagePay: 12, flatPay: 8, unitPay: 5 });
    expect(s).toContain("mileage");
    expect(s).toContain("flat");
    expect(s).toContain("per-unit");
  });
});

describe("quickbooksNote", () => {
  test("paid, billed, and nothing", () => {
    expect(quickbooksNote({ ...job, vendorBillStatus: "paid" })?.paid).toBe(true);
    expect(quickbooksNote({ ...job, vendorBillStatus: "billed" })?.paid).toBe(false);
    expect(quickbooksNote({ ...job, vendorBillStatus: "none" })).toBeNull();
    expect(quickbooksNote(job)).toBeNull();
  });
});
