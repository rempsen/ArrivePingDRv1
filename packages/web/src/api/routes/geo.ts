import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { forwardGeocode } from "../../services/geocode";
import { autocompleteAddress, placeDetails } from "../../services/places";
import { companyOfficeBias } from "../../services/company-office";
import type { AppEnv } from "../env";

// Routing and ETAs live in services/routing.ts + services/trip-engine.ts
// (Routes API). Address search lives in services/places.ts (Places API New).

/**
 * Signed-in address proxy, so the Maps key never reaches the browser.
 * The browser sends one `sessionToken` for every keystroke of an address entry
 * and the closing details call, so Google bills it as one session.
 */
export const geoRoutes = new Hono<AppEnv>()
  // autocomplete: ?q=423 main&sessionToken=<uuid>
  .get("/autocomplete", requireAuth, async (c) => {
    const q = c.req.query("q")?.trim() ?? "";
    const bias = await companyOfficeBias(c.get("companyId"));
    const res = await autocompleteAddress(q, { sessionToken: c.req.query("sessionToken"), bias });
    return c.json(res, 200);
  })
  // resolve a placeId to coordinates + formatted address; closes the session
  .get("/details", requireAuth, async (c) => {
    const placeId = c.req.query("placeId");
    if (!placeId) return c.json({ message: "placeId required" }, 400);
    const res = await placeDetails(placeId, { sessionToken: c.req.query("sessionToken") });
    return c.json({ ...res, address: res.address || c.req.query("description") || "" }, 200);
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
