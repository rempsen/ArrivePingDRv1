import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { forwardGeocode } from "../../services/geocode";
import type { AppEnv } from "../env";

const KEY = process.env.GOOGLE_MAPS_API_KEY;

const AVG_KMH = 32; // urban average, used for haversine fallback

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * Compute live driving ETA from origin -> destination.
 * Uses Google Distance Matrix (traffic-aware) when a key is set,
 * otherwise falls back to a haversine + average-speed estimate.
 * Returns null when coords are invalid.
 */
export async function computeEta(
  oLat: number,
  oLng: number,
  dLat: number,
  dLng: number,
): Promise<{ etaMins: number; distanceKm: number; durationText: string; provider: string } | null> {
  if (
    [oLat, oLng, dLat, dLng].some(
      (n) => typeof n !== "number" || Number.isNaN(n),
    )
  )
    return null;

  if (KEY) {
    try {
      const url = new URL(
        "https://maps.googleapis.com/maps/api/distancematrix/json",
      );
      url.searchParams.set("origins", `${oLat},${oLng}`);
      url.searchParams.set("destinations", `${dLat},${dLng}`);
      url.searchParams.set("mode", "driving");
      url.searchParams.set("departure_time", "now"); // enables traffic model
      url.searchParams.set("key", KEY);
      const r = await fetch(url);
      const data = await r.json();
      const el = data.rows?.[0]?.elements?.[0];
      if (el?.status === "OK") {
        const dur = el.duration_in_traffic ?? el.duration;
        return {
          etaMins: Math.max(1, Math.round((dur.value ?? 0) / 60)),
          distanceKm: Math.round(((el.distance?.value ?? 0) / 1000) * 10) / 10,
          durationText: dur.text ?? "",
          provider: "google",
        };
      }
    } catch {
      // fall through to estimate
    }
  }

  const km = haversineKm(oLat, oLng, dLat, dLng);
  const etaMins = Math.max(1, Math.round((km / AVG_KMH) * 60));
  return {
    etaMins,
    distanceKm: Math.round(km * 10) / 10,
    durationText: `${etaMins} min`,
    provider: "estimate",
  };
}

/**
 * Compute live driving route origin -> destination.
 *
 * Road-following path (Uber/Lyft-style) plus live ETA. Sources, in order:
 *   1. Google Directions (traffic-aware) — step-level polylines stitched
 *      together, because `overview_polyline` is heavily simplified and on a
 *      short urban hop can collapse to a handful of points that cut corners.
 *   2. OSRM public demo router — keyless, no traffic, but still real streets.
 *      Used when there is no Google key, Google denies the request, or it
 *      times out, so the customer never sees a line drawn through buildings.
 *   3. Straight 2-point line + haversine ETA (`provider: "estimate"`) — last
 *      resort only. Callers can tell it apart via `provider` and render it as
 *      an approximation (dashed) rather than a route.
 *
 * Returns the decoded path as [lat,lng] points.
 */
