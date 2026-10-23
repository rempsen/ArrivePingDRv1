/**
 * A job OFFER: what a tech sees, and says, before they accept or decline.
 *
 * Pure (no db, no network) so the API, the web tech app and the mobile app's
 * tests can all share it.
 */
import { round2, type LineItem } from "./catalog";
import { jobTechPay, type JobPayFacts, type RiderPayRates } from "./tech-pay";

/**
 * Push notification category for a new job offer. The mobile app registers it
 * (packages/mobile/lib/push.ts) with these action ids; the server tags offer
 * pushes with it so the buttons appear.
 */
export const JOB_OFFER_CATEGORY = "job_offer";
export const JOB_OFFER_ACTIONS = { accept: "accept", details: "details", decline: "decline" } as const;

/**
 * Why a tech is turning down an offer. A fixed list so the office can see
 * patterns (one tech always "too far" = their zone is wrong), plus an optional
 * note for anything the list can't say. The mobile app keeps a copy in
 * packages/mobile/lib/offer.ts; a test keeps the two in step.
 */
export const DECLINE_REASONS = [
  "too_far",
  "schedule_conflict",
  "not_qualified",
  "vehicle_equipment",
  "personal",
  "other",
] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export const DECLINE_REASON_LABELS: Record<DeclineReason, string> = {
  too_far: "Too far away",
  schedule_conflict: "Schedule conflict",
  not_qualified: "Not qualified for this job",
  vehicle_equipment: "Vehicle or equipment issue",
  personal: "Personal reason",
  other: "Other",
};

/**
 * The text stored on the job and shown to the office: "Too far away — 90 km
 * from my last job". An older app sends free text in `reason` with no code;
 * that is kept as it was written.
 */
export function declineDetail(input: { code?: DeclineReason | null; note?: string | null; reason?: string | null }): string {
  const note = (input.note ?? "").trim();
  if (input.code) return `${DECLINE_REASON_LABELS[input.code]}${note ? ` — ${note}` : ""}`;
  return (input.reason ?? "").trim() || note;
}

export interface OfferPayEstimate {
  /** Estimated total for this job, before tax. */
  estimate: number;
  hourlyPay: number;
  mileagePay: number;
  unitPay: number;
  flatPay: number;
  /** On-site hours the hourly part assumes. */
  hours: number;
  /** Paid distance the mileage part assumes, km. */
  paidKm: number;
  /** True when neither the tech nor the job has any pay rate set. */
  unrated: boolean;
  /**
   * Parts the estimate leaves out because an input is unknown: "time" when
   * there's no expected duration but the tech is paid by the hour, "mileage"
   * when there's no drive distance but they're paid per km. The total is
   * then a floor, and the screen says so.
   */
  missing: ("time" | "mileage")[];
}

/**
 * What a tech would earn on this job if it runs to plan: the same formula as
 * on completion (`jobTechPay`), fed with the expected on-site time and the
 * drive instead of the measured ones. Round-trip mileage counts the drive both
 * ways, as completion does when the job's basis is round trip.
 */
export function estimateOfferPay(
  job: Pick<JobPayFacts, "lineItems" | "techPayModel">,
  rider: RiderPayRates,
  expected: { onSiteMinutes: number | null; driveKm: number | null },
): OfferPayEstimate {
  const km = Math.max(0, Number(expected.driveKm) || 0);
  const pay = jobTechPay(
    {
      ...job,
      onSiteMinutes: Math.max(0, Number(expected.onSiteMinutes) || 0),
      mileageToJobKm: km,
      mileageKm: km * 2,
    },
    rider,
  );
  return {
    estimate: pay.techPay,
    hourlyPay: pay.hourlyPay,
    mileagePay: pay.mileagePay,
    unitPay: pay.unitPay,
    flatPay: pay.flatPay,
    hours: pay.hours,
    paidKm: pay.paidKm,
    unrated: pay.unrated,
    missing: [
      ...(expected.onSiteMinutes == null && pay.payRatePerHour > 0 ? (["time"] as const) : []),
      ...(expected.driveKm == null && pay.payRatePerKm > 0 ? (["mileage"] as const) : []),
    ],
  };
}

/** A line on the offer: what is being installed or supplied, without margins. */
export interface OfferLine {
  name: string;
  qty: number;
  unit: string;
  kind: string;
}

export function offerLines(items: LineItem[]): OfferLine[] {
  return items
    .filter((li) => li && typeof li.name === "string" && li.name.trim())
    .slice(0, 50)
    .map((li) => ({ name: li.name, qty: round2(Number(li.qty) || 0), unit: li.unit || "", kind: li.kind || "" }));
}

/** Checklist labels from a booking's `checklistState` JSON. */
export function offerChecklist(json: string | null | undefined): { label: string; required: boolean }[] {
  try {
    const arr = JSON.parse(json || "[]");
    if (!Array.isArray(arr)) return [];
    return arr
      .map((i: unknown) =>
        typeof i === "string"
          ? { label: i, required: false }
          : i && typeof i === "object" && typeof (i as { label?: unknown }).label === "string"
            ? { label: (i as { label: string }).label, required: (i as { required?: unknown }).required === true }
            : null,
      )
      .filter((x): x is { label: string; required: boolean } => !!x && !!x.label.trim())
      .slice(0, 100);
  } catch {
    return [];
  }
}

/** "required_skills" is stored as CSV. */
export function skillList(csv: string | null | undefined): string[] {
  return (csv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
