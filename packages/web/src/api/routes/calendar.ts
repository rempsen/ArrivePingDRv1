import { Hono } from "hono";
import { sdb } from "../database";
import { tdb } from "../database/tenant";
import * as schema from "../database/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { officeCan, requireAuth, loadMemberships } from "../middleware/auth";
import { isOfficeRole } from "../lib/office-access";
import { overrideAt } from "../lib/permissions";
import { buildCalendar, type CalEvent } from "../../services/ics";
import { publicOrigin } from "../lib/request-origin";
import type { AppEnv } from "../env";

type SessionUser = { id: string; role?: string; email: string; name: string };

function ensureToken(existing: string | null): string {
  return existing && existing.length > 10 ? existing : crypto.randomUUID().replace(/-/g, "");
}

// Was: process.env.APP_URL || process.env.PUBLIC_URL first, request host
// last — the exact bug request-origin.ts documents. APP_URL was still
// "https://uberize.ai" long after the product's domain moved to
// arriveping.com, so every "Sync your calendar" webcal/Google/Outlook link
// (and the tracking URL embedded in each calendar event) kept pointing at
// the dead old domain no matter which domain the user was actually on.
// publicOrigin(c) trusts the real request (via X-Forwarded-Host behind the
// prod proxy) over the stale env var, matching the fix already applied to
// forms.ts / api-keys.ts share links.
const baseUrl = publicOrigin;

/** Resolve the set of bookings a given user should see on their calendar. */
async function bookingsForUser(u: { id: string; role: string | null; permissions?: string | null; companyId: string }) {
  const t = tdb(u.companyId);
  // The office's feed is the whole schedule — if their role (or their own
  // override at that company) lets them see the scheduler.
  if (await officeCan({ role: u.role, permissions: u.permissions ?? null }, "scheduler:view")) {
    return t.select(schema.bookings);
  }
  if (u.role === "rider") {
    const rp = await t.selectOne(schema.riders, eq(schema.riders.userId, u.id));
    if (!rp) return [];
    return t.select(schema.bookings, eq(schema.bookings.riderId, rp.id));
  }
  return t.select(schema.bookings, eq(schema.bookings.customerId, u.id));
}

async function eventFor(
  b: typeof schema.bookings.$inferSelect,
  base: string,
  companyId: string,
): Promise<CalEvent> {
  const t = tdb(companyId);
  const svc = await t.selectOne(schema.services, eq(schema.services.id, b.serviceId));
  const [cust] = await sdb
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, b.customerId));
  let techName = "";
  if (b.riderId) {
    const r = await t.selectOne(schema.riders, eq(schema.riders.id, b.riderId));
    if (r) {
      const [ru] = await sdb.select().from(schema.user).where(eq(schema.user.id, r.userId));
      techName = ru?.name ?? "";
    }
  }
  const start = new Date(b.scheduledAt);
  const durMins = svc?.durationMins ?? 60;
  const end = new Date(start.getTime() + durMins * 60_000);
  const descLines = [
    svc?.name ? `Service: ${svc.name}` : "",
    cust?.name ? `Client: ${cust.name}` : "",
    b.customerPhone ? `Phone: ${b.customerPhone}` : "",
    techName ? `Technician: ${techName}` : "Technician: Unassigned",
    `Status: ${b.status}`,
    b.priority ? `Priority: ${b.priority}` : "",
    b.total ? `Total: $${Number(b.total).toFixed(2)}` : "",
    b.notes ? `Notes: ${b.notes}` : "",
    b.publicToken ? `Track: ${base}/t/${b.publicToken}` : "",
  ].filter(Boolean);
  const cancelled = b.status === "cancelled";
  const title = b.title || svc?.name || "Job";
  return {
    uid: `booking-${b.id}@nvc360`,
    title: cancelled ? `Cancelled: ${title}` : title,
    description: descLines.join("\n"),
    location: b.address,
    start,
    end,
    status: cancelled ? "CANCELLED" : "CONFIRMED",
    url: b.publicToken ? `${base}/t/${b.publicToken}` : undefined,
    alarmMinutesBefore: 60,
    lat: b.lat,
    lng: b.lng,
  };
}

type FeedUser = typeof schema.user.$inferSelect;

/**
 * Every job this person should see in a calendar, across every company they
 * work for, each read with the role they hold THERE (a technician at one
 * company can be office staff at another). Shared by the subscription feed
 * (/api/calendar/<token>.ics) and the phone's calendar sync (/events), so the
 * two can never disagree about which jobs are someone's.
 */
