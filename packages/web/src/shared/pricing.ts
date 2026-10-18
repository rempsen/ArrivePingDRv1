/**
 * Shared pricing + tax engine. Used by backend (work order create/recompute,
 * payouts) and frontend (live price preview in form builder + work order modal).
 *
 * Fully flexible RateModel — every component optional, mix and match:
 *  - flatRate: fixed $ that INCLUDES includedMinutes + includedKm
 *  - timeRate: $ per unit (minute|hour) billed for time beyond includedMinutes
 *  - kmRate:   $ per km billed for distance beyond includedKm
 * Pure per-minute / per-hour / per-km models = set flatRate 0 and included* 0.
 */

import { distanceLabel, kmToUnit, perKmToUnit, type DistanceUnit } from "./units";

export type TimeUnit = "minute" | "hour";
/** Which tracked distance a mileage charge or mileage pay counts. Mileage is
 *  always tracked and recorded in full; this only picks what gets billed/paid. */
export type MileageBasis = "round_trip" | "to_job";
/** How many minutes are included free before billing starts (0 = none, 30, 60). */
export type IncludedFreeMinutes = 0 | 30 | 60;

export interface RateModel {
  flatRate: number;          // $ base charge
  includedMinutes: number;   // minutes covered by flat rate
  includedKm: number;        // km covered by flat rate
  timeRate: number;          // $ per timeUnit after included time
  timeUnit: TimeUnit;        // minute | hour
  kmRate: number;            // $ per km after included km
  minCharge: number;         // optional floor for the subtotal (0 = none)
  // ── tiered hourly pricing ──
  freeMinutes: number;       // minutes included at no charge (0 | 30 | 60)
  firstHourRate: number;     // $ for the first billable hour (0 = use timeRate)
  additionalHourRate: number;// $ per hour after the first (0 = same as first)
  // ── mileage basis ── (optional so older stored models stay valid)
  kmBasis?: MileageBasis;    // round_trip (default) | to_job
}

export const EMPTY_RATE_MODEL: RateModel = {
  flatRate: 0,
  includedMinutes: 0,
  includedKm: 0,
  timeRate: 0,
  timeUnit: "hour",
  kmRate: 0,
  minCharge: 0,
  freeMinutes: 0,
  firstHourRate: 0,
  additionalHourRate: 0,
};

export function parseRateModel(json: string | null | undefined): RateModel | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    return { ...EMPTY_RATE_MODEL, ...o };
  } catch {
    return null;
  }
}

export interface PriceLineItem {
  label: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
}

export interface PriceResult {
  subtotal: number;
  items: PriceLineItem[];
}

