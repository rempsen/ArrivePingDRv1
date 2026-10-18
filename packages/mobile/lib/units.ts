/**
 * Distance display for the driver app — mirrors packages/web/src/shared/units.ts.
 * Everything arrives metric from the API; a company set to Imperial in
 * Settings sees feet and miles.
 */
export type DistanceUnit = "metric" | "imperial";

const KM_PER_MI = 1.609344;
const M_PER_FT = 0.3048;

export const parseDistanceUnit = (v: unknown): DistanceUnit => (v === "imperial" ? "imperial" : "metric");

/** "10.7 km" / "6.7 mi". */
export function fmtKm(km: number, unit: DistanceUnit, digits = 1): string {
  const n = Number(km) || 0;
  return unit === "imperial" ? `${(n / KM_PER_MI).toFixed(digits)} mi` : `${n.toFixed(digits)} km`;
}

/** "150 m" / "490 ft" (feet rounded to 5, like Settings). */
export function fmtM(m: number, unit: DistanceUnit): string {
  const n = Number(m) || 0;
  return unit === "imperial" ? `${Math.round(n / M_PER_FT / 5) * 5} ft` : `${Math.round(n)} m`;
}

/** A distance that may be short or long: under ~1 km/0.2 mi in m/ft, else km/mi. */
export function fmtDistanceM(m: number, unit: DistanceUnit): string {
  const n = Number(m) || 0;
  if (unit === "imperial") return n < 320 ? fmtM(n, unit) : fmtKm(n / 1000, unit);
  return n < 1000 ? fmtM(n, unit) : fmtKm(n / 1000, unit);
}
