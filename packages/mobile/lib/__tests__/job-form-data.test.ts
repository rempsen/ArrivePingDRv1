import { describe, expect, test } from "bun:test";
import { mergeAnswers, type FormDef, type FormItem } from "../forms/form-model";
import {
  base64Ascii,
  buildAnswer,
  choiceAsButtons,
  combineAnswers,
  formIncomplete,
  maskDate,
  maskTime,
  missingQuestions,
  missingSummary,
  numberHint,
  outOfRange,
  parseDateInput,
  parseNumberInput,
  parseTimeInput,
  patchBody,
  signatureStrokes,
  strokesToSignatureDataUrl,
  unbase64Ascii,
  withAnswers,
  type JobForm,
} from "../forms/job-form-data";

/**
 * The phone side of Job forms v2: what an answer looks like when it leaves
 * the phone, how queued (offline) answers stay on screen, and how the
 * server's "finish the form first" refusal is read.
 */

const T1 = "2026-10-19T14:00:00.000Z";
const T2 = "2026-10-19T14:05:00.000Z";

const items: FormItem[] = [
  { id: "s1", type: "section", label: "Arrival" },
  { id: "q_name", type: "short_text", label: "Contact on site", required: true },
  { id: "q_psi", type: "number", label: "Gas pressure", unit: "psi", min: 0, max: 15 },
  { id: "q_leak", type: "yes_no", label: "Leak found?", required: true, flagOn: ["yes"] },
  { id: "q_leak_photo", type: "photo", label: "Photo of the leak", required: true, minPhotos: 2, showIf: { itemId: "q_leak", op: "is", value: "yes" } },
  { id: "q_steps", type: "checklist", label: "Shutdown", options: ["Gas off", "Power off"], required: true },
  { id: "q_sig", type: "signature", label: "Customer signature", signer: "customer" },
];
const form: FormDef = { schema: 2, items };

function jf(answers = {}): JobForm {
  return {
    templateId: "t1",
    templateName: "Furnace service",
    version: 3,
    versionId: "v3",
    form,
    answers,
    status: "in_progress",
    missing: [],
    flagged: [],
    progress: { answered: 0, total: 0 },
    updatedAt: null,
    updatedBy: "",
  };
}
const item = (id: string) => items.find((i) => i.id === id)!;

describe("buildAnswer", () => {
  test("stamps the moment the tech answered, not the send time", () => {
    const a = buildAnswer(item("q_name"), { value: "Pat" }, new Date(T1));
    expect(a).toEqual({ value: "Pat", at: T1 });
  });

  test("cleans the value to the question's type", () => {
    expect(buildAnswer(item("q_psi"), { value: "7.5" }, T1).value).toBe(7.5);
    expect(buildAnswer(item("q_leak"), { value: "maybe" }, T1).value).toBeNull();
    // checklist keeps the form's order and drops unknown entries
    expect(buildAnswer(item("q_steps"), { value: ["Power off", "Nope", "Gas off"] }, T1).value).toEqual(["Gas off", "Power off"]);
  });

  test("a cleared answer is sent as null so the server clears it too", () => {
    expect(buildAnswer(item("q_name"), { value: null }, T1).value).toBeNull();
    expect(buildAnswer(item("q_name"), { value: "" }, T1).value).toBeNull();
  });

  test("photo answers carry the photo ids, de-duplicated and capped", () => {
    const a = buildAnswer(item("q_leak_photo"), { photoIds: ["p1", "p2", "p1"] }, T1);
    expect(a).toEqual({ value: null, photoIds: ["p1", "p2"], at: T1 });
    const capped = buildAnswer({ ...item("q_leak_photo"), maxPhotos: 1 }, { photoIds: ["p1", "p2"] }, T1);
    expect(capped.photoIds).toEqual(["p1"]);
  });

  test("signature answers carry the printed name", () => {
    const url = "data:image/svg+xml;base64,PHN2Zy8+";
    const a = buildAnswer(item("q_sig"), { value: url, name: "  Dana Lee " }, T1);
    expect(a).toEqual({ value: url, name: "Dana Lee", at: T1 });
  });
});

describe("patchBody", () => {
  test("is the PATCH /api/job-forms body, without the display-only `by`", () => {
    const body = patchBody({
      q_name: { value: "Pat", at: T1, by: "Sam" },
      q_leak_photo: { value: null, photoIds: ["p1"], at: T2 },
    });
    expect(body).toEqual({
      answers: {
        q_name: { value: "Pat", at: T1 },
        q_leak_photo: { value: null, photoIds: ["p1"], at: T2 },
      },
    });
  });
});

