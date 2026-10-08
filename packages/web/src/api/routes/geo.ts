import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { forwardGeocode } from "../../services/geocode";
import type { AppEnv } from "../env";

const KEY = process.env.GOOGLE_MAPS_API_KEY;

// Routing and ETAs moved to services/routing.ts + services/trip-engine.ts
// (Routes API). Places below moves to Places API (New) in phase 2.

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
  });
