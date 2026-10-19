/**
 * Job forms v2 on the phone: the pure bits (no React Native, no network), so
 * they can be unit tested with `bun test`.
 *
 *  - building the answer a tech just gave (stamped with WHEN they gave it, so
 *    a mutation queued offline replays safely: the server keeps the newer
 *    answer per question)
 *  - folding not-yet-acknowledged answers over what the server sent
 *  - reading the server's 409 "form_incomplete" refusal
 *  - turning signature strokes into the data URL the form stores, and back
 *  - the small parsers behind the number / date / time inputs
 *
 * The form model itself lives in ./form-model.ts (a generated mirror of the
 * web copy — never edit it here).
 */
import {
  LIMITS,
  cleanAnswerValue,
  flaggedItems,
  mergeAnswers,
  missingRequired,
  progress,
  type Answer,
  type AnswerValue,
  type Answers,
  type FormDef,
  type FormItem,
} from "./form-model";

/** GET /api/job-forms/:bookingId → { form: JobForm | null } (mirrors services/job-forms.ts). */
export interface JobForm {
  templateId: string | null;
  templateName: string;
  version: number;
  versionId: string;
  form: FormDef;
  answers: Answers;
  status: "in_progress" | "complete";
  missing: string[];
  flagged: string[];
  progress: { answered: number; total: number };
  updatedAt: string | null;
  updatedBy: string;
}

export interface AnswerInput {
  value?: AnswerValue;
  photoIds?: string[];
  name?: string;
}

/** What the PATCH body carries for one question. */
export interface AnswerPatch {
  value: AnswerValue;
  photoIds?: string[];
  name?: string;
  at: string;
}

/**
 * The answer the tech just gave, cleaned to the question's type and stamped
 * with `at` — pass the moment of the tap/keystroke, NOT the send time.
 */
export function buildAnswer(item: FormItem, input: AnswerInput, at: Date | string = new Date()): Answer {
  const iso = typeof at === "string" ? at : at.toISOString();
  if (item.type === "photo") {
    const ids = [...new Set((input.photoIds ?? []).filter((p) => typeof p === "string" && p))];
    return { value: null, photoIds: ids.slice(0, item.maxPhotos ?? LIMITS.photos), at: iso };
  }
  const a: Answer = { value: cleanAnswerValue(item, input.value), at: iso };
  if (item.type === "signature") {
    const name = (input.name ?? "").trim().slice(0, 120);
    if (name) a.name = name;
  }
  return a;
}

/** PATCH /api/job-forms/:bookingId body for a set of answers (drops the display-only `by`). */
export function patchBody(answers: Answers): { answers: Record<string, AnswerPatch> } {
  const out: Record<string, AnswerPatch> = {};
  for (const [id, a] of Object.entries(answers)) {
    const p: AnswerPatch = { value: a.value ?? null, at: a.at };
    if (a.photoIds) p.photoIds = a.photoIds;
    if (a.name !== undefined) p.name = a.name;
    out[id] = p;
  }
  return { answers: out };
}

/** Merge several batches of answers in order (newer `at` wins per question). */
export function combineAnswers(batches: Answers[]): Answers {
  return batches.reduce<Answers>((acc, b) => mergeAnswers(acc, b), {});
}

/**
 * The job form with extra answers folded in, and everything derived from the
 * answers (missing, flagged, progress) recomputed — used for the optimistic
 * update and to keep queued offline answers on screen across refetches.
 */
export function withAnswers(jf: JobForm, incoming: Answers): JobForm {
  if (!Object.keys(incoming).length) return jf;
  const answers = mergeAnswers(jf.answers, incoming);
  return {
    ...jf,
    answers,
    missing: missingRequired(jf.form, answers).map((i) => i.id),
    flagged: flaggedItems(jf.form, answers).map((i) => i.id),
    progress: progress(jf.form, answers),
  };
}

export interface MissingQuestion {
  id: string;
  label: string;
}

/** Required questions still unanswered, in form order. */
export function missingQuestions(form: FormDef, answers: Answers): MissingQuestion[] {
  return missingRequired(form, answers).map((i) => ({ id: i.id, label: i.label }));
}

