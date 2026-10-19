/**
 * Job forms v2: template versions and the forms technicians fill in on a job.
 *
 *  - A template's questions, prices and pay are published as an immutable
 *    version every time they change. A job is booked against the current
 *    version and keeps it, whatever happens to the template afterwards.
 *  - A job's answers live in job_form_responses (one row per job + version),
 *    merged per question by timestamp so offline phones replay safely.
 *
 * Every read and write goes through tdb(companyId).
 */
import { and, desc, eq, sql } from "drizzle-orm";
import * as schema from "../api/database/schema";
import { tdb, type Executor } from "../api/database/tenant";
import {
  cleanAnswerValue,
  flaggedItems,
  isInputItem,
  mergeAnswers,
  missingRequired,
  normalizeForm,
  progress,
  templateForm,
  type Answer,
  type Answers,
  type FormDef,
  type FormItem,
} from "../shared/forms/form-model";

type Template = typeof schema.taskTemplates.$inferSelect;
type Version = typeof schema.templateVersions.$inferSelect;
type Booking = typeof schema.bookings.$inferSelect;
type Response = typeof schema.jobFormResponses.$inferSelect;

export function versionForm(v: Pick<Version, "form">): FormDef {
  try {
    return normalizeForm(JSON.parse(v.form || "{}"));
  } catch {
    return normalizeForm({ items: [] });
  }
}

/** What a version captures from a template (compared to decide whether to publish). */
function snapshotOf(t: Template) {
  return {
    name: t.name,
    form: JSON.stringify(templateForm(t)),
    rateModel: t.rateModel ?? "",
    techPayModel: t.techPayModel ?? "",
    collectPayment: t.collectPayment ?? "",
  };
}

const sameSnapshot = (a: ReturnType<typeof snapshotOf>, b: Pick<Version, "name" | "form" | "rateModel" | "techPayModel" | "collectPayment">) =>
  a.name === b.name && a.form === b.form && a.rateModel === b.rateModel && a.techPayModel === b.techPayModel && a.collectPayment === b.collectPayment;

async function latestVersion(companyId: string, templateId: string): Promise<Version | undefined> {
  const t = tdb(companyId);
  return t.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.templateVersions)
      .where(t.scope(schema.templateVersions, eq(schema.templateVersions.templateId, templateId)))
      .orderBy(desc(schema.templateVersions.version))
      .limit(1);
    return rows[0];
  });
}

/**
 * Publish the template's current state as a new version when it differs from
 * the latest one, and point the template at it. Returns the current version.
 */
export async function publishVersion(companyId: string, templateId: string, actor = ""): Promise<Version | null> {
  const t = tdb(companyId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const tpl = await t.selectOne(schema.taskTemplates, eq(schema.taskTemplates.id, templateId));
    if (!tpl) return null;
    const snap = snapshotOf(tpl);
    const latest = await latestVersion(companyId, templateId);
    if (latest && sameSnapshot(snap, latest)) {
      if (tpl.currentVersionId !== latest.id) {
        await t.update(schema.taskTemplates, { currentVersionId: latest.id }, eq(schema.taskTemplates.id, templateId));
      }
      return latest;
    }
    try {
      const [v] = await t.insert(schema.templateVersions, {
        templateId,
        version: (latest?.version ?? 0) + 1,
        ...snap,
        createdBy: actor,
      });
      await t.update(schema.taskTemplates, { currentVersionId: v!.id }, eq(schema.taskTemplates.id, templateId));
      return v!;
    } catch (e) {
      // Two saves raced for the same version number: re-read and try again.
      if (attempt === 2) throw e;
    }
  }
  return null;
}

/** The version new jobs from this template are booked against (published lazily). */
export async function currentVersion(companyId: string, templateId: string): Promise<Version | null> {
  const t = tdb(companyId);
  const tpl = await t.selectOne(schema.taskTemplates, eq(schema.taskTemplates.id, templateId));
  if (!tpl) return null;
  if (tpl.currentVersionId) {
    const v = await t.selectOne(schema.templateVersions, eq(schema.templateVersions.id, tpl.currentVersionId));
    if (v) return v;
  }
  return publishVersion(companyId, templateId);
}

