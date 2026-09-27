/**
 * Item 7 — wires the qualifying-chat answers (onboarding.ts, Part 2) back
 * into what's already provisioned for the tenant: catalog/templates/rate
 * models. Deterministic, not AI-generated — the qualifying answers are
 * plain numbers/booleans, so a multiply-and-tag pass is far more reliable
 * and testable than another model call, and it composes cleanly with the
 * AI-generated templates from template-scout.ts (it edits their `rateModel`
 * JSON, it doesn't regenerate them).
 *
 * Called exactly once, from the `finish_onboarding` tool in onboarding.ts,
 * gated on `qualifying.tuningAppliedAt` so re-finishing an onboarding
 * session (or a user going back and forth) never compounds the multiplier.
 * Best-effort like every other provisioning step here: never throws, always
 * returns a summary so the caller can log/report it and move on.
 */
import { eq } from "drizzle-orm";
import { db } from "../api/database";
import * as schema from "../api/database/schema";
import { EMPTY_RATE_MODEL, type RateModel } from "../shared/pricing";

/** Canonical shape of `company_settings.qualifying_profile` (JSON text column). */
export type QualifyingProfile = {
  technicianCount?: number;
  vehicleCount?: number;
  jobsPerDay?: number;
  offersMaintenancePlans?: boolean;
  offersEmergencyPremium?: boolean;
  emergencyMultiplierPct?: number; // e.g. 150 = 1.5x rate after-hours/rush
  icpAnswers?: { question: string; answer: string }[];
  /** Set once applyQualifyingTuning() has run, so it never re-runs and compounds the multiplier. */
  tuningAppliedAt?: string;
};

const RUSH_PATTERN = /emergency|rush|urgent|after.?hours|off.?hours|overtime|priority|weekend/i;
// Deliberately narrower than it could be: "routine", "inspection",
// "membership", "program" alone are too generic (they show up in
// ICP-specific templates — e.g. a sports org's "Coached Program Session" —
// with no relation to a recurring maintenance plan) and would falsely skip
// creating a real maintenance-plan template for that tenant.
const MAINTENANCE_PATTERN = /maintenance|tune.?up|preventive|service plan|membership plan/i;

