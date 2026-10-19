import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { isOfficeRole } from "../lib/office-access";
import { parseTechPayModel } from "../../shared/tech-pay";
import { ensureFormCategories } from "../../services/form-categories";
import * as schema from "../database/schema";
import { sdb } from "../database";
import { eq } from "drizzle-orm";
import { requireAuth, requireOffice, tenantId, tx } from "../middleware/auth";
import { z } from "zod";
import { jsonBody, shortText, longText, hexColor } from "../lib/validate";
import type { AppEnv } from "../env";
import { formProblems, normalizeForm, questionCount, templateForm } from "../../shared/forms/form-model";
import { toLegacy } from "../../shared/forms/legacy";
import { listVersions, publishVersion, templateStats } from "../../services/job-forms";
import { audit } from "../lib/audit";
import { libraryFor } from "../../shared/forms/library";
import { getIndustryPreset } from "../../services/industry-presets";
import { GenerateError, generateTemplateDraft } from "../../services/form-generate";
import { rateLimit, keyByUser } from "../lib/rate-limit";
import { isFeatureOn } from "../../services/features";

/** The library and AI drafts are part of Job forms v2 (Control Hub switch). */
const requireFormsV2 = createMiddleware<AppEnv>(async (c, next) => {
  if (!(await isFeatureOn(tenantId(c), "forms.v2"))) return c.json({ message: "Job forms v2 isn't switched on for this company." }, 403);
  return next();
});

const generateLimit = rateLimit({ limit: 20, windowMs: 60 * 60 * 1000, keyFn: keyByUser, name: "template-generate" });

async function companyIndustry(companyId: string): Promise<{ id: string; label: string | null; name: string }> {
  const co = await sdb.select({ industry: schema.companies.industry, name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, companyId)).limit(1);
  const id = co[0]?.industry ?? "";
  return { id, label: getIndustryPreset(id)?.label ?? null, name: co[0]?.name ?? "" };
}

/**
 * Work-order templates. `fields`/`checklist` are the legacy (schema 1)
 * builder output; `form` is the Job forms v2 schema-2 form. When `form` is
 * saved, the legacy columns are rewritten from it (shared/forms/legacy.ts) so
 * older readers keep working. Every change to questions, prices or pay is
 * published as a new immutable version (services/job-forms.ts), so jobs
 * already booked keep the version they were booked with.
 *
 * Reading is open to anyone signed in at the company (the phone app lists
 * them); writing is office-only (`mod("forms")` in lib/office-access.ts).
 */
const TemplateBody = z.object({
  name: shortText("Name", 120),
  category: shortText("Category", 64).optional(),
  icon: shortText("Icon", 64).optional(),
  color: hexColor().optional(),
  description: longText(2_000).optional(),
  fields: z.array(z.unknown()).max(500).optional(),
  checklist: z.array(z.unknown()).max(500).optional(),
  form: z.unknown().optional(),
  estimatedMins: z.number().int().min(0).max(43_200).optional(),
  rateModel: z.unknown().optional(),
  techPayModel: z.unknown().optional(),
  collectPayment: z.enum(["", "on_site"]).optional(),
  sendCustomerCopy: z.boolean().optional(),
  active: z.boolean().optional(),
});

/** Validate + normalise a tech pay model; "" / null clears it (tech's own rates). */
export function techPayModelJson(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  const m = parseTechPayModel(typeof v === "string" ? v : JSON.stringify(v));
  return m ? JSON.stringify(m) : "";
}

const TemplatePatch = TemplateBody.partial();

type Body = z.infer<typeof TemplatePatch>;

/** The columns a create/patch body sets, with `form` fanned out to the legacy columns. */
function columnsFrom(body: Body): { set: Record<string, unknown>; problem?: string } {
  const set: Record<string, unknown> = {};
  for (const k of ["name", "category", "icon", "color", "description", "estimatedMins", "active", "sendCustomerCopy"] as const)
    if (body[k] !== undefined) set[k] = body[k];
  if (body.fields !== undefined) {
    set.fields = JSON.stringify(body.fields);
    // The old builder saved: its fields win over a stale schema-2 form.
    if (body.form === undefined) set.form = "";
  }
  if (body.checklist !== undefined) set.checklist = JSON.stringify(body.checklist);
  if (body.form !== undefined) {
    const def = normalizeForm(body.form);
    const problems = formProblems(def);
    if (problems.length) return { set, problem: problems[0]!.message };
    const legacy = toLegacy(def);
    set.form = JSON.stringify(def);
    set.fields = JSON.stringify(legacy.fields);
    set.checklist = JSON.stringify(legacy.checklist);
  }
  if (body.rateModel !== undefined)
    set.rateModel = typeof body.rateModel === "string" ? body.rateModel : JSON.stringify(body.rateModel);
  if (body.techPayModel !== undefined) set.techPayModel = techPayModelJson(body.techPayModel);
  if (body.collectPayment !== undefined) set.collectPayment = body.collectPayment;
  return { set };
}

/** A template row plus its parsed form and usage, for the builder and lists. */
function present(t: typeof schema.taskTemplates.$inferSelect, stats?: { jobs: number; version: number }) {
  const formDef = templateForm(t);
  return { ...t, formDef, questionCount: questionCount(formDef), jobCount: stats?.jobs ?? 0, version: stats?.version ?? 0 };
}