describe("withAnswers (optimistic + queued offline answers)", () => {
  test("recomputes progress, missing and flagged from the merged answers", () => {
    const before = withAnswers(jf(), { q_name: { value: "Pat", at: T1 } });
    expect(before.progress).toEqual({ answered: 1, total: 5 });
    expect(before.missing).toEqual(["q_leak", "q_steps"]);

    // Answering "yes" flags it AND reveals the required photo question.
    const after = withAnswers(before, { q_leak: { value: "yes", at: T2 } });
    expect(after.flagged).toEqual(["q_leak"]);
    expect(after.missing).toEqual(["q_leak_photo", "q_steps"]);
    expect(after.progress).toEqual({ answered: 2, total: 6 });
  });

  test("an older queued answer never overwrites a newer one from the server", () => {
    const server = jf({ q_name: { value: "Office fixed it", at: T2 } });
    const out = withAnswers(server, { q_name: { value: "Pat", at: T1 } });
    expect(out.answers.q_name!.value).toBe("Office fixed it");
  });

  test("no extra answers returns the same object", () => {
    const x = jf();
    expect(withAnswers(x, {})).toBe(x);
  });

  test("combineAnswers replays batches in order, newer wins per question", () => {
    const merged = combineAnswers([
      { q_name: { value: "A", at: T2 } },
      { q_name: { value: "B", at: T1 }, q_psi: { value: 3, at: T1 } },
    ]);
    expect(merged.q_name!.value).toBe("A");
    expect(merged.q_psi!.value).toBe(3);
    expect(merged).toEqual(mergeAnswers({ q_name: { value: "A", at: T2 } }, { q_psi: { value: 3, at: T1 } }));
  });
});

describe("what's missing", () => {
  test("missingQuestions lists required visible questions in form order", () => {
    expect(missingQuestions(form, {})).toEqual([
      { id: "q_name", label: "Contact on site" },
      { id: "q_leak", label: "Leak found?" },
      { id: "q_steps", label: "Shutdown" },
    ]);
    // a required checklist needs every step ticked
    expect(missingQuestions(form, { q_steps: { value: ["Gas off"], at: T1 } }).map((m) => m.id)).toContain("q_steps");
  });

  test("formIncomplete reads the server's 409 refusal", () => {
    const r = formIncomplete(409, {
      reason: "form_incomplete",
      message: "Answer the required questions first: Leak found?.",
      missing: [{ id: "q_leak", label: "Leak found?" }, { id: 5 }, null, { id: "q_x" }],
    });
    expect(r).toEqual({
      message: "Answer the required questions first: Leak found?.",
      missing: [
        { id: "q_leak", label: "Leak found?" },
        { id: "q_x", label: "Question" },
      ],
    });
  });

  test("formIncomplete ignores every other response", () => {
    expect(formIncomplete(409, { message: "Check in on site before completing this job", from: "enroute", to: "completed" })).toBeNull();
    expect(formIncomplete(400, { reason: "form_incomplete" })).toBeNull();
    expect(formIncomplete(409, null)).toBeNull();
    expect(formIncomplete(409, "nope")).toBeNull();
  });

  test("missingSummary lists a few and counts the rest", () => {
    const m = ["A", "B", "C", "D"].map((label) => ({ label }));
    expect(missingSummary(m, 2)).toBe("• A\n• B\n…and 2 more");
    expect(missingSummary(m.slice(0, 1))).toBe("• A");
  });
});

