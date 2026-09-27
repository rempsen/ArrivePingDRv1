/**
 * ONBOARDING — turns a website URL into a fully-seeded tenant, then closes
 * whatever gaps the automated scrape couldn't fill with a short, guided AI
 * conversation.
 *
 * Two front doors feed the SAME pipeline (services/company-provisioning.ts):
 *   - the superadmin "New Company" panel (routes/superadmin.ts)
 *   - the public self-serve signup flow (this file, `onboardingPublicRoutes`)
 * so a tenant who signs themselves up ends up exactly as fully set up as one
 * a superadmin built by hand.
 *
 * This file exports TWO route groups:
 *   - `onboardingPublicRoutes` — mounted at /api/public/onboarding, BEFORE
 *     authMiddleware. Unauthenticated by design (nobody has a login yet):
 *     scrape-on-URL-entry + the actual signup. Rate-limited by IP.
 *   - `onboardingRoutes` — mounted at /onboarding, AFTER authMiddleware.
 *     Admin-only, tenant-scoped: the finishing-touches AI chat that runs on
 *     first login for every freshly-provisioned tenant (self-serve or
 *     superadmin-built alike — see `companies.onboardingCompletedAt`).
 */
import type { AppEnv } from "../env";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { requireAdmin, tenantId } from "../middleware/auth";
import { gateway, MODELS } from "../agent/gateway";
import { rateLimit, keyByIp } from "../lib/rate-limit";
import { jsonBody, optText } from "../lib/validate";
import { Err } from "../lib/errors";
import {
  provisionCompany,
  websiteUrlSchema,
  CompanyCreateBody,
  seedCatalogForCompany,
  seedOptionCatalogForCompany,
  loadIcpKnowledge,
} from "../../services/company-provisioning";
import { scoutBrand } from "../../services/brand-scout";
import { applyQualifyingTuning, type QualifyingProfile } from "../../services/qualifying-tuning";
import {
  getIndustryPreset,
  industryLabel,
  INDUSTRY_LABELS,
  INDUSTRY_GROUPS,
} from "../../services/industry-presets";

/* -------------------------------------------------------------------------- */
/*  Rate limits — public, unauthenticated, IP-keyed on purpose (nobody has a  */
/*  credential yet). Scout is generous (typing a URL can trigger it a few     */
/*  times as the debounce settles); signup is tight (it provisions a real     */
/*  tenant + admin login, so it's the one worth protecting hardest).          */
/* -------------------------------------------------------------------------- */
const onboardingScoutLimiter = rateLimit({
  name: "onboarding-scout",
  limit: 10,
  windowMs: 60_000,
  keyFn: keyByIp,
});
const onboardingSignupLimiter = rateLimit({
  name: "onboarding-signup",
  limit: 6,
  windowMs: 60 * 60_000,
  keyFn: keyByIp,
});

/* -------------------------------------------------------------------------- */
/*  PUBLIC: scrape-on-URL-entry + self-serve signup                          */
/* -------------------------------------------------------------------------- */

const ScoutBody = z.object({
  website: websiteUrlSchema,
  name: optText(200),
});

// Self-serve is CompanyCreateBody minus the manager fields (no "invite a
// second person" step in the public flow — they can add teammates later from
// inside the app) and with plan hardcoded to "starter" (self-serve tenants
// don't get to pick pro/enterprise from a public form).
const SelfServeSignupBody = CompanyCreateBody.omit({
  plan: true,
  managerName: true,
  managerEmail: true,
  managerPassword: true,
});

