/**
 * Job forms v2: every job's answers for one template as a table (the
 * "Export answers (CSV)" download, GET /api/export/form-responses).
 *
 * One row per job booked on the template (any version). Question columns are
 * keyed by question id across all of the template's versions, so a question
 * that kept its id through an edit stays one column; the header is the label
 * from the newest version that has it. Office only: internal questions are
 * included.
 */
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { tdb } from "../api/database/tenant";
import { answerText, flaggedItems, isInputItem, type Answers, type FormItem } from "../shared/forms/form-model";
import { formStatusLine } from "../shared/forms/form-results";
import { fmtInZone, namedDayBounds } from "../shared/tz";
import { companyTimeZone } from "./company-tz";
import { versionForm } from "./job-forms";

export interface FormExport {
  templateName: string;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number>[];
}

const jobNumber = (id: string) => id.replace(/-/g, "").slice(0, 8).toUpperCase();

/**
 * Answers are free text typed in the field and this file opens in Excel: a
 * leading =, +, @ (or - not starting a number) would run as a formula, so it
 * gets a leading apostrophe. "-5 °C" stays as it is.
 */
export function csvSafe(v: string): string {
  return /^[=+@\t\r]|^-(?![\d.])/.test(v) ? `'${v}` : v;
}

function parseAnswers(s: string | null | undefined): Answers {
  try {
    const v = JSON.parse(s || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Answers) : {};
  } catch {
    return {};
  }
}

/** null when the template isn't this company's. */
export async function formResponsesExport(
  companyId: string,
  templateId: string,
  range: { from?: string; to?: string } = {},
): Promise<FormExport | null> {
  const t = tdb(companyId);
  const tpl = await t.selectOne(schema.taskTemplates, eq(schema.taskTemplates.id, templateId));
  if (!tpl) return null;
  const tz = await companyTimeZone(companyId);

  const [versions, jobs] = await t.transaction(async (tx) => {
    const v = await tx
      .select()
      .from(schema.templateVersions)
      .where(t.scope(schema.templateVersions, eq(schema.templateVersions.templateId, templateId)))
      .orderBy(asc(schema.templateVersions.version));
    const j = await tx
      .select()
      .from(schema.bookings)
      .where(t.scope(schema.bookings, and(eq(schema.bookings.templateId, templateId), isNotNull(schema.bookings.templateVersionId))));
    return [v, j] as const;
  });

  // Question columns: the newest version's questions in its order, then any
  // that only older versions had (newest first). Labels from the newest.
  const forms = new Map(versions.map((v) => [v.id, versionForm(v)]));
  // Ids from old (converted) templates are positional, so a field inserted
  // later shifts them: key those by id + wording so two different questions
  // never share a column.
  const colKey = (item: FormItem) => (item.id.startsWith("lg_") ? `${item.id}|${item.label.trim().toLowerCase()}` : item.id);
  const cols = new Map<string, string>();
  for (const v of [...versions].reverse()) {
    for (const item of forms.get(v.id)!.items) {
      if (isInputItem(item) && !cols.has(colKey(item))) cols.set(colKey(item), item.label);
    }
  }

  const from = range.from ? namedDayBounds(range.from, tz).start.getTime() : -Infinity;
  const to = range.to ? namedDayBounds(range.to, tz).end.getTime() : Infinity;
  const jobDate = (b: (typeof jobs)[number]) => b.finishedAt ?? b.scheduledAt;
  const inRange = jobs
    .filter((b) => !b.isSample && !b.deletedAt && forms.has(b.templateVersionId!))
    .filter((b) => {
      const ms = new Date(jobDate(b)).getTime();
      return ms >= from && ms <= to;
    })
    .sort(
      (a, b) =>
        new Date(jobDate(a)).getTime() - new Date(jobDate(b)).getTime() ||
        new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime(),
    );

  const ids = inRange.map((b) => b.id);
  const responses = ids.length
    ? await t.select(schema.jobFormResponses, inArray(schema.jobFormResponses.bookingId, ids))
    : [];
  const riderIds = [...new Set(inRange.map((b) => b.riderId).filter((x): x is string => !!x))];
  const riders = riderIds.length ? await t.select(schema.riders, inArray(schema.riders.id, riderIds)) : [];
  const userIds = [...new Set([...inRange.map((b) => b.customerId), ...riders.map((r) => r.userId)])];
  const users = userIds.length
    ? await sdb.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, userIds))
    : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const techName = new Map(riders.map((r) => [r.id, userName.get(r.userId) ?? ""]));

  const respByJob = new Map(responses.map((r) => [`${r.bookingId}:${r.templateVersionId}`, r]));
  const rows = inRange.map((b) => {
    const form = forms.get(b.templateVersionId!)!;
    const resp = respByJob.get(`${b.id}:${b.templateVersionId}`);
    const answers = parseAnswers(resp?.answers);
    const byKey = new Map<string, FormItem>(form.items.filter(isInputItem).map((i) => [colKey(i), i]));
    const status = formStatusLine({ status: resp?.status === "complete" ? "complete" : "in_progress", missing: Array(resp?.missingCount ?? 0) as string[] });
    const row: Record<string, string | number> = {
      jobNumber: jobNumber(b.id),
      title: csvSafe(b.title),
      date: fmtInZone(jobDate(b), tz, { year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA", ""),
      technician: b.riderId ? csvSafe(techName.get(b.riderId) ?? "") : "",
      customer: csvSafe(userName.get(b.customerId) ?? ""),
      status: b.status,
      formStatus: resp ? status.text : "Not started",
      version: versions.find((v) => v.id === b.templateVersionId)?.version ?? "",
    };
    for (const key of cols.keys()) {
      const item = byKey.get(key);
      const a = item ? answers[item.id] : undefined;
      const text = item && a ? answerText(item, a) : "";
      row[`q:${key}`] = text === "—" ? "" : csvSafe(text);
    }
    row.flagged = flaggedItems(form, answers).length;
    return row;
  });

  return {
    templateName: tpl.name,
    columns: [
      { key: "jobNumber", label: "Job #" },
      { key: "title", label: "Job title" },
      { key: "date", label: "Date" },
      { key: "technician", label: "Technician" },
      { key: "customer", label: "Customer" },
      { key: "status", label: "Job status" },
      { key: "formStatus", label: "Form status" },
      { key: "version", label: "Form version" },
      ...[...cols].map(([key, label]) => ({ key: `q:${key}`, label: csvSafe(label) })),
      { key: "flagged", label: "Flagged answers" },
    ],
    rows,
  };
}
