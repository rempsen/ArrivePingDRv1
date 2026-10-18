/**
 * Distance units — one company setting (`company_settings.distance_unit`).
 *
 * Everything is STORED metric (metres for the geofence, kilometres for
 * mileage, money per km for mileage rates) so switching a company between
 * Metric and Imperial never rewrites or loses data. These helpers convert at
 * the edges: what a person types in, and what a screen shows.
 */

export type DistanceUnit = "metric" | "imperial";

export const KM_PER_MI = 1.609344;
export const M_PER_FT = 0.3048;

export function parseDistanceUnit(v: unknown): DistanceUnit {
  return v === "imperial" ? "imperial" : "metric";
}

/** "km" / "mi" — the long-distance unit (mileage). */
export function distanceLabel(unit: DistanceUnit): "km" | "mi" {
  return unit === "imperial" ? "mi" : "km";
}

/** "m" / "ft" — the short-distance unit (geofence radius). */
export function shortDistanceLabel(unit: DistanceUnit): "m" | "ft" {
  return unit === "imperial" ? "ft" : "m";
}

const finite = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
};

/** Kilometres -> the company's long unit (km or mi). */
export function kmToUnit(km: number, unit: DistanceUnit): number {
  return unit === "imperial" ? finite(km) / KM_PER_MI : finite(km);
}

/** The company's long unit (km or mi) -> kilometres, for storage. */
export function unitToKm(v: number, unit: DistanceUnit): number {
  return unit === "imperial" ? finite(v) * KM_PER_MI : finite(v);
}

/** Metres -> the company's short unit. Feet are rounded to the nearest 5 ft so
 *  a radius typed as 500 ft (stored as whole metres, 152 m) reads back as 500. */
export function mToUnit(m: number, unit: DistanceUnit): number {
  if (unit !== "imperial") return Math.round(finite(m));
  return Math.round(finite(m) / M_PER_FT / 5) * 5;
}

/** The company's short unit -> whole metres, for storage. */
export function unitToM(v: number, unit: DistanceUnit): number {
  return Math.round(unit === "imperial" ? finite(v) * M_PER_FT : finite(v));
}

/** A money-per-km rate shown in the company's unit ($/km or $/mi). */
export function perKmToUnit(ratePerKm: number, unit: DistanceUnit): number {
  return unit === "imperial" ? finite(ratePerKm) * KM_PER_MI : finite(ratePerKm);
}

/** A money-per-unit rate typed in the company's unit, stored per km. */
export function unitRateToPerKm(rate: number, unit: DistanceUnit): number {
  return unit === "imperial" ? finite(rate) / KM_PER_MI : finite(rate);
}

/** "10.7 km" / "6.7 mi". */
export function fmtDistance(km: number, unit: DistanceUnit, digits = 1): string {
  return `${kmToUnit(km, unit).toFixed(digits)} ${distanceLabel(unit)}`;
}

/** "150 m" / "490 ft". */
export function fmtShortDistance(m: number, unit: DistanceUnit): string {
  return `${mToUnit(m, unit).toLocaleString("en-US")} ${shortDistanceLabel(unit)}`;
}
