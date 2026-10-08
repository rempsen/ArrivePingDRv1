import { describe, expect, test } from "bun:test";
import { redact, runGoogleSmoke } from "../google-smoke";

const KEY = "AIzaTEST-not-a-real-key-123";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

type Call = { url: string; init?: RequestInit };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fake Google that answers every API happily, unless overridden. */
function fakeGoogle(overrides: Partial<Record<"routes" | "auto" | "details" | "geo" | "static", () => Response>> = {}) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes("computeRoutes"))
      return (overrides.routes ?? (() =>
        json({ routes: [{ distanceMeters: 3900, duration: "540s", staticDuration: "480s", polyline: { encodedPolyline: "abc" } }] })))();
    if (url.includes("places:autocomplete"))
      return (overrides.auto ?? (() =>
        json({ suggestions: [{ placePrediction: { placeId: "ChIJ123", text: { text: "100 Osborne St, Winnipeg, MB" } } }] })))();
    if (url.includes("places.googleapis.com/v1/places/"))
      return (overrides.details ?? (() =>
        json({ id: "ChIJ123", formattedAddress: "100 Osborne St, Winnipeg, MB R3L 1Y5", location: { latitude: 49.88, longitude: -97.14 } })))();
    if (url.includes("geocode/json"))
      return (overrides.geo ?? (() =>
        json({ status: "OK", results: [{ formatted_address: "510 Main St, Winnipeg", geometry: { location: { lat: 49.9, lng: -97.13 }, location_type: "ROOFTOP" } }] })))();
    if (url.includes("staticmap"))
      return (overrides.static ?? (() => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } })))();
    throw new Error(`unexpected url ${url}`);
  };
  return { calls, impl };
}

describe("runGoogleSmoke", () => {
  test("reports a missing key without calling Google", async () => {
    const g = fakeGoogle();
    const r = await runGoogleSmoke({ env: {}, fetchImpl: g.impl });
    expect(r.keyPresent).toBe(false);
    expect(r.keyVar).toBe("GOOGLE_MAPS_API_KEY_NEW");
    expect(r.allOk).toBe(false);
    expect(g.calls.length).toBe(0);
  });

  test("all five checks pass and the key never appears in the report", async () => {
    const g = fakeGoogle();
    const r = await runGoogleSmoke({ env: { GOOGLE_MAPS_API_KEY_NEW: KEY }, fetchImpl: g.impl, includeRaw: true });
    expect(r.allOk).toBe(true);
    expect(r.checks.map((c) => c.name)).toEqual(["routes", "places_autocomplete", "places_details", "geocoding", "static_maps"]);
    expect(r.checks[0]!.summary).toBe("3.9 km, 9 min with traffic (8 min without)");
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  test("uses TRAFFIC_AWARE, a field mask, and one session token across autocomplete and details", async () => {
    const g = fakeGoogle();
    await runGoogleSmoke({ env: { GOOGLE_MAPS_API_KEY_NEW: KEY }, fetchImpl: g.impl });
    const routes = g.calls.find((c) => c.url.includes("computeRoutes"))!;
    const body = JSON.parse(String(routes.init!.body));
    expect(body.routingPreference).toBe("TRAFFIC_AWARE");
    const h = routes.init!.headers as Record<string, string>;
    expect(h["X-Goog-FieldMask"]).toContain("routes.duration");
    expect(h["X-Goog-Api-Key"]).toBe(KEY);

    const auto = g.calls.find((c) => c.url.includes("places:autocomplete"))!;
    const token = JSON.parse(String(auto.init!.body)).sessionToken;
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    const details = g.calls.find((c) => c.url.includes("/v1/places/ChIJ123"))!;
    expect(details.url).toContain(`sessionToken=${token}`);
    expect((details.init!.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe("id,formattedAddress,location");
  });

  test("?key=current reads GOOGLE_MAPS_API_KEY", async () => {
    const g = fakeGoogle();
    const r = await runGoogleSmoke({ choice: "current", env: { GOOGLE_MAPS_API_KEY: KEY }, fetchImpl: g.impl });
    expect(r.keyVar).toBe("GOOGLE_MAPS_API_KEY");
    expect(r.allOk).toBe(true);
  });

  test("a disabled API is reported with Google's status and a hint", async () => {
    const g = fakeGoogle({
      routes: () => json({ error: { code: 403, status: "PERMISSION_DENIED", message: "Routes API has not been used in project 123" } }, 403),
    });
    const r = await runGoogleSmoke({ env: { GOOGLE_MAPS_API_KEY_NEW: KEY }, fetchImpl: g.impl });
    expect(r.allOk).toBe(false);
    const routes = r.checks[0]!;
    expect(routes.ok).toBe(false);
    expect(routes.httpStatus).toBe(403);
    expect(routes.googleStatus).toBe("PERMISSION_DENIED");
    expect(r.notes.some((n) => n.includes("isn't enabled"))).toBe(true);
    // the other APIs are still tested
    expect(r.checks.filter((c) => c.ok).length).toBe(4);
  });

  test("details is skipped when autocomplete finds nothing", async () => {
    const g = fakeGoogle({ auto: () => json({}) });
    const r = await runGoogleSmoke({ env: { GOOGLE_MAPS_API_KEY_NEW: KEY }, fetchImpl: g.impl });
    const d = r.checks.find((c) => c.name === "places_details")!;
    expect(d.ok).toBe(false);
    expect(d.summary).toContain("Skipped");
    expect(g.calls.some((c) => c.url.includes("/v1/places/"))).toBe(false);
  });

  test("geocoding REQUEST_DENIED and a static-map text error are failures, with the key redacted", async () => {
    const g = fakeGoogle({
      geo: () => json({ status: "REQUEST_DENIED", error_message: "This API project is not authorized to use this API.", results: [] }),
      static: () => new Response(`The Google Maps Platform server rejected your request. key=${KEY}`, { status: 403, headers: { "content-type": "text/plain" } }),
    });
    const r = await runGoogleSmoke({ env: { GOOGLE_MAPS_API_KEY_NEW: KEY }, fetchImpl: g.impl });
    const geo = r.checks.find((c) => c.name === "geocoding")!;
    expect(geo.ok).toBe(false);
    expect(geo.googleStatus).toBe("REQUEST_DENIED");
    const st = r.checks.find((c) => c.name === "static_maps")!;
    expect(st.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  test("an invalid key gets a 'check the key' hint (shape recorded from real Google, 2026-10-07)", async () => {
    const bad = () => json({ error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." } }, 400);
    const g = fakeGoogle({ routes: bad, auto: bad });
    const r = await runGoogleSmoke({ env: { GOOGLE_MAPS_API_KEY_NEW: KEY }, fetchImpl: g.impl });
    expect(r.notes.some((n) => n.includes("rejected the key itself"))).toBe(true);
  });

  test("a network error is reported, not thrown", async () => {
    const g = fakeGoogle({
      routes: () => {
        throw new TypeError("fetch failed");
      },
    });
    const r = await runGoogleSmoke({ env: { GOOGLE_MAPS_API_KEY_NEW: KEY }, fetchImpl: g.impl });
    expect(r.checks[0]!.ok).toBe(false);
    expect(r.checks[0]!.summary).toContain("fetch failed");
  });
});

describe("redact", () => {
  test("removes the key and any key= query value", () => {
    expect(redact(`x ${KEY} y`, KEY)).toBe("x [redacted] y");
    expect(redact("https://a.b/c?size=1&key=ABC123&z=2", undefined)).toBe("https://a.b/c?size=1&key=[redacted]&z=2");
  });
});