const RATE_MULTIPLY_FIELDS: (keyof RateModel)[] = [
  "flatRate",
  "timeRate",
  "kmRate",
  "minCharge",
  "firstHourRate",
  "additionalHourRate",
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseRateModel(json: string | null | undefined): RateModel {
  try {
    return { ...EMPTY_RATE_MODEL, ...JSON.parse(json || "") };
  } catch {
    return { ...EMPTY_RATE_MODEL };
  }
}

function multiplyRateModel(rm: RateModel, mult: number): RateModel {
  const out: RateModel = { ...rm };
  for (const f of RATE_MULTIPLY_FIELDS) {
    const v = out[f] as number;
    if (typeof v === "number" && v > 0) (out as any)[f] = round2(v * mult);
  }
  return out;
}

export type TuningSummary = {
  applied: boolean;
  reason?: string;
  emergencyTemplatesTuned: number;
  emergencyTemplateCreated: boolean;
  maintenanceTemplateCreated: boolean;
};

/**
 * Tune the tenant's already-seeded work-order templates using their
 * qualifying-chat answers:
 *
 *  - offersEmergencyPremium + emergencyMultiplierPct: multiply the rate
 *    model on every rush/emergency/after-hours-flavored template by the
 *    multiplier. If the tenant has no such template yet (the AI-generated
 *    set for their ICP didn't include one), clone their best base template
 *    into a new "Emergency / After-Hours Call" one so the premium actually
 *    has somewhere to live.
 *
 *  - offersMaintenancePlans: if true and the tenant has no
 *    maintenance/routine/plan-flavored template yet, add a starter
 *    "Maintenance Plan Visit" template cloned from their base workflow.
 *    Never removes or edits anything if a suitable template already exists
 *    — additive only.
 *
 * technicianCount / vehicleCount / jobsPerDay are intentionally NOT wired
 * into provisioning here — they're capacity/context signals with no
 * concrete downstream consumer yet (no scheduling/capacity-planning
 * feature exists in the app to hand them to). They stay stored in
 * qualifying_profile for future use rather than forcing a change that
 * isn't grounded in anything real.
 */
export async function applyQualifyingTuning(
  companyId: string,
  qualifying: QualifyingProfile,
): Promise<TuningSummary> {
  const summary: TuningSummary = {
    applied: false,
    emergencyTemplatesTuned: 0,
    emergencyTemplateCreated: false,
    maintenanceTemplateCreated: false,
  };

  if (qualifying.tuningAppliedAt) {
    summary.reason = "already applied";
    return summary;
  }

  try {
    const templates = await db
      .select()
      .from(schema.taskTemplates)
      .where(eq(schema.taskTemplates.companyId, companyId));

    if (!templates.length) {
      summary.reason = "no templates to tune";
      return summary;
    }

    // Prefer a "Service" category template as the clone base (most likely to
    // carry a sensible time-based rate), else just the first template.
    const baseTemplate =
      templates.find((t) => t.category.toLowerCase() === "service") ?? templates[0];

    // ── emergency / rush premium ──────────────────────────────────────
    if (qualifying.offersEmergencyPremium && qualifying.emergencyMultiplierPct) {
      const mult = qualifying.emergencyMultiplierPct / 100;
      const rushTemplates = templates.filter(
        (t) => RUSH_PATTERN.test(t.name) || RUSH_PATTERN.test(t.category),
      );

      if (rushTemplates.length > 0) {
        for (const t of rushTemplates) {
          const rm = parseRateModel(t.rateModel);
          const tuned = multiplyRateModel(rm, mult);
          const noteTag = `[Priority/after-hours rate: ${qualifying.emergencyMultiplierPct}% of standard, applied from onboarding]`;
          const description = t.description.includes(noteTag)
            ? t.description
            : `${t.description} ${noteTag}`.trim();
          await db
            .update(schema.taskTemplates)
            .set({ rateModel: JSON.stringify(tuned), description })
            .where(eq(schema.taskTemplates.id, t.id));
          summary.emergencyTemplatesTuned++;
        }
      } else {
        // No rush-flavored template exists for this ICP's generated set —
        // clone the base template into one so the premium has a home.
        const baseFields = JSON.parse(baseTemplate.fields || "[]");
        const baseChecklist = JSON.parse(baseTemplate.checklist || "[]");
        const hasUrgencyField = baseFields.some((f: any) =>
          /urgency/i.test(f.label || ""),
        );
        const fields = hasUrgencyField
          ? baseFields
          : [
              { id: crypto.randomUUID(), type: "select", label: "Urgency reason", required: true },
              ...baseFields,
            ];
        const hasPremiumCheck = baseChecklist.some((c: any) =>
          /premium|rush/i.test(c.label || ""),
        );
        const checklist = hasPremiumCheck
          ? baseChecklist
          : [
              { id: crypto.randomUUID(), label: "Confirm rush/after-hours premium with customer", required: true },
              ...baseChecklist,
            ];
        const rm = parseRateModel(baseTemplate.rateModel);
        const tuned = multiplyRateModel(rm, mult);
        const noteTag = `[Priority/after-hours rate: ${qualifying.emergencyMultiplierPct}% of standard, applied from onboarding]`;
        await db.insert(schema.taskTemplates).values({
          companyId,
          name: "Emergency / After-Hours Call",
          category: "Emergency",
          icon: "alert-triangle",
          color: baseTemplate.color,
          description: `Urgent or after-hours call that jumps the queue and carries a rush premium. ${noteTag}`.trim(),
          fields: JSON.stringify(fields),
          checklist: JSON.stringify(checklist),
          estimatedMins: baseTemplate.estimatedMins,
          rateModel: JSON.stringify(tuned),
          active: true,
        });
        summary.emergencyTemplateCreated = true;
      }
    }

    // ── routine maintenance plans ──────────────────────────────────────
    if (qualifying.offersMaintenancePlans) {
      const hasMaintenanceTemplate = templates.some(
        (t) => MAINTENANCE_PATTERN.test(t.name) || MAINTENANCE_PATTERN.test(t.category),
      );
      if (!hasMaintenanceTemplate) {
        const baseFields = JSON.parse(baseTemplate.fields || "[]");
        const baseChecklist = JSON.parse(baseTemplate.checklist || "[]");
        const fields = [
          ...baseFields,
          { id: crypto.randomUUID(), type: "date", label: "Next visit due date", required: false },
        ];
        const checklist = [
          ...baseChecklist,
          { id: crypto.randomUUID(), label: "Log readings/notes for next visit", required: false },
        ];
        await db.insert(schema.taskTemplates).values({
          companyId,
          name: "Maintenance Plan Visit",
          category: "Maintenance",
          icon: "calendar-check",
          color: baseTemplate.color,
          description: "Recurring maintenance-plan visit for a customer on a routine service plan.",
          fields: JSON.stringify(fields),
          checklist: JSON.stringify(checklist),
          estimatedMins: baseTemplate.estimatedMins,
          rateModel: baseTemplate.rateModel,
          active: true,
        });
        summary.maintenanceTemplateCreated = true;
      }
    }

    summary.applied = true;
    return summary;
  } catch (e) {
    console.error("[qualifying-tuning] applyQualifyingTuning failed", e);
    summary.reason = "error";
    return summary;
  }
}
