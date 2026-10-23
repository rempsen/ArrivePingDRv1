import { describe, expect, it } from "bun:test";
import {
  DECLINE_REASONS,
  DECLINE_REASON_LABELS,
  JOB_OFFER_ACTIONS,
  JOB_OFFER_CATEGORY,
  declineDetail,
  estimateOfferPay,
  offerChecklist,
  offerLines,
  skillList,
} from "../offer";
import * as mobile from "../../../../mobile/lib/offer";

describe("decline reasons", () => {
  it("store the label, with the note when there is one", () => {
    expect(declineDetail({ code: "schedule_conflict" })).toBe("Schedule conflict");
    expect(declineDetail({ code: "too_far", note: "  across the river " })).toBe("Too far away — across the river");
  });

  it("keep an older app's free text", () => {
    expect(declineDetail({ reason: "Declined from app" })).toBe("Declined from app");
    expect(declineDetail({ note: "just a note" })).toBe("just a note");
    expect(declineDetail({})).toBe("");
  });

  it("match the mobile app's copy, buttons included", () => {
    expect(mobile.DECLINE_REASONS).toEqual(DECLINE_REASONS.map((key) => ({ key, label: DECLINE_REASON_LABELS[key] })));
    expect(mobile.JOB_OFFER_CATEGORY).toBe(JOB_OFFER_CATEGORY);
    expect(mobile.OFFER_ACTION).toEqual(JOB_OFFER_ACTIONS);
  });
});

describe("estimated pay", () => {
  it("prices the expected time and the drive both ways with the tech's rates", () => {
    const p = estimateOfferPay({ lineItems: "[]", techPayModel: "" }, { payRatePerHour: 30, payRatePerKm: 0.6 }, { onSiteMinutes: 120, driveKm: 10 });
    expect(p.hourlyPay).toBe(60);
    expect(p.mileagePay).toBe(12);
    expect(p.estimate).toBe(72);
    expect(p.unrated).toBe(false);
  });

  it("uses the job's own pay model over the tech's rates", () => {
    const model = JSON.stringify({ hourlyRate: null, perKmRate: 0, flatPay: 85, mileageBasis: "to_job", includedKm: 0 });
    const p = estimateOfferPay({ lineItems: "[]", techPayModel: model }, { payRatePerHour: 0 }, { onSiteMinutes: 60, driveKm: 20 });
    expect(p.estimate).toBe(85);
    expect(p.flatPay).toBe(85);
  });

  it("says when nobody set a rate, and survives a missing drive", () => {
    const p = estimateOfferPay({ lineItems: null, techPayModel: null }, {}, { onSiteMinutes: 90, driveKm: null });
    expect(p.estimate).toBe(0);
    expect(p.unrated).toBe(true);
    expect(p.missing).toEqual([]);
  });

  it("names what it couldn't price, so the total reads as a floor", () => {
    const p = estimateOfferPay({ lineItems: "[]", techPayModel: "" }, { payRatePerHour: 30, payRatePerKm: 0.6 }, { onSiteMinutes: null, driveKm: null });
    expect(p.missing).toEqual(["time", "mileage"]);
    const q = estimateOfferPay({ lineItems: "[]", techPayModel: "" }, { payRatePerHour: 30, payRatePerKm: 0 }, { onSiteMinutes: 60, driveKm: null });
    expect(q.missing).toEqual([]);
  });
});

describe("scope helpers", () => {
  it("lists lines without prices or costs", () => {
    const lines = offerLines([
      { itemId: "a", kind: "part", name: "Filter", sku: "", unit: "ea", qty: 2, unitCost: 5, unitPrice: 12, taxable: true, cost: 10, price: 24 },
      { itemId: "b", kind: "part", name: " ", sku: "", unit: "", qty: 1, unitCost: 0, unitPrice: 0, taxable: true, cost: 0, price: 0 },
    ] as never);
    expect(lines).toEqual([{ name: "Filter", qty: 2, unit: "ea", kind: "part" }]);
  });

  it("reads both checklist shapes and ignores junk", () => {
    expect(offerChecklist(JSON.stringify(["A", { label: "B", required: true }, { nope: 1 }, 7]))).toEqual([
      { label: "A", required: false },
      { label: "B", required: true },
    ]);
    expect(offerChecklist("not json")).toEqual([]);
  });

  it("splits skills", () => {
    expect(skillList(" gas, ,refrigerant ")).toEqual(["gas", "refrigerant"]);
    expect(skillList(null)).toEqual([]);
  });
});