export const onboardingPublicRoutes = new Hono<AppEnv>()
  // POST /api/public/onboarding/scout — fired automatically the moment the
  // signup form has a valid website URL (debounced client-side), and again
  // by the manual "Re-scan" fallback button. No DB writes — same shape as the
  // superadmin brand-scout endpoint, just reachable pre-login.
  .post("/scout", onboardingScoutLimiter, jsonBody(ScoutBody), async (c) => {
    const b = c.req.valid("json");
    const website = b.website;
    const companyId = website.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 60) || "pending";
    try {
      const proposal = await scoutBrand(website, `pending-${companyId}`);
      return c.json({ proposal }, 200);
    } catch (e: any) {
      return c.json({ message: `Brand scout failed: ${e?.message ?? "unknown error"}` }, 502);
    }
  })

  // POST /api/public/onboarding/signup — provisions a brand-new tenant end to
  // end (same pipeline the superadmin panel uses) and returns just enough for
  // the client to immediately sign the admin in with the credentials THEY
  // typed. Deliberately does NOT return the raw API key secret here — unlike
  // the superadmin flow (a trusted internal operator acting on someone else's
  // behalf), this response body is sitting in a stranger's browser before
  // they've even authenticated; the admin can view/rotate their key from
  // Settings once signed in.
  .post("/signup", onboardingSignupLimiter, jsonBody(SelfServeSignupBody), async (c) => {
    const b = c.req.valid("json");
    const result = await provisionCompany({ ...b, plan: "starter" }, {}, { source: "self_serve" });
    return c.json(
      {
        companySlug: result.company.id,
        companyName: result.company.name,
        admin: result.admin,
        seeded: result.seeded,
      },
      201,
    );
  });

/* -------------------------------------------------------------------------- */
/*  AUTHENTICATED: onboarding status + the finishing-touches AI chat         */
/* -------------------------------------------------------------------------- */

/**
 * Shape of `company_settings.qualifying_profile` (JSON text column) — see
 * qualifying-tuning.ts for the canonical type. Captured by the qualifying
 * section of the onboarding chat below: the 5 mandatory baseline questions
 * plus a handful of ICP-specific ones the agent designs itself from the
 * deep research. Provisioning (templates/catalog/notifications) already ran
 * before this exists, so nothing downstream ASSUMES it is populated — but
 * `finish_onboarding` below does make one best-effort pass
 * (applyQualifyingTuning) to tune the rush/maintenance-flavored templates
 * once it is.
 */

async function buildOnboardingSnapshot(cid: string) {
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, cid));
  const [settings] = await db.select().from(schema.companySettings).where(eq(schema.companySettings.companyId, cid));
  if (!company || !settings) throw Err.notFound("Company not found");

  const [forms, templates, services, catalog, options] = await Promise.all([
    db.select().from(schema.intakeForms).where(eq(schema.intakeForms.companyId, cid)),
    db.select().from(schema.taskTemplates).where(eq(schema.taskTemplates.companyId, cid)),
    db.select().from(schema.services).where(eq(schema.services.companyId, cid)),
    db.select().from(schema.catalogItems).where(eq(schema.catalogItems.companyId, cid)),
    db.select().from(schema.optionCategories).where(eq(schema.optionCategories.companyId, cid)),
  ]);

  const knowledge = await loadIcpKnowledge(company.industry).catch(() => null);

  let qualifying: QualifyingProfile = {};
  try {
    qualifying = JSON.parse(settings.qualifyingProfile || "{}");
  } catch {
    qualifying = {};
  }
  const baselineDone =
    typeof qualifying.technicianCount === "number" &&
    typeof qualifying.vehicleCount === "number" &&
    typeof qualifying.jobsPerDay === "number" &&
    typeof qualifying.offersMaintenancePlans === "boolean" &&
    typeof qualifying.offersEmergencyPremium === "boolean";

  // What actually got auto-provisioned for THIS tenant — the real, concrete
  // surface a "customize the workflow" question should be anchored to, not a
  // generic guess. Rate-model shape is summarized (flat / hourly / per-km /
  // mixed) rather than dumped raw, since only the billing SHAPE matters for
  // a qualifying question, not the exact seeded dollar figures.
  const templateSummaries = templates.map((t) => {
    let rm: any = {};
    try {
      rm = JSON.parse(t.rateModel || "{}");
    } catch {
      /* ignore */
    }
    const parts: string[] = [];
    if (rm.flatRate) parts.push(`${rm.flatRate} flat`);
    if (rm.timeRate) parts.push(`${rm.timeRate}/${rm.timeUnit || "hour"}`);
    if (rm.kmRate) parts.push(`${rm.kmRate}/km`);
    return `${t.name} (${t.category}${parts.length ? `, ${parts.join(" + ")}` : ""})`;
  });
  const catalogCategories = Array.from(new Set(catalog.map((c) => c.category).filter(Boolean)));
  const optionSummaries = options.map((o) => o.name);

  return {
    company,
    settings,
    counts: {
      forms: forms.length,
      templates: templates.length,
      services: services.length,
      catalogItems: catalog.length,
      optionCategories: options.length,
    },
    structure: {
      templates: templateSummaries,
      catalogCategories,
      optionCategories: optionSummaries,
    },
    knowledge,
    qualifying,
    checklist: {
      hasIndustry: Boolean(company.industry && company.industry !== "other"),
      hasLogo: Boolean(settings.logo),
      hasTagline: Boolean(settings.tagline),
      hasServiceArea: Boolean(settings.serviceArea),
      hasCatalog: catalog.length > 0,
      hasForms: forms.length > 0,
      hasTemplates: templates.length > 0,
      hasQualifyingBaseline: baselineDone,
      done: Boolean(company.onboardingCompletedAt),
    },
  };
}

