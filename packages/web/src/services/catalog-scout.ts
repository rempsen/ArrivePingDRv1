/**
 * Catalog Scout — tailors the CATALOG (priced products / services /
 * assemblies) and the OPTIONS/TIER catalog (good / better / best groups)
 * seeded for a brand-new tenant to what THAT business actually sells,
 * instead of copying the industry preset verbatim.
 *
 * Until now these two were the only onboarding surfaces that ignored the
 * website scrape entirely: an HVAC shop whose site leads with heat pumps and
 * geothermal opened the Catalog to the generic furnace list. The Service
 * Library already got this treatment (service-scout.ts); this does the same
 * for pricing.
 *
 * Design — edits, not rewrites. The preset's unit costs and markups are
 * grounded Canadian contractor pricing and are the valuable part; the model
 * is NOT allowed to touch them. It returns a small edit list instead:
 *   keep[]  — preset items to keep, optionally renamed / re-described in the
 *             tenant's own wording
 *   drop[]  — preset items that clearly don't apply to this business
 *   add[]   — things on their website the preset has no row for, with a
 *             cost estimate flagged as such in the description
 * We then apply those edits to the preset ourselves, so a bad model turn can
 * at worst rename a row — never zero out a price. Hard guardrails below
 * (never drop more than ~60% of the preset, never end up with fewer than
 * 8 rows) fall straight back to the untouched preset.
 *
 * Degrades gracefully: no scrape data, no preset, or any model failure →
 * exactly today's behaviour (preset as-is, or nothing for "other").
 */
import { generateObject } from "ai";
import { z } from "zod";
import { gateway, MODELS } from "../api/agent/gateway";
import { log } from "../api/lib/logger";
import { CATALOG_PRESETS, type CatalogPresetItem } from "./catalog-presets";
import { OPTION_CATALOG_PRESETS, type OptionCategoryPreset } from "./option-catalog-presets";
import type { IcpKnowledge } from "./template-scout";

export interface CatalogScoutInput {
  name: string;
  industry?: string | null;
  industryOther?: string | null;
  /** Service names scraped off the tenant's own website. */
  services?: string[];
  /** 2-4 sentence "what this business does" from the scrape. */
  description?: string | null;
  website?: string | null;
  knowledge?: IcpKnowledge | null;
}

/** True when there's enough scrape signal to be worth a model call. */
export function hasScrapeSignal(input: Pick<CatalogScoutInput, "services" | "description">): boolean {
  const svc = (input.services ?? []).filter((s) => s && s.trim());
  return svc.length > 0 || Boolean(input.description && input.description.trim().length >= 40);
}

function contextBlock(input: CatalogScoutInput): string {
  const scraped = (input.services ?? []).map((s) => s.trim()).filter(Boolean);
  const k = input.knowledge;
  const research: string[] = [];
  if (k?.summary) research.push(`Industry context: ${k.summary}`);
  if (k?.terminologyNotes) research.push(`Industry terminology: ${k.terminologyNotes}`);
  if (k?.bestPractices?.length) research.push(`Pricing/menu best practices: ${k.bestPractices.slice(0, 6).join("; ")}`);
  return `COMPANY: ${input.name}
INDUSTRY: ${input.industry || "(none)"}${input.industryOther ? ` (${input.industryOther})` : ""}
WEBSITE: ${input.website || "(unknown)"}
ABOUT THE BUSINESS (from their website): ${input.description?.trim() || "(none)"}
SERVICES THEY ADVERTISE (from their website — ground truth for what THEY sell): ${scraped.length ? scraped.join("; ") : "(none listed)"}${research.length ? `\n\nDEEP INDUSTRY RESEARCH:\n${research.join("\n")}` : ""}`;
}

/* -------------------------------------------------------------------------- */
/*  Catalog items                                                             */
/* -------------------------------------------------------------------------- */

const CatalogEditSchema = z.object({
  keep: z
    .array(
      z.object({
        key: z.string().describe("Preset item key, exactly as given"),
        name: z.string().nullable().describe("Renamed in the tenant's own wording, or null to keep the preset name"),
        description: z.string().nullable().describe("Re-described for this business, or null to keep"),
      }),
    )
    .default([]),
  drop: z.array(z.string()).describe("Preset item keys that clearly do not apply to this business").default([]),
  add: z
    .array(
      z.object({
        name: z.string(),
        kind: z.enum(["service", "product"]),
        category: z.string().describe("Short, reusable category — reuse a preset category where one fits"),
        description: z.string(),
        unit: z.string().describe("each, hour, job, sqft, ft, m, visit, …"),
        unitCost: z.number().min(0).max(1_000_000).describe("Estimated wholesale/COGS cost in CAD"),
        markupPct: z.number().min(0).max(500),
        taxable: z.boolean(),
      }),
    )
    .max(16)
    .default([]),
});

function skuFor(prefix: string, name: string, taken: Set<string>): string {
  const base = `${prefix}-${name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 6) || "ITEM"}`;
  let sku = base;
  let i = 2;
  while (taken.has(sku)) sku = `${base}${i++}`;
  taken.add(sku);
  return sku;
}

