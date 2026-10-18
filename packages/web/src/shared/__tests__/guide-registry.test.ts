/**
 * Guide chapter lint: the copy rules from the blueprint (≤5 steps per chapter,
 * ≤140-character bodies), every anchor a step points at is a declared anchor,
 * and chapter ids are valid keys for the saved-progress record.
 */
import { describe, expect, test } from "bun:test";
import { CHAPTERS, interpolate } from "../../web/guide/registry";
import { ANCHORS } from "../../web/guide/anchors";

const anchors = new Set<string>(ANCHORS);

describe("guide registry", () => {
  test("nine chapters, numbered 1–9, with unique save-safe ids", () => {
    expect(CHAPTERS.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const ids = CHAPTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{1,40}$/);
  });

  test("every chapter has 1–5 steps with unique ids", () => {
    for (const c of CHAPTERS) {
      expect(c.steps.length).toBeGreaterThan(0);
      expect(c.steps.length).toBeLessThanOrEqual(5);
      const ids = c.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("copy stays short", () => {
    for (const c of CHAPTERS) {
      for (const s of c.steps) {
        expect({ step: `${c.id}/${s.id}`, len: s.body.length <= 140 }).toEqual({ step: `${c.id}/${s.id}`, len: true });
        expect(s.title.length).toBeLessThanOrEqual(40);
      }
    }
  });

  test("every anchor and opener is a declared anchor", () => {
    for (const c of CHAPTERS) {
      for (const s of c.steps) {
        if (s.anchor) expect(anchors.has(s.anchor)).toBe(true);
        if (s.open) expect(anchors.has(s.open)).toBe(true);
      }
    }
  });

  test("admin-only pages are only in admin chapters", () => {
    for (const c of CHAPTERS.filter((x) => x.number >= 4)) expect(c.roles).toEqual(["admin"]);
    for (const c of CHAPTERS.filter((x) => x.number <= 3)) expect(c.roles).toContain("dispatcher");
  });

  test("terminology tokens resolve, with no braces left over", () => {
    const terms = { job: "Service call", jobs: "Service calls", worker: "Technician", workers: "Technicians", customer: "Homeowner", customers: "Homeowners" };
    for (const c of CHAPTERS) {
      for (const text of [c.title, c.summary, ...c.steps.flatMap((s) => [s.title, s.body])]) {
        expect(interpolate(text, terms)).not.toMatch(/[{}]/);
      }
    }
    expect(interpolate(CHAPTERS[3]!.title, terms)).toBe("Homeowners, technicians & coworkers");
  });
});
