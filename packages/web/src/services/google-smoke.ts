/**
 * Google Maps Platform smoke check (blueprint phase 0).
 *
 * Makes one live call to each Google API the modernization plan depends on,
 * using the key from the new "NVC360 Workforce" project, and reports what
 * came back. It runs on the server so the key never leaves the server's
 * secrets: the report carries status, timing and a short summary, never the
 * key or a URL containing it.
 *
 *   1. Routes API          computeRoutes, DRIVE + TRAFFIC_AWARE (Pro SKU)
 *   2. Places API (New)    autocomplete + place details, one session token
 *   3. Geocoding API       forward geocode, Canada component filter
 *   4. Maps Static API     one small PNG
 *
 * Cost per run: one Pro route, one autocomplete session ending in an
 * Essentials details call, one geocode and one static map. All of these
 * sit well inside the monthly free calls.
 *
 * Read-only and side-effect free apart from the billable calls; superadmin
 * only (see routes/superadmin.ts).
 */

export type SmokeKeyChoice = "new" | "current";

export interface SmokeCheck {
  name: "routes" | "places_autocomplete" | "places_details" | "geocoding" | "static_maps";
  api: string;
  ok: boolean;
  httpStatus: number | null;
  ms: number;
  /** Short human summary of what came back (or why it failed). */
  summary: string;
  /** Key facts pulled from the response, for the report. */
  details?: Record<string, unknown>;
  /** Google's error status, e.g. PERMISSION_DENIED / REQUEST_DENIED. */
  googleStatus?: string;
  /** The response body, only when fixtures were requested (never contains the key). */
  raw?: unknown;
}

