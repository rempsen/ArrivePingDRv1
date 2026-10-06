/**
 * Item 1 (agentic-onboarding remediation, 2026-10-01) — the missing
 * consumer for `qualifyingProfile.icpAnswers[]`.
 *
 * During the onboarding chat the concierge designs 1-5 ICP-specific
 * questions and stores each Q/A pair via `save_icp_qualifying_answer`. Until
 * now those pairs were only ever re-read into the next turn's prompt; nothing
 * about the tenant's actual setup changed because of them. That's the trust
 * gap the gap analysis called out: "we'll use this to tune your setup" was
 * said, and nothing was tuned.
 *
 * This pass runs ONCE at `finish_onboarding` (gated on `icpTuningAppliedAt`)
 * and turns the free-text answers into a short list of FIXED, deterministic
 * provisioning actions. The model only chooses from a closed menu:
 *
 *   add_catalog_item          — a priced service/product they named
 *   add_option_category       — a new good/better/best group with tiers
 *   add_option_tier           — one more tier on an EXISTING group
 *   deactivate_option_category— they said they don't sell that as tiers
 *   add_template_checklist    — a quality/compliance gate on an EXISTING template
 *   add_template_field        — an intake field on an EXISTING template
 *   set_template_billing      — switch an EXISTING template between flat / hourly
 *   noop                      — the answer is context only
 *
 * Every action must cite the Q/A it came from. The executor dedupes against
 * what already exists (same-name catalog item / option group / checklist
 * label → skipped), caps the batch, and never throws — finishing onboarding
 * is never blocked by this. Same philosophy as qualifying-tuning.ts: the
 * model decides WHAT, deterministic code decides HOW.
 */
import { generateObject } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import * as schema from "../api/database/schema";
import { tdb } from "../api/database/tenant";
import { gateway, MODELS } from "../api/agent/gateway";
import { log } from "../api/lib/logger";
import { EMPTY_RATE_MODEL, type RateModel } from "../shared/pricing";
import { getIndustryPreset, industryLabel } from "./industry-presets";
import type { QualifyingProfile } from "./qualifying-tuning";

const MAX_ACTIONS = 8;
const TIMEOUT_MS = 45_000;

const TierSchema = z.object({
  tierLabel: z.string().max(30),
  name: z.string().max(120),
  description: z.string().max(240),
  priceDelta: z.number().min(0).max(100_000),
  isDefault: z.boolean(),
});

const ActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("add_catalog_item"),
    name: z.string().max(120),
    category: z.string().max(60),
    kind: z.enum(["service", "product"]),
    unit: z.string().max(30),
    unitCost: z.number().min(0).max(1_000_000),
    markupPct: z.number().min(0).max(300),
    reason: z.string().max(240),
  }),
  z.object({
    type: z.literal("add_option_category"),
    name: z.string().max(80),
    description: z.string().max(240),
    tiers: z.array(TierSchema).min(2).max(4),
    reason: z.string().max(240),
  }),
  z.object({
    type: z.literal("add_option_tier"),
    categoryName: z.string().max(80),
    tier: TierSchema,
    reason: z.string().max(240),
  }),
  z.object({
    type: z.literal("deactivate_option_category"),
    categoryName: z.string().max(80),
    reason: z.string().max(240),
  }),
  z.object({
    type: z.literal("add_template_checklist"),
    templateName: z.string().max(120),
    label: z.string().max(160),
    required: z.boolean(),
    reason: z.string().max(240),
  }),
  z.object({
    type: z.literal("add_template_field"),
    templateName: z.string().max(120),
    fieldType: z.enum(["text", "number", "checkbox", "select", "date", "photo", "signature"]),
    label: z.string().max(120),
    required: z.boolean(),
    reason: z.string().max(240),
  }),
  z.object({
    type: z.literal("set_template_billing"),
    templateName: z.string().max(120),
    billing: z.enum(["flat", "hourly"]),
    /** flat: the flat rate; hourly: the per-hour rate. Required > 0. */
    rate: z.number().min(1).max(100_000),
    reason: z.string().max(240),
  }),
  z.object({
    type: z.literal("noop"),
    reason: z.string().max(240),
  }),
]);

const PlanSchema = z.object({
  actions: z.array(ActionSchema).max(MAX_ACTIONS),
});