async function eventsForUser(u: FeedUser, base: string, from: Date, to: Date): Promise<CalEvent[]> {
  const memberships = await loadMemberships(u.id);
  const userPerms = (u as { permissions?: string | null }).permissions;
  const scopes = memberships.length
    ? memberships.map((m) => ({
        companyId: m.companyId,
        role: m.role,
        // Same rule as authMiddleware, so the feed never shows more than the
        // dashboard would (lib/permissions.ts overrideAt).
        permissions: overrideAt({ membership: m.permissions, user: userPerms, companyId: m.companyId, homeCompany: u.companyId }),
      }))
    : [{ companyId: (u as any).companyId || "default", role: u.role, permissions: userPerms ?? null }];

  const perCompany = await Promise.all(
    scopes.map(async (s) => {
      const rows = await bookingsForUser({ id: u.id, role: s.role, permissions: s.permissions, companyId: s.companyId });
      return rows
        .filter((b) => {
          const t = new Date(b.scheduledAt).getTime();
          return t >= from.getTime() && t <= to.getTime();
        })
        .map((b) => ({ booking: b, companyId: s.companyId }));
    }),
  );
  const events = await Promise.all(perCompany.flat().map((x) => eventFor(x.booking, base, x.companyId)));
  return events.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** The calendar's name in Apple Calendar, Google and Outlook. */
function calendarName(u: FeedUser): string {
  if (isOfficeRole(u.role)) return "ArrivePing — Dispatch Schedule";
  if (u.role === "rider") return `ArrivePing — ${u.name}'s Jobs`;
  return "ArrivePing — My Appointments";
}

/** The phone sync's window: recent history plus what's coming up. */
export const SYNC_DAYS_BACK = 14;
export const SYNC_DAYS_AHEAD = 90;

export const calendarRoutes = new Hono<AppEnv>()
  // Return (creating if needed) the current user's personal feed URLs.
  .get("/feed", requireAuth, async (c) => {
    const u = c.get("user") as SessionUser;
    const [row] = await sdb.select().from(schema.user).where(eq(schema.user.id, u.id));
    let token = (row as any)?.calendarToken as string | null;
    if (!token) {
      token = ensureToken(null);
      await sdb
        .update(schema.user)
        .set({ calendarToken: token } as any)
        .where(eq(schema.user.id, u.id));
    }
    const base = baseUrl(c);
    const httpsUrl = `${base}/api/calendar/${token}.ics`;
    const webcal = httpsUrl.replace(/^https?:\/\//, "webcal://");
    const name = encodeURIComponent("ArrivePing Schedule");
    return c.json(
      {
        token,
        url: httpsUrl,
        webcal,
        google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
        // Outlook for work or school (Microsoft 365). Kept as `outlook` for
        // the web settings card, which already links to it.
        outlook: `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(httpsUrl)}&name=${name}`,
        // Outlook.com / Hotmail personal accounts live on a different host.
        outlookPersonal: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(httpsUrl)}&name=${name}`,
      },
      200,
    );
  })
  // The signed-in person's jobs as JSON, for the mobile app to write into the
  // phone's own calendar (Apple Calendar, or a Google / Outlook account on the
  // phone). Google's and Outlook's apps can't subscribe to a feed from a phone,
  // and techs don't sign in to the web app, so the phone syncs these itself.
  // Same people, same jobs and same event text as the .ics feed.
  .get("/events", requireAuth, async (c) => {
    const me = c.get("user") as SessionUser;
    const [u] = await sdb.select().from(schema.user).where(eq(schema.user.id, me.id));
    if (!u) return c.json({ message: "Not found" }, 404);
    const now = Date.now();
    const from = new Date(now - SYNC_DAYS_BACK * 86_400_000);
    const to = new Date(now + SYNC_DAYS_AHEAD * 86_400_000);
    const events = await eventsForUser(u, baseUrl(c), from, to);
    return c.json(
      {
        calendarName: calendarName(u),
        from: from.toISOString(),
        to: to.toISOString(),
        events: events.map((e) => ({
          uid: e.uid,
          title: e.title,
          description: e.description ?? "",
          location: e.location ?? "",
          start: e.start.toISOString(),
          end: e.end.toISOString(),
          status: e.status ?? "CONFIRMED",
          url: e.url ?? null,
          alarmMinutesBefore: e.alarmMinutesBefore ?? null,
        })),
      },
      200,
    );
  })
  // Regenerate the token (invalidates the old subscription URL).
  .post("/feed/regenerate", requireAuth, async (c) => {
    const u = c.get("user") as SessionUser;
    const token = ensureToken(null);
    await sdb
      .update(schema.user)
      .set({ calendarToken: token } as any)
      .where(eq(schema.user.id, u.id));
    return c.json({ token }, 200);
  })
  // Public token-authed iCal feed. Subscribed by Google Calendar / Outlook.
  // NOTE: must be mounted so this path resolves to /api/calendar/:token.ics
  .get("/:file", async (c) => {
    const file = c.req.param("file");
    const token = file.replace(/\.ics$/i, "");
    if (!token || token.length < 10) return c.text("Not found", 404);
    const [u] = await sdb
      .select()
      .from(schema.user)
      .where(eq(schema.user.calendarToken as any, token));
    if (!u) return c.text("Not found", 404);

    // Window: 60 days back, 180 days forward (keeps feed small + fast).
    const now = Date.now();
    const from = new Date(now - 60 * 86_400_000);
    const to = new Date(now + 180 * 86_400_000);
    const events = await eventsForUser(u, baseUrl(c), from, to);
    const calName = calendarName(u);
    const ics = buildCalendar(events, { name: calName, refreshMinutes: 30 });
    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="nvc360-${u.role ?? "schedule"}.ics"`,
        "Cache-Control": "no-cache, max-age=0",
      },
    });
  });

// silence unused import lint if tree-shaken
void and;
void gte;
void lte;
