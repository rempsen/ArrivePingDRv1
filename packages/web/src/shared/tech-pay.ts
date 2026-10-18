import { sumUnitLinePay, round2, parseLineItems, type LineItem } from "./catalog";
import { mileageFor, type MileageBasis } from "./pricing";

/**
 * What the technician actually earns on a job.
 *
 *   tech pay = (on-site minutes -> hours) x the hourly rate
 *            + paid distance x the mileage rate
 *            + a flat amount per job
 *            + the pay side of every per-unit line item (e.g. $1.20/sq-ft installed)
 *
 * The rates come from the technician's own record unless the job's workflow
 * (template / work order `techPayModel`) sets its own — which is how a company
 * pays a tech one rate while charging the client another (the client side is
 * the separate `RateModel` in pricing.ts).
 *
 * This is the single source of truth. It is used when a job is completed
 * (`accrueTechPay`), when a payout is generated for a pay period, and by the
 * Earnings screens — so all three always agree. Previously payouts were a flat
 * percentage of the customer's invoice, which could never reconcile with what
 * the driver app told the tech they had earned.
 *
 * Deliberately pure and defensive:
 *  - `Number(undefined)` / `Number("nonsense")` is NaN, and NaN money silently
 *    poisons every total downstream, so non-finite inputs fall back to 0.
 *  - Negative minutes or a negative rate (a typo in the team screen) must never
 *    produce negative pay, which would quietly claw back other jobs in the same
 *    payout period.
 *  - Catalog/product cost is company COGS, NOT tech pay — only `kind: "unit"`
 *    lines pay the tech (see `sumUnitLinePay`).
 */
export interface TechPayInput {
  /** Billed minutes actually worked on site (the geofenced clock). */
  onSiteMinutes: number;
  /** The tech's hourly rate for on-site time, from their team/rider record. */
  payRatePerHour: number;
  /** Parsed line items on the booking. */
  lineItems: LineItem[];
  /** Distance that counts for mileage pay, km (already basis- and allowance-resolved). */
  paidKm?: number;
  /** Mileage pay per km. */
  payRatePerKm?: number;
  /** Flat pay for the job. */
  flatPay?: number;
}

export interface TechPayResult {
  hours: number;
  payRatePerHour: number;
  hourlyPay: number;
  unitPay: number;
  /** Distance paid for, km, and what it earned. */
  paidKm: number;
  payRatePerKm: number;
  mileagePay: number;
  flatPay: number;
  techPay: number;
  /**
   * True when this job produced $0 because nobody set the tech's hourly rate
   * and there was no per-unit pay either — i.e. the office needs to fix the
   * rate, not a tech who genuinely earned nothing. Surfaced on the payout so a
   * $0 line is never mistaken for a correct one.
   */
  unrated: boolean;
}

/** Non-finite / negative -> 0. Never let bad config become NaN or negative money. */
function safe(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

export function computeTechPay(input: TechPayInput): TechPayResult {
  const payRatePerHour = safe(input.payRatePerHour);
  const minutes = safe(input.onSiteMinutes);
  // Paid to the exact minute (minutes / 60 x rate, rounded once to the cent),
  // the same rule customers are billed by. `hours` is for display only.
  const hours = round2(minutes / 60);
  const hourlyPay = round2((minutes / 60) * payRatePerHour);
  // sumUnitLinePay can go negative if someone entered a negative unit cost;
  // clamp so a bad line can't reduce pay earned on other jobs in the period.
  const unitPay = Math.max(0, sumUnitLinePay(input.lineItems ?? []));
  const payRatePerKm = safe(input.payRatePerKm);
  const paidKm = round2(safe(input.paidKm));
  const mileagePay = round2(paidKm * payRatePerKm);
  const flatPay = round2(safe(input.flatPay));
  const techPay = round2(hourlyPay + unitPay + mileagePay + flatPay);
  const unrated = payRatePerHour === 0 && unitPay === 0 && payRatePerKm === 0 && flatPay === 0;
  return { hours, payRatePerHour, hourlyPay, unitPay, paidKm, payRatePerKm, mileagePay, flatPay, techPay, unrated };
}

/**
 * How a workflow pays the technician. Stored as JSON on task_templates and
 * snapshotted onto each booking (`tech_pay_model`), like the client RateModel.
 * `null` rates mean "use the technician's own rate".
 */
export interface TechPayModel {
  hourlyRate: number | null;
  perKmRate: number | null;
  flatPay: number;
  mileageBasis: MileageBasis;
  /** Free distance per job before mileage pay starts, km. */
  includedKm: number;
}

export const DEFAULT_TECH_PAY_MODEL: TechPayModel = {
  hourlyRate: null,
  perKmRate: null,
  flatPay: 0,
  mileageBasis: "round_trip",
  includedKm: 0,
};

const rateOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function parseTechPayModel(json: string | null | undefined): TechPayModel | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json) ?? {};
    if (typeof o !== "object") return null;
    return {
      hourlyRate: rateOrNull(o.hourlyRate),
      perKmRate: rateOrNull(o.perKmRate),
      flatPay: safe(o.flatPay),
      mileageBasis: o.mileageBasis === "to_job" ? "to_job" : "round_trip",
      includedKm: safe(o.includedKm),
    };
  } catch {
    return null;
  }
}

/** The booking + rider fields tech pay reads. */
export interface JobPayFacts {
  onSiteMinutes?: number | null;
  mileageKm?: number | null;
  mileageToJobKm?: number | null;
  lineItems?: string | null;
  techPayModel?: string | null;
}
export interface RiderPayRates {
  payRatePerHour?: number | null;
  payRatePerKm?: number | null;
}

/** Tech pay for one job — the single entry point for job completion, payouts and Earnings. */
export function jobTechPay(b: JobPayFacts, r: RiderPayRates): TechPayResult & { mileageBasis: MileageBasis; trackedKm: number } {
  const m = parseTechPayModel(b.techPayModel) ?? DEFAULT_TECH_PAY_MODEL;
  const trackedKm = mileageFor(m.mileageBasis, Number(b.mileageKm) || 0, Number(b.mileageToJobKm) || 0);
  const pay = computeTechPay({
    onSiteMinutes: Number(b.onSiteMinutes) || 0,
    payRatePerHour: m.hourlyRate ?? (Number(r.payRatePerHour) || 0),
    lineItems: parseLineItems(b.lineItems),
    paidKm: Math.max(0, trackedKm - m.includedKm),
    payRatePerKm: m.perKmRate ?? (Number(r.payRatePerKm) || 0),
    flatPay: m.flatPay,
  });
  return { ...pay, mileageBasis: m.mileageBasis, trackedKm: round2(trackedKm) };
}