export async function listVersions(companyId: string, templateId: string) {
  const t = tdb(companyId);
  return t.transaction((tx) =>
    tx
      .select({
        id: schema.templateVersions.id,
        version: schema.templateVersions.version,
        name: schema.templateVersions.name,
        createdBy: schema.templateVersions.createdBy,
        createdAt: schema.templateVersions.createdAt,
      })
      .from(schema.templateVersions)
      .where(t.scope(schema.templateVersions, eq(schema.templateVersions.templateId, templateId)))
      .orderBy(desc(schema.templateVersions.version)),
  );
}

/** Jobs booked from each template, and its latest version number. */
export async function templateStats(companyId: string): Promise<Map<string, { jobs: number; version: number }>> {
  const t = tdb(companyId);
  const out = new Map<string, { jobs: number; version: number }>();
  const [jobs, versions] = await t.transaction(async (tx) => {
    const j = await tx
      .select({ id: schema.bookings.templateId, n: sql<number>`count(*)::int` })
      .from(schema.bookings)
      .where(t.scope(schema.bookings, sql`${schema.bookings.templateId} is not null`))
      .groupBy(schema.bookings.templateId);
    const v = await tx
      .select({ id: schema.templateVersions.templateId, n: sql<number>`max(${schema.templateVersions.version})::int` })
      .from(schema.templateVersions)
      .where(t.scope(schema.templateVersions))
      .groupBy(schema.templateVersions.templateId);
    return [j, v] as const;
  });
  for (const r of jobs) if (r.id) out.set(r.id, { jobs: Number(r.n) || 0, version: 0 });
  for (const r of versions) {
    const cur = out.get(r.id) ?? { jobs: 0, version: 0 };
    cur.version = Number(r.n) || 0;
    out.set(r.id, cur);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* a job's form                                                        */
/* ------------------------------------------------------------------ */

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

function parseAnswers(s: string | null | undefined): Answers {
  try {
    const v = JSON.parse(s || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Answers) : {};
  } catch {
    return {};
  }
}

function shape(v: Version, r: Response | undefined): JobForm {
  const form = versionForm(v);
  const answers = parseAnswers(r?.answers);
  return {
    templateId: v.templateId,
    templateName: v.name,
    version: v.version,
    versionId: v.id,
    form,
    answers,
    status: r?.status === "complete" ? "complete" : "in_progress",
    missing: missingRequired(form, answers).map((i) => i.id),
    flagged: flaggedItems(form, answers).map((i) => i.id),
    progress: progress(form, answers),
    updatedAt: r?.updatedAt ? r.updatedAt.toISOString() : null,
    updatedBy: r?.updatedBy ?? "",
  };
}

/** The form for a job, or null when the job wasn't booked on Job forms v2. */
export async function jobForm(companyId: string, b: Pick<Booking, "id" | "templateVersionId">): Promise<JobForm | null> {
  if (!b.templateVersionId) return null;
  const t = tdb(companyId);
  const v = await t.selectOne(schema.templateVersions, eq(schema.templateVersions.id, b.templateVersionId));
  if (!v) return null;
  const r = await t.selectOne(
    schema.jobFormResponses,
    and(eq(schema.jobFormResponses.bookingId, b.id), eq(schema.jobFormResponses.templateVersionId, v.id)),
  );
  return shape(v, r);
}

export class FormInputError extends Error {}

export interface IncomingAnswer {
  value?: unknown;
  photoIds?: unknown;
  name?: unknown;
  at?: unknown;
}

/**
 * Save answers to a job's form. Unknown questions are rejected, values are
 * cleaned to each question's type, photo ids must be this job's photos, and
 * per-question timestamps decide which edit wins.
 */
export async function saveJobAnswers(
  companyId: string,
  b: Pick<Booking, "id" | "templateVersionId">,
  incoming: Record<string, IncomingAnswer>,
  by: string,
): Promise<JobForm> {
  if (!b.templateVersionId) throw new FormInputError("This job has no form.");
  const t = tdb(companyId);
  const v = await t.selectOne(schema.templateVersions, eq(schema.templateVersions.id, b.templateVersionId));
  if (!v) throw new FormInputError("This job's form is missing.");
  const form = versionForm(v);
  const byId = new Map<string, FormItem>(form.items.map((i) => [i.id, i]));

  const wantPhotos = new Set<string>();
  for (const a of Object.values(incoming)) {
    if (Array.isArray(a?.photoIds)) for (const p of a.photoIds) if (typeof p === "string") wantPhotos.add(p);
  }
  const jobPhotoIds = new Set<string>();
  if (wantPhotos.size) {
    const rows = await t.select(schema.jobPhotos, eq(schema.jobPhotos.bookingId, b.id));
    for (const r of rows) jobPhotoIds.add(r.id);
  }

  const now = Date.now();
  const clean: Answers = {};
  for (const [id, a] of Object.entries(incoming)) {
    const item = byId.get(id);
    if (!item || !isInputItem(item)) throw new FormInputError(`Unknown question: ${id}`);
    const atMs = typeof a?.at === "string" ? Date.parse(a.at) : NaN;
    // Clocks on phones drift; never accept an answer from the future.
    const at = new Date(Number.isFinite(atMs) ? Math.min(atMs, now) : now).toISOString();
    const ans: Answer = { value: cleanAnswerValue(item, a?.value), at, by };
    if (item.type === "photo") {
      const ids = Array.isArray(a?.photoIds) ? (a.photoIds as unknown[]).filter((p): p is string => typeof p === "string" && jobPhotoIds.has(p)) : [];
      ans.photoIds = [...new Set(ids)].slice(0, item.maxPhotos ?? 30);
    }
    if (item.type === "signature" && typeof a?.name === "string") ans.name = a.name.slice(0, 120);
    clean[id] = ans;
  }

  const saved = await t.transaction(async (tx: Executor) => {
    await tx
      .insert(schema.jobFormResponses)
      .values({ companyId, bookingId: b.id, templateVersionId: v.id })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(schema.jobFormResponses)
      .where(t.scope(schema.jobFormResponses, and(eq(schema.jobFormResponses.bookingId, b.id), eq(schema.jobFormResponses.templateVersionId, v.id))))
      .for("update");
    const answers = mergeAnswers(parseAnswers(row!.answers), clean);
    const missing = missingRequired(form, answers).length;
    const p = progress(form, answers);
    const [out] = await tx
      .update(schema.jobFormResponses)
      .set({
        answers: JSON.stringify(answers),
        answeredCount: p.answered,
        flaggedCount: flaggedItems(form, answers).length,
        missingCount: missing,
        updatedBy: by,
        updatedAt: new Date(),
      })
      .where(t.scope(schema.jobFormResponses, eq(schema.jobFormResponses.id, row!.id)))
      .returning();
    return out!;
  });
  return shape(v, saved);
}

/** Required questions still unanswered on a job (empty when it can be finished). */
export async function missingForJob(companyId: string, b: Pick<Booking, "id" | "templateVersionId">): Promise<FormItem[]> {
  const f = await jobForm(companyId, b);
  if (!f) return [];
  return missingRequired(f.form, f.answers);
}

/** Mark the job's form done when the job is completed (keeps answers editable by the office). */
export async function closeJobForm(companyId: string, b: Pick<Booking, "id" | "templateVersionId">, by: string): Promise<void> {
  if (!b.templateVersionId) return;
  const t = tdb(companyId);
  await t.transaction(async (tx) => {
    await tx
      .insert(schema.jobFormResponses)
      .values({ companyId, bookingId: b.id, templateVersionId: b.templateVersionId! })
      .onConflictDoNothing();
    await tx
      .update(schema.jobFormResponses)
      .set({ status: "complete", completedAt: new Date(), updatedBy: by })
      .where(t.scope(schema.jobFormResponses, and(eq(schema.jobFormResponses.bookingId, b.id), eq(schema.jobFormResponses.templateVersionId, b.templateVersionId!))));
  });
}