describe("inputs", () => {
  test("numbers: comma decimals, blanks clear, junk is rejected", () => {
    expect(parseNumberInput("7,5")).toEqual({ ok: true, value: 7.5 });
    expect(parseNumberInput("-3")).toEqual({ ok: true, value: -3 });
    expect(parseNumberInput(" ")).toEqual({ ok: true, value: null });
    expect(parseNumberInput("12psi").ok).toBe(false);
    expect(parseNumberInput("1.2.3").ok).toBe(false);
  });

  test("number range hint and check", () => {
    expect(numberHint(item("q_psi"))).toBe("Between 0 and 15 psi");
    expect(numberHint({ min: 5 })).toBe("At least 5");
    expect(numberHint({})).toBe("");
    expect(outOfRange(item("q_psi"), 16)).toBe(true);
    expect(outOfRange(item("q_psi"), 15)).toBe(false);
    expect(outOfRange(item("q_psi"), null)).toBe(false);
  });

  test("dates are masked as typed and must exist", () => {
    expect(maskDate("2026")).toBe("2026");
    expect(maskDate("202610")).toBe("2026-10");
    expect(maskDate("2026-10-199")).toBe("2026-10-19");
    expect(parseDateInput("2026-10-19")).toEqual({ ok: true, value: "2026-10-19" });
    expect(parseDateInput("2026-02-30").ok).toBe(false);
    expect(parseDateInput("2026-13-01").ok).toBe(false);
    expect(parseDateInput("2026-1").ok).toBe(false);
    expect(parseDateInput("")).toEqual({ ok: true, value: null });
  });

  test("times are 24-hour HH:MM", () => {
    expect(maskTime("1430")).toBe("14:30");
    expect(parseTimeInput("14:30")).toEqual({ ok: true, value: "14:30" });
    expect(parseTimeInput("24:00").ok).toBe(false);
    expect(parseTimeInput("9:30").ok).toBe(false);
  });

  test("single choice shows buttons when asked or when the list is short", () => {
    const six = ["a", "b", "c", "d", "e", "f"];
    expect(choiceAsButtons({ id: "x", type: "single_choice", label: "x", options: six, display: "buttons" })).toBe(true);
    expect(choiceAsButtons({ id: "x", type: "single_choice", label: "x", options: six, display: "dropdown" })).toBe(false);
    expect(choiceAsButtons({ id: "x", type: "single_choice", label: "x", options: ["a", "b"], display: "dropdown" })).toBe(true);
  });
});

describe("signatures", () => {
  const strokes = [
    [
      [10, 20],
      [30.04, 40.06],
      [50, 60],
    ],
    [[5, 5]], // a tap with no line is dropped
  ];

  test("base64 round-trips ASCII and matches the platform encoder", () => {
    for (const s of ["", "a", "ab", "abc", "<svg viewBox=\"0 0 1 1\"/>"]) {
      expect(base64Ascii(s)).toBe(btoa(s));
      expect(unbase64Ascii(base64Ascii(s))).toBe(s);
    }
  });

  test("strokes become an SVG data URL the form model accepts, and read back", () => {
    const url = strokesToSignatureDataUrl(strokes, 320.4, 180)!;
    expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const svg = unbase64Ascii(url.slice("data:image/svg+xml;base64,".length));
    expect(svg).toContain('viewBox="0 0 320 180"');
    expect(svg).toContain('d="M10 20 L30 40.1 L50 60"');
    expect(buildAnswer(item("q_sig"), { value: url, name: "Dana" }, T1).value).toBe(url);

    const back = signatureStrokes(url)!;
    expect(back.width).toBe(320);
    expect(back.height).toBe(180);
    expect(back.strokes).toEqual([
      [
        [10, 20],
        [30, 40.1],
        [50, 60],
      ],
    ]);
  });

  test("no ink, no signature", () => {
    expect(strokesToSignatureDataUrl([], 300, 180)).toBeNull();
    expect(strokesToSignatureDataUrl([[[1, 1]]], 300, 180)).toBeNull();
  });

  test("a huge signature is simplified to fit the size limit, or refused", () => {
    const long = [Array.from({ length: 4000 }, (_, i) => [i % 300 + 0.123, (i * 7) % 180 + 0.456])];
    const full = strokesToSignatureDataUrl(long, 300, 180, 10_000_000)!;
    const fitted = strokesToSignatureDataUrl(long, 300, 180, 60_000)!;
    expect(fitted.length).toBeLessThanOrEqual(60_000);
    expect(fitted.length).toBeLessThan(full.length);
    expect(strokesToSignatureDataUrl(long, 300, 180, 500)).toBeNull();
  });

  test("reads the server's plain (utf8) SVG too, and rejects non-SVG", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><path d="M1 2 L3 4" fill="none"/></svg>';
    expect(signatureStrokes(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`)).toEqual({
      strokes: [
        [
          [1, 2],
          [3, 4],
        ],
      ],
      width: 600,
      height: 200,
    });
    expect(signatureStrokes("data:image/png;base64,AAAA")).toBeNull();
    expect(signatureStrokes("/uploads/signatures/a.svg")).toBeNull();
  });
});