/**
 * The server's refusal to complete a job whose form isn't finished:
 * 409 { reason: "form_incomplete", missing: [{id,label}], message }.
 * Returns null for any other response.
 */
export function formIncomplete(status: number, body: unknown): { message: string; missing: MissingQuestion[] } | null {
  if (status !== 409 || !body || typeof body !== "object") return null;
  const b = body as { reason?: unknown; missing?: unknown; message?: unknown };
  if (b.reason !== "form_incomplete") return null;
  const missing = Array.isArray(b.missing)
    ? b.missing
        .filter((m): m is { id: unknown; label?: unknown } => !!m && typeof m === "object" && "id" in m)
        .filter((m) => typeof m.id === "string")
        .map((m) => ({ id: m.id as string, label: typeof m.label === "string" && m.label ? m.label : "Question" }))
    : [];
  return {
    message: typeof b.message === "string" && b.message ? b.message : "Answer the required questions first.",
    missing,
  };
}

/** "• Label\n• Label\n…and 3 more" for an alert. */
export function missingSummary(missing: { label: string }[], max = 6): string {
  const shown = missing.slice(0, max).map((m) => `• ${m.label}`);
  if (missing.length > max) shown.push(`…and ${missing.length - max} more`);
  return shown.join("\n");
}

/** single_choice renders as buttons when asked to, or when the list is short. */
export function choiceAsButtons(item: FormItem): boolean {
  return item.display === "buttons" || (item.options?.length ?? 0) <= 5;
}

/* ------------------------------------------------------------------ */
/* number / date / time inputs                                          */
/* ------------------------------------------------------------------ */

export type Parsed<T> = { ok: true; value: T | null } | { ok: false; error: string };

/** Typed text → number (empty clears it). Accepts a comma decimal separator. */
export function parseNumberInput(text: string): Parsed<number> {
  const t = text.trim().replace(",", ".");
  if (!t) return { ok: true, value: null };
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return { ok: false, error: "Enter a number" };
  const n = Number(t);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: "Enter a number" };
}

/** "Between 0 and 120 psi" / "At least 5 V" / "" — the min/max hint under a number. */
export function numberHint(item: Pick<FormItem, "min" | "max" | "unit">): string {
  const u = item.unit ? ` ${item.unit}` : "";
  if (item.min !== undefined && item.max !== undefined) return `Between ${item.min} and ${item.max}${u}`;
  if (item.min !== undefined) return `At least ${item.min}${u}`;
  if (item.max !== undefined) return `At most ${item.max}${u}`;
  return "";
}

export function outOfRange(item: Pick<FormItem, "min" | "max">, n: number | null): boolean {
  if (n === null) return false;
  return (item.min !== undefined && n < item.min) || (item.max !== undefined && n > item.max);
}

/** Keep digits only and insert the dashes as the tech types: "20261019" → "2026-10-19". */
export function maskDate(text: string): string {
  const d = text.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
}

