import { describe, expect, test } from "bun:test";
import { computeRoute, estimateRoute, googleRoute, mapsServerKey, ROUTES_FIELD_MASK } from "../routing";
import { encodePolyline } from "../../shared/polyline";

const O = { lat: 49.8662, lng: -97.1735 };
const D = { lat: 49.8762, lng: -97.1435 };
const PATH: [number, number][] = [
  [49.8662, -97.1735],
  [49.87, -97.16],
  [49.8762, -97.1435],
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Response shape recorded from the live smoke check on 2026-10-07. */
const GOOGLE_OK = {
  routes: [{ distanceMeters: 2547, duration: "377s", staticDuration: "370s", polyline: { encodedPolyline: encodePolyline(PATH) } }],
};
const OSRM_OK = {
  code: "Ok",
  routes: [{ duration: 400, distance: 2600, geometry: { coordinates: PATH.map(([lat, lng]) => [lng, lat]) } }],
};

describe("mapsServerKey", () => {
  test("prefers the new project's key, falls back to the old one", () => {
    expect(mapsServerKey({ GOOGLE_MAPS_API_KEY_NEW: "new", GOOGLE_MAPS_API_KEY: "old" })).toBe("new");
    expect(mapsServerKey({ GOOGLE_MAPS_API_KEY_NEW: "  ", GOOGLE_MAPS_API_KEY: "old" })).toBe("old");
    expect(mapsServerKey({})).toBeUndefined();
  });
});

describe("googleRoute", () => {
  test("sends a TRAFFIC_AWARE, HIGH_QUALITY request with the field mask and parses the route", async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const r = await googleRoute(O, D, {
      key: "k",
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return json(GOOGLE_OK);
      },
    });
    expect(seen!.url).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    const h = seen!.init!.headers as Record<string, string>;
    expect(h["X-Goog-Api-Key"]).toBe("k");
    expect(h["X-Goog-FieldMask"]).toBe(ROUTES_FIELD_MASK);
    const body = JSON.parse(String(seen!.init!.body));
    expect(body.routingPreference).toBe("TRAFFIC_AWARE");
    expect(body.polylineQuality).toBe("HIGH_QUALITY");
    expect(body.travelMode).toBe("DRIVE");
    expect(body.origin.location.latLng).toEqual({ latitude: O.lat, longitude: O.lng });
    // nothing that would bump the request to the Enterprise SKU
    expect(body.extraComputations).toBeUndefined();
    expect(body.routeModifiers).toBeUndefined();

    expect(r).toEqual({ path: PATH, durationSec: 377, staticDurationSec: 370, distanceM: 2547, provider: "google" });
  });

  test("traffic: false asks for TRAFFIC_UNAWARE (Essentials SKU)", async () => {
    let body: { routingPreference?: string } = {};
    await googleRoute(O, D, {
      key: "k",
      traffic: false,
      fetchImpl: async (_u, init) => {
        body = JSON.parse(String(init!.body));
        return json(GOOGLE_OK);
      },
    });
    expect(body.routingPreference).toBe("TRAFFIC_UNAWARE");
  });

  test("a disabled API or bad key returns null (caller falls back)", async () => {
    const denied = () =>
      json({ error: { code: 403, status: "PERMISSION_DENIED", message: "Routes API has not been used in project" } }, 403);
    expect(await googleRoute(O, D, { key: "k", fetchImpl: async () => denied() })).toBeNull();
    expect(await googleRoute(O, D, { key: "k", fetchImpl: async () => json({}) })).toBeNull();
    expect(
      await googleRoute(O, D, {
        key: "k",
        fetchImpl: async () => {
          throw new DOMException("timed out", "TimeoutError");
        },
      }),
    ).toBeNull();
  });

  test("no key means no request", async () => {
    let called = false;
    const r = await googleRoute(O, D, {
      key: "",
      fetchImpl: async () => {
        called = true;
        return json(GOOGLE_OK);
      },
    });
    expect(r).toBeNull();
    expect(called).toBe(false);
  });
});

describe("computeRoute fallbacks", () => {
  test("Google → OSRM when Google fails", async () => {
    const r = await computeRoute(O, D, {
      key: "k",
      fetchImpl: async (url) => (url.includes("routes.googleapis.com") ? json({}, 500) : json(OSRM_OK)),
    });
    expect(r!.provider).toBe("osrm");
    expect(r!.path).toEqual(PATH);
    expect(r!.durationSec).toBe(400);
  });

  test("OSRM → straight-line estimate when both fail", async () => {
    const r = await computeRoute(O, D, { key: "k", fetchImpl: async () => json({}, 503) });
    expect(r!.provider).toBe("estimate");
    expect(r!.path).toEqual([
      [O.lat, O.lng],
      [D.lat, D.lng],
    ]);
  });

  test("invalid coordinates → null", async () => {
    expect(await computeRoute({ lat: NaN, lng: 0 }, D, { key: "k", fetchImpl: async () => json(GOOGLE_OK) })).toBeNull();
  });

  test("the estimate uses an urban average speed", () => {
    const e = estimateRoute(O, D);
    // ~2.4 km at 32 km/h ≈ 4.5 min
    expect(e.durationSec / 60).toBeGreaterThan(3.5);
    expect(e.durationSec / 60).toBeLessThan(5.5);
  });
});
