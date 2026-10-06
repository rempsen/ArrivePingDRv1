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
import * as schema from "../api/database/schema";
import { tdb } from "../api/database/tenant";
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
  /** Set once the ICP-answer → provisioning pass (icp-answer-tuning.ts) has run. */
  icpTuningAppliedAt?: string;
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
  /** Capacity pass (technicianCount + jobsPerDay → service/template durations). */
  capacityApplied: boolean;
  capacityNote?: string;
};

/** Average open span per working day from company_settings.hours
 * (`[{day,open,close}]`, "HH:MM"). Falls back to an 8-hour day when the
 * field is freeform text, empty, or unparseable. */
export function workdayMinutesFromHours(hoursJson: string | null | undefined): number {
  const FALLBACK = 480;
  try {
    const parsed = JSON.parse(hoursJson || "");
    if (!Array.isArray(parsed)) return FALLBACK;
    const spans: number[] = [];
    for (const row of parsed) {
      const open = String(row?.open ?? "");
      const close = String(row?.close ?? "");
      const m1 = /^(\d{1,2}):(\d{2})/.exec(open);
      const m2 = /^(\d{1,2}):(\d{2})/.exec(close);
      if (!m1 || !m2) continue;
      const span = Number(m2[1]) * 60 + Number(m2[2]) - (Number(m1[1]) * 60 + Number(m1[2]));
      if (span >= 120 && span <= 24 * 60) spans.push(span);
    }
    if (!spans.length) return FALLBACK;
    return Math.round(spans.reduce((a, b) => a + b, 0) / spans.length);
  } catch {
    return FALLBACK;
  }
}

/** Share of a tech's day that is actually on-site (the rest is driving,
 * parts runs, paperwork). Field-service benchmarks put wrench time at
 * 60-75%; 70% is the middle of that band. */
const ON_SITE_SHARE = 0.7;
/** Within this band the seeded durations already match the stated volume —
 * don't churn the catalog over noise. */
const NO_CHANGE_BAND: [number, number] = [0.7, 1.4];
/** Hard clamp on how far one pass may move durations. */
const FACTOR_CLAMP: [number, number] = [0.5, 2.0];

function round15(mins: number): number {
  return Math.max(15, Math.min(480, Math.round(mins / 15) * 15));
}

/**
 * Pure helper: given the stated volume and the seeded durations, decide the
 * rescale factor (or null for "leave it"). Exported for tests/debugging.
 */
export function capacityFactor(input: {
  technicianCount?: number;
  jobsPerDay?: number;
  workdayMins: number;
  seededAvgMins: number;
}): { factor: number; impliedMins: number; jobsPerTech: number } | null {
  const techs = Math.max(1, Math.floor(input.technicianCount ?? 1));
  const jobs = input.jobsPerDay;
  if (typeof jobs !== "number" || !(jobs > 0)) return null;
  if (!(input.seededAvgMins > 0)) return null;
  const jobsPerTech = jobs / techs;
  if (!(jobsPerTech > 0)) return null;
  const impliedMins = (input.workdayMins * ON_SITE_SHARE) / jobsPerTech;
  const raw = impliedMins / input.seededAvgMins;
  if (raw >= NO_CHANGE_BAND[0] && raw <= NO_CHANGE_BAND[1]) return null;
  const factor = Math.min(FACTOR_CLAMP[1], Math.max(FACTOR_CLAMP[0], raw));
  return { factor, impliedMins, jobsPerTech };
}

/**
 * Item 6a — the capacity consumer for technicianCount + jobsPerDay.
 *
 * The seeded service `durationMins` and template `estimatedMins` are the
 * numbers the scheduler actually runs on: availability clash detection
 * (services/availability.ts), the calendar slot size (routes/calendar.ts),
 * AI dispatch workload projection (services/ai-dispatch.ts) and the
 * customer's calendar invite (services/email.ts). They were seeded as
 * industry-typical values. A shop telling us "3 techs, 24 jobs a day" is
 * telling us their real jobs are ~40 minutes, not the 90 the preset
 * assumed — so rescale the seeded durations toward the implied density.
 *
 * Conservative on purpose: no change inside a 0.7-1.4x band, factor clamped
 * to 0.5-2x, every duration rounded to 15 minutes and kept in 15-480.
 * Ratios between services are preserved (a 30-min inspection stays shorter
 * than a 3-hour install). vehicleCount isn't a duration signal — it feeds
 * the AI dispatcher's context instead (routes/ai.ts).
 */
