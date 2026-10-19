import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  answerText,
  cleanAnswerValue,
  flaggedItems,
  formProblems,
  fromLegacy,
  isAnswered,
  mergeAnswers,
  missingRequired,
  normalizeForm,
  progress,
  sectionsOf,
  templateForm,
  visibleItems,
  type Answers,
  type FormDef,
} from "../form-model";

const at = (s = 0) => new Date(Date.UTC(2026, 9, 19, 12, 0, s)).toISOString();

const def: FormDef = normalizeForm({
  items: [
    { id: "s1", type: "section", label: "Arrival" },
    { id: "filter", type: "pass_fail", label: "Filter", required: true, flagOn: ["fail"] },
    { id: "fphoto", type: "photo", label: "Filter photo", required: true, minPhotos: 2, showIf: { itemId: "filter", op: "is", value: "fail" } },
    { id: "s2", type: "section", label: "Commercial only", showIf: { itemId: "kind", op: "is", value: "Commercial" } },
    { id: "kind", type: "single_choice", label: "Site", options: ["Home", "Commercial"] },
    { id: "rtu", type: "short_text", label: "RTU number", required: true },
    { id: "s3", type: "section", label: "Sign-off" },
    { id: "steps", type: "checklist", label: "Steps", options: ["A", "B"], required: true },
    { id: "sig", type: "signature", label: "Customer", required: true },
  ],
});

describe("mobile copy", () => {
  it("is byte-identical to the shared model (run tools/sync-form-model.ts)", () => {
    const a = readFileSync(join(import.meta.dir, "../form-model.ts"), "utf8");
    const b = readFileSync(join(import.meta.dir, "../../../../../mobile/lib/forms/form-model.ts"), "utf8");
    expect(b).toBe(a);
  });
});

describe("normalizeForm", () => {
  it("drops logic that points forward or at a missing question", () => {
    // s2 points at "kind", which comes after it -> rule removed, section always shown.
    expect(def.items.find((i) => i.id === "s2")!.showIf).toBeUndefined();
    const f = normalizeForm({ items: [{ id: "a", type: "short_text", label: "A", showIf: { itemId: "zzz", op: "answered" } }] });
    expect(f.items[0]!.showIf).toBeUndefined();
  });
  it("drops unknown types, dedupes ids and options, bounds text", () => {
    const f = normalizeForm({
      items: [
        { id: "x", type: "short_text", label: "A" },
        { id: "x", type: "short_text", label: "B" },
        { id: "y", type: "bogus", label: "C" },
        { id: "z", type: "multi_choice", label: "D", options: ["One", "one", "", "Two"] },
        { id: "w", type: "section", label: "S", required: true },
      ],
    });
    expect(f.items.map((i) => i.type)).toEqual(["short_text", "short_text", "multi_choice", "section"]);
    expect(new Set(f.items.map((i) => i.id)).size).toBe(4);
    expect(f.items[2]!.options).toEqual(["One", "Two"]);
    expect(f.items[3]!.required).toBeUndefined();
  });
  it("accepts a bare array", () => {
    expect(normalizeForm([{ type: "date", label: "When" }]).items[0]!.type).toBe("date");
  });
});

describe("legacy templates", () => {
  it("converts old fields and the separate checklist, with stable ids", () => {
    const f = fromLegacy(
      [
        { type: "text", label: "Model #", required: true },
        { type: "textarea", label: "Notes" },
        { type: "select", label: "Unit", options: ["Furnace", "AC"] },
        { type: "checkbox", label: "Done", options: ["Filter", "Coils"] },
        { type: "checkbox", label: "Customer present" },
        { type: "photo", label: "Before", required: true },
        { type: "signature", label: "Sign" },
        { type: "weird", label: "skip" },
      ],
      [{ label: "Wipe down", required: true }, { label: "Lock up" }],
    );
    expect(f.items.map((i) => [i.id, i.type])).toEqual([
      ["lg_0", "short_text"],
      ["lg_1", "long_text"],
      ["lg_2", "single_choice"],
      ["lg_3", "checklist"],
      ["lg_4", "checklist"],
      ["lg_5", "photo"],
      ["lg_6", "signature"],
      ["lg_checklist_req", "checklist"],
      ["lg_checklist", "checklist"],
    ]);
    expect(f.items[3]!.options).toEqual(["Filter", "Coils"]);
    expect(f.items[4]!.options).toEqual(["Customer present"]);
    expect(f.items[5]!.minPhotos).toBe(1);
    // only the item that was required blocks finishing
    expect(f.items[7]).toMatchObject({ options: ["Wipe down"], required: true });
    expect(f.items[8]!.options).toEqual(["Lock up"]);
    expect(f.items[8]!.required).toBeUndefined();
    expect(fromLegacy([{ type: "text", label: "A" }]).items[0]!.id).toBe(fromLegacy([{ type: "text", label: "A" }]).items[0]!.id);
  });
  it("templateForm prefers a saved schema-2 form", () => {
    const form = JSON.stringify({ schema: 2, items: [{ id: "n", type: "number", label: "PSI" }] });
    expect(templateForm({ form, fields: '[{"type":"text","label":"x"}]' }).items[0]!.id).toBe("n");
    expect(templateForm({ form: "", fields: '[{"type":"text","label":"x"}]' }).items[0]!.id).toBe("lg_0");
    expect(templateForm({ form: "{bad", fields: "nope" }).items).toEqual([]);
  });
});

