import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { INDUSTRY_PRESETS } from "../../../services/industry-presets";
import { formProblems, isInputItem, normalizeForm, type FormItem } from "../form-model";
import { LIBRARY, libraryFor } from "../library";

const presetIds = new Set(INDUSTRY_PRESETS.map((p) => p.id));
const general = LIBRARY.filter((t) => t.industries.length === 0);

/** The answers a question can actually hold (null = free-form). */
function validAnswers(item: FormItem): string[] | null {
  switch (item.type) {
    case "yes_no":
      return ["yes", "no"];
    case "pass_fail":
      return ["pass", "fail", "na"];
    case "single_choice":
    case "multi_choice":
    case "checklist":
      return item.options ?? [];
    default:
      return null;
  }
}

const lucideIcons = join(dirname(Bun.resolveSync("lucide-react", import.meta.dir)), "..", "esm", "icons");

describe("template library", () => {
  it("has about two dozen templates with unique, slug-shaped keys", () => {
    expect(LIBRARY.length).toBeGreaterThanOrEqual(20);
    const keys = LIBRARY.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(new Set(LIBRARY.map((t) => t.name)).size).toBe(LIBRARY.length);
  });

  for (const t of LIBRARY) {
    describe(t.key, () => {
      it("survives normalisation unchanged", () => {
        expect(normalizeForm(t.form)).toStrictEqual(t.form);
      });

      it("has no builder problems", () => {
        expect(formProblems(t.form)).toEqual([]);
      });

      it("has card metadata", () => {
        expect(t.name.trim()).toBe(t.name);
        expect(t.name.length).toBeGreaterThan(0);
        expect(t.category.length).toBeGreaterThan(0);
        expect(t.description).toMatch(/^[A-Z].*\.$/);
        expect(t.description.length).toBeLessThanOrEqual(120);
        expect(t.estimatedMins).toBeGreaterThan(0);
        expect(Number.isInteger(t.estimatedMins)).toBe(true);
        expect(t.color).toMatch(/^#[0-9a-f]{6}$/);
        expect(t.icon).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(existsSync(join(lucideIcons, `${t.icon}.js`))).toBe(true);
      });

      it("references real industry presets", () => {
        expect(new Set(t.industries).size).toBe(t.industries.length);
        for (const id of t.industries) expect(presetIds.has(id)).toBe(true);
      });

      it("is a well-shaped form", () => {
        const items = t.form.items;
        expect(items.length).toBeGreaterThanOrEqual(8);
        expect(items.length).toBeLessThanOrEqual(25);
        expect(items[0].type).toBe("section");
        const sections = items.filter((i) => i.type === "section").length;
        expect(sections).toBeGreaterThanOrEqual(2);
        expect(sections).toBeLessThanOrEqual(5);
        expect(items.some((i) => isInputItem(i) && i.required)).toBe(true);
        expect(items.some((i) => i.type === "signature")).toBe(true);
        for (const i of items) {
          expect(i.id).toMatch(/^[a-z0-9_]+$/);
          expect(i.id.length).toBeLessThanOrEqual(24);
          expect(i.label.length).toBeLessThanOrEqual(60);
          if (i.type === "instructions") expect((i.help ?? "").length).toBeGreaterThan(0);
        }
        // Every section holds at least one item.
        items.forEach((it, n) => {
          if (it.type === "section") expect(items[n + 1] && items[n + 1].type !== "section").toBe(true);
        });
      });

      it("only flags on real answers", () => {
        for (const i of t.form.items) {
          if (!i.flagOn) continue;
          const valid = validAnswers(i);
          expect(valid).not.toBeNull();
          for (const f of i.flagOn) expect(valid).toContain(f);
        }
      });

      it("shows-if only on earlier questions and real answers", () => {
        const seen = new Map<string, FormItem>();
        for (const i of t.form.items) {
          if (i.showIf) {
            const target = seen.get(i.showIf.itemId);
            expect(target).toBeDefined();
            if (!target) continue;
            if (i.showIf.op === "is" || i.showIf.op === "is_not") {
              const valid = validAnswers(target);
              expect(valid).not.toBeNull();
              expect(valid).toContain(i.showIf.value ?? "");
            } else {
              expect(i.showIf.value).toBeUndefined();
              if (i.showIf.op === "flagged") expect(target.flagOn?.length ?? 0).toBeGreaterThan(0);
            }
          }
          if (isInputItem(i)) seen.set(i.id, i);
        }
      });
    });
  }
});

describe("libraryFor", () => {
  it("puts HVAC first for the HVAC & plumbing preset, then plumbing, then general", () => {
    const list = libraryFor("hvac-plumbing");
    expect(list[0].key.startsWith("hvac-")).toBe(true);
    const keys = list.map((t) => t.key);
    expect(keys.filter((k) => k.startsWith("hvac-")).length).toBe(3);
    expect(keys.filter((k) => k.startsWith("plumbing-")).length).toBe(3);
    expect(keys.lastIndexOf("hvac-equipment-install")).toBeLessThan(keys.indexOf("plumbing-service-call"));
    expect(list.slice(-general.length)).toEqual(general);
  });

  it("lists industry matches before general templates", () => {
    for (const id of presetIds) {
      const list = libraryFor(id);
      expect(list.length).toBeGreaterThan(0);
      const firstGeneral = list.findIndex((t) => t.industries.length === 0);
      expect(list.slice(0, firstGeneral).every((t) => t.industries.includes(id))).toBe(true);
      expect(list.slice(firstGeneral)).toEqual(general);
    }
  });

  it("gives every core vertical its own templates", () => {
    for (const id of [
      "hvac-plumbing",
      "electrical",
      "equipment-rental",
      "property-management-maintenance",
      "commercial-building-maintenance",
      "home-builder-developer",
      "renovation-contractor",
    ]) {
      expect(libraryFor(id).length).toBeGreaterThan(general.length);
    }
  });

  it("falls back to the general templates", () => {
    expect(general.length).toBeGreaterThanOrEqual(6);
    expect(libraryFor(undefined)).toEqual(general);
    expect(libraryFor(null)).toEqual(general);
    expect(libraryFor("")).toEqual(general);
    expect(libraryFor("other")).toEqual(general);
    expect(libraryFor("not-a-real-industry")).toEqual(general);
  });
});