async function applyCapacityDefaults(
  companyId: string,
  qualifying: QualifyingProfile,
  summary: TuningSummary,
): Promise<void> {
  const tdbc = tdb(companyId);
  const settings = await tdbc.selectOne(schema.companySettings);
  const services = (await tdbc.select(schema.services)).filter((s) => s.active);
  if (!services.length) {
    summary.capacityNote = "no services to size";
    return;
  }
  const seededAvgMins = services.reduce((a, s) => a + (s.durationMins || 60), 0) / services.length;
  const workdayMins = workdayMinutesFromHours(settings?.hours);
  const decision = capacityFactor({
    technicianCount: qualifying.technicianCount,
    jobsPerDay: qualifying.jobsPerDay,
    workdayMins,
    seededAvgMins,
  });
  if (!decision) {
    summary.capacityNote =
      typeof qualifying.jobsPerDay === "number"
        ? "seeded durations already match stated volume"
        : "jobsPerDay not captured";
    return;
  }

  for (const svc of services) {
    const next = round15((svc.durationMins || 60) * decision.factor);
    if (next !== svc.durationMins) {
      await tdbc.update(schema.services, { durationMins: next }, eq(schema.services.id, svc.id));
    }
  }
  const templates = await tdbc.select(schema.taskTemplates);
  for (const tpl of templates) {
    if (!tpl.estimatedMins) continue;
    const next = round15(tpl.estimatedMins * decision.factor);
    if (next !== tpl.estimatedMins) {
      await tdbc.update(schema.taskTemplates, { estimatedMins: next }, eq(schema.taskTemplates.id, tpl.id));
    }
  }
  summary.capacityApplied = true;
  summary.capacityNote = `Rescaled default durations x${decision.factor.toFixed(2)} (about ${Math.round(
    decision.jobsPerTech * 10,
  ) / 10} jobs per tech per day over a ${Math.round(workdayMins / 60)}h day implies ~${round15(
    decision.impliedMins,
  )} min on site; seeded average was ${Math.round(seededAvgMins)} min)`;
}

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
 *  - technicianCount + jobsPerDay: rescale seeded service/template
 *    durations toward the implied job density (applyCapacityDefaults
 *    above). vehicleCount is surfaced to the AI dispatcher as operating
 *    context in routes/ai.ts rather than changing any seeded data.
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
    capacityApplied: false,
  };

  if (qualifying.tuningAppliedAt) {
    summary.reason = "already applied";
    return summary;
  }

  // Capacity pass first and independently — it doesn't need templates to
  // exist, and a failure here must not stop the template tuning below.
  try {
    await applyCapacityDefaults(companyId, qualifying, summary);
  } catch (e) {
    console.error("[qualifying-tuning] capacity pass failed", e);
    summary.capacityNote = "error";
  }

  try {
    const tdbc = tdb(companyId);
    const templates = await tdbc.select(schema.taskTemplates);

    if (!templates.length) {
      summary.reason = "no templates to tune";
      summary.applied = true;
      return summary;
    }

    // Prefer a "Service" category template as the clone base (most likely to
    // carry a sensible time-based rate), else just the first template.
    const baseTemplate =
      templates.find((t) => t.category.toLowerCase() === "service") ?? templates[0]!;

    // ── emergency / rush premium ──────────────────────────────────────
    if (qualifying.offersEmergencyPremium && qualifying.emergencyMultiplierPct) {
      const mult = qualifying.emergencyMultiplierPct / 100;
      const rushTemplates = templates.filter(
        (t) => RUSH_PATTERN.test(t.name) || RUSH_PATTERN.test(t.category),
      );

      if (rushTemplates.length > 0) {
        for (const tpl of rushTemplates) {
          const rm = parseRateModel(tpl.rateModel);
          const tuned = multiplyRateModel(rm, mult);
          const noteTag = `[Priority/after-hours rate: ${qualifying.emergencyMultiplierPct}% of standard, applied from onboarding]`;
          const description = tpl.description.includes(noteTag)
            ? tpl.description
            : `${tpl.description} ${noteTag}`.trim();
          await tdbc.update(
            schema.taskTemplates,
            { rateModel: JSON.stringify(tuned), description },
            eq(schema.taskTemplates.id, tpl.id),
          );
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
        await tdbc.insert(schema.taskTemplates, {
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
        await tdbc.insert(schema.taskTemplates, {
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
    // If the capacity pass already rewrote durations, report applied so the
    // caller stamps tuningAppliedAt and a retry can't rescale them twice.
    summary.applied = summary.capacityApplied;
    return summary;
  }
}