type Ctx = Context<AppEnv>;
const actorOf = (c: Ctx) => {
  const u = c.get("user") as { name?: string; email?: string } | null;
  return u?.name || u?.email || "";
};
function log(c: Ctx, action: string, entityId: string, summary: string) {
  const u = c.get("user") as { id?: string } | null;
  return audit({ companyId: tenantId(c), actorId: u?.id ?? "", actorName: actorOf(c), action, entityType: "template", entityId, summary });
}

/** Templates carry office-only questions and pay: staff only, never customers. */
const requireStaff = createMiddleware<AppEnv>(async (c, next) => {
  const u = c.get("user") as { role?: string } | null;
  if (!u) return c.json({ message: "Unauthorized" }, 401);
  if (!isOfficeRole(u.role) && u.role !== "rider") return c.json({ message: "Forbidden" }, 403);
  return next();
});

export const templatesRoutes = new Hono<AppEnv>()
  .get("/", requireAuth, requireStaff, async (c) => {
    const rows = await tx(c).select(schema.taskTemplates);
    const stats = await templateStats(tenantId(c)).catch(() => new Map());
    return c.json({ templates: rows.map((t) => present(t, stats.get(t.id))) }, 200);
  })
  // The starter library for this company's trade (industry matches first, then general).
  .get("/library", requireOffice, requireFormsV2, async (c) => {
    const ind = await companyIndustry(tenantId(c));
    return c.json({ industry: ind.id || null, industryLabel: ind.label, templates: structuredClone(libraryFor(ind.id)) }, 200);
  })
  // "Describe it": an AI draft for review in the editor. Never saved here.
  .post("/generate", requireOffice, requireFormsV2, generateLimit, jsonBody(z.object({ description: z.string().trim().min(12, "Describe the job in a sentence or two.").max(1500) })), async (c) => {
    const { description } = c.req.valid("json");
    const ind = await companyIndustry(tenantId(c));
    try {
      const draft = await generateTemplateDraft({ description, industry: ind.id, companyName: ind.name });
      return c.json({ draft }, 200);
    } catch (e) {
      if (e instanceof GenerateError) return c.json({ message: e.message }, 502);
      throw e;
    }
  })
  .get("/:id", requireAuth, requireStaff, async (c) => {
    const t = await tx(c).selectOne(
      schema.taskTemplates,
      eq(schema.taskTemplates.id, c.req.param("id")),
    );
    if (!t) return c.json({ message: "Not found" }, 404);
    const stats = await templateStats(tenantId(c)).catch(() => new Map());
    return c.json({ template: present(t, stats.get(t.id)) }, 200);
  })
  .get("/:id/versions", requireOffice, async (c) => {
    return c.json({ versions: await listVersions(tenantId(c), c.req.param("id")) }, 200);
  })
  .post("/", requireOffice, jsonBody(TemplateBody), async (c) => {
    const body = c.req.valid("json");
    const { set, problem } = columnsFrom(body);
    if (problem) return c.json({ message: problem }, 400);
    if (body.category) await ensureFormCategories(tenantId(c), [body.category]);
    const [t] = await tx(c).insert(schema.taskTemplates, {
      category: "General",
      icon: "clipboard-list",
      color: "#0ea5e9",
      description: "",
      fields: "[]",
      checklist: "[]",
      estimatedMins: 60,
      rateModel: "",
      techPayModel: "",
      collectPayment: "",
      ...set,
      name: body.name,
      updatedAt: new Date(),
      updatedBy: actorOf(c),
    } as never);
    const v = await publishVersion(tenantId(c), t!.id, actorOf(c));
    await log(c, "template.create", t!.id, `Created template ${t!.name}`);
    return c.json({ template: present({ ...t!, currentVersionId: v?.id ?? null }, { jobs: 0, version: v?.version ?? 0 }) }, 201);
  })
  .patch("/:id", requireOffice, jsonBody(TemplatePatch), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const { set, problem } = columnsFrom(body);
    if (problem) return c.json({ message: problem }, 400);
    if (body.category) await ensureFormCategories(tenantId(c), [body.category]);
    const [t] = await tx(c).update(
      schema.taskTemplates,
      { ...set, updatedAt: new Date(), updatedBy: actorOf(c) },
      eq(schema.taskTemplates.id, id),
    );
    if (!t) return c.json({ message: "Not found" }, 404);
    const v = await publishVersion(tenantId(c), id, actorOf(c));
    const stats = await templateStats(tenantId(c)).catch(() => new Map());
    await log(c, "template.update", id, `Saved template ${t.name} (v${v?.version ?? "?"})`);
    return c.json({ template: present({ ...t, currentVersionId: v?.id ?? t.currentVersionId }, stats.get(id)) }, 200);
  })
  .delete("/:id", requireOffice, async (c) => {
    const id = c.req.param("id");
    const existing = await tx(c).selectOne(schema.taskTemplates, eq(schema.taskTemplates.id, id));
    // bookings.templateId -> task_templates.id has no ON DELETE action, so a
    // template still referenced by a work order fails the delete with a raw
    // FK-constraint 500 ("Server error — nothing was saved") even though the
    // UI's own confirm copy promises "work orders already using it are
    // unaffected." Detach existing bookings from the template first so that
    // promise is actually true — the work order keeps its own snapshot (and,
    // on Job forms v2, its template version) — it just stops pointing at a
    // template that no longer exists.
    await tx(c).update(
      schema.bookings,
      { templateId: null },
      eq(schema.bookings.templateId, id),
    );
    await tx(c).delete(schema.taskTemplates, eq(schema.taskTemplates.id, id));
    if (existing) await log(c, "template.delete", id, `Deleted template ${existing.name}`);
    return c.json({ ok: true }, 200);
  });
