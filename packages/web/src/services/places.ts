/**
 * Address search on Google Places API (New): autocomplete + place details.
 *
 * One implementation for both address proxies: the signed-in one
 * (api/routes/geo.ts) and the public-form one (api/routes/public-forms.ts).
 * They used to be two copies of the legacy Places calls, which Google no
 * longer offers to new Cloud projects (developers.google.com/maps/legacy).
 *
 * Billing (Documented, developers.google.com/maps/documentation/places/web-service/session-pricing):
 * every keystroke request in a session carries the same `sessionToken`, and
 * the session ends with ONE Place Details call using that token. The first
 * 12 autocomplete requests in a session are billed as "Autocomplete Requests";
 * the rest are free; the closing Details call is billed at the SKU its field
 * mask selects. `formattedAddress,location` is Place Details Essentials, the
 * cheapest tier that returns coordinates.
 *
 * Without a key this returns no suggestions and the field works as free text
 * (the booking paths geocode typed addresses server-side). The old fallback to
 * Nominatim for autocomplete is gone: Nominatim's usage policy forbids
 * autocomplete (operations.osmfoundation.org/policies/nominatim).
 */
import { mapsServerKey } from "./routing";
import { log } from "../api/lib/logger";

export const PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
export const PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places/";
/** Only what the dropdown shows. Keeps responses small; doesn't change the SKU. */
export const AUTOCOMPLETE_FIELD_MASK =
  "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text," +
  "suggestions.placePrediction.structuredFormat.mainText.text," +
  "suggestions.placePrediction.structuredFormat.secondaryText.text";
/** Place Details Essentials. Adding any Pro/Enterprise field raises the SKU. */
export const DETAILS_FIELD_MASK = "formattedAddress,location";
export const PLACES_TIMEOUT_MS = 4_000;
/** Bias suggestions toward the company's office, not restrict to it. */
export const BIAS_RADIUS_M = 50_000;
export const MIN_INPUT = 3;
export const MAX_INPUT = 200;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AddressPrediction {
  placeId: string;
  description: string;
  main: string;
  secondary: string;
}

export interface AutocompleteResult {
  predictions: AddressPrediction[];
  provider: "google" | "none";
  /** True when Google failed (bad key, API off, timeout). The UI falls back to free text. */
  degraded?: boolean;
}

export interface PlaceDetailsResult {
  lat: number | null;
  lng: number | null;
  address: string;
  provider: "google" | "none";
  degraded?: boolean;
}

/**
 * Google wants a URL- and filename-safe base64 string of at most 36 chars.
 * A v4 UUID fits. Anything else is dropped, which only means that request is
 * billed on its own instead of as part of a session.
 */
export function validSessionToken(t: string | undefined | null): string | undefined {
  return t && /^[A-Za-z0-9_-]{1,36}$/.test(t) ? t : undefined;
}

/** Place IDs are URL-safe base64. Reject anything that could alter the request path. */
export function validPlaceId(id: string | undefined | null): string | undefined {
  return id && /^[A-Za-z0-9_-]{1,512}$/.test(id) ? id : undefined;
}

const warned = new Map<string, number>();
function warnOnce(key: string, msg: string, extra?: Record<string, unknown>) {
  const now = Date.now();
  if (now - (warned.get(key) ?? 0) < 5 * 60_000) return;
  warned.set(key, now);
  log.warn(msg, extra);
}

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function autocompleteAddress(
  input: string,
  opts: {
    sessionToken?: string;
    bias?: { lat: number; lng: number } | null;
    key?: string;
    fetchImpl?: FetchLike;
  } = {},
): Promise<AutocompleteResult> {
  const q = input.trim();
  if (q.length < MIN_INPUT) return { predictions: [], provider: "google" };
  const key = opts.key ?? mapsServerKey();
  if (!key) return { predictions: [], provider: "none" };

  const body: Record<string, unknown> = {
    input: q.slice(0, MAX_INPUT),
    includedRegionCodes: ["ca", "us"],
  };
  const token = validSessionToken(opts.sessionToken);
  if (token) body.sessionToken = token;
  const b = opts.bias;
  if (b && Number.isFinite(b.lat) && Number.isFinite(b.lng)) {
    body.locationBias = { circle: { center: { latitude: b.lat, longitude: b.lng }, radius: BIAS_RADIUS_M } };
  }

  const doFetch: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  try {
    const r = await doFetch(PLACES_AUTOCOMPLETE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": AUTOCOMPLETE_FIELD_MASK },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
    });
    const data = (await r.json().catch(() => ({}))) as {
      suggestions?: Array<{
        placePrediction?: {
          placeId?: string;
          text?: { text?: string };
          structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
        };
      }>;
      error?: { status?: string; message?: string };
    };
    if (!r.ok) {
      // A disabled API or restricted key used to look like "no results". Say so in the logs.
      warnOnce(`ac:${r.status}:${data.error?.status ?? ""}`, "places: autocomplete failed", {
        httpStatus: r.status,
        googleStatus: data.error?.status,
        message: data.error?.message,
      });
      return { predictions: [], provider: "google", degraded: true };
    }
    const predictions: AddressPrediction[] = [];
    for (const s of data.suggestions ?? []) {
      const p = s.placePrediction;
      const placeId = validPlaceId(p?.placeId);
      if (!p || !placeId) continue; // query predictions etc.
      const description = text(p.text?.text);
      predictions.push({
        placeId,
        description,
        main: text(p.structuredFormat?.mainText?.text) || description,
        secondary: text(p.structuredFormat?.secondaryText?.text),
      });
    }
    return { predictions, provider: "google" };
  } catch (e) {
    warnOnce("ac:error", "places: autocomplete request failed", { err: String((e as Error)?.message ?? e) });
    return { predictions: [], provider: "google", degraded: true };
  }
}

export async function placeDetails(
  placeId: string,
  opts: { sessionToken?: string; key?: string; fetchImpl?: FetchLike } = {},
): Promise<PlaceDetailsResult> {
  const id = validPlaceId(placeId);
  const key = opts.key ?? mapsServerKey();
  if (!id || !key) return { lat: null, lng: null, address: "", provider: key ? "google" : "none" };

  const url = new URL(PLACES_DETAILS_URL + encodeURIComponent(id));
  const token = validSessionToken(opts.sessionToken);
  if (token) url.searchParams.set("sessionToken", token);

  const doFetch: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  try {
    const r = await doFetch(url.toString(), {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": DETAILS_FIELD_MASK },
      signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
    });
    const data = (await r.json().catch(() => ({}))) as {
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
      error?: { status?: string; message?: string };
    };
    const lat = data.location?.latitude;
    const lng = data.location?.longitude;
    if (r.ok && typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng, address: text(data.formattedAddress), provider: "google" };
    }
    warnOnce(`det:${r.status}:${data.error?.status ?? ""}`, "places: details returned no location", {
      httpStatus: r.status,
      googleStatus: data.error?.status,
      message: data.error?.message,
    });
    return { lat: null, lng: null, address: "", provider: "google", degraded: true };
  } catch (e) {
    warnOnce("det:error", "places: details request failed", { err: String((e as Error)?.message ?? e) });
    return { lat: null, lng: null, address: "", provider: "google", degraded: true };
  }
}