export const onboardingRoutes = new Hono<AppEnv>()
  // GET /onboarding/status — grounds both the finishing-chat's first message
  // and a live checklist sidebar the frontend renders next to it.
  .get("/status", requireAdmin, async (c) => {
    const snap = await buildOnboardingSnapshot(tenantId(c));
    return c.json(snap, 200);
  })

  // POST /onboarding/complete — "I'll finish this later" skip button. The
  // `finish_onboarding` tool below does the same write when the AI decides
  // the conversation is done; this is the manual escape hatch.
  .post("/complete", requireAdmin, async (c) => {
    const cid = tenantId(c);
    await db
      .update(schema.companies)
      .set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.companies.id, cid));
    return c.json({ ok: true }, 200);
  })

  // POST /onboarding/chat — the agentic finishing-touches conversation.
  // Streams back a hand-rolled SSE protocol (not the ai-sdk data-stream
  // protocol, since the frontend has no ai-sdk React client installed):
  //   event: delta    — a chunk of the assistant's reply text
  //   event: tool      — {name, input, output} once a tool call resolves,
  //                       so the frontend can flash "✓ set your service area"
  //                       and refresh the live checklist
  //   event: done      — this turn is over
  //   event: complete   — the AI called finish_onboarding; frontend should
  //                       close the wizard and drop into the real app
  .post(
    "/chat",
    requireAdmin,
    jsonBody(
      z.object({
        messages: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().max(4_000),
            }),
          )
          .max(60),
      }),
    ),
    async (c) => {
      const cid = tenantId(c);
      const { messages } = c.req.valid("json");
      const snap = await buildOnboardingSnapshot(cid);

      let finished = false;

      const industryList = INDUSTRY_GROUPS.flatMap((g) =>
        INDUSTRY_LABELS.filter((i) => i.group === g).map((i) => `${i.id} — ${i.label} (${g})`),
      ).join("\n");

      const k = snap.knowledge;
      const q = snap.qualifying;
      const icpAnswered = q.icpAnswers?.length ?? 0;
      const system = `You are the onboarding concierge inside ArrivePing (a field-service dispatch
platform). A new tenant, "${snap.company.name}", just signed up and their site was
auto-scraped for branding. This is the very first thing they see — make it
feel like a smart person who already did their homework, not a form.

This ONE conversation has TWO parts, back to back, in this order:

PART 1 — BRAND/PROFILE GAPS. Close whatever the scrape couldn't fill:
industry confirmation, terminology, tagline, service area.

PART 2 — QUALIFYING QUESTIONS. Once Part 1's essentials are settled, ask a
focused round of 5-10 qualifying questions so ArrivePing understands how this
business actually operates AND so the workflows/catalog/pricing already
auto-provisioned for them get tuned into something best-in-class for THIS
specific operator, not just generically correct for the industry. This part
is MANDATORY, not optional filler — don't skip straight to finish_onboarding
without it unless the user explicitly says to skip/finish everything.

  Ask AT MINIMUM (call save_qualifying_baseline as soon as each is answered,
  don't wait to batch them):
    1. How many ${snap.settings.workerNoun.toLowerCase()}s/techs do they have? (technicianCount)
    2. How many vehicles in the fleet? (vehicleCount)
    3. Roughly how many ${snap.settings.jobNoun.toLowerCase()}s/calls per day? (jobsPerDay)
    4. Do they sell/offer routine maintenance plans (recurring service
       contracts, not one-off calls)? yes/no (offersMaintenancePlans)
    5. Do they charge a premium for emergency/rush/after-hours work? yes/no,
       and if yes, roughly what multiplier (e.g. "1.5x", "double") —
       (offersEmergencyPremium + emergencyMultiplierPct, e.g. 150 for 1.5x)

  THEN design and ask 1-5 MORE questions SPECIFIC to this ICP. Before you
  write a single one of these, do the following review — silently, in your
  own reasoning, not out loud to the user:
    a) Read WHAT'S ALREADY BUILT FOR THIS TENANT below — the actual
       work-order templates, catalog categories, and option/tier groups
       ArrivePing already auto-provisioned for them at signup. This is the
       real, concrete surface you're tuning: every question you ask should
       trace to one of these being configured wrong/generic for this
       specific operator (a rate model that's flat when this business
       actually bills hourly, a missing tier this operator's segment expects,
       a checklist gate that's overkill or missing for their actual scale).
    b) Read the DEEP RESEARCH NOTES below — this is curated trade-publication
       and standards-body research specific to this ICP, more authoritative
       than generic assumptions.
    c) Then apply your OWN expert knowledge of best-in-class field-service /
       operations workflow management for this specific vertical — the kind
       of operational maturity questions a seasoned ops consultant for this
       exact trade would ask a new client in a 15-minute intake call:
       capacity/scale signals that change which templates or rate models fit
       (crew size vs. solo-op changes whether dispatch/assignment even
       matters), segment signals that change pricing structure (membership
       vs. transactional, contract vs. one-off, tiered service levels),
       compliance/quality-gate signals specific to the trade (licensing,
       inspection sign-off, safety documentation) that should turn a
       checklist item from optional to required or vice versa, and
       seasonality/volume signals that change what's worth pre-building at
       all for them right now vs. later.
    Design questions that answer (b)+(c) filtered through what's concretely
    tunable per (a) — not textbook trivia, not something a generic SaaS
    onboarding wizard would ask any industry. Examples of the RIGHT altitude:
    a sports facility with court-rental templates already seeded — ask how
    many courts/fields/spaces and the prime-time vs off-peak split, because
    that directly informs whether the rental rate model needs a peak
    multiplier; an HVAC/plumbing shop with a maintenance-plan template
    seeded — ask how many service-agreement tiers they actually sell and
    whether they truck-stock common parts, because that changes the
    template's fields and the catalog's part-availability assumptions;
    equipment rental — typical rental duration and whether they run a
    damage-waiver program; property management — number of units/properties
    and whether turns are scheduled or on-demand.
    Call save_icp_qualifying_answer for each of these as they're answered.
  Total across both mandatory + ICP-specific: 5-10 questions, one at a time.

Rules:
- One question at a time. Never dump a checklist of questions on them.
- Open by briefly confirming what was already detected (industry, worker/
  customer/job terms, tagline) so they feel understood, then ask about
  whatever is genuinely still missing in Part 1, then move into Part 2.
- If something in CURRENT STATE below already looks right/already answered,
  don't ask about it again — just move on.
- Call update_brand_profile / set_industry / add_catalog_item /
  save_qualifying_baseline / save_icp_qualifying_answer AS SOON AS the user
  gives you the info — don't wait to batch it at the end. Narrate what you
  just did in one short sentence ("Got it — service area set to Ottawa and
  the surrounding region.").
- Keep replies to 1-3 short sentences. No corporate tone, no bullet-point
  walls, no "Great question!".
- Only call finish_onboarding once Part 1's essentials AND the 5 mandatory
  qualifying fields are captured (or the user explicitly says they're done /
  it's fine / skip it — then call it immediately regardless of what's
  missing). Don't drag either part out chasing perfection.

CURRENT STATE:
- Industry: ${snap.company.industry ? industryLabel(snap.company.industry) || snap.company.industry : "not yet set"}${snap.company.industryOther ? ` (${snap.company.industryOther})` : ""}
- Worker / Customer / Job terms: ${snap.settings.workerNoun} / ${snap.settings.customerNoun} / ${snap.settings.jobNoun}
- Tagline: ${snap.settings.tagline || "(none)"}
- Service area: ${snap.settings.serviceArea || "(not set — ask about this if industry needs it)"}
- Catalog seeded: ${snap.counts.catalogItems} items, ${snap.counts.optionCategories} option groups
- Starter forms/templates seeded: ${snap.counts.forms} forms, ${snap.counts.templates} work-order templates
- Qualifying baseline captured so far: technicianCount=${q.technicianCount ?? "?"}, vehicleCount=${q.vehicleCount ?? "?"}, jobsPerDay=${q.jobsPerDay ?? "?"}, offersMaintenancePlans=${q.offersMaintenancePlans ?? "?"}, offersEmergencyPremium=${q.offersEmergencyPremium ?? "?"}${q.offersEmergencyPremium ? `, emergencyMultiplierPct=${q.emergencyMultiplierPct ?? "?"}` : ""}
- ICP-specific qualifying questions answered so far: ${icpAnswered}${icpAnswered ? "\n" + q.icpAnswers!.map((a) => `  - Q: ${a.question}\n    A: ${a.answer}`).join("\n") : ""}

WHAT'S ALREADY BUILT FOR THIS TENANT (the concrete surface your ICP-specific
questions should tune — see step (a) above):
- Work-order templates seeded: ${snap.structure.templates.length ? snap.structure.templates.join("; ") : "(none yet)"}
- Catalog categories seeded: ${snap.structure.catalogCategories.length ? snap.structure.catalogCategories.join(", ") : "(none yet)"}
- Option/tier groups seeded: ${snap.structure.optionCategories.length ? snap.structure.optionCategories.join(", ") : "(none — this ICP may not use good/better/best tiers)"}
${k ? `\nDEEP RESEARCH NOTES for this industry (use to sound like a specialist AND to design the ICP-specific qualifying questions — don't recite verbatim):\n- ${k.summary ?? ""}\n- Terminology: ${k.terminologyNotes ?? "n/a"}\n- Workflow: ${k.workflowNotes ?? "n/a"}\n- Best practices: ${k.bestPractices?.join("; ") ?? "n/a"}\n- Compliance: ${k.complianceNotes ?? "n/a"}` : ""}

INDUSTRY OPTIONS (id — label (group), for set_industry):
${industryList}
other — Other (free-text business description)`;

      const tools = {
        update_brand_profile: tool({
          description:
            "Update the tenant's brand profile — terminology, tagline, colors, hours, or service area. Only pass the fields the user actually gave you.",
          inputSchema: z.object({
            tagline: z.string().max(300).optional(),
            workerNoun: z.string().max(40).optional(),
            workerNounPlural: z.string().max(40).optional(),
            customerNoun: z.string().max(40).optional(),
            customerNounPlural: z.string().max(40).optional(),
            jobNoun: z.string().max(40).optional(),
            jobNounPlural: z.string().max(40).optional(),
            primaryColor: z.string().max(9).optional(),
            accentColor: z.string().max(9).optional(),
            hours: z.string().max(300).optional(),
            serviceArea: z.string().max(300).optional(),
          }),
          execute: async (input) => {
            const patch: Record<string, unknown> = {};
            const hex = /^#[0-9a-f]{3,8}$/i;
            for (const [key, val] of Object.entries(input)) {
              if (typeof val !== "string" || !val.trim()) continue;
              if ((key === "primaryColor" || key === "accentColor") && !hex.test(val.trim())) continue;
              patch[key] = val.trim();
            }
            if (Object.keys(patch).length === 0) return { updated: [] };
            await db.update(schema.companySettings).set(patch).where(eq(schema.companySettings.companyId, cid));
            return { updated: Object.keys(patch) };
          },
        }),
        set_industry: tool({
          description:
            "Confirm or correct the tenant's Primary Industry (ICP). If the tenant currently has no catalog seeded, this also seeds the standard catalog + option groups for the newly-set industry.",
          inputSchema: z.object({
            industryId: z.string().max(80),
            industryOther: z.string().max(200).optional(),
          }),
          execute: async ({ industryId, industryOther }) => {
            const preset = getIndustryPreset(industryId);
            const resolved = preset?.id ?? (industryId === "other" ? "other" : "");
            if (!resolved) return { ok: false, message: "Unrecognized industry id" };
            await db
              .update(schema.companies)
              .set({
                industry: resolved,
                industryOther: resolved === "other" ? String(industryOther ?? "").slice(0, 200) : "",
                updatedAt: new Date(),
              })
              .where(eq(schema.companies.id, cid));
            let catalogSeeded = 0;
            let optionsSeeded = 0;
            if (preset?.id && snap.counts.catalogItems === 0) {
              catalogSeeded = await seedCatalogForCompany(cid, preset.id).catch(() => 0);
              optionsSeeded = await seedOptionCatalogForCompany(cid, preset.id).catch(() => 0);
            }
            return { ok: true, industry: industryLabel(resolved) || resolved, catalogSeeded, optionsSeeded };
          },
        }),
        add_catalog_item: tool({
          description:
            "Add one priced item/service to the tenant's catalog — for something specific they mentioned that the standard preset didn't cover.",
          inputSchema: z.object({
            name: z.string().max(200),
            unit: z.string().max(40).optional(),
            unitCost: z.number().min(0).max(1_000_000).optional(),
            markupPct: z.number().min(0).max(500).optional(),
            category: z.string().max(80).optional(),
            kind: z.enum(["service", "product"]).optional(),
          }),
          execute: async (input) => {
            const [row] = await db
              .insert(schema.catalogItems)
              .values({
                companyId: cid,
                kind: input.kind ?? "service",
                name: input.name.slice(0, 200),
                category: input.category?.slice(0, 80) || "General",
                unit: input.unit?.slice(0, 40) || "each",
                unitCost: input.unitCost ?? 0,
                markupPct: input.markupPct ?? 35,
                priceMode: "auto",
                unitPrice: 0,
                taxable: true,
                components: "[]",
                active: true,
              })
              .returning({ id: schema.catalogItems.id });
            return { ok: Boolean(row), name: input.name };
          },
        }),
        save_qualifying_baseline: tool({
          description:
            "Save one or more of the 5 mandatory qualifying baseline fields as soon as the user answers them. Call this incrementally — one field at a time is fine, don't wait to collect all 5 first.",
          inputSchema: z.object({
            technicianCount: z.number().int().min(0).max(100_000).optional(),
            vehicleCount: z.number().int().min(0).max(100_000).optional(),
            jobsPerDay: z.number().min(0).max(100_000).optional(),
            offersMaintenancePlans: z.boolean().optional(),
            offersEmergencyPremium: z.boolean().optional(),
            emergencyMultiplierPct: z
              .number()
              .min(100)
              .max(1000)
              .optional()
              .describe("e.g. 150 for 1.5x, 200 for double — only when offersEmergencyPremium is true"),
          }),
          execute: async (input) => {
            const [row] = await db
              .select({ qualifyingProfile: schema.companySettings.qualifyingProfile })
              .from(schema.companySettings)
              .where(eq(schema.companySettings.companyId, cid));
            let current: QualifyingProfile = {};
            try {
              current = JSON.parse(row?.qualifyingProfile || "{}");
            } catch {
              current = {};
            }
            const updated: QualifyingProfile = { ...current };
            const saved: string[] = [];
            for (const [key, val] of Object.entries(input)) {
              if (val === undefined) continue;
              (updated as any)[key] = val;
              saved.push(key);
            }
            if (!saved.length) return { saved: [] };
            await db
              .update(schema.companySettings)
              .set({ qualifyingProfile: JSON.stringify(updated), updatedAt: new Date() })
              .where(eq(schema.companySettings.companyId, cid));
            return { saved };
          },
        }),
        save_icp_qualifying_answer: tool({
          description:
            "Save ONE ICP-specific qualifying question+answer pair you designed yourself for this industry (beyond the 5 mandatory baseline fields). Call once per question, right after the user answers it.",
          inputSchema: z.object({
            question: z.string().max(300),
            answer: z.string().max(500),
          }),
          execute: async ({ question, answer }) => {
            const [row] = await db
              .select({ qualifyingProfile: schema.companySettings.qualifyingProfile })
              .from(schema.companySettings)
              .where(eq(schema.companySettings.companyId, cid));
            let current: QualifyingProfile = {};
            try {
              current = JSON.parse(row?.qualifyingProfile || "{}");
            } catch {
              current = {};
            }
            const icpAnswers = Array.isArray(current.icpAnswers) ? current.icpAnswers.slice() : [];
            icpAnswers.push({ question: question.slice(0, 300), answer: answer.slice(0, 500) });
            const updated: QualifyingProfile = { ...current, icpAnswers };
            await db
              .update(schema.companySettings)
              .set({ qualifyingProfile: JSON.stringify(updated), updatedAt: new Date() })
              .where(eq(schema.companySettings.companyId, cid));
            return { ok: true, totalIcpAnswers: icpAnswers.length };
          },
        }),
        finish_onboarding: tool({
          description:
            "Call this once the essentials are covered, or the user asks to skip/finish. Ends the onboarding conversation.",
          inputSchema: z.object({ summary: z.string().max(500).optional() }),
          execute: async ({ summary }) => {
            finished = true;
            await db
              .update(schema.companies)
              .set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
              .where(eq(schema.companies.id, cid));

            // Item 7: one best-effort pass to wire the qualifying answers
            // into what's already provisioned (rush-premium/maintenance
            // template tuning). Gated on tuningAppliedAt so it never
            // compounds if the user reaches finish_onboarding more than
            // once in a session. Never blocks finishing on failure.
            let tuning: Awaited<ReturnType<typeof applyQualifyingTuning>> | null = null;
            try {
              const [row] = await db
                .select({ qualifyingProfile: schema.companySettings.qualifyingProfile })
                .from(schema.companySettings)
                .where(eq(schema.companySettings.companyId, cid));
              let current: QualifyingProfile = {};
              try {
                current = JSON.parse(row?.qualifyingProfile || "{}");
              } catch {
                current = {};
              }
              if (!current.tuningAppliedAt) {
                tuning = await applyQualifyingTuning(cid, current);
                if (tuning.applied) {
                  const updated: QualifyingProfile = { ...current, tuningAppliedAt: new Date().toISOString() };
                  await db
                    .update(schema.companySettings)
                    .set({ qualifyingProfile: JSON.stringify(updated), updatedAt: new Date() })
                    .where(eq(schema.companySettings.companyId, cid));
                }
              }
            } catch (e) {
              console.error("[onboarding] qualifying tuning failed", e);
            }

            return { ok: true, summary: summary ?? "", tuning };
          },
        }),
      } as const;

      const result = streamText({
        // Deep reasoning model: this conversation has to review the full ICP
        // knowledge base + what's already provisioned for this tenant and
        // design good ICP-specific qualifying questions itself, not just
        // fill a form — worth the extra latency/cost over MODELS.text.
        model: gateway(MODELS.reasoning),
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        tools,
        // 5-10 questions × (tool-call step + reply step) plus Part 1 brand
        // exchanges needs real headroom — 6 was sized for the old
        // brand-only flow and would cut a qualifying round off mid-way.
        stopWhen: stepCountIs(24),
      });

      return streamSSE(c, async (stream) => {
        try {
          for await (const part of result.fullStream) {
            if (part.type === "text-delta") {
              await stream.writeSSE({ event: "delta", data: part.text });
            } else if (part.type === "tool-result") {
              await stream.writeSSE({
                event: "tool",
                data: JSON.stringify({
                  name: (part as any).toolName,
                  input: (part as any).input,
                  output: (part as any).output,
                }),
              });
            } else if (part.type === "error") {
              await stream.writeSSE({ event: "error", data: String((part as any).error ?? "error") });
            }
          }
        } catch (e: any) {
          await stream.writeSSE({ event: "error", data: e?.message ?? "stream failed" });
        }
        await stream.writeSSE({ event: "done", data: "1" });
        if (finished) await stream.writeSSE({ event: "complete", data: "1" });
      });
    },
  );