export interface SmokeReport {
  ranAt: string;
  keyVar: string;
  keyPresent: boolean;
  allOk: boolean;
  checks: SmokeCheck[];
  notes: string[];
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 8_000;

/** River Heights → Osborne Village, Winnipeg: a short real drive. */
const ORIGIN = { latitude: 49.8662, longitude: -97.1735 };
const DESTINATION = { latitude: 49.8762, longitude: -97.1435 };
const AUTOCOMPLETE_INPUT = "100 Osborne St Winnipeg";
const GEOCODE_ADDRESS = "510 Main St, Winnipeg, MB";

export function keyVarFor(choice: SmokeKeyChoice): string {
  return choice === "current" ? "GOOGLE_MAPS_API_KEY" : "GOOGLE_MAPS_API_KEY_NEW";
}

/** Remove anything that looks like the key from text we report back. */
export function redact(text: string, key: string | undefined): string {
  let out = text;
  if (key) out = out.split(key).join("[redacted]");
  return out.replace(/([?&]key=)[^&\s"]+/g, "$1[redacted]");
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: unknown; ms: number }> {
  const t0 = performance.now();
  try {
    const value = await fn();
    return { value, ms: Math.round(performance.now() - t0) };
  } catch (error) {
    return { error, ms: Math.round(performance.now() - t0) };
  }
}

async function readJson(r: Response): Promise<unknown> {
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { nonJsonBody: text.slice(0, 300) };
  }
}

/** Google v1 APIs answer errors as { error: { status, message } }. */
function googleError(body: unknown): { status?: string; message?: string } {
  const e = (body as { error?: { status?: string; message?: string } } | null)?.error;
  return e ? { status: e.status, message: e.message } : {};
}

function failure(
  base: Pick<SmokeCheck, "name" | "api">,
  ms: number,
  httpStatus: number | null,
  message: string,
  key: string | undefined,
  googleStatus?: string,
  raw?: unknown,
): SmokeCheck {
  return {
    ...base,
    ok: false,
    httpStatus,
    ms,
    summary: redact(message, key),
    ...(googleStatus ? { googleStatus } : {}),
    ...(raw !== undefined ? { raw } : {}),
  };
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.name === "TimeoutError" ? `timed out after ${TIMEOUT_MS / 1000}s` : e.message;
  return String(e);
}

export async function runGoogleSmoke(
  opts: { choice?: SmokeKeyChoice; includeRaw?: boolean; fetchImpl?: FetchLike; env?: Record<string, string | undefined> } = {},
): Promise<SmokeReport> {
  const choice = opts.choice ?? "new";
  const env = opts.env ?? process.env;
  const doFetch: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const keyVar = keyVarFor(choice);
  const key = env[keyVar]?.trim() || undefined;
  const raw = Boolean(opts.includeRaw);
  const notes: string[] = [];
  const checks: SmokeCheck[] = [];
  const signal = () => AbortSignal.timeout(TIMEOUT_MS);

  if (!key) {
    return {
      ranAt: new Date().toISOString(),
      keyVar,
      keyPresent: false,
      allOk: false,
      checks: [],
      notes: [`${keyVar} is not set on this server. Add it in the hosting secrets and redeploy.`],
    };
  }

  // 1. Routes API — the traffic-aware call that drives ETAs.
  {
    const base = { name: "routes", api: "Routes API · computeRoutes (TRAFFIC_AWARE)" } as const;
    const res = await timed(async () => {
      const r = await doFetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline",
        },
        body: JSON.stringify({
          origin: { location: { latLng: ORIGIN } },
          destination: { location: { latLng: DESTINATION } },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
          regionCode: "CA",
          units: "METRIC",
        }),
        signal: signal(),
      });
      return { r, body: await readJson(r) };
    });
    if (res.error || !res.value) {
      checks.push(failure(base, res.ms, null, `Request failed: ${errText(res.error)}`, key));
    } else {
      const { r, body } = res.value;
      const route = (body as { routes?: Array<Record<string, unknown>> }).routes?.[0];
      if (r.ok && route) {
        const secs = (s: unknown) => (typeof s === "string" ? Number(s.replace(/s$/, "")) : NaN);
        const dur = secs(route.duration);
        const stat = secs(route.staticDuration);
        const poly = (route.polyline as { encodedPolyline?: string } | undefined)?.encodedPolyline ?? "";
        checks.push({
          ...base,
          ok: true,
          httpStatus: r.status,
          ms: res.ms,
          summary: `${((route.distanceMeters as number) / 1000).toFixed(1)} km, ${Math.round(dur / 60)} min with traffic (${Math.round(stat / 60)} min without)`,
          details: { distanceMeters: route.distanceMeters, durationSec: dur, staticDurationSec: stat, polylineChars: poly.length },
          ...(raw ? { raw: body } : {}),
        });
      } else {
        const g = googleError(body);
        checks.push(
          failure(base, res.ms, r.status, g.message ?? (r.ok ? "No route returned" : `HTTP ${r.status}`), key, g.status, raw ? body : undefined),
        );
      }
    }
  }

  // 2. Places API (New) — autocomplete then details, sharing one session token.
  const sessionToken = crypto.randomUUID();
  let placeId: string | undefined;
  {
    const base = { name: "places_autocomplete", api: "Places API (New) · autocomplete" } as const;
    const res = await timed(async () => {
      const r = await doFetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
        body: JSON.stringify({
          input: AUTOCOMPLETE_INPUT,
          sessionToken,
          includedRegionCodes: ["ca", "us"],
          locationBias: { circle: { center: ORIGIN, radius: 30_000 } },
        }),
        signal: signal(),
      });
      return { r, body: await readJson(r) };
    });
    if (res.error || !res.value) {
      checks.push(failure(base, res.ms, null, `Request failed: ${errText(res.error)}`, key));
    } else {
      const { r, body } = res.value;
      type Sugg = { placePrediction?: { placeId?: string; text?: { text?: string } } };
      const preds = ((body as { suggestions?: Sugg[] }).suggestions ?? []).filter((s) => s.placePrediction?.placeId);
      if (r.ok && preds.length) {
        placeId = preds[0]!.placePrediction!.placeId;
        checks.push({
          ...base,
          ok: true,
          httpStatus: r.status,
          ms: res.ms,
          summary: `${preds.length} suggestion(s); top: "${preds[0]!.placePrediction!.text?.text ?? "?"}"`,
          details: { suggestions: preds.slice(0, 3).map((s) => s.placePrediction!.text?.text) },
          ...(raw ? { raw: body } : {}),
        });
      } else {
        const g = googleError(body);
        checks.push(
          failure(base, res.ms, r.status, g.message ?? (r.ok ? "No suggestions returned" : `HTTP ${r.status}`), key, g.status, raw ? body : undefined),
        );
      }
    }
  }
  {
    const base = { name: "places_details", api: "Places API (New) · place details (Essentials fields)" } as const;
    if (!placeId) {
      checks.push(failure(base, 0, null, "Skipped: autocomplete returned no place to look up", key));
    } else {
      const res = await timed(async () => {
        const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId!)}?sessionToken=${sessionToken}`;
        const r = await doFetch(url, {
          headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,formattedAddress,location" },
          signal: signal(),
        });
        return { r, body: await readJson(r) };
      });
      if (res.error || !res.value) {
        checks.push(failure(base, res.ms, null, `Request failed: ${errText(res.error)}`, key));
      } else {
        const { r, body } = res.value;
        const p = body as { formattedAddress?: string; location?: { latitude?: number; longitude?: number } };
        if (r.ok && p.location?.latitude != null) {
          checks.push({
            ...base,
            ok: true,
            httpStatus: r.status,
            ms: res.ms,
            summary: `${p.formattedAddress} (${p.location.latitude.toFixed(5)}, ${p.location.longitude?.toFixed(5)})`,
            details: { formattedAddress: p.formattedAddress, location: p.location },
            ...(raw ? { raw: body } : {}),
          });
        } else {
          const g = googleError(body);
          checks.push(
            failure(base, res.ms, r.status, g.message ?? (r.ok ? "No location returned" : `HTTP ${r.status}`), key, g.status, raw ? body : undefined),
          );
        }
      }
    }
  }

  // 3. Geocoding API.
  {
    const base = { name: "geocoding", api: "Geocoding API" } as const;
    const res = await timed(async () => {
      const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      u.searchParams.set("address", GEOCODE_ADDRESS);
      u.searchParams.set("components", "country:CA");
      u.searchParams.set("key", key);
      const r = await doFetch(u.toString(), { signal: signal() });
      return { r, body: await readJson(r) };
    });
    if (res.error || !res.value) {
      checks.push(failure(base, res.ms, null, `Request failed: ${errText(res.error)}`, key));
    } else {
      const { r, body } = res.value;
      const b = body as {
        status?: string;
        error_message?: string;
        results?: Array<{ formatted_address?: string; geometry?: { location?: { lat: number; lng: number }; location_type?: string } }>;
      };
      const top = b.results?.[0];
      if (r.ok && b.status === "OK" && top?.geometry?.location) {
        checks.push({
          ...base,
          ok: true,
          httpStatus: r.status,
          ms: res.ms,
          summary: `${top.formatted_address} (${top.geometry.location.lat.toFixed(5)}, ${top.geometry.location.lng.toFixed(5)}, ${top.geometry.location_type})`,
          details: { formattedAddress: top.formatted_address, location: top.geometry.location, locationType: top.geometry.location_type },
          ...(raw ? { raw: body } : {}),
        });
      } else {
        checks.push(
          failure(base, res.ms, r.status, b.error_message ?? `Status ${b.status ?? `HTTP ${r.status}`}`, key, b.status, raw ? body : undefined),
        );
      }
    }
  }

  // 4. Maps Static API. Unsigned here; URL signing lands in phase 3.
  {
    const base = { name: "static_maps", api: "Maps Static API" } as const;
    const res = await timed(async () => {
      const u = new URL("https://maps.googleapis.com/maps/api/staticmap");
      u.searchParams.set("size", "320x200");
      u.searchParams.set("scale", "2");
      u.searchParams.set("markers", `${ORIGIN.latitude},${ORIGIN.longitude}|${DESTINATION.latitude},${DESTINATION.longitude}`);
      u.searchParams.set("key", key);
      const r = await doFetch(u.toString(), { signal: signal() });
      const type = r.headers.get("content-type") ?? "";
      const buf = new Uint8Array(await r.arrayBuffer());
      return { r, type, buf };
    });
    if (res.error || !res.value) {
      checks.push(failure(base, res.ms, null, `Request failed: ${errText(res.error)}`, key));
    } else {
      const { r, type, buf } = res.value;
      const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      if (r.ok && type.startsWith("image/") && isPng) {
        checks.push({
          ...base,
          ok: true,
          httpStatus: r.status,
          ms: res.ms,
          summary: `PNG, ${(buf.length / 1024).toFixed(1)} KB`,
          details: { contentType: type, bytes: buf.length },
        });
      } else {
        // Static Maps errors come back as plain text, sometimes with a 200 and an error image.
        const text = new TextDecoder().decode(buf.slice(0, 400));
        checks.push(failure(base, res.ms, r.status, type.startsWith("image/") ? `Unexpected image (${type})` : text || `HTTP ${r.status}`, key));
      }
    }
  }

  const allOk = checks.length === 5 && checks.every((c) => c.ok);
  if (!allOk) {
    if (checks.some((c) => !c.ok && /key not valid|key is invalid/i.test(c.summary))) {
      notes.push(`Google rejected the key itself. Check that ${keyVar} holds the complete key, with no spaces or quotes.`);
    }
    const denied = checks.filter((c) => !c.ok && /PERMISSION_DENIED|REQUEST_DENIED|not authorized|API_KEY_SERVICE_BLOCKED/i.test(`${c.googleStatus ?? ""} ${c.summary}`));
    if (denied.length) {
      notes.push(
        "A denied call usually means that API isn't enabled in the Google Cloud project, isn't in the key's API restrictions, or billing isn't linked.",
      );
    }
  }
  notes.push("Costs: one traffic-aware route (Pro), one autocomplete session, one geocode, one static map. All within Google's monthly free calls.");

  return { ranAt: new Date().toISOString(), keyVar, keyPresent: true, allOk, checks, notes };
}