/**
 * Tailor the catalog preset for one tenant. Never throws; returns the
 * untouched preset (or [] when there is no preset and nothing to build from)
 * on any failure or guardrail trip.
 */
export async function scoutStarterCatalog(input: CatalogScoutInput): Promise<CatalogPresetItem[]> {
  const preset: CatalogPresetItem[] = (input.industry && CATALOG_PRESETS[input.industry]) || [];
  if (!hasScrapeSignal(input)) return preset;

  const presetLines = preset.map(
    (it) =>
      `${it.key} | ${it.kind} | ${it.name} | ${it.category} | ${it.unit} | cost ${it.unitCost} CAD, markup ${it.markupPct}%${
        it.kind === "assembly" ? ` | assembly of ${(it.components ?? []).map((c) => c.key).join("+")}` : ""
      }`,
  );
  const skuPrefix = (preset[0]?.sku.split("-")[0] || (input.industry || "GEN").toUpperCase().slice(0, 3)).toUpperCase();

  try {
    const { object } = await generateObject({
      model: gateway(MODELS.text),
      schema: CatalogEditSchema,
      prompt: `You are onboarding a service business into a field-service platform and must tailor its starter PRICE CATALOG — the priced products, services and bundles their office quotes from — so it matches what THIS business actually sells.

${contextBlock(input)}

STARTER CATALOG FOR THIS INDUSTRY (key | kind | name | category | unit | pricing). The costs and markups are grounded contractor pricing — you cannot change them, only keep/rename/drop rows and add new ones:
${presetLines.length ? presetLines.join("\n") : "(no preset for this industry — build a starter catalog from the website alone via add[])"}

Return an EDIT LIST:
- keep: every preset row that applies to this business. Rename rows to the company's own wording when their website uses a different name for the same thing (e.g. "Furnace Tune-Up" → "Annual Furnace Maintenance" if that's what they call it). Leave name/description null when the preset wording is fine.
- drop: rows that clearly do not apply given what the site says they do (e.g. drop new-construction rows if they only advertise repair; drop commercial rows for a residential-only shop). Be conservative — when in doubt, keep. Never drop more than about a third of the list.
- add: things they advertise that the preset has NO row for (a named service, a product line, a specialty). ${preset.length ? "Up to 6 additions." : "Build 8-12 rows that cover their advertised services, each a realistic bookable/quotable line."} Give each a realistic Canadian wholesale cost and markup for that trade, and END its description with " (estimated — verify pricing)".
- Reuse existing category names where they fit so the catalog stays grouped.
- Assembly rows: keep them unless one of their components is dropped.`,
    });

    const dropSet = new Set(object.drop ?? []);
    const keepByKey = new Map((object.keep ?? []).map((k) => [k.key, k]));

    // Guardrail: too aggressive → preset unchanged.
    if (preset.length && dropSet.size > Math.floor(preset.length * 0.6)) {
      log.warn("catalog-scout: model dropped too many preset rows; using preset", { company: input.name, dropped: dropSet.size });
      return preset;
    }

    const takenSkus = new Set(preset.map((p) => p.sku));
    const out: CatalogPresetItem[] = [];

    for (const it of preset) {
      if (dropSet.has(it.key)) continue;
      if (it.kind === "assembly") {
        const comps = (it.components ?? []).filter((c) => !dropSet.has(c.key));
        if (comps.length === 0) continue;
        out.push({ ...it, components: comps });
        continue;
      }
      const edit = keepByKey.get(it.key);
      out.push({
        ...it,
        name: edit?.name?.trim() ? edit.name.trim().slice(0, 200) : it.name,
        description: edit?.description?.trim() ? edit.description.trim().slice(0, 500) : it.description,
      });
    }

    const existingNames = new Set(out.map((o) => o.name.toLowerCase()));
    for (const a of object.add ?? []) {
      const name = a.name.trim().slice(0, 200);
      if (!name || existingNames.has(name.toLowerCase())) continue;
      existingNames.add(name.toLowerCase());
      out.push({
        key: `scouted-${out.length + 1}`,
        kind: a.kind,
        name,
        sku: skuFor(skuPrefix, name, takenSkus),
        category: (a.category || "General").trim().slice(0, 80),
        description: a.description.trim().slice(0, 500),
        unit: (a.unit || "each").trim().slice(0, 40),
        unitCost: Math.round(a.unitCost * 100) / 100,
        markupPct: Math.round(a.markupPct),
        taxable: a.taxable,
        imageQuery: name.toLowerCase(),
        image: "",
      });
    }

    const minRows = preset.length ? 8 : 4;
    if (out.length < minRows) {
      log.warn("catalog-scout: too few rows after tailoring; using preset", { company: input.name, rows: out.length });
      return preset;
    }
    return out;
  } catch (e) {
    log.warn("catalog-scout: model call failed; using preset", {
      company: input.name,
      error: e instanceof Error ? e.message : String(e),
    });
    return preset;
  }
}

/* -------------------------------------------------------------------------- */
/*  Options / tiers                                                           */
/* -------------------------------------------------------------------------- */