export async function computeRoute(
  oLat: number,
  oLng: number,
  dLat: number,
  dLng: number,
): Promise<{
  path: [number, number][];
  etaMins: number;
  distanceKm: number;
  durationText: string;
  provider: string;
} | null> {
  if ([oLat, oLng, dLat, dLng].some((n) => typeof n !== "number" || Number.isNaN(n)))
    return null;

  if (KEY) {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
      url.searchParams.set("origin", `${oLat},${oLng}`);
      url.searchParams.set("destination", `${dLat},${dLng}`);
      url.searchParams.set("mode", "driving");
      url.searchParams.set("departure_time", "now");
      url.searchParams.set("key", KEY);
      const r = await fetch(url, { signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) });
      const data = await r.json();
      const route = data.routes?.[0];
      const leg = route?.legs?.[0];
      if (route && leg) {
        // Stitch per-step polylines for a faithful street trace; fall back to
        // the overview line if a step is missing its geometry.
        let path: [number, number][] = [];
        const steps: any[] = Array.isArray(leg.steps) ? leg.steps : [];
        if (steps.length && steps.every((st) => st?.polyline?.points)) {
          for (const st of steps) {
            const seg = decodePolyline(st.polyline.points);
            // consecutive steps share their boundary point — drop the duplicate
            if (path.length && seg.length && samePoint(path[path.length - 1], seg[0])) seg.shift();
            path.push(...seg);
          }
        }
        if (path.length < 2 && route.overview_polyline?.points) {
          path = decodePolyline(route.overview_polyline.points);
        }
        if (path.length >= 2) {
          const dur = leg.duration_in_traffic ?? leg.duration;
          return {
            path,
            etaMins: Math.max(1, Math.round((dur?.value ?? 0) / 60)),
            distanceKm: Math.round(((leg.distance?.value ?? 0) / 1000) * 10) / 10,
            durationText: dur?.text ?? "",
            provider: "google",
          };
        }
      }
      // Surface the reason instead of silently drawing a straight line. Typical:
      // REQUEST_DENIED (Directions API not enabled, or key restricted to
      // browser referrers so server calls are blocked), OVER_QUERY_LIMIT.
      warnOnce(
        `directions:${data.status}`,
        `[geo] Google Directions returned ${data.status ?? "no routes"}${
          data.error_message ? ` — ${data.error_message}` : ""
        }; falling back to OSRM`,
      );
    } catch (e) {
      warnOnce("directions:error", `[geo] Google Directions failed: ${(e as Error)?.message}`);
    }
  }

  const osrm = await osrmRoute(oLat, oLng, dLat, dLng);
  if (osrm) return osrm;

  const km = haversineKm(oLat, oLng, dLat, dLng);
  const etaMins = Math.max(1, Math.round((km / AVG_KMH) * 60));
  return {
    path: [
      [oLat, oLng],
      [dLat, dLng],
    ],
    etaMins,
    distanceKm: Math.round(km * 10) / 10,
    durationText: `${etaMins} min`,
    provider: "estimate",
  };
}

const ROUTE_TIMEOUT_MS = 4_000;

