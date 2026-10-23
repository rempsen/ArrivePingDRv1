/**
 * Calendar sync for technicians (Dan, 2026-10-23): techs don't sign in to the
 * web app, so the mobile app syncs their jobs into the phone's own calendar
 * from GET /api/calendar/events, and can subscribe Apple / Google / Outlook
 * to the .ics feed from GET /api/calendar/feed.
 *
 *   - /events returns only the tech's OWN jobs, at every company they work
 *     for, inside the sync window, as the same events the .ics feed carries;
 *   - a cancelled job reads "Cancelled: …" everywhere;
 *   - /feed gives Apple (webcal), Google and both Outlook links.
 *
 * In-memory database; ids prefixed "cs-".
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../env";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { calendarRoutes } = await import("../calendar");

function colDdl(col: PgColumn, withPk: boolean): string {
  const parts = [`"${col.name}"`, col.getSQLType()];
  if (withPk && col.primary) parts.push("PRIMARY KEY");
  const d = (col as any).default;
  const lit = d === undefined ? null : typeof d === "string" ? `'${d.replace(/'/g, "''")}'` : typeof d === "boolean" ? (d ? "TRUE" : "FALSE") : typeof d === "number" ? String(d) : null;
  if (lit !== null) parts.push(`DEFAULT ${lit}`);
  return parts.join(" ");
}
async function ensureTable(table: PgTable) {
  const s = (db as any).$client;
  const cfg = getTableConfig(table);
  await s.execute(`CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cfg.columns.map((c) => colDdl(c, true)).join(", ")})`);
  for (const c of cfg.columns) if (!c.primary) await s.execute(`ALTER TABLE "${cfg.name}" ADD COLUMN IF NOT EXISTS ${colDdl(c, false)}`);
}

const A = "cs-co-a";
const B = "cs-co-b";
const DAY = 86_400_000;
const app = new Hono<AppEnv>().use("*", async (c, next) => {
  const id = c.req.header("X-User");
  if (id) c.set("user", { id, role: "rider", email: `${id}@cs.test`, name: id, companyId: A } as any);
  c.set("companyId", A);
  return next();
});
app.route("/api/calendar", calendarRoutes);

const get = (path: string, user?: string) => app.request(path, { headers: user ? { "X-User": user } : {} });

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTable(v);
  for (const co of [A, B]) {
    await db.insert(schema.companies).values({ id: co, name: co, status: "active" } as any);
    await db.insert(schema.companySettings).values({ id: co, companyId: co, name: co } as any);
    await db.insert(schema.services).values({ id: `${co}-svc`, companyId: co, name: "Furnace repair", category: "hvac", durationMins: 90 } as any);
  }
  // Sam works for both companies; Pat only for A.
  await db.insert(schema.user).values([
    { id: "cs-sam", name: "Sam Tech", email: "sam@cs.test", role: "rider", companyId: A },
    { id: "cs-pat", name: "Pat Tech", email: "pat@cs.test", role: "rider", companyId: A },
    { id: "cs-cust", name: "Zoë Côté", email: "zoe@cs.test", role: "customer", companyId: A },
  ] as any);
  await db.insert(schema.memberships).values([
    { id: "cs-m-sam-a", userId: "cs-sam", companyId: A, role: "rider", status: "active" },
    { id: "cs-m-sam-b", userId: "cs-sam", companyId: B, role: "rider", status: "active" },
    { id: "cs-m-pat-a", userId: "cs-pat", companyId: A, role: "rider", status: "active" },
  ] as any);
  await db.insert(schema.riders).values([
    { id: "cs-r-sam-a", userId: "cs-sam", companyId: A },
    { id: "cs-r-sam-b", userId: "cs-sam", companyId: B },
    { id: "cs-r-pat-a", userId: "cs-pat", companyId: A },
  ] as any);
  const now = Date.now();
  const job = (id: string, co: string, riderId: string, at: number, over: Record<string, unknown> = {}) => ({
    id, companyId: co, customerId: "cs-cust", serviceId: `${co}-svc`, riderId, title: "Furnace repair", status: "confirmed",
    address: "120 Maple St, Winnipeg", scheduledAt: new Date(at), price: 100, publicToken: `tok-${id}`, ...over,
  });
  await db.insert(schema.bookings).values([
    job("cs-j1", A, "cs-r-sam-a", now + 2 * DAY),
    job("cs-j2", B, "cs-r-sam-b", now + 1 * DAY),
    job("cs-j3", A, "cs-r-sam-a", now + 3 * DAY, { status: "cancelled" }),
    job("cs-j4", A, "cs-r-pat-a", now + 1 * DAY), // Pat's, not Sam's
    job("cs-j5", A, "cs-r-sam-a", now + 120 * DAY), // past the sync window
    job("cs-j6", A, "cs-r-sam-a", now - 30 * DAY), // too far back
  ] as any);
});

describe("GET /api/calendar/events (the phone's calendar sync)", () => {
  it("needs a signed-in person", async () => {
    expect((await get("/api/calendar/events")).status).toBe(401);
  });

  it("is the tech's own jobs at every company, in the window, soonest first", async () => {
    const r = await get("/api/calendar/events", "cs-sam");
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    expect(body.events.map((e: any) => e.uid)).toEqual(["booking-cs-j2@nvc360", "booking-cs-j1@nvc360", "booking-cs-j3@nvc360"]);
    expect(body.calendarName).toBe("ArrivePing — Sam Tech's Jobs");
  });

  it("carries what a calendar needs: times from the service length, address, client, tracking link", async () => {
    const body = (await (await get("/api/calendar/events", "cs-sam")).json()) as any;
    const e = body.events.find((x: any) => x.uid === "booking-cs-j1@nvc360");
    expect(new Date(e.end).getTime() - new Date(e.start).getTime()).toBe(90 * 60_000);
    expect(e.location).toBe("120 Maple St, Winnipeg");
    expect(e.description).toContain("Client: Zoë Côté");
    expect(e.url).toMatch(/\/t\/tok-cs-j1$/);
    expect(e.status).toBe("CONFIRMED");
  });

  it("a cancelled job says so in its title", async () => {
    const body = (await (await get("/api/calendar/events", "cs-sam")).json()) as any;
    const e = body.events.find((x: any) => x.uid === "booking-cs-j3@nvc360");
    expect(e).toMatchObject({ status: "CANCELLED", title: "Cancelled: Furnace repair" });
  });

  it("another tech sees only theirs", async () => {
    const body = (await (await get("/api/calendar/events", "cs-pat")).json()) as any;
    expect(body.events.map((e: any) => e.uid)).toEqual(["booking-cs-j4@nvc360"]);
  });
});

describe("GET /api/calendar/feed (subscribe with a link)", () => {
  it("gives Apple, Google and both Outlook links for one private feed", async () => {
    const f = (await (await get("/api/calendar/feed", "cs-sam")).json()) as any;
    expect(f.url).toMatch(/^https?:\/\/.+\/api\/calendar\/[0-9a-f]{32}\.ics$/);
    expect(f.webcal).toBe(f.url.replace(/^https?:\/\//, "webcal://"));
    expect(f.google).toBe(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(f.webcal)}`);
    expect(f.outlook.startsWith("https://outlook.office.com/calendar/0/addfromweb?url=")).toBe(true);
    expect(f.outlookPersonal.startsWith("https://outlook.live.com/calendar/0/addfromweb?url=")).toBe(true);
    expect(decodeURIComponent(f.outlookPersonal.split("url=")[1].split("&")[0])).toBe(f.url);
  });

  it("the feed and the phone sync carry the same jobs", async () => {
    const f = (await (await get("/api/calendar/feed", "cs-sam")).json()) as any;
    const ics = await (await get(`/api/calendar/${f.token}.ics`)).text();
    const uids = [...ics.replace(/\r\n /g, "").matchAll(/^UID:(.+)$/gm)].map((m) => m[1]!.trim());
    // The feed's window is wider (60 days back, 180 ahead), so it also has j5 and j6.
    expect(uids.sort()).toEqual(["booking-cs-j1@nvc360", "booking-cs-j2@nvc360", "booking-cs-j3@nvc360", "booking-cs-j5@nvc360", "booking-cs-j6@nvc360"].sort());
    expect(ics).toContain("X-WR-CALNAME:ArrivePing — Sam Tech's Jobs");
  });

  it("resetting the link stops the old one working", async () => {
    const before = (await (await get("/api/calendar/feed", "cs-pat")).json()) as any;
    expect((await get(`/api/calendar/${before.token}.ics`)).status).toBe(200);
    await app.request("/api/calendar/feed/regenerate", { method: "POST", headers: { "X-User": "cs-pat" } });
    expect((await get(`/api/calendar/${before.token}.ics`)).status).toBe(404);
    const [row] = await db.select().from(schema.user).where(eq(schema.user.id, "cs-pat"));
    expect((row as any).calendarToken).not.toBe(before.token);
  });
});