describe("logic and validation", () => {
  it("shows a follow-up only when its condition holds", () => {
    const ids = (a: Answers) => visibleItems(def, a).map((i) => i.id);
    expect(ids({})).not.toContain("fphoto");
    expect(ids({ filter: { value: "fail", at: at() } })).toContain("fphoto");
    expect(ids({ filter: { value: "pass", at: at() } })).not.toContain("fphoto");
  });
  it("hides a whole section when its rule fails", () => {
    const f = normalizeForm({
      items: [
        { id: "kind", type: "single_choice", label: "Site", options: ["Home", "Commercial"] },
        { id: "s", type: "section", label: "Commercial", showIf: { itemId: "kind", op: "is", value: "Commercial" } },
        { id: "rtu", type: "short_text", label: "RTU", required: true },
        { id: "s2", type: "section", label: "End" },
        { id: "end", type: "short_text", label: "End note" },
      ],
    });
    expect(visibleItems(f, {}).map((i) => i.id)).toEqual(["kind", "s2", "end"]);
    expect(missingRequired(f, {}).map((i) => i.id)).toEqual([]);
    const com = { kind: { value: "Commercial", at: at() } };
    expect(missingRequired(f, com).map((i) => i.id)).toEqual(["rtu"]);
  });
  it("lists missing required questions, counting photo minimums and full checklists", () => {
    const a: Answers = {
      filter: { value: "fail", at: at() },
      fphoto: { value: null, photoIds: ["p1"], at: at() },
      rtu: { value: "RTU-4", at: at() },
      steps: { value: ["A"], at: at() },
    };
    expect(missingRequired(def, a).map((i) => i.id)).toEqual(["fphoto", "steps", "sig"]);
    a.fphoto = { value: null, photoIds: ["p1", "p2"], at: at() };
    a.steps = { value: ["A", "B"], at: at() };
    a.sig = { value: "data:image/svg+xml;base64,AAA", name: "Pat", at: at() };
    expect(missingRequired(def, a)).toEqual([]);
    expect(progress(def, a)).toEqual({ answered: 5, total: 6 }); // "Site" left blank
    expect(flaggedItems(def, a).map((i) => i.id)).toEqual(["filter"]);
  });
  it("points out logic and flags that no longer match an answer", () => {
    const f = normalizeForm({
      items: [
        { id: "k", type: "single_choice", label: "Kind", options: ["Home", "Office"], flagOn: ["Shed"] },
        { id: "x", type: "short_text", label: "Desk", showIf: { itemId: "k", op: "is", value: "Commercial" } },
      ],
    });
    expect(formProblems(f).map((p) => p.itemId)).toEqual(["k", "x"]);
  });
  it("problems before saving", () => {
    expect(formProblems(normalizeForm({ items: [{ type: "section", label: "S" }] }))[0]!.message).toMatch(/at least one question/);
    const f = normalizeForm({ items: [{ id: "c", type: "single_choice", label: "Pick", options: [] }] });
    expect(formProblems(f).map((p) => p.itemId)).toEqual(["c"]);
  });
});

describe("answers", () => {
  it("cleans values to the shape each question expects", () => {
    const by = (id: string) => def.items.find((i) => i.id === id)!;
    expect(cleanAnswerValue(by("filter"), "fail")).toBe("fail");
    expect(cleanAnswerValue(by("filter"), "maybe")).toBeNull();
    expect(cleanAnswerValue(by("kind"), "Commercial")).toBe("Commercial");
    expect(cleanAnswerValue(by("kind"), "Office")).toBeNull();
    expect(cleanAnswerValue(by("steps"), ["B", "Z", "A"])).toEqual(["A", "B"]);
    expect(cleanAnswerValue(by("sig"), "javascript:alert(1)")).toBeNull();
    // never an outside URL (the PDF builder and office views would load it)
    expect(cleanAnswerValue(by("sig"), "http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(cleanAnswerValue(by("sig"), "https://evil.test/pixel.png")).toBeNull();
    expect(cleanAnswerValue(by("sig"), "data:image/svg+xml;base64,PHN2Zz4=")).toBe("data:image/svg+xml;base64,PHN2Zz4=");
    expect(cleanAnswerValue(by("sig"), "/uploads/sig/a.png")).toBe("/uploads/sig/a.png");
    expect(cleanAnswerValue(by("sig"), "data:text/html;base64,AAA")).toBeNull();
    expect(cleanAnswerValue({ id: "n", type: "number", label: "n" }, "12.5")).toBe(12.5);
    expect(cleanAnswerValue({ id: "d", type: "date", label: "d" }, "2026-10-19")).toBe("2026-10-19");
    expect(cleanAnswerValue({ id: "d", type: "date", label: "d" }, "tomorrow")).toBeNull();
  });
  it("merges offline edits: the newer answer wins per question", () => {
    const stored: Answers = { a: { value: "new", at: at(30) }, b: { value: "old", at: at(0) } };
    const replay: Answers = { a: { value: "stale", at: at(10) }, b: { value: "fresh", at: at(20) }, c: { value: "x", at: at(5) } };
    expect(mergeAnswers(stored, replay)).toEqual({ a: { value: "new", at: at(30) }, b: { value: "fresh", at: at(20) }, c: { value: "x", at: at(5) } });
  });
  it("reads answers as plain text", () => {
    const by = (id: string) => def.items.find((i) => i.id === id)!;
    expect(answerText(by("filter"), { value: "fail", at: at() })).toBe("Fail");
    expect(answerText(by("steps"), { value: ["A"], at: at() })).toBe("1 of 2 done");
    expect(answerText(by("sig"), { value: "data:image/png;base64,A", name: "Pat", at: at() })).toBe("Signed by Pat");
    expect(answerText(by("rtu"), undefined)).toBe("—");
    expect(isAnswered(by("rtu"), { value: "", at: at() })).toBe(false);
  });
  it("groups items by section", () => {
    const g = sectionsOf(visibleItems(def, {}));
    expect(g.map((x) => x.section?.id ?? null)).toEqual(["s1", "s2", "s3"]);
  });
});
