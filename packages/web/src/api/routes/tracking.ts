import { Hono } from "hono";
import type { Context } from "hono";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { requireAuth, tx, tenantId } from "../middleware/auth";
import { tripEngine, EN_ROUTE_STATUSES } from "../../services/trip-engine";
import {
  haversineKm,
  isInsideGeofence,
  resolveGeofenceRadiusM,
  resolveAutoPauseRadiusM,
} from "../../shared/geo-distance";
import { applyBookingStatus, pauseClock, resumeClock } from "../../services/booking-status";
import { ensureSnappedRoute } from "../../services/route-snap";
import { pingLimiter } from "../lib/rate-limit";
import { publishTrack } from "../../services/realtime";
import { isAdminRole } from "../lib/permissions";
import { LA_TOKEN_KEYS } from "../../services/apns";
import { z } from "zod";
import { jsonBody, latitude, longitude } from "../lib/validate";
import type { AppEnv } from "../env";

/**
 * Per-tenant geofence radius, cached briefly.
 *
 * Every active technician pings every 8 seconds, and each ping used to read the
 * whole companySettings row from the DB just to learn one integer.
 */
const GEOFENCE_TTL_MS = 60_000;
const geofenceCache = new Map<string, { at: number; radiusM: number | null }>();
async function geofenceRadiusFor(c: Context<AppEnv>) {
  const co = tenantId(c);
  const hit = geofenceCache.get(co);
  if (hit && Date.now() - hit.at < GEOFENCE_TTL_MS) return hit.radiusM;
  const settings = await tx(c).selectOne(schema.companySettings);
  const radiusM = settings?.geofenceRadiusM ?? null;
  geofenceCache.set(co, { at: Date.now(), radiusM });
  return radiusM;
}

/** A live GPS ping from a technician's device. */
const PingBody = z.object({ lat: latitude, lng: longitude });

