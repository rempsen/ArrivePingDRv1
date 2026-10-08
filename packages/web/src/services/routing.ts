/**
 * Driving route + traffic-aware duration between two points.
 *
 * Sources, in order:
 *   1. Google Routes API v2 `computeRoutes` (TRAFFIC_AWARE). Billed as
 *      "Routes: Compute Routes Pro", so callers must go through the
 *      TripEngine (services/trip-engine.ts), which calls this a handful of
 *      times per job instead of on every GPS ping.
 *   2. OSRM public demo router: keyless, no traffic, fair use only. Used
 *      when there is no key, Google denies the request, or it times out, so
 *      the customer never sees a line drawn through buildings.
 *   3. A straight two-point line + haversine estimate (`provider: "estimate"`).
 *      Callers can tell it apart and draw it as a dashed approximation.
 *
 * Replaces the legacy Directions and Distance Matrix calls, which Google no
 * longer offers to new Cloud projects (developers.google.com/maps/legacy).
 */
import { haversineKm } from "../shared/geo-distance";
import { decodePolyline } from "../shared/polyline";
import { log } from "../api/lib/logger";

export type LatLng = { lat: number; lng: number };

export interface RouteResult {
  /** Road-following path as [lat, lng] pairs, origin first. */
  path: [number, number][];
  /** Traffic-aware duration (Google) or free-flow duration (OSRM/estimate). */
  durationSec: number;
  /** Duration without traffic, when Google provides it. */
  staticDurationSec: number | null;
  distanceM: number;
  provider: "google" | "osrm" | "estimate";
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const ROUTE_TIMEOUT_MS = 4_000;
const AVG_KMH = 32; // urban average, for the straight-line estimate only

export const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
/**
 * Only what the trip engine uses. A field mask is mandatory on Routes API,
 * and asking for less keeps responses small. HIGH_QUALITY polylines and these
 * fields don't change the SKU; TRAFFIC_AWARE is what makes it Pro (Documented,
 * developers.google.com/maps/billing-and-pricing/sku-details, 2026-10-07).
 */
export const ROUTES_FIELD_MASK = "routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline";

/**
 * The server key for Google Maps Platform. The new "NVC360 Workforce"
 * project's key wins when present; the old variable is the fallback until
 * cut-over (blueprint phase 4) renames it.
 */
export function mapsServerKey(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.GOOGLE_MAPS_API_KEY_NEW?.trim() || env.GOOGLE_MAPS_API_KEY?.trim() || undefined;
}

// One log line per distinct failure per ~5 minutes: a misconfigured key would
// otherwise log on every recompute for every live trip.
const warned = new Map<string, number>();
function warnOnce(key: string, msg: string, extra?: Record<string, unknown>) {
  const now = Date.now();
  if (now - (warned.get(key) ?? 0) < 5 * 60_000) return;
  warned.set(key, now);
  log.warn(msg, extra);
}

function seconds(v: unknown): number {
  return typeof v === "string" ? Number(v.replace(/s$/, "")) : NaN;
}

function validCoords(...n: number[]) {
  return n.every((x) => typeof x === "number" && Number.isFinite(x));
}

/**
 * The exact computeRoutes request production sends. Shared with the smoke
 * check (services/google-smoke.ts) so a green smoke run proves this body.
 */
export function routesRequestBody(o: LatLng, d: LatLng, traffic = true) {
  return {
    origin: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
    destination: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
    travelMode: "DRIVE",
    // TRAFFIC_AWARE is the Pro SKU; TRAFFIC_UNAWARE is Essentials (cheaper),
    // right for anything that isn't a live ETA.
    routingPreference: traffic ? "TRAFFIC_AWARE" : "TRAFFIC_UNAWARE",
    polylineQuality: "HIGH_QUALITY",
    units: "METRIC",
  };
}

/** Google Routes API. Returns null on any failure (the caller falls back). */
export async function googleRoute(
  o: LatLng,
  d: LatLng,
  opts: { key?: string; fetchImpl?: FetchLike; traffic?: boolean } = {},
): Promise<RouteResult | null> {
  const key = opts.key ?? mapsServerKey();
  if (!key) return null;
  const doFetch: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  try {
    const r = await doFetch(ROUTES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": ROUTES_FIELD_MASK },
      body: JSON.stringify(routesRequestBody(o, d, opts.traffic ?? true)),
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
    });
    const body = (await r.json().catch(() => ({}))) as {
      routes?: Array<{ duration?: string; staticDuration?: string; distanceMeters?: number; polyline?: { encodedPolyline?: string } }>;
      error?: { status?: string; message?: string };
    };
    const route = body.routes?.[0];
    const encoded = route?.polyline?.encodedPolyline;
    const durationSec = seconds(route?.duration);
    if (r.ok && route && encoded && Number.isFinite(durationSec)) {
      const path = decodePolyline(encoded);
      if (path.length >= 2) {
        const stat = seconds(route.staticDuration);
        return {
          path,
          durationSec,
          staticDurationSec: Number.isFinite(stat) ? stat : null,
          distanceM: route.distanceMeters ?? 0,
          provider: "google",
        };
      }
    }
    // An empty 200 means Google found no drivable route; anything else is a
    // configuration problem (API not enabled, key restriction, billing).
    warnOnce(
      `routes:${r.status}:${body.error?.status ?? ""}`,
      "routing: Google Routes returned no usable route; falling back to OSRM",
      { httpStatus: r.status, googleStatus: body.error?.status, message: body.error?.message },
    );
    return null;
  } catch (e) {
    warnOnce("routes:error", "routing: Google Routes request failed; falling back to OSRM", { err: String((e as Error)?.message ?? e) });
    return null;
  }
}