/** Compute the client subtotal (pre-tax) given a rate model + actuals. */
export function computeSubtotal(
  rm: RateModel,
  actualMinutes: number,
  actualKm: number,
  unit: DistanceUnit = "metric",
): PriceResult {
  const items: PriceLineItem[] = [];
  const round = (n: number) => Math.round(n * 100) / 100;

  if (rm.flatRate > 0) {
    const incl: string[] = [];
    if (rm.includedMinutes > 0) incl.push(`${rm.includedMinutes} min`);
    if (rm.includedKm > 0) incl.push(`${round(kmToUnit(rm.includedKm, unit))} ${distanceLabel(unit)}`);
    items.push({
      label: incl.length ? `Flat rate (incl. ${incl.join(" + ")})` : "Flat rate",
      qty: 1,
      unit: "job",
      rate: rm.flatRate,
      amount: round(rm.flatRate),
    });
  }

  // ── tiered hourly billing ──
  const freeMin = rm.freeMinutes || 0;
  const firstHrRate = rm.firstHourRate || 0;
  const addlHrRate = rm.additionalHourRate || 0;
  const useTiered = firstHrRate > 0 || addlHrRate > 0;

  if (useTiered) {
    const billableMin = Math.max(0, actualMinutes - freeMin);
    if (billableMin > 0) {
      const firstMin = Math.min(billableMin, 60);
      const addlMin = Math.max(0, billableMin - 60);
      const firstHrs = round(firstMin / 60);
      const addlHrs = round(addlMin / 60);
      if (firstHrRate > 0 && firstMin > 0) {
        items.push({ label: "First hour", qty: firstHrs, unit: "hr", rate: firstHrRate, amount: round(firstHrs * firstHrRate) });
      }
      if (addlHrRate > 0 && addlMin > 0) {
        items.push({ label: "Additional time", qty: addlHrs, unit: "hr", rate: addlHrRate, amount: round(addlHrs * addlHrRate) });
      } else if (addlMin > 0 && firstHrRate > 0) {
        // fallback: use firstHrRate for additional if additionalHourRate not set
        items.push({ label: "Additional time", qty: addlHrs, unit: "hr", rate: firstHrRate, amount: round(addlHrs * firstHrRate) });
      }
    }
  } else if (rm.timeRate > 0) {
    // simple flat hourly / per-minute
    const billableMin = Math.max(0, actualMinutes - rm.includedMinutes);
    if (rm.timeUnit === "hour") {
      const hrs = round(billableMin / 60);
      if (hrs > 0)
        items.push({ label: "Additional time", qty: hrs, unit: "hr", rate: rm.timeRate, amount: round(hrs * rm.timeRate) });
    } else {
      if (billableMin > 0)
        items.push({ label: "Additional time", qty: round(billableMin), unit: "min", rate: rm.timeRate, amount: round(billableMin * rm.timeRate) });
    }
  }

  // km overage
  if (rm.kmRate > 0) {
    const billableKm = round(Math.max(0, actualKm - rm.includedKm));
    if (billableKm > 0)
      items.push({
        label: "Mileage",
        qty: round(kmToUnit(billableKm, unit)),
        unit: distanceLabel(unit),
        rate: round(perKmToUnit(rm.kmRate, unit)),
        amount: round(billableKm * rm.kmRate),
      });
  }

  let subtotal = round(items.reduce((s, i) => s + i.amount, 0));
  if (rm.minCharge > 0 && subtotal < rm.minCharge) {
    items.push({ label: "Minimum charge adjustment", qty: 1, unit: "", rate: 0, amount: round(rm.minCharge - subtotal) });
    subtotal = rm.minCharge;
  }
  return { subtotal, items };
}

/** Human-readable one-line summary of a rate model (for cards/lists). */
export function describeRateModel(rm: RateModel, unit: DistanceUnit = "metric"): string {
  const parts: string[] = [];
  if (rm.flatRate > 0) {
    let s = `$${rm.flatRate.toFixed(2)} flat`;
    const inc: string[] = [];
    if (rm.includedMinutes) inc.push(`${rm.includedMinutes}m`);
    if (rm.includedKm) inc.push(`${Math.round(kmToUnit(rm.includedKm, unit) * 10) / 10}${distanceLabel(unit)}`);
    if (inc.length) s += ` (incl ${inc.join("/")})`;
    parts.push(s);
  }
  const firstHrRate = rm.firstHourRate || 0;
  const addlHrRate = rm.additionalHourRate || 0;
  if (firstHrRate > 0 || addlHrRate > 0) {
    if (rm.freeMinutes) parts.push(`${rm.freeMinutes}min free`);
    if (firstHrRate > 0) parts.push(`$${firstHrRate.toFixed(2)}/1st hr`);
    if (addlHrRate > 0 && addlHrRate !== firstHrRate) parts.push(`$${addlHrRate.toFixed(2)}/hr after`);
  } else {
    if (rm.timeRate > 0) parts.push(`+$${rm.timeRate.toFixed(2)}/${rm.timeUnit === "hour" ? "hr" : "min"}`);
  }
  if (rm.kmRate > 0) parts.push(`+$${perKmToUnit(rm.kmRate, unit).toFixed(2)}/${distanceLabel(unit)}${rm.kmBasis === "to_job" ? " (to job)" : ""}`);
  if (!parts.length) return "No pricing set";
  return parts.join(" · ");
}

/** The distance a mileage charge or mileage pay counts, from what was tracked. */
export function mileageFor(basis: MileageBasis | undefined, roundTripKm: number, toJobKm: number): number {
  const v = basis === "to_job" ? Number(toJobKm) : Number(roundTripKm);
  return Number.isFinite(v) && v > 0 ? v : 0;
}