export type IcpTuningAction = z.infer<typeof ActionSchema>;

export type IcpTuningSummary = {
  applied: boolean;
  reason?: string;
  /** What actually changed, in the order it ran. */
  actions: { type: IcpTuningAction["type"]; target: string; ok: boolean; note?: string }[];
  skipped: number;
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function parseJsonArray(json: string | null | undefined): any[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function parseRateModel(json: string | null | undefined): RateModel {
  try {
    return { ...EMPTY_RATE_MODEL, ...JSON.parse(json || "") };
  } catch {
    return { ...EMPTY_RATE_MODEL };
  }
}

function rateShape(rm: RateModel): string {
  const parts: string[] = [];
  if (rm.flatRate) parts.push(`flat ${rm.flatRate}`);
  if (rm.timeRate) parts.push(`${rm.timeRate}/${rm.timeUnit}`);
  if (rm.firstHourRate) parts.push(`first hour ${rm.firstHourRate}`);
  if (rm.kmRate) parts.push(`${rm.kmRate}/km`);
  return parts.length ? parts.join(" + ") : "no rate set";
}

export async function applyIcpAnswerTuning(
  companyId: string,
  qualifying: QualifyingProfile,
): Promise<IcpTuningSummary> {
  const summary: IcpTuningSummary = { applied: false, actions: [], skipped: 0 };
  if (qualifying.icpTuningAppliedAt) {
    summary.reason = "already applied";
    return summary;
  }
  const answers = Array.isArray(qualifying.icpAnswers)
    ? qualifying.icpAnswers.filter((a) => a && a.question && a.answer)
    : [];
  if (!answers.length) {
    summary.reason = "no ICP answers";
    return summary;
  }
  if (!process.env.AI_GATEWAY_API_KEY) {
    summary.reason = "AI gateway not configured";
    return summary;
  }

  try {
    const t = tdb(companyId);
    const [company] = await import("../api/database").then((m) =>
      m.db.select().from(schema.companies).where(eq(schema.companies.id, companyId)),
    );
    const settings = await t.selectOne(schema.companySettings);
    const templates = await t.select(schema.taskTemplates);
    const catalog = await t.select(schema.catalogItems);
    const optionCats = await t.select(schema.optionCategories);
    const optionItems = await t.select(schema.optionCategoryItems);

    const preset = getIndustryPreset(company?.industry);
    const industry = company?.industry ? industryLabel(company.industry) || company.industry : "unknown";
    const noun = settings?.workerNoun || preset?.workerNoun || "technician";
    const customerNoun = settings?.customerNoun || preset?.customerNoun || "customer";

    const templateLines = templates
      .map((tpl) => {
        const fields = parseJsonArray(tpl.fields).map((f) => f.label).filter(Boolean);
        const checks = parseJsonArray(tpl.checklist).map((c) => c.label).filter(Boolean);
        return `- "${tpl.name}" (${tpl.category}; billing: ${rateShape(parseRateModel(tpl.rateModel))}; fields: ${
          fields.join(", ") || "none"
        }; checklist: ${checks.join(", ") || "none"})`;
      })
      .join("\n");
    const catalogLines = catalog
      .filter((c) => c.active)
      .map((c) => `- "${c.name}" (${c.category}, ${c.kind}, ${c.unit})`)
      .join("\n");
    const optionLines = optionCats
      .filter((o) => o.active)
      .map((o) => {
        const tiers = optionItems.filter((i) => i.categoryId === o.id).map((i) => `${i.tierLabel}: ${i.name} (+${i.priceDelta})`);
        return `- "${o.name}" → ${tiers.join(" / ") || "no tiers"}`;
      })
      .join("\n");
    const qaLines = answers.map((a, i) => `Q${i + 1}: ${a.question}\nA${i + 1}: ${a.answer}`).join("\n\n");

    const prompt = `You are finishing the setup of a field-service business inside ArrivePing (dispatch platform). During onboarding the business answered a few industry-specific questions. Translate those answers into a SHORT list of concrete setup changes, chosen only from the action menu in the output schema.

BUSINESS: ${company?.name ?? companyId} — industry: ${industry}. They call field workers "${noun}" and the people they serve "${customerNoun}".

WHAT IS ALREADY SET UP (you may only reference templates/option groups by these exact names):
Work-order templates:
${templateLines || "(none)"}

Catalog items (priced services/products):
${catalogLines || "(none)"}

Option / tier groups (good-better-best style upsells):
${optionLines || "(none)"}

THEIR ANSWERS:
${qaLines}

RULES
- Only propose a change when an answer clearly implies it. If an answer is context only, emit a single "noop" with the reason. Fewer, well-grounded actions beat many speculative ones. Max ${MAX_ACTIONS}.
- add_catalog_item: only for a specific service/product they NAMED that is not already in the catalog. Realistic unitCost in CAD; markupPct 25-60 for products, 0 for services whose unitCost is already the price.
- add_option_category / add_option_tier: only when they described tiers, packages, service levels, or a size/scope split that affects price. Exactly one tier isDefault with priceDelta 0.
- deactivate_option_category: only when they explicitly said they do NOT offer that kind of choice.
- add_template_checklist / add_template_field: for a compliance, safety, documentation or sign-off step they said they require (permits, photos, inspections, waivers, COI, readings). Do not duplicate an existing label.
- set_template_billing: only when they stated how they bill (flat vs hourly) AND the template's current billing shape contradicts it. Use the rate they gave; if they gave none, skip.
- "reason" must quote or paraphrase the specific answer it came from, in one sentence.
- Never invent templates or option groups that aren't listed when using add_option_tier / add_template_* / set_template_billing / deactivate_option_category.`;

    const { object } = await Promise.race([
      generateObject({ model: gateway(MODELS.text), schema: PlanSchema, prompt }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("icp-answer-tuning timeout")), TIMEOUT_MS)),
    ]);

    // ── Execute deterministically ─────────────────────────────────────
    const catalogNames = new Set(catalog.map((c) => norm(c.name)));
    const optionByName = new Map(optionCats.map((o) => [norm(o.name), o]));
    const templateByName = new Map(templates.map((tpl) => [norm(tpl.name), tpl]));

    for (const action of object.actions) {
      try {
        switch (action.type) {
          case "noop":
            summary.skipped++;
            break;

          case "add_catalog_item": {
            if (catalogNames.has(norm(action.name))) {
              summary.skipped++;
              break;
            }
            const [row] = await t.insert(schema.catalogItems, {
              kind: action.kind,
              name: action.name.slice(0, 120),
              category: action.category.slice(0, 60) || "General",
              unit: action.unit.slice(0, 30) || "each",
              unitCost: action.unitCost,
              markupPct: action.markupPct,
              priceMode: "auto",
              unitPrice: 0,
              taxable: true,
              components: "[]",
              description: `Added from onboarding: ${action.reason}`.slice(0, 500),
              active: true,
            });
            catalogNames.add(norm(action.name));
            summary.actions.push({ type: action.type, target: action.name, ok: Boolean(row) });
            break;
          }

          case "add_option_category": {
            if (optionByName.has(norm(action.name))) {
              summary.skipped++;
              break;
            }
            const defaults = action.tiers.filter((x) => x.isDefault).length;
            const tiers = action.tiers.map((x, i) => ({ ...x, isDefault: defaults === 1 ? x.isDefault : i === 0 }));
            const [catRow] = await t.insert(schema.optionCategories, {
              name: action.name.slice(0, 80),
              description: `${action.description} (from onboarding: ${action.reason})`.slice(0, 500),
              sortOrder: optionCats.length + summary.actions.length,
              active: true,
            });
            if (!catRow) {
              summary.actions.push({ type: action.type, target: action.name, ok: false });
              break;
            }
            for (let j = 0; j < tiers.length; j++) {
              const x = tiers[j]!;
              await t.insert(schema.optionCategoryItems, {
                categoryId: catRow.id,
                tierLabel: x.tierLabel,
                name: x.name,
                description: x.description,
                priceDelta: x.isDefault ? 0 : x.priceDelta,
                unitCost: 0,
                isDefault: x.isDefault,
                sortOrder: j,
                active: true,
              });
            }
            optionByName.set(norm(action.name), catRow);
            summary.actions.push({ type: action.type, target: action.name, ok: true, note: `${tiers.length} tiers` });
            break;
          }

          case "add_option_tier": {
            const cat = optionByName.get(norm(action.categoryName));
            if (!cat) {
              summary.skipped++;
              break;
            }
            const existing = optionItems.filter((i) => i.categoryId === cat.id);
            if (existing.some((i) => norm(i.name) === norm(action.tier.name))) {
              summary.skipped++;
              break;
            }
            await t.insert(schema.optionCategoryItems, {
              categoryId: cat.id,
              tierLabel: action.tier.tierLabel,
              name: action.tier.name,
              description: action.tier.description,
              priceDelta: action.tier.priceDelta,
              unitCost: 0,
              isDefault: false, // never displace the existing default
              sortOrder: existing.length,
              active: true,
            });
            summary.actions.push({ type: action.type, target: `${cat.name} → ${action.tier.name}`, ok: true });
            break;
          }

          case "deactivate_option_category": {
            const cat = optionByName.get(norm(action.categoryName));
            if (!cat || !cat.active) {
              summary.skipped++;
              break;
            }
            await t.update(schema.optionCategories, { active: false }, eq(schema.optionCategories.id, cat.id));
            summary.actions.push({ type: action.type, target: cat.name, ok: true });
            break;
          }

          case "add_template_checklist": {
            const tpl = templateByName.get(norm(action.templateName));
            if (!tpl) {
              summary.skipped++;
              break;
            }
            const checklist = parseJsonArray(tpl.checklist);
            if (checklist.some((c) => norm(String(c.label ?? "")) === norm(action.label))) {
              summary.skipped++;
              break;
            }
            checklist.push({ id: crypto.randomUUID(), label: action.label.slice(0, 160), required: action.required });
            await t.update(schema.taskTemplates, { checklist: JSON.stringify(checklist) }, eq(schema.taskTemplates.id, tpl.id));
            tpl.checklist = JSON.stringify(checklist);
            summary.actions.push({ type: action.type, target: `${tpl.name} → ${action.label}`, ok: true });
            break;
          }

          case "add_template_field": {
            const tpl = templateByName.get(norm(action.templateName));
            if (!tpl) {
              summary.skipped++;
              break;
            }
            const fields = parseJsonArray(tpl.fields);
            if (fields.some((f) => norm(String(f.label ?? "")) === norm(action.label))) {
              summary.skipped++;
              break;
            }
            fields.push({ id: crypto.randomUUID(), type: action.fieldType, label: action.label.slice(0, 120), required: action.required });
            await t.update(schema.taskTemplates, { fields: JSON.stringify(fields) }, eq(schema.taskTemplates.id, tpl.id));
            tpl.fields = JSON.stringify(fields);
            summary.actions.push({ type: action.type, target: `${tpl.name} → ${action.label}`, ok: true });
            break;
          }

          case "set_template_billing": {
            const tpl = templateByName.get(norm(action.templateName));
            if (!tpl) {
              summary.skipped++;
              break;
            }
            const rm = parseRateModel(tpl.rateModel);
            const next: RateModel =
              action.billing === "flat"
                ? { ...rm, flatRate: action.rate, timeRate: 0, firstHourRate: 0, additionalHourRate: 0 }
                : { ...rm, flatRate: 0, includedMinutes: 0, timeRate: action.rate, timeUnit: "hour", firstHourRate: 0, additionalHourRate: 0 };
            await t.update(schema.taskTemplates, { rateModel: JSON.stringify(next) }, eq(schema.taskTemplates.id, tpl.id));
            tpl.rateModel = JSON.stringify(next);
            summary.actions.push({ type: action.type, target: `${tpl.name} → ${action.billing} ${action.rate}`, ok: true });
            break;
          }
        }
      } catch (e: any) {
        summary.actions.push({ type: action.type, target: (action as any).name ?? (action as any).templateName ?? (action as any).categoryName ?? "?", ok: false, note: e?.message });
      }
    }

    summary.applied = true;
    log.info("icp-answer-tuning applied", { companyId, actions: summary.actions.length, skipped: summary.skipped });
    return summary;
  } catch (e: any) {
    log.warn("icp-answer-tuning failed", { companyId, error: e?.message });
    summary.reason = e?.message ?? "error";
    return summary;
  }
}