const OptionEditSchema = z.object({
  keep: z
    .array(
      z.object({
        name: z.string().describe("Preset category name, exactly as given"),
        newName: z.string().nullable().describe("Renamed in the tenant's wording, or null"),
        description: z.string().nullable().describe("Re-described for this business, or null"),
        tierNames: z
          .array(z.string())
          .nullable()
          .describe("Optional: new names for the tiers IN ORDER (same count as the preset). Null to keep."),
      }),
    )
    .default([]),
  drop: z.array(z.string()).describe("Preset category names that do not apply").default([]),
  add: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        tiers: z
          .array(
            z.object({
              tierLabel: z.string().describe("Good / Better / Best, or the trade's own words"),
              name: z.string(),
              description: z.string(),
              priceDelta: z.number().min(0).max(1_000_000).describe("CAD above the included tier; 0 for the default"),
              isDefault: z.boolean(),
            }),
          )
          .min(2)
          .max(4),
      }),
    )
    .max(4)
    .default([]),
});

/**
 * Tailor the option/tier preset for one tenant. Never throws; returns the
 * untouched preset on any failure or guardrail trip.
 */
export async function scoutStarterOptionCatalog(input: CatalogScoutInput): Promise<OptionCategoryPreset[]> {
  const preset: OptionCategoryPreset[] = (input.industry && OPTION_CATALOG_PRESETS[input.industry]) || [];
  // Tiers only make sense where the trade sells good/better/best; with no
  // preset we don't invent a tier structure from a website alone.
  if (!preset.length || !hasScrapeSignal(input)) return preset;

  const presetLines = preset.map(
    (c) => `${c.name} — ${c.description} | tiers: ${c.tiers.map((t) => `${t.tierLabel}: ${t.name} (+${t.priceDelta})`).join(", ")}`,
  );

  try {
    const { object } = await generateObject({
      model: gateway(MODELS.text),
      schema: OptionEditSchema,
      prompt: `You are onboarding a service business into a field-service platform and must tailor its starter OPTIONS & TIERS — the good/better/best upgrade groups a customer picks from on a quote — to what THIS business actually offers.

${contextBlock(input)}

STARTER OPTION GROUPS FOR THIS INDUSTRY (name — description | tiers). Price deltas are grounded starting points — you cannot change them, only keep/rename/drop groups and add new ones:
${presetLines.join("\n")}

Return an EDIT LIST:
- keep: every group that applies. Rename the group or its tiers into the company's own wording where their site uses different terms (brand names they install, how they label their packages). Leave null when the preset is fine.
- drop: groups for things the site makes clear they don't do. Be conservative; when in doubt keep.
- add: at most 2 new groups for a clearly-advertised upgrade path the preset lacks (e.g. a shop that advertises heat pumps but the preset only tiers furnaces). Realistic CAD deltas; default tier at 0.`,
    });

    const dropSet = new Set(object.drop ?? []);
    const keepByName = new Map((object.keep ?? []).map((k) => [k.name, k]));
    const out: OptionCategoryPreset[] = [];
    for (const c of preset) {
      if (dropSet.has(c.name)) continue;
      const edit = keepByName.get(c.name);
      const tierNames = edit?.tierNames && edit.tierNames.length === c.tiers.length ? edit.tierNames : null;
      out.push({
        name: edit?.newName?.trim() ? edit.newName.trim().slice(0, 120) : c.name,
        description: edit?.description?.trim() ? edit.description.trim().slice(0, 400) : c.description,
        tiers: c.tiers.map((t, i) => ({
          ...t,
          name: tierNames?.[i]?.trim() ? tierNames[i]!.trim().slice(0, 120) : t.name,
        })),
      });
    }
    const names = new Set(out.map((o) => o.name.toLowerCase()));
    for (const a of object.add ?? []) {
      const name = a.name.trim().slice(0, 120);
      if (!name || names.has(name.toLowerCase())) continue;
      names.add(name.toLowerCase());
      const tiers = a.tiers.map((t) => ({
        tierLabel: t.tierLabel.trim().slice(0, 40) || "Option",
        name: t.name.trim().slice(0, 120),
        description: t.description.trim().slice(0, 400),
        priceDelta: Math.round(t.priceDelta),
        isDefault: t.isDefault,
      }));
      if (!tiers.some((t) => t.isDefault)) tiers[0]!.isDefault = true;
      out.push({ name, description: a.description.trim().slice(0, 400), tiers });
    }

    // Guardrail: the tailored list must still carry at least half as many
    // groups as the preset (drops are fine when replacements were added —
    // small presets like "furnace tiers" for a drain-only shop are
    // legitimately replaced wholesale).
    if (out.length < Math.max(1, Math.ceil(preset.length / 2))) {
      log.warn("catalog-scout: too few option groups after tailoring; using preset", { company: input.name, groups: out.length });
      return preset;
    }
    return out;
  } catch (e) {
    log.warn("catalog-scout: option model call failed; using preset", {
      company: input.name,
      error: e instanceof Error ? e.message : String(e),
    });
    return preset;
  }
}
