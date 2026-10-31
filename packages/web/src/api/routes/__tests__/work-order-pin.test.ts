/**
 * WORK-ORDER FORM PIN
 *   A work-order form is gated only by its shared PIN and the public routes
 *   refuse every request when it's blank, so the admin routes must never save
 *   one without a PIN (there used to be a silent "123456" default instead).
 *   Lead forms have no PIN and are unaffected.
 */
import { describe, it, expect } from "bun:test";

process.env.DATABASE_URL = process.env.DATABASE_URL || ":memory:";
process.env.DATABASE_AUTH_TOKEN = process.env.DATABASE_AUTH_TOKEN || "";

const { workOrderPinProblem, WORK_ORDER_PIN_REQUIRED } = await import("../forms");

describe("workOrderPinProblem", () => {
  it("refuses a blank PIN on a work-order form", () => {
    expect(workOrderPinProblem("work_order", "")).toBe(WORK_ORDER_PIN_REQUIRED);
    expect(workOrderPinProblem("work_order", "   ")).toBe(WORK_ORDER_PIN_REQUIRED);
    expect(workOrderPinProblem("work_order", undefined)).toBe(WORK_ORDER_PIN_REQUIRED);
    expect(workOrderPinProblem("work_order", null)).toBe(WORK_ORDER_PIN_REQUIRED);
  });

  it("accepts a work-order form that has a PIN", () => {
    expect(workOrderPinProblem("work_order", "482915")).toBeNull();
    expect(workOrderPinProblem("work_order", 482915)).toBeNull();
  });

  it("never requires a PIN on a lead form", () => {
    expect(workOrderPinProblem("lead", "")).toBeNull();
    expect(workOrderPinProblem("lead", undefined)).toBeNull();
  });

  it("explains the fix in plain words", () => {
    expect(WORK_ORDER_PIN_REQUIRED).toMatch(/PIN/);
    expect(WORK_ORDER_PIN_REQUIRED).toMatch(/Generate/);
  });
});
