/**
 * Job forms v2 — reading a filled form back: the office's work order and job
 * report, the job PDF, the customer's emailed copy and the CSV export all show
 * the same thing, built here once.
 *
 * Audience matters: "office" sees everything, including office-only
 * (`internal`) questions and flags. "customer" never gets an internal
 * question, nor anything inside an internal section, nor flags.
 */
import {
  answerText,
  isAnswered,
  isFlagged,
  isInputItem,
  sectionsOf,
  visibleItems,
  type Answer,
  type Answers,
  type FormDef,
  type FormItem,
} from "./form-model";

export type FormAudience = "office" | "customer";

/** The parts of a job's form (services/job-forms.ts JobForm) the results need. */
export interface JobFormView {
  templateName: string;
  version: number;
  form: FormDef;
  answers: Answers;
  status: "in_progress" | "complete";
  missing: string[];
  flagged: string[];
  progress: { answered: number; total: number };
  updatedAt: string | null;
  updatedBy: string;
}

export interface ResultRow {
  item: FormItem;
  answer: Answer | undefined;
  /** One line of plain text (answerText), "—" when unanswered. */
  text: string;
  answered: boolean;
  /** Office only: always false for the customer audience. */
  flagged: boolean;
  /** Required, shown, and not answered. */
  missing: boolean;
  /** Office-only question (itself, or its section). */
  internal: boolean;
  photoIds: string[];
}

export interface ResultGroup {
  section: FormItem | null;
  internal: boolean;
  rows: ResultRow[];
}

/**
 * The answered-or-answerable questions the audience may see, grouped under
 * their sections. Instructions are left out (nothing to answer), and so are
 * questions hidden by "show only if" logic.
 */
export function formResults(f: Pick<JobFormView, "form" | "answers">, audience: FormAudience): ResultGroup[] {
  const groups: ResultGroup[] = [];
  for (const g of sectionsOf(visibleItems(f.form, f.answers))) {
    const sectionInternal = g.section?.internal === true;
    if (audience === "customer" && sectionInternal) continue;
    const rows: ResultRow[] = [];
    for (const item of g.items) {
      if (!isInputItem(item)) continue;
      const internal = sectionInternal || item.internal === true;
      if (audience === "customer" && internal) continue;
      const answer = f.answers[item.id];
      const answered = isAnswered(item, answer);
      rows.push({
        item,
        answer,
        text: answerText(item, answer),
        answered,
        flagged: audience === "office" && isFlagged(item, answer),
        missing: item.required === true && !answered,
        internal,
        photoIds: item.type === "photo" ? (answer?.photoIds ?? []) : [],
      });
    }
    if (rows.length) groups.push({ section: g.section, internal: sectionInternal, rows });
  }
  return groups;
}

/** "12 of 14 answered", counted over what this audience sees. */
export function resultsProgress(groups: ResultGroup[]): { answered: number; total: number } {
  let answered = 0;
  let total = 0;
  for (const g of groups) {
    for (const r of g.rows) {
      total++;
      if (r.answered) answered++;
    }
  }
  return { answered, total };
}

/** Plain-words status for the office: complete, in progress, or completed with gaps. */
export function formStatusLine(f: Pick<JobFormView, "status" | "missing">): { tone: "ok" | "warn" | "pending"; text: string } {
  const n = f.missing.length;
  if (f.status === "complete" && n > 0)
    return { tone: "warn", text: `Completed with ${n} required question${n === 1 ? "" : "s"} missing` };
  if (f.status === "complete") return { tone: "ok", text: "Complete" };
  return { tone: "pending", text: "In progress" };
}

/** Is a signature answer an image the PDF can embed? (PNG or JPEG data URL.) */
export function signatureImageKind(value: unknown): "png" | "jpg" | null {
  if (typeof value !== "string") return null;
  if (/^data:image\/png;base64,/i.test(value)) return "png";
  if (/^data:image\/jpe?g;base64,/i.test(value)) return "jpg";
  return null;
}