/** "1430" → "14:30". */
export function maskTime(text: string): string {
  const d = text.replace(/\D/g, "").slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}:${d.slice(2)}`;
}

/** A real calendar date as YYYY-MM-DD (no 2026-02-30). */
export function parseDateInput(text: string): Parsed<string> {
  const t = text.trim();
  if (!t) return { ok: true, value: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return { ok: false, error: "Use YYYY-MM-DD" };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (mo < 1 || mo > 12 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return { ok: false, error: "That date doesn't exist" };
  }
  return { ok: true, value: t };
}

/** 24-hour HH:MM. */
export function parseTimeInput(text: string): Parsed<string> {
  const t = text.trim();
  if (!t) return { ok: true, value: null };
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return { ok: false, error: "Use HH:MM (24-hour)" };
  if (Number(m[1]) > 23 || Number(m[2]) > 59) return { ok: false, error: "That time doesn't exist" };
  return { ok: true, value: t };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** Today's date on the phone's clock, as YYYY-MM-DD. */
export function todayLocal(now = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}
/** The phone's current time, as HH:MM. */
export function nowLocal(now = new Date()): string {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

/* ------------------------------------------------------------------ */
/* signatures                                                           */
/* ------------------------------------------------------------------ */

export type Stroke = number[][];

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 of an ASCII string (no reliance on a global btoa). */
export function base64Ascii(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i += 3) {
    const a = s.charCodeAt(i) & 0xff;
    const b = i + 1 < s.length ? s.charCodeAt(i + 1) & 0xff : NaN;
    const c = i + 2 < s.length ? s.charCodeAt(i + 2) & 0xff : NaN;
    const n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += Number.isNaN(b) ? "=" : B64[(n >> 6) & 63]!;
    out += Number.isNaN(c) ? "=" : B64[n & 63]!;
  }
  return out;
}

export function unbase64Ascii(s: string): string {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  let out = "";
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]!) << 18) |
      (B64.indexOf(clean[i + 1] ?? "A") << 12) |
      ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]!) : 0) << 6) |
      (i + 3 < clean.length ? B64.indexOf(clean[i + 3]!) : 0);
    out += String.fromCharCode((n >> 16) & 0xff);
    if (i + 2 < clean.length) out += String.fromCharCode((n >> 8) & 0xff);
    if (i + 3 < clean.length) out += String.fromCharCode(n & 0xff);
  }
  return out;
}

function svgFor(strokes: Stroke[], w: number, h: number, decimals: number, every: number): string {
  const f = 10 ** decimals;
  const r = (v: number) => Math.round(v * f) / f;
  const paths = strokes
    .filter((s) => s.length > 1)
    .map((s) => {
      // keep both ends, thin the middle
      const pts = s.filter((_, i) => i === 0 || i === s.length - 1 || i % every === 0);
      const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${r(p[0] ?? 0)} ${r(p[1] ?? 0)}`).join(" ");
      return `<path d="${d}" fill="none" stroke="#0f172a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join("");
  // Same drawing the server renders for the job-level sign-off.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<rect width="100%" height="100%" fill="#ffffff"/>${paths}</svg>`
  );
}

/**
 * Signature pad strokes → `data:image/svg+xml;base64,…` within the form's
 * size limit (detail is reduced if needed). Null when there's no ink or it
 * can't be made small enough.
 */
export function strokesToSignatureDataUrl(strokes: Stroke[], width: number, height: number, limit: number = LIMITS.signature): string | null {
  if (!strokes.some((s) => s.length > 1)) return null;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  for (const [decimals, every] of [[1, 1], [0, 1], [0, 2], [0, 3], [0, 5]] as const) {
    const url = `data:image/svg+xml;base64,${base64Ascii(svgFor(strokes, w, h, decimals, every))}`;
    if (url.length <= limit) return url;
  }
  return null;
}

/**
 * Read strokes back out of a signature SVG (ours or the server's), so the
 * app can draw a preview without an SVG renderer. Null if it isn't one.
 */
export function signatureStrokes(src: string): { strokes: Stroke[]; width: number; height: number } | null {
  let svg = "";
  const b64 = /^data:image\/svg\+xml;base64,(.*)$/s.exec(src);
  const raw = /^data:image\/svg\+xml(?:;charset=[^,;]+)?(?:;utf8)?,(.*)$/s.exec(src);
  try {
    if (b64) svg = unbase64Ascii(b64[1]!);
    else if (raw) svg = decodeURIComponent(raw[1]!);
    else return null;
  } catch {
    return null;
  }
  const vb = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/.exec(svg);
  const width = vb ? Number(vb[1]) : 600;
  const height = vb ? Number(vb[2]) : 200;
  const strokes: Stroke[] = [];
  for (const m of svg.matchAll(/<path[^>]*\sd="([^"]*)"/g)) {
    const nums = (m[1]!.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    const pts: number[][] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i]!, nums[i + 1]!]);
    if (pts.length > 1) strokes.push(pts);
  }
  if (!strokes.length) return null;
  return { strokes, width, height };
}
