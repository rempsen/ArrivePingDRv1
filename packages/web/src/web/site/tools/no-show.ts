/**
 * The free no-show cost calculator (/tools/no-show-cost-calculator).
 *
 * Models one wasted trip, the "customer not home" truck roll: the technician's
 * loaded time for the drive and the minutes lost on site, plus the vehicle's
 * running cost for the distance. Pure functions, so the page prerenders the
 * default result and the browser runs the same maths. Nothing is stored.
 */

export type DistanceUnit = "mi" | "km";

export type NoShowInput = {
  /** Loaded cost of one technician hour (wage plus taxes, benefits and overhead), in dollars. */
  hourlyRate: number;
  /** Drive minutes spent on the wasted trip (there and on to the next job or back). */
  driveMinutes: number;
  /** Minutes lost at the door: knocking, calling, waiting. */
  onSiteMinutes: number;
  /** Distance driven for the wasted trip, in `unit`. */
  distance: number;
  unit: DistanceUnit;
  /** Vehicle running cost per mile or km, in dollars. */
  vehicleRate: number;
  /** Wasted trips in a typical month. */
  perMonth: number;
};

export type NoShowResult = {
  labour: number;
  vehicle: number;
  perTrip: number;
  monthly: number;
  yearly: number;
  /** Technician hours lost per year. */
  hoursPerYear: number;
};

export const KM_PER_MILE = 1.609344;

/**
 * Example inputs, shown until the visitor types their own:
 *  - $35/h: the loaded technician rate ArrivePing uses in its own examples;
 *  - 76 cents a mile: the IRS business standard mileage rate from July 1, 2026
 *    (Announcement 2026-11, reported by the Journal of Accountancy);
 *  - the trip and the monthly count are round illustrative numbers.
 */
export const NO_SHOW_DEFAULTS: NoShowInput = {
  hourlyRate: 35,
  driveMinutes: 40,
  onSiteMinutes: 10,
  distance: 20,
  unit: "mi",
  vehicleRate: 0.76,
  perMonth: 8,
};

/** Non-negative finite number, or 0. */
export function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const cents = (v: number) => Math.round(v * 100) / 100;

export function noShowCost(input: NoShowInput): NoShowResult {
  const rate = num(input.hourlyRate);
  const mins = num(input.driveMinutes) + num(input.onSiteMinutes);
  const labour = (rate * mins) / 60;
  const vehicle = num(input.vehicleRate) * num(input.distance);
  const perTrip = labour + vehicle;
  const count = num(input.perMonth);
  return {
    labour: cents(labour),
    vehicle: cents(vehicle),
    perTrip: cents(perTrip),
    monthly: cents(perTrip * count),
    yearly: cents(perTrip * count * 12),
    hoursPerYear: Math.round(((mins * count * 12) / 60) * 10) / 10,
  };
}

/** Switch units without changing the answer: distance and per-unit rate convert together. */
export function convertUnit(input: NoShowInput, to: DistanceUnit): NoShowInput {
  if (input.unit === to) return input;
  const factor = to === "km" ? KM_PER_MILE : 1 / KM_PER_MILE;
  return {
    ...input,
    unit: to,
    distance: Math.round(num(input.distance) * factor * 10) / 10,
    vehicleRate: Math.round((num(input.vehicleRate) / factor) * 100) / 100,
  };
}

export const money = (v: number, decimals = 2) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;

/** The formula with the visitor's numbers in it, for the "show your working" line. */
export function formulaLine(input: NoShowInput): string {
  const r = noShowCost(input);
  return `${money(num(input.hourlyRate))} × (${num(input.driveMinutes)} + ${num(input.onSiteMinutes)}) ÷ 60 + ${money(num(input.vehicleRate))} × ${num(input.distance)} ${input.unit} = ${money(r.perTrip)} per wasted trip`;
}
