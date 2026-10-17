import { describe, it, expect } from "bun:test";
import { isFictionalPhone, isUndeliverableEmail, sampleEmail, samplePhone, SAMPLE_EMAIL_DOMAIN } from "../sample-contact";

describe("sample contact details", () => {
  it("makes undeliverable, per-company emails", () => {
    const e = sampleEmail("acme-hvac", "tech1");
    expect(e).toBe(`tech1.acme-hvac@${SAMPLE_EMAIL_DOMAIN}`);
    expect(isUndeliverableEmail(e)).toBe(true);
    expect(sampleEmail("a", "x")).not.toBe(sampleEmail("b", "x"));
  });

  it("recognises only .invalid hosts", () => {
    expect(isUndeliverableEmail("x@foo.invalid")).toBe(true);
    expect(isUndeliverableEmail("X@FOO.INVALID.")).toBe(true);
    expect(isUndeliverableEmail("x@invalid")).toBe(true);
    expect(isUndeliverableEmail("x@invalid.com")).toBe(false);
    expect(isUndeliverableEmail("dan@nvc360.com")).toBe(false);
    expect(isUndeliverableEmail("")).toBe(false);
    expect(isUndeliverableEmail(null)).toBe(false);
  });

  it("makes fictional phones and recognises them in any format", () => {
    expect(samplePhone(7)).toBe("(204) 555-0107");
    for (const p of ["(204) 555-0107", "+1 204 555 0199", "12045550100", "204.555.0150"]) {
      expect(isFictionalPhone(p)).toBe(true);
    }
  });

  it("never matches a real number", () => {
    for (const p of ["(204) 555-0200", "204-555-1234", "+1 204 555 0099", "555-0123", "", null, "+44 20 5550 0123"]) {
      expect(isFictionalPhone(p)).toBe(false);
    }
  });
});
