// ─── Road-matched route for the completed-job report ──────────────────────
// The technician's phone posts a GPS fix every 8 seconds. Joining those fixes
// with straight lines is NOT where the truck went: at 60 km/h a fix lands
// every ~130 m, so every corner is cut, and when the app loses signal for a
// couple of minutes (backgrounded, dead zone) the next fix is kilometres away
// and the "route" is drawn straight across a river. That is exactly what the
// bmd-materials report showed.
//
// This module turns the raw breadcrumb trail into a road-following path:
//   1. clean   — sort, drop stationary jitter and physically impossible jumps
//   2. split   — one run per driving phase (enroute / return). On-site pings
//                are walking around a property, not driving, so they are kept
//                raw (thinned), never snapped to a road.
//   3. match   — Valhalla `trace_route` (map matching, public OSM instance):
//                one request per driving run, handles 1000s of points.
//   4. fill    — when the matcher breaks the trace at a gap it cannot bridge,
//                fill the hole with a real driving route between the two
//                ends (Google Directions -> OSRM -> straight line as a last
//                resort), so the trail is continuous and still on roads.
//   5. fallback — if Valhalla is down, Google Roads `snapToRoads`; if that is
//                unavailable too, return null and the report draws the raw
//                trail (clearly labelled) rather than nothing.
//
// The result is stored on the booking (`bookings.route_snapped`) the first
// time a settled job's report is opened and reused afterwards — see
// ensureSnappedRoute. The raw pings are never modified: they remain the
// evidence; this is the presentation layer.
import { eq } from "drizzle-orm";
import * as schema from "../api/database/schema";
import type { TenantDb } from "../api/database/tenant";
import { computeRoute } from "./routing";
import { haversineKm, pathDistanceKm } from "../shared/geo-distance";
import { log } from "../api/lib/logger";

export interface RawPing {
  lat: number;
  lng: number;
  phase: string;
  createdAt: Date | string | number;
}

export interface SnappedPoint {
  lat: number;
  lng: number;
  phase: string;
}

export interface SnappedRoute {
  v: 1;
  /** Which matcher produced the driving legs: valhalla | google | mixed. */
  provider: string;
  /** How many raw pings existed when this was computed — staleness check. */
  pingCount: number;
  /** Road distance of the matched trail, km. Informational; mileage billing still uses bookings.mileageKm. */
  distanceKm: number;
  points: SnappedPoint[];
  computedAt: string;
}

/** Phases where the tech is driving and the trail should follow roads. */
const DRIVING_PHASES = new Set(["enroute", "return"]);
/** Consecutive fixes closer than this are GPS jitter while stopped. */
const MIN_MOVE_M = 8;
/** On-site wandering is thinned harder: we only want the gist, not every step. */
const ONSITE_MIN_MOVE_M = 25;
/** A fix implying faster than this between pings is a glitch, not a truck. */
const MAX_SPEED_MPS = 60; // 216 km/h
/** Valhalla trace_route per-request shape cap (public instance allows far more; keep requests small). */
const VALHALLA_CHUNK = 800;
/** Matcher points this far from the raw fix are a mis-snap; drop them. */
const MAX_SNAP_DIST_M = 80;
const REQUEST_TIMEOUT_MS = 10_000;
const UA = "ArrivePing/1.0 (+https://arriveping.com)";

const VALHALLA_URL = process.env.VALHALLA_URL || "https://valhalla1.openstreetmap.de";
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;

function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return haversineKm(a.lat, a.lng, b.lat, b.lng) * 1000;
}

function ms(v: Date | string | number) {
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

/**
 * Sort by time, drop jitter (< MIN_MOVE_M from the previous kept fix) and
 * impossible jumps (> MAX_SPEED_MPS). Exported for tests.
 */
export function cleanPings(pings: RawPing[]): RawPing[] {
  const sorted = [...pings]
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  const out: RawPing[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (!last) {
      out.push(p);
      continue;
    }
    const d = metersBetween(last, p);
    const minMove = DRIVING_PHASES.has(p.phase) ? MIN_MOVE_M : ONSITE_MIN_MOVE_M;
    // A phase change is always kept so the colour boundary lands where the
    // status actually changed, even if the truck had not moved yet.
    if (d < minMove && last.phase === p.phase) continue;
    const dt = (ms(p.createdAt) - ms(last.createdAt)) / 1000;
    if (dt > 0 && d / dt > MAX_SPEED_MPS) continue;
    out.push(p);
  }
  return out;
}

/** Contiguous same-phase runs, in order. Exported for tests. */
export function splitByPhase(pings: RawPing[]): { phase: string; pings: RawPing[] }[] {
  const runs: { phase: string; pings: RawPing[] }[] = [];
  for (const p of pings) {
    const last = runs[runs.length - 1];
    if (last && last.phase === p.phase) last.pings.push(p);
    else runs.push({ phase: p.phase, pings: [p] });
  }
  return runs;
}

/** Decode a Google/Valhalla encoded polyline (precision 5 or 6) into [lat,lng]. */
export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const factor = Math.pow(10, precision);
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / factor, lng / factor]);
  }
  return points;
}