export const trackingRoutes = new Hono<AppEnv>()
  // rider posts a live location ping for a booking
  .post("/:bookingId/ping", pingLimiter, requireAuth, jsonBody(PingBody), async (c) => {
    const bookingId = c.req.param("bookingId");
    const { lat, lng } = c.req.valid("json");
    const t = tx(c);

    // ping = tech's live location. The booking's lat/lng is the JOB destination
    // and must NOT be overwritten. Live location lives on rider + pings.
    const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, bookingId));
    // The booking must be visible in the caller's tenant. Without this check a
    // device still signed into another company (or the default tenant) would
    // insert pings stamped with the wrong company_id, and the booking's own
    // tenant would never see that part of the trail on the report. That is
    // exactly what happened to 56 pings on one bmd-materials job in Aug 2026.
    if (!b) return c.json({ message: "Not found" }, 404);

    // phase for mileage segmentation: enroute / onsite / return
    const phase = b?.status === "completed" ? "return" : b?.status === "in_progress" || b?.status === "arrived" ? "onsite" : "enroute";

    // accumulate mileage from the previous ping (great-circle, jitter-filtered)
    const prevRows = await t.select(
      schema.trackingPings,
      eq(schema.trackingPings.bookingId, bookingId),
    );
    prevRows.sort((a, z) => Number(z.createdAt) - Number(a.createdAt));
    const prev = prevRows[0];
    await t.insert(schema.trackingPings, { bookingId, lat, lng, phase });

    if (b && prev && b.enrouteAt) {
      // count distance for the whole active trip: enroute -> onsite -> return,
      // starting the moment the tech tapped "on my way" (enrouteAt is set).
      const seg = haversineKm(prev.lat, prev.lng, lat, lng);
      if (seg > 0.005 && seg < 5) {
        await t.update(
          schema.bookings,
          { mileageKm: Math.round((b.mileageKm + seg) * 100) / 100 },
          eq(schema.bookings.id, bookingId),
        );
      }
    }

    if (b?.riderId) {
      await t.update(
        schema.riders,
        { lat, lng, locationUpdatedAt: new Date() },
        eq(schema.riders.id, b.riderId),
      );
    }

    // --- GEOFENCE: auto-arrive + clock pause/resume -------------------------
    // Authoritative on the server. Once the tech is enroute (or already on a
    // job), entering the ARRIVE radius around the job address auto-arrives
    // them and starts/resumes the clock. Leaving pauses the clock, but not at
    // that same tight radius — auto-pause only fires once they're past DOUBLE
    // the arrive radius (resolveAutoPauseRadiusM, hardcoded 2x system-wide),
    // so stepping back to the truck for a moment just outside a tight 20 m
    // residential radius doesn't cut their time. Between the two radii is a
    // dead zone: the clock keeps whatever state it was already in. Resuming
    // always requires being back inside the tighter arrive radius, per the
    // same reasoning `insideGeofence` already used — see resumeClock/pauseClock
    // in booking-status.ts. Completion stays manual.
    let statusNow = b.status;
    let geofence: { radiusM: number; pauseRadiusM: number; distanceM: number; inside: boolean } | null = null;
    if (b && b.lat != null && b.lng != null && b.enrouteAt && b.status !== "completed" && b.status !== "cancelled") {
      // Configured radius in metres. Resolved through the shared helper so a
      // missing settings row, a blank field or a 0 can't silently disable
      // auto-arrive — the fallback here used to be 20m while the DB column
      // default and the driver app's own copy both said 150m.
      const radiusM = resolveGeofenceRadiusM(await geofenceRadiusFor(c));
      const pauseRadiusM = resolveAutoPauseRadiusM(radiusM);
      const distanceM = Math.round(haversineKm(lat, lng, b.lat, b.lng) * 1000);
      const insideArrive = isInsideGeofence(lat, lng, b.lat, b.lng, radiusM);
      const insidePause = isInsideGeofence(lat, lng, b.lat, b.lng, pauseRadiusM);
      geofence = { radiusM, pauseRadiusM, distanceM, inside: insideArrive };

      if (insideArrive && !b.insideGeofence) {
        // entered (or re-entered) the tight arrive radius
        if (b.status === "enroute") {
          // first arrival → auto-arrive + start the job clock
          await applyBookingStatus(tenantId(c), bookingId, "arrived", { byGeofence: true });
          statusNow = "arrived";
        } else {
          // came back after stepping away → resume the clock
          await resumeClock(tenantId(c), bookingId);
        }
      } else if (!insidePause && b.insideGeofence) {
        // gone past DOUBLE the arrive radius → they've actually left, pause
        await pauseClock(tenantId(c), bookingId);
      }
    }
    // -----------------------------------------------------------------------

    // Live ETA from the shared trip engine: projects this ping onto the
    // booking's traffic-aware route and only calls Google when the route is
    // stale or the tech has left it (services/trip-engine.ts). Outside the
    // driving statuses the trip is dropped and no routing happens at all.
    if (EN_ROUTE_STATUSES.has(statusNow) && b.lat != null && b.lng != null) {
      const snap = await tripEngine.update(bookingId, { lat, lng }, { lat: b.lat, lng: b.lng });
      if (snap && (snap.etaMins !== b.etaMins || snap.distanceKm !== b.etaDistanceKm)) {
        await t.update(
          schema.bookings,
          { etaMins: snap.etaMins, etaDistanceKm: snap.distanceKm },
          eq(schema.bookings.id, bookingId),
        );
      }
    } else {
      tripEngine.end(bookingId);
    }

    // push to live SSE subscribers (public tracking page) — fire and forget
    if (b?.publicToken) {
      void publishTrack({ type: "location", token: b.publicToken, data: { lat, lng } });
    }

    // Return current etaMins so the mobile app can update Live Activity countdown
    const fresh = await t.selectOne(schema.bookings, eq(schema.bookings.id, bookingId));
    const freshEta = fresh?.etaMins ?? null;
    // `geofence` and `status` go back to the driver app so the job screen can
    // say "340 m away — auto check-in at 150 m" instead of a hardcoded promise,
    // and so it notices an auto-arrive that happened server-side.
    return c.json({ success: true, etaMins: freshEta, status: fresh?.status ?? null, geofence }, 200);
  })
  // driver registers/refreshes Live Activity push token so server can send APNs updates
  .post("/:bookingId/live-activity-token", requireAuth, async (c) => {
    const bookingId = c.req.param("bookingId");
    const { token, type } = await c.req.json<{ token: string; type: "update" | "start" }>();
    if (!token) return c.json({ ok: false }, 400);
    const t = tx(c);
    // Stored inside the existing `bookings.field_data` JSON blob so no migration
    // is needed. This previously read/wrote `bookings.customFields`, a column
    // that does not exist — every token was silently discarded.
    const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, bookingId));
    if (!b) return c.json({ ok: false, message: "Not found" }, 404);
    let fd: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(b.fieldData || "{}");
      if (parsed && typeof parsed === "object") fd = parsed as Record<string, unknown>;
    } catch {
      // corrupt blob — start clean rather than 500 on a driver's device
    }
    fd[type === "start" ? LA_TOKEN_KEYS.start : LA_TOKEN_KEYS.update] = token;
    await t.update(
      schema.bookings,
      { fieldData: JSON.stringify(fd) },
      eq(schema.bookings.id, bookingId),
    );
    return c.json({ ok: true });
  })
  // customer fetches latest rider location for a booking
  .get("/:bookingId", requireAuth, async (c) => {
    const bookingId = c.req.param("bookingId");
    const t = tx(c);
    const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, bookingId));
    if (!b) return c.json({ message: "Not found" }, 404);

    let rider: any = null;
    if (b.riderId) {
      const r = await t.selectOne(schema.riders, eq(schema.riders.id, b.riderId));
      if (r) {
        const ru = await t.selectOne(schema.user, eq(schema.user.id, r.userId));
        rider = {
          id: r.id,
          name: ru?.name,
          phone: ru?.phone,
          vehicle: r.vehicle,
          rating: r.rating,
          lat: r.lat,
          lng: r.lng,
        };
      }
    }
    const latestRows = await t.select(
      schema.trackingPings,
      eq(schema.trackingPings.bookingId, bookingId),
    );
    latestRows.sort((a, z) => Number(z.createdAt) - Number(a.createdAt));
    const latest = latestRows[0];

    const riderLocation = latest
      ? { lat: latest.lat, lng: latest.lng }
      : rider?.lat
        ? { lat: rider.lat, lng: rider.lng }
        : null;

    // road-following route + live ETA while en route — same engine and the
    // same numbers as the ping handler and the public tracking page
    let route: { lat: number; lng: number }[] | null = null;
    let etaMins = b.etaMins;
    if (riderLocation && EN_ROUTE_STATUSES.has(b.status) && b.lat != null && b.lng != null) {
      const snap = await tripEngine.update(b.id, riderLocation, { lat: b.lat, lng: b.lng });
      if (snap) {
        route = snap.remainingPath.map(([lat, lng]) => ({ lat, lng }));
        etaMins = snap.etaMins;
      }
    }

    return c.json(
      {
        status: b.status,
        destination: { lat: b.lat, lng: b.lng },
        rider,
        riderLocation,
        route,
        etaMins,
      },
      200,
    );
  })

  // Full historical GPS breadcrumb trail for a booking — powers the route
  // map on the completed-job report. Distinct from the GET /:bookingId
  // above, which only returns the LATEST ping (for live tracking while a
  // job is still en route). Staff-only: this is an internal ops view, not
  // the customer-facing live-tracking page.
  .get("/:bookingId/route-history", requireAuth, async (c) => {
    const u = c.get("user") as { role?: string };
    if (!isAdminRole(u?.role) && u?.role !== "dispatcher") return c.json({ message: "Forbidden" }, 403);
    const bookingId = c.req.param("bookingId");
    const t = tx(c);
    const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, bookingId));
    if (!b) return c.json({ message: "Not found" }, 404);
    const rows = await t.select(schema.trackingPings, eq(schema.trackingPings.bookingId, bookingId));
    rows.sort((a, z) => Number(a.createdAt) - Number(z.createdAt));
    const snapped = await ensureSnappedRoute(t, b, rows).catch(() => null);
    return c.json(
      {
        pings: rows.map((r) => ({ lat: r.lat, lng: r.lng, phase: r.phase, createdAt: r.createdAt })),
        routeSnapped: snapped
          ? { provider: snapped.provider, distanceKm: snapped.distanceKm, points: snapped.points }
          : null,
        destination: b.lat != null && b.lng != null ? { lat: b.lat, lng: b.lng } : null,
      },
      200,
    );
  });
