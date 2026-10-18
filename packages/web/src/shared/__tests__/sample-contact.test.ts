import { describe, it, expect } from "bun:test";
import { isFictionalPhone, isUndeliverableEmail, sampleEmail, samplePhone, SAMPLE_EMAIL_DOMAIN } from "../sample-contact";

describe("sample contact details", () => {
  it("makes undeliverable, per-company emails", () => {
    const e = sampleEmail("acme-hvac", "tech1");
    expect(e).toMatch(new RegExp(`^tech1\\.acme-hvac-[a-z0-9]+@${SAMPLE_EMAIL_DOMAIN.replace(/\./g, "\\.")}$`));
    expect(isUndeliverableEmail(e)).toBe(true);
    expect(sampleEmail("a", "x")).not.toBe(sampleEmail("b", "x"));
    // Two long slugs that share their first 40 characters must not collide
    // (user.email is globally unique).
    const base = "a-very-long-company-name-that-goes-on-and-on";
    expect(sampleEmail(`${base}-one`, "c1")).not.toBe(sampleEmail(`${base}-two`, "c1"));
    expect(sampleEmail("acme", "c1")).toBe(sampleEmail("acme", "c1"));
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