type LatLng = { lat: number; lng: number };

interface MatchResult {
  /** Ordered legs; consecutive legs may have a gap between them (matcher broke the trace). */
  legs: LatLng[][];
  provider: string;
}

/** One Valhalla trace_route call for ≤ VALHALLA_CHUNK points. */
async function valhallaMatch(pings: RawPing[]): Promise<MatchResult | null> {
  const body = {
    shape: pings.map((p) => ({ lat: p.lat, lon: p.lng, time: Math.round(ms(p.createdAt) / 1000) })),
    costing: "auto",
    shape_match: "map_snap",
    format: "osrm",
    trace_options: {
      search_radius: 40,
      gps_accuracy: 20,
      // metres between fixes before the matcher gives up and starts a new
      // leg; we fill the resulting hole with a routed leg (fillGaps).
      breakage_distance: 2000,
      interpolation_distance: 10,
    },
  };
  const res = await fetch(`${VALHALLA_URL}/trace_route`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`valhalla HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    code?: string;
    message?: string;
    matchings?: { geometry: string; confidence?: number }[];
    tracepoints?: ({ matchings_index: number; distance?: number; location: [number, number] } | null)[];
  };
  if (data.code !== "Ok" || !data.matchings?.length) {
    throw new Error(`valhalla ${data.code ?? "no code"}: ${data.message ?? "no matchings"}`);
  }
  const legs: LatLng[][] = [];
  for (const m of data.matchings) {
    const pts = decodePolyline(m.geometry, 6).map(([lat, lng]) => ({ lat, lng }));
    if (pts.length >= 2) legs.push(pts);
  }
  // Sanity: if the matcher pulled most fixes far off where the phone said it
  // was, it matched the wrong roads (sparse trace on a motorway next to a
  // service road, say). Treat as failure so the caller falls back.
  const tps = (data.tracepoints ?? []).filter((t): t is NonNullable<typeof t> => !!t);
  if (tps.length) {
    const far = tps.filter((t) => (t.distance ?? 0) > MAX_SNAP_DIST_M).length;
    if (far / tps.length > 0.5) throw new Error(`valhalla matched ${far}/${tps.length} fixes > ${MAX_SNAP_DIST_M} m away`);
  }
  if (!legs.length) return null;
  return { legs, provider: "valhalla" };
}

/** Google Roads snapToRoads (≤100 points per request), used only if Valhalla fails. */
async function googleSnap(pings: RawPing[]): Promise<MatchResult | null> {
  if (!GOOGLE_KEY) return null;
  const legs: LatLng[][] = [];
  for (let i = 0; i < pings.length; i += 99) {
    // overlap one point per chunk so the pieces join
    const chunk = pings.slice(Math.max(0, i - 1), i + 99);
    const url = new URL("https://roads.googleapis.com/v1/snapToRoads");
    url.searchParams.set("path", chunk.map((p) => `${p.lat},${p.lng}`).join("|"));
    url.searchParams.set("interpolate", "true");
    url.searchParams.set("key", GOOGLE_KEY);
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const data = (await res.json()) as {
      snappedPoints?: { location: { latitude: number; longitude: number } }[];
      error?: { message?: string; status?: string };
    };
    if (!res.ok || data.error) throw new Error(`google roads ${data.error?.status ?? res.status}: ${data.error?.message ?? ""}`);
    const pts = (data.snappedPoints ?? []).map((s) => ({ lat: s.location.latitude, lng: s.location.longitude }));
    if (pts.length >= 2) legs.push(pts);
  }
  if (!legs.length) return null;
  // Google returns one continuous interpolated path; present as one leg.
  return { legs: [legs.flat()], provider: "google" };
}

/** Match one driving run, chunking long traces and trying matchers in order. */
async function matchRun(pings: RawPing[]): Promise<MatchResult | null> {
  const chunks: RawPing[][] = [];
  for (let i = 0; i < pings.length; i += VALHALLA_CHUNK - 1) {
    const c = pings.slice(i, i + VALHALLA_CHUNK);
    if (c.length >= 2) chunks.push(c);
  }
  if (!chunks.length) return null;
  try {
    const legs: LatLng[][] = [];
    for (const c of chunks) {
      const r = await valhallaMatch(c);
      if (r) legs.push(...r.legs);
    }
    if (legs.length) return { legs, provider: "valhalla" };
  } catch (e) {
    log.warn("route-snap: valhalla failed, trying google roads", { err: String(e), points: pings.length });
  }
  try {
    return await googleSnap(pings);
  } catch (e) {
    log.warn("route-snap: google roads failed", { err: String(e) });
    return null;
  }
}

/**
 * Join legs into one continuous path. Where two consecutive legs do not meet
 * (the matcher broke the trace at a signal gap), route between them so the
 * hole is bridged along roads instead of a straight line.
 */
async function fillGaps(legs: LatLng[][]): Promise<{ path: LatLng[]; routed: boolean }> {
  const path: LatLng[] = [];
  let routed = false;
  for (const leg of legs) {
    const last = path[path.length - 1];
    const first = leg[0]!;
    if (last && metersBetween(last, first) > 30) {
      // A drive that already happened: no live traffic needed, so the
      // Essentials SKU (TRAFFIC_UNAWARE) rather than the Pro one.
      const r = await computeRoute(last, first, { traffic: false });
      if (r && r.provider !== "estimate" && r.path.length >= 2) {
        routed = true;
        for (const [lat, lng] of r.path) path.push({ lat, lng });
      }
      // "estimate" is a straight line — pushing the leg's first point gives
      // us that anyway, so there is nothing to add.
    }
    for (const p of leg) {
      const prev = path[path.length - 1];
      if (prev && metersBetween(prev, p) < 0.5) continue;
      path.push(p);
    }
  }
  return { path, routed };
}

/**
 * Build the road-matched trail for a set of raw pings. Returns null when
 * there is nothing to draw (fewer than 2 distinct fixes) or no matcher could
 * be reached — the caller then falls back to the raw trail.
 */
export async function snapRoute(rawPings: RawPing[]): Promise<SnappedRoute | null> {
  const pings = cleanPings(rawPings);
  if (pings.length < 2) return null;

  const points: SnappedPoint[] = [];
  const providers = new Set<string>();
  let anyMatched = false;

  for (const run of splitByPhase(pings)) {
    if (DRIVING_PHASES.has(run.phase) && run.pings.length >= 2) {
      const m = await matchRun(run.pings);
      if (m) {
        anyMatched = true;
        providers.add(m.provider);
        const { path, routed } = await fillGaps(m.legs);
        if (routed) providers.add("routed-gap");
        for (const p of path) points.push({ lat: p.lat, lng: p.lng, phase: run.phase });
        continue;
      }
      // matcher unavailable for this run — keep the cleaned raw fixes so the
      // trail is at least continuous; provider records that it is raw.
      providers.add("raw");
    }
    for (const p of run.pings) points.push({ lat: p.lat, lng: p.lng, phase: run.phase });
  }

  if (!anyMatched) return null;
  const provider = providers.size === 1 ? [...providers][0]! : "mixed:" + [...providers].sort().join("+");
  return {
    v: 1,
    provider,
    pingCount: rawPings.length,
    distanceKm: Math.round(pathDistanceKm(points) * 100) / 100,
    points,
    computedAt: new Date().toISOString(),
  };
}

/** Parse the stored JSON, tolerating garbage. */
export function parseSnapped(raw: string | null | undefined): SnappedRoute | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as SnappedRoute;
    if (v && v.v === 1 && Array.isArray(v.points)) return v;
  } catch {
    /* ignore */
  }
  return null;
}

/** Terminal statuses: the trip is over, pings will stop soon if not already. */
const TERMINAL = new Set(["completed", "cancelled", "no_show"]);
/** Don't snap while fixes are still arriving — wait for a quiet period. */
const QUIET_MS = 3 * 60_000;
/** A non-terminal job with no pings for this long is treated as over (app closed, status never finalised). */
const STALE_MS = 10 * 60_000;

/**
 * Return the stored road-matched trail for a booking, computing and storing
 * it on first use once the trip has settled. Returns null while the job is
 * still live (fixes arriving) or when matching is impossible; callers draw
 * the raw trail in that case.
 *
 * `pings` is the full raw trail the caller already loaded (sorted or not).
 */
export async function ensureSnappedRoute(
  t: TenantDb,
  booking: { id: string; status: string; routeSnapped: string | null },
  pings: RawPing[],
): Promise<SnappedRoute | null> {
  if (pings.length < 2) return null;
  const cached = parseSnapped(booking.routeSnapped);
  if (cached && cached.pingCount === pings.length) return cached;

  const lastPingAt = Math.max(...pings.map((p) => ms(p.createdAt)));
  const quietFor = Date.now() - lastPingAt;
  const settled = quietFor > QUIET_MS && (TERMINAL.has(booking.status) || quietFor > STALE_MS);
  // Still live: show the newest cached version if we have one (stale by a
  // few pings is better than a raw line), else let the caller draw raw.
  if (!settled) return cached;

  const snapped = await snapRoute(pings);
  if (!snapped) return cached;
  await t.update(schema.bookings, { routeSnapped: JSON.stringify(snapped) }, eq(schema.bookings.id, booking.id));
  log.info("route-snap: stored road-matched route", {
    bookingId: booking.id,
    provider: snapped.provider,
    pings: pings.length,
    points: snapped.points.length,
    km: snapped.distanceKm,
  });
  return snapped;
}
