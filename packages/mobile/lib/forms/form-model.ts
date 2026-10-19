/**
 * Job forms v2 — the one form model shared by the builder, its preview, the
 * web tech page, the phone app and the server.
 *
 * A form is a flat, ordered list of items. A "section" item starts a group
 * that runs to the next section, so dragging stays a simple list move while
 * the tech still sees collapsible groups.
 *
 * This file has NO imports on purpose: packages/mobile/lib/forms/form-model.ts
 * is a byte-identical copy (the drift test in shared/forms/__tests__ fails if
 * they differ). Edit here, then run `bun run tools/sync-form-model.ts`.
 */

export const FORM_SCHEMA = 2 as const;

export const ITEM_TYPES = [
  "section",
  "instructions",
  "short_text",
  "long_text",
  "number",
  "date",
  "time",
  "yes_no",
  "pass_fail",
  "single_choice",
  "multi_choice",
  "checklist",
  "photo",
  "signature",
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** Layout items: shown to the tech, never answered. */
export const LAYOUT_TYPES: readonly ItemType[] = ["section", "instructions"];
/** Item types that carry a list of options. */
export const OPTION_ITEM_TYPES: readonly ItemType[] = ["single_choice", "multi_choice", "checklist"];

export const ITEM_LABELS: Record<ItemType, string> = {
  section: "Section",
  instructions: "Instructions",
  short_text: "Short answer",
  long_text: "Long answer",
  number: "Number",
  date: "Date",
  time: "Time",
  yes_no: "Yes / No",
  pass_fail: "Pass / Fail",
  single_choice: "Single choice",
  multi_choice: "Multiple choice",
  checklist: "Checklist",
  photo: "Photo",
  signature: "Signature",
};

export type ShowIfOp = "is" | "is_not" | "answered" | "flagged";

export interface ShowIf {
  itemId: string;
  op: ShowIfOp;
  value?: string;
}

export interface FormItem {
  id: string;
  type: ItemType;
  label: string;
  /** Short help shown under the question (or the body of an instructions item). */
  help?: string;
  required?: boolean;
  /** single_choice / multi_choice / checklist. */
  options?: string[];
  /** single_choice only: a dropdown, or buttons for short lists. */
  display?: "dropdown" | "buttons";
  /** number only. */
  unit?: string;
  min?: number;
  max?: number;
  /** photo only. */
  minPhotos?: number;
  maxPhotos?: number;
  /** signature only. */
  signer?: "customer" | "technician";
  /** Answers that flag this question for the office (e.g. ["no"], ["fail"]). */
  flagOn?: string[];
  /** Show only when an earlier question matches. */
  showIf?: ShowIf;
  /** Office-only: left out of the customer's copy. */
  internal?: boolean;
}

export interface FormDef {
  schema: typeof FORM_SCHEMA;
  items: FormItem[];
}

export type AnswerValue = string | number | string[] | null;

export interface Answer {
  value: AnswerValue;
  /** photo items: ids of the job photos taken for this question. */
  photoIds?: string[];
  /** signature items: printed name of whoever signed. */
  name?: string;
  /** ISO timestamp the answer was given (used to merge offline edits). */
  at: string;
  /** Display name of who answered. */
  by?: string;
}

export type Answers = Record<string, Answer>;

export const LIMITS = {
  items: 200,
  options: 100,
  label: 300,
  help: 2000,
  option: 200,
  text: 5000,
  signature: 200_000,
  photos: 30,
} as const;

export const EMPTY_FORM: FormDef = { schema: FORM_SCHEMA, items: [] };

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

export function newItemId(): string {
  return `q_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : typeof v === "number" ? String(v).slice(0, max) : "";
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function isItemType(v: unknown): v is ItemType {
  return typeof v === "string" && (ITEM_TYPES as readonly string[]).includes(v);
}

export function isInputItem(item: Pick<FormItem, "type">): boolean {
  return !LAYOUT_TYPES.includes(item.type);
}

/** The default flag for a new item: a Fail is always worth a look. */
export function defaultFlagOn(type: ItemType): string[] | undefined {
  return type === "pass_fail" ? ["fail"] : undefined;
}

/** A fresh item for the builder palette, with sensible starter content. */
export function blankItem(type: ItemType): FormItem {
  const base: FormItem = { id: newItemId(), type, label: ITEM_LABELS[type] };
  switch (type) {
    case "section":
      return { ...base, label: "New section" };
    case "instructions":
      return { ...base, label: "Before you start", help: "" };
    case "single_choice":
      return { ...base, label: "Choose one", options: ["Option 1", "Option 2"], display: "buttons" };
    case "multi_choice":
      return { ...base, label: "Choose any", options: ["Option 1", "Option 2"] };
    case "checklist":
      return { ...base, label: "Checklist", options: ["First step"] };
    case "pass_fail":
      return { ...base, label: "Inspection result", flagOn: ["fail"] };
    case "yes_no":
      return { ...base, label: "Question" };
    case "photo":
      return { ...base, label: "Photo", minPhotos: 1 };
    case "signature":
      return { ...base, label: "Customer signature", signer: "customer" };
    case "number":
      return { ...base, label: "Reading" };
    default:
      return { ...base, label: type === "long_text" ? "Notes" : "Question" };
  }
}

/* ------------------------------------------------------------------ */
/* normalise                                                           */
/* ------------------------------------------------------------------ */

function normOptions(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of v) {
    const s = str(o, LIMITS.option).trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= LIMITS.options) break;
  }
  return out;
}

/**
 * Clean up anything that claims to be a form: unknown types dropped, text
 * bounded, ids made unique, and "show only if" rules that point at a missing
 * or later question removed (logic can only look back, so it can't loop).
 */
export function normalizeForm(input: unknown): FormDef {
  const raw = input && typeof input === "object" ? (input as { items?: unknown }).items : undefined;
  const list = Array.isArray(raw) ? raw : Array.isArray(input) ? input : [];
  const items: FormItem[] = [];
  const ids = new Set<string>();
  for (const r of list) {
    if (items.length >= LIMITS.items) break;
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (!isItemType(o.type)) continue;
    let id = str(o.id, 64).replace(/[^A-Za-z0-9_-]/g, "");
    if (!id || ids.has(id)) id = newItemId();
    ids.add(id);
    const type = o.type;
    const item: FormItem = { id, type, label: str(o.label, LIMITS.label).trim() || ITEM_LABELS[type] };
    const help = str(o.help, LIMITS.help).trim();
    if (help) item.help = help;
    if (o.required === true && isInputItem(item)) item.required = true;
    if (o.internal === true) item.internal = true;
    if (OPTION_ITEM_TYPES.includes(type)) item.options = normOptions(o.options);
    if (type === "single_choice") item.display = o.display === "dropdown" ? "dropdown" : "buttons";
    if (type === "number") {
      const unit = str(o.unit, 20).trim();
      if (unit) item.unit = unit;
      const min = num(o.min);
      const max = num(o.max);
      if (min !== undefined) item.min = min;
      if (max !== undefined && (min === undefined || max >= min)) item.max = max;
    }
    if (type === "photo") {
      const minP = Math.max(0, Math.min(LIMITS.photos, Math.round(num(o.minPhotos) ?? 0)));
      const maxP = Math.round(num(o.maxPhotos) ?? 0);
      if (minP) item.minPhotos = minP;
      if (maxP > 0) item.maxPhotos = Math.max(minP || 1, Math.min(LIMITS.photos, maxP));
    }
    if (type === "signature") item.signer = o.signer === "technician" ? "technician" : "customer";
    if (Array.isArray(o.flagOn) && isInputItem(item)) {
      const f = normOptions(o.flagOn);
      if (f.length) item.flagOn = f;
    }
    if (o.showIf && typeof o.showIf === "object") {
      const s = o.showIf as Record<string, unknown>;
      const op = s.op;
      if (
        typeof s.itemId === "string" &&
        (op === "is" || op === "is_not" || op === "answered" || op === "flagged")
      ) {
        item.showIf = { itemId: s.itemId, op };
        if ((op === "is" || op === "is_not") && s.value !== undefined) item.showIf.value = str(s.value, LIMITS.option);
      }
    }
    items.push(item);
  }
  // Logic only looks back, and only at answerable questions.
  const seenInputs = new Set<string>();
  for (const item of items) {
    if (item.showIf && !seenInputs.has(item.showIf.itemId)) delete item.showIf;
    if (isInputItem(item)) seenInputs.add(item.id);
  }
  return { schema: FORM_SCHEMA, items };
}

/** Problems the builder should point at before saving (empty when fine). */
export function formProblems(def: FormDef): { itemId?: string; message: string }[] {
  const out: { itemId?: string; message: string }[] = [];
  if (!def.items.some(isInputItem)) out.push({ message: "Add at least one question" });
  for (const it of def.items) {
    if (OPTION_ITEM_TYPES.includes(it.type) && !(it.options ?? []).some((o) => o.trim())) {
      out.push({ itemId: it.id, message: `"${it.label}" needs at least one ${it.type === "checklist" ? "item" : "choice"}` });
    }
    if (it.showIf && (it.showIf.op === "is" || it.showIf.op === "is_not") && !it.showIf.value) {
      out.push({ itemId: it.id, message: `"${it.label}" has a "show only if" rule with no answer picked` });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* legacy (schema 1) templates                                         */
/* ------------------------------------------------------------------ */

/**
 * Convert the old builder output (`fields` + separate `checklist`) into a
 * form. Ids are deterministic (`lg_<n>`) so a template that hasn't been
 * re-saved still has stable question ids.
 */
export function fromLegacy(fields: unknown, checklist?: unknown): FormDef {
  const items: FormItem[] = [];
  const f = Array.isArray(fields) ? fields : [];
  f.forEach((r, i) => {
    if (!r || typeof r !== "object") return;
    const o = r as Record<string, unknown>;
    const label = str(o.label, LIMITS.label).trim() || "Question";
    const required = o.required === true;
    const id = `lg_${i}`;
    const options = normOptions(o.options);
    switch (o.type) {
      case "text":
        items.push({ id, type: "short_text", label, required });
        break;
      case "textarea":
      case "notes":
        items.push({ id, type: "long_text", label, required });
        break;
      case "number":
        items.push({ id, type: "number", label, required });
        break;
      case "date":
        items.push({ id, type: "date", label, required });
        break;
      case "select":
        items.push({ id, type: "single_choice", label, required, options, display: "dropdown" });
        break;
      case "checkbox":
        items.push({ id, type: "checklist", label, required, options: options.length ? options : [label] });
        break;
      case "photo":
      case "file":
        items.push({ id, type: "photo", label, required, minPhotos: required ? 1 : undefined });
        break;
      case "signature":
        items.push({ id, type: "signature", label, required, signer: "customer" });
        break;
      case "instructions":
        items.push({ id, type: "instructions", label, help: str(o.help ?? o.placeholder, LIMITS.help) });
        break;
      default:
        break;
    }
  });
  const c = Array.isArray(checklist) ? checklist : [];
  const labels = normOptions(c.map((x) => (x && typeof x === "object" ? (x as { label?: unknown }).label : x)));
  if (labels.length) {
    const anyRequired = c.some((x) => x && typeof x === "object" && (x as { required?: unknown }).required === true);
    items.push({ id: "lg_checklist", type: "checklist", label: "Checklist", options: labels, required: anyRequired });
  }
  return normalizeForm({ items: items.map((it) => (it.required ? it : { ...it, required: undefined })) });
}

/** The form a template row carries: schema 2 if saved by the new builder, else converted. */
export function templateForm(t: { form?: string | null; fields?: string | null; checklist?: string | null }): FormDef {
  if (t.form) {
    try {
      const parsed = JSON.parse(t.form);
      if (parsed && parsed.schema === FORM_SCHEMA) return normalizeForm(parsed);
    } catch {
      /* fall through to legacy */
    }
  }
  let fields: unknown = [];
  let checklist: unknown = [];
  try {
    fields = JSON.parse(t.fields || "[]");
  } catch {
    /* empty */
  }
  try {
    checklist = JSON.parse(t.checklist || "[]");
  } catch {
    /* empty */
  }
  return fromLegacy(fields, checklist);
}

/* ------------------------------------------------------------------ */
/* answers                                                             */
/* ------------------------------------------------------------------ */

/** Coerce an incoming answer value to the shape its question expects (null = cleared). */
export function cleanAnswerValue(item: FormItem, v: unknown): AnswerValue {
  if (v === null || v === undefined || v === "") return null;
  switch (item.type) {
    case "short_text":
    case "long_text":
      return str(v, LIMITS.text) || null;
    case "number": {
      const n = num(v);
      return n === undefined ? null : n;
    }
    case "date":
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    case "time":
      return typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : null;
    case "yes_no":
      return v === "yes" || v === "no" ? v : null;
    case "pass_fail":
      return v === "pass" || v === "fail" || v === "na" ? v : null;
    case "single_choice":
      return typeof v === "string" && (item.options ?? []).includes(v) ? v : null;
    case "multi_choice":
    case "checklist": {
      if (!Array.isArray(v)) return null;
      const opts = item.options ?? [];
      const picked = opts.filter((o) => v.includes(o));
      return picked.length ? picked : null;
    }
    case "signature":
      return typeof v === "string" && v.length <= LIMITS.signature && /^(data:image\/|https?:\/\/|\/uploads\/)/.test(v) ? v : null;
    case "photo":
      return null;
    default:
      return null;
  }
}

export function isAnswered(item: FormItem, a: Answer | undefined): boolean {
  if (!a) return false;
  if (item.type === "photo") return (a.photoIds?.length ?? 0) >= Math.max(1, item.minPhotos ?? 0);
  if (item.type === "checklist") {
    const ticked = Array.isArray(a.value) ? a.value.length : 0;
    // A required checklist means every item ticked.
    return item.required ? ticked >= (item.options?.length ?? 0) && ticked > 0 : ticked > 0;
  }
  if (Array.isArray(a.value)) return a.value.length > 0;
  return a.value !== null && a.value !== "";
}

export function isFlagged(item: FormItem, a: Answer | undefined): boolean {
  if (!a || !item.flagOn?.length) return false;
  const v = a.value;
  if (Array.isArray(v)) return v.some((x) => item.flagOn!.includes(x));
  return v !== null && item.flagOn.includes(String(v));
}

function conditionMet(def: FormDef, s: ShowIf, answers: Answers, visible: Set<string>): boolean {
  const target = def.items.find((i) => i.id === s.itemId);
  if (!target || !visible.has(target.id)) return false;
  const a = answers[target.id];
  switch (s.op) {
    case "answered":
      return isAnswered(target, a);
    case "flagged":
      return isFlagged(target, a);
    case "is":
    case "is_not": {
      const v = a?.value;
      const hit = Array.isArray(v) ? v.includes(s.value ?? "") : v !== null && v !== undefined && String(v) === s.value;
      return s.op === "is" ? hit : isAnswered(target, a) && !hit;
    }
    default:
      return true;
  }
}

/** The items the tech should see right now, given the answers so far. */
export function visibleItems(def: FormDef, answers: Answers): FormItem[] {
  const out: FormItem[] = [];
  const visible = new Set<string>();
  let sectionShown = true;
  for (const item of def.items) {
    const own = item.showIf ? conditionMet(def, item.showIf, answers, visible) : true;
    if (item.type === "section") {
      sectionShown = own;
      if (sectionShown) {
        out.push(item);
        visible.add(item.id);
      }
      continue;
    }
    if (sectionShown && own) {
      out.push(item);
      visible.add(item.id);
    }
  }
  return out;
}

/** Required questions still to answer (only the ones currently shown). */
export function missingRequired(def: FormDef, answers: Answers): FormItem[] {
  return visibleItems(def, answers).filter((i) => isInputItem(i) && i.required && !isAnswered(i, answers[i.id]));
}

export function flaggedItems(def: FormDef, answers: Answers): FormItem[] {
  return visibleItems(def, answers).filter((i) => isFlagged(i, answers[i.id]));
}

export function progress(def: FormDef, answers: Answers): { answered: number; total: number } {
  const inputs = visibleItems(def, answers).filter(isInputItem);
  return { answered: inputs.filter((i) => isAnswered(i, answers[i.id])).length, total: inputs.length };
}

/**
 * Merge answers that arrive (possibly late, from an offline phone) into what
 * is stored: per question, the newer `at` wins, so a stale replay never
 * overwrites a fresher answer.
 */
export function mergeAnswers(stored: Answers, incoming: Answers): Answers {
  const out: Answers = { ...stored };
  for (const [id, a] of Object.entries(incoming)) {
    const prev = out[id];
    if (!prev || Date.parse(a.at) >= Date.parse(prev.at)) out[id] = a;
  }
  return out;
}

/** One line of plain text for an answer, for reports, PDFs and emails. */
export function answerText(item: FormItem, a: Answer | undefined): string {
  if (!a || !isAnswered(item, a)) {
    if (item.type === "checklist" && a && Array.isArray(a.value) && a.value.length) {
      return `${a.value.length} of ${item.options?.length ?? 0} done`;
    }
    return "—";
  }
  const v = a.value;
  switch (item.type) {
    case "yes_no":
      return v === "yes" ? "Yes" : "No";
    case "pass_fail":
      return v === "pass" ? "Pass" : v === "fail" ? "Fail" : "N/A";
    case "number":
      return `${v}${item.unit ? ` ${item.unit}` : ""}`;
    case "checklist":
      return `${(v as string[]).length} of ${item.options?.length ?? 0} done`;
    case "multi_choice":
      return (v as string[]).join(", ");
    case "photo":
      return `${a.photoIds?.length ?? 0} photo${(a.photoIds?.length ?? 0) === 1 ? "" : "s"}`;
    case "signature":
      return a.name ? `Signed by ${a.name}` : "Signed";
    default:
      return String(v);
  }
}

/** Group visible items under their sections (a leading group has no section). */
export function sectionsOf(items: FormItem[]): { section: FormItem | null; items: FormItem[] }[] {
  const groups: { section: FormItem | null; items: FormItem[] }[] = [];
  let cur: { section: FormItem | null; items: FormItem[] } = { section: null, items: [] };
  for (const it of items) {
    if (it.type === "section") {
      if (cur.section || cur.items.length) groups.push(cur);
      cur = { section: it, items: [] };
    } else cur.items.push(it);
  }
  if (cur.section || cur.items.length) groups.push(cur);
  return groups;
}

/** How many answerable questions a form has (for cards and lists). */
export function questionCount(def: FormDef): number {
  return def.items.filter(isInputItem).length;
}