function samePoint(a: [number, number], b: [number, number]) {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

// One log line per distinct failure per ~5 minutes — the public tracking page
// polls every few seconds and a misconfigured key would otherwise flood logs.
const warned = new Map<string, number>();
function warnOnce(key: string, msg: string) {
  const now = Date.now();
  const last = warned.get(key) ?? 0;
  if (now - last < 5 * 60_000) return;
  warned.set(key, now);
  console.warn(msg);
}

/**
 * OSRM public demo server. No key, no traffic data, fair-use only — fine as a
 * fallback at our poll cadence (routes are cached ~12s per booking upstream).
 */
async function osrmRoute(oLat: number, oLng: number, dLat: number, dLng: number) {
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/${oLng},${oLat};${dLng},${dLat}` +
      `?overview=full&geometries=geojson&steps=false`;
    const r = await fetch(url, {
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
      headers: { "User-Agent": "ArrivePing/1.0 (+https://arriveping.com)" },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const route = data.routes?.[0];
    const coords: [number, number][] | undefined = route?.geometry?.coordinates;
    if (data.code !== "Ok" || !coords || coords.length < 2) {
      warnOnce(`osrm:${data.code}`, `[geo] OSRM returned ${data.code ?? "no route"}`);
      return null;
    }
    const etaMins = Math.max(1, Math.round((route.duration ?? 0) / 60));
    return {
      // GeoJSON is [lng,lat]; we hand out [lat,lng]
      path: coords.map(([lng, lat]) => [lat, lng] as [number, number]),
      etaMins,
      distanceKm: Math.round(((route.distance ?? 0) / 1000) * 10) / 10,
      durationText: `${etaMins} min`,
      provider: "osrm",
    };
  } catch (e) {
    warnOnce("osrm:error", `[geo] OSRM failed: ${(e as Error)?.message}`);
    return null;
  }
}

/** Decode a Google encoded polyline into [lat,lng] pairs. */
function decodePolyline(encoded: string): [number, number][] {
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
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/**
 * Server-side proxy for Google Places so the API key never reaches the browser.
 * Falls back to OpenStreetMap Nominatim if no key is configured.
 */
export const geoRoutes = new Hono<AppEnv>()
  // autocomplete: ?q=423 main
  .get("/autocomplete", requireAuth, async (c) => {
    const q = c.req.query("q")?.trim();
    if (!q || q.length < 3) return c.json({ predictions: [] }, 200);

    if (KEY) {
      const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
      url.searchParams.set("input", q);
      url.searchParams.set("key", KEY);
      url.searchParams.set("components", "country:ca|country:us");
      const r = await fetch(url);
      const data = await r.json();
      const predictions = (data.predictions || []).map((p: any) => ({
        placeId: p.place_id,
        description: p.description,
        main: p.structured_formatting?.main_text ?? p.description,
        secondary: p.structured_formatting?.secondary_text ?? "",
      }));
      return c.json({ predictions, provider: "google" }, 200);
    }

    // Nominatim fallback
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "json");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "6");
    const r = await fetch(url, { headers: { "User-Agent": "ArrivePing/1.0" } });
    const data = await r.json();
    const predictions = (data || []).map((p: any) => ({
      placeId: `osm:${p.lat},${p.lon}`,
      description: p.display_name,
      main: p.display_name.split(",")[0],
      secondary: p.display_name.split(",").slice(1).join(",").trim(),
      lat: parseFloat(p.lat),
      lng: parseFloat(p.lon),
    }));
    return c.json({ predictions, provider: "osm" }, 200);
  })
  // resolve a placeId to coordinates + formatted address
  .get("/details", requireAuth, async (c) => {
    const placeId = c.req.query("placeId");
    if (!placeId) return c.json({ message: "placeId required" }, 400);

    if (placeId.startsWith("osm:")) {
      const [lat, lng] = placeId.slice(4).split(",").map(Number);
      return c.json({ lat, lng, address: c.req.query("description") || "" }, 200);
    }

    if (KEY) {
      const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
      url.searchParams.set("place_id", placeId);
      url.searchParams.set("key", KEY);
      url.searchParams.set("fields", "geometry,formatted_address");
      const r = await fetch(url);
      const data = await r.json();
      const loc = data.result?.geometry?.location;
      return c.json({
        lat: loc?.lat ?? null,
        lng: loc?.lng ?? null,
        address: data.result?.formatted_address ?? "",
        provider: "google",
      }, 200);
    }
    return c.json({ message: "No geocoder configured" }, 500);
  })
  // forward geocode a free-text address. Delegates to services/geocode.ts so
  // this route and the booking-create paths share ONE implementation (and one
  // timeout policy) instead of two copies that can drift.
  .get("/geocode", requireAuth, async (c) => {
    const address = c.req.query("address")?.trim();
    if (!address) return c.json({ message: "address required" }, 400);
    const hit = await forwardGeocode(address);
    return c.json({ lat: hit?.lat ?? null, lng: hit?.lng ?? null, address: hit?.address ?? address }, 200);
  })
  // live driving ETA: ?oLat=&oLng=&dLat=&dLng=
  .get("/eta", requireAuth, async (c) => {
    const oLat = parseFloat(c.req.query("oLat") ?? "");
    const oLng = parseFloat(c.req.query("oLng") ?? "");
    const dLat = parseFloat(c.req.query("dLat") ?? "");
    const dLng = parseFloat(c.req.query("dLng") ?? "");
    const res = await computeEta(oLat, oLng, dLat, dLng);
    if (!res) return c.json({ message: "valid oLat,oLng,dLat,dLng required" }, 400);
    return c.json(res, 200);
  })
  // expose whether google is available (no key leak)
  .get("/config", requireAuth, (c) => c.json({ provider: KEY ? "google" : "osm" }, 200));