/** OSRM public demo server. No key, no traffic data, fair use only. */
export async function osrmRoute(o: LatLng, d: LatLng, opts: { fetchImpl?: FetchLike } = {}): Promise<RouteResult | null> {
  const doFetch: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/${o.lng},${o.lat};${d.lng},${d.lat}` +
      `?overview=full&geometries=geojson&steps=false`;
    const r = await doFetch(url, {
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
      headers: { "User-Agent": "ArrivePing/1.0 (+https://arriveping.com)" },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()) as {
      code?: string;
      routes?: Array<{ duration?: number; distance?: number; geometry?: { coordinates?: [number, number][] } }>;
    };
    const route = data.routes?.[0];
    const coords = route?.geometry?.coordinates;
    if (data.code !== "Ok" || !coords || coords.length < 2) {
      warnOnce(`osrm:${data.code}`, "routing: OSRM returned no route", { code: data.code });
      return null;
    }
    return {
      // GeoJSON is [lng, lat]; we hand out [lat, lng]
      path: coords.map(([lng, lat]) => [lat, lng] as [number, number]),
      durationSec: route.duration ?? 0,
      staticDurationSec: null,
      distanceM: route.distance ?? 0,
      provider: "osrm",
    };
  } catch (e) {
    warnOnce("osrm:error", "routing: OSRM failed", { err: String((e as Error)?.message ?? e) });
    return null;
  }
}

/** Straight line + average urban speed. Never fails. */
export function estimateRoute(o: LatLng, d: LatLng): RouteResult {
  const km = haversineKm(o.lat, o.lng, d.lat, d.lng);
  return {
    path: [
      [o.lat, o.lng],
      [d.lat, d.lng],
    ],
    durationSec: (km / AVG_KMH) * 3600,
    staticDurationSec: null,
    distanceM: km * 1000,
    provider: "estimate",
  };
}

/** Google → OSRM → estimate. Returns null only for invalid coordinates. */
export async function computeRoute(
  o: LatLng,
  d: LatLng,
  opts: { key?: string; fetchImpl?: FetchLike; traffic?: boolean } = {},
): Promise<RouteResult | null> {
  if (!validCoords(o.lat, o.lng, d.lat, d.lng)) return null;
  return (await googleRoute(o, d, opts)) ?? (await osrmRoute(o, d, opts)) ?? estimateRoute(o, d);
}
