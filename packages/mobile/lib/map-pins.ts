/**
 * What the live map draws, worked out away from the map so bun tests cover
 * it: which technicians show, what colour a job pin is, and the region that
 * fits everything on screen.
 */
import { IN_FIELD, TERMINAL } from "./board";

export interface Point {
  lat: number | null | undefined;
  lng: number | null | undefined;
}
export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/** Red: nobody. Amber: offered, not accepted. Green: in the field. Brand: accepted and scheduled. */
export type PinKind = "unassigned" | "offered" | "active" | "scheduled";

export function pinKind(job: { riderId: string | null; assignStatus: string; status: string }): PinKind | null {
  if (TERMINAL.has(job.status)) return null;
  if (IN_FIELD.has(job.status)) return "active";
  if (!job.riderId) return "unassigned";
  if (job.assignStatus === "offered") return "offered";
  return "scheduled";
}

/** Technicians with a position; off-shift ones only when asked for. */
export function visibleTechs<T extends Point & { status: string }>(techs: readonly T[], showOffline: boolean): T[] {
  return techs.filter((t) => t.lat != null && t.lng != null && (showOffline || t.status !== "offline"));
}

/** Jobs with a position that still need doing. */
export function visibleJobs<J extends Point & { riderId: string | null; assignStatus: string; status: string }>(jobs: readonly J[]): Array<J & { kind: PinKind }> {
  const out: Array<J & { kind: PinKind }> = [];
  for (const j of jobs) {
    if (j.lat == null || j.lng == null) continue;
    const kind = pinKind(j);
    if (kind) out.push({ ...j, kind });
  }
  return out;
}

/** Somewhere to look when there is nothing to show: North America, zoomed out. */
export const CONTINENT: Region = { latitude: 45, longitude: -100, latitudeDelta: 40, longitudeDelta: 40 };
/** Never zoom in past a neighbourhood, even for one pin. */
const MIN_DELTA = 0.02;

/**
 * The region that holds every point with a fifth of padding around them. One
 * point gets the minimum span; none gets the fallback (the office, when the
 * board has one) or the continent.
 */
export function fitRegion(points: readonly Point[], fallback: Point | null = null): Region {
  const pts = points.filter((p) => p.lat != null && p.lng != null) as Array<{ lat: number; lng: number }>;
  if (pts.length === 0) {
    if (fallback && fallback.lat != null && fallback.lng != null) {
      return { latitude: fallback.lat, longitude: fallback.lng, latitudeDelta: 0.08, longitudeDelta: 0.08 };
    }
    return CONTINENT;
  }
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of pts) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(MIN_DELTA, (maxLat - minLat) * 1.4),
    longitudeDelta: Math.max(MIN_DELTA, (maxLng - minLng) * 1.4),
  };
}
