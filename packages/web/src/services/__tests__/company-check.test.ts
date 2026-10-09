import { describe, expect, test } from "bun:test";
import { digits, normText, serviceCovered, slugKey } from "../company-check";

describe("company-check normalisers", () => {
  test("digits strips formatting and a leading country 1", () => {
    expect(digits("+1 204-800-4292")).toBe("2048004292");
    expect(digits("(204) 955-6052")).toBe("2049556052");
    expect(digits("2049556052")).toBe("2049556052");
    expect(digits(null)).toBe("");
  });

  test("normText treats St/Street and trailing country as the same address", () => {
    expect(normText("700 King Edward St, Winnipeg, MB R3H 1B4, Canada")).toBe(normText("700 King Edward Street Winnipeg MB R3H 1B4"));
    expect(normText("700 King Edward St")).not.toBe(normText("780 Bradford St"));
  });

  test("slugKey is stable and url-safe", () => {
    expect(slugKey("Waterproof Decking Supply & Install")).toBe("waterproof-decking-supply-install");
  });
});

describe("serviceCovered", () => {
  const existing = [
    "Commercial Flooring Supply & Install",
    "Window Coverings & Treatments",
    "FF&E Procurement (Hospitality)",
    "Site Visit & Measurement",
  ];
  test("near-duplicates of existing services are covered", () => {
    expect(serviceCovered("Commercial Flooring", existing)).toBe(true);
    expect(serviceCovered("Window Coverings", existing)).toBe(true);
    expect(serviceCovered("Flooring Installation", existing)).toBe(true);
  });
  test("genuinely new work is not covered", () => {
    expect(serviceCovered("Waterproof Decking", existing)).toBe(false);
    expect(serviceCovered("Commercial Tile Installation", existing)).toBe(false);
    expect(serviceCovered("Value Engineering", existing)).toBe(false);
  });
  test("empty / stop-word-only proposals never become services", () => {
    expect(serviceCovered("Services", existing)).toBe(true);
    expect(serviceCovered("", existing)).toBe(true);
  });
});
