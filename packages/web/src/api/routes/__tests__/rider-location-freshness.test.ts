/**
 * "Is the phone alive?" and "how old is the position?" are different
 * questions, kept in different columns.
 *
 * The app's heartbeat (sent every minute whether or not GPS works) used to
 * stamp locationUpdatedAt, so a pin 40 minutes old showed on the dispatch map
 * as live, "seen just now", for as long as the app kept pinging. Now:
 *   - a heartbeat stamps lastSeenAt only;
 *   - a GPS report stamps locationUpdatedAt with the time the phone took the
 *     fix (clamped to now; older builds send none and get "now");
 *   - signing in doesn't claim a fresh position;
 *   - presence counts either check-in as "online".
 *
 * Harness: in-memory PGlite, ids prefixed "locfresh-".
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { ensureTables } = await import("../../../test-support/tables");
const { ridersRoutes, fixTime } = await import("../riders");
const { reconcileRiderStatus } = await import("../../../services/presence");

const CO = "locfresh-co";
const USER = "locfresh-user";
const RIDER = "locfresh-rider";
const MIN = 60_000;

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", CO);
  c.set("user", { id: USER, role: "rider", email: "tech@example.test", name: "Tech" } as any);
  return next();
});
app.route("/riders", ridersRoutes);

const patchMe = (json: Record<string, unknown>) =>
  app.request("/riders/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) });

const row = async () => (await db.select().from(schema.riders).where(eq(schema.riders.id, RIDER)))[0]!;
const ms = (d: Date | null | undefined) => (d ? new Date(d).getTime() : null);

const FORTY_MIN_AGO = () => new Date(Date.now() - 40 * MIN);

beforeEach(async () => {
  await ensureTables(schema.riders, schema.bookings);
  await db.delete(schema.riders).where(eq(schema.riders.companyId, CO));
  await db.insert(schema.riders).values({
    id: RIDER,
    companyId: CO,
    userId: USER,
    status: "available",
    lat: 49.9,
    lng: -97.14,
    locationUpdatedAt: FORTY_MIN_AGO(),
    lastSeenAt: FORTY_MIN_AGO(),
  } as never);
});

describe("PATCH /riders/me — liveness vs. position age", () => {
  it("a heartbeat says the phone is alive, and leaves the position's age alone", async () => {
    const before = await row();
    const res = await patchMe({ heartbeat: true });
    expect(res.status).toBe(200);
    const after = await row();
    expect(Date.now() - ms(after.lastSeenAt)!).toBeLessThan(5_000);
    expect(ms(after.locationUpdatedAt)).toBe(ms(before.locationUpdatedAt));
    expect([after.lat, after.lng]).toEqual([49.9, -97.14]);
  });

  it("a GPS report moves the pin, dated when the phone took the fix", async () => {
    const fixAt = Date.now() - 20_000;
    await patchMe({ lat: 49.88, lng: -97.2, fixAt });
    const after = await row();
    expect([after.lat, after.lng]).toEqual([49.88, -97.2]);
    expect(ms(after.locationUpdatedAt)).toBe(fixAt);
    expect(Date.now() - ms(after.lastSeenAt)!).toBeLessThan(5_000);
  });

  it("an older fix arriving late doesn't drag the pin back", async () => {
    const newer = Date.now() - 10_000;
    await patchMe({ lat: 49.88, lng: -97.2, fixAt: newer });
    await patchMe({ lat: 49.7, lng: -97.5, fixAt: newer - 120_000 });
    const after = await row();
    expect([after.lat, after.lng]).toEqual([49.88, -97.2]);
    expect(ms(after.locationUpdatedAt)).toBe(newer);
    // ...but it still counts as the phone checking in.
    expect(Date.now() - ms(after.lastSeenAt)!).toBeLessThan(5_000);
  });

  it("an older build that sends no fix time gets 'now'", async () => {
    await patchMe({ lat: 49.88, lng: -97.2 });
    expect(Date.now() - ms((await row()).locationUpdatedAt)!).toBeLessThan(5_000);
  });

  it("signing in doesn't claim a fresh position", async () => {
    await db.update(schema.riders).set({ status: "offline", manualOffline: true }).where(eq(schema.riders.id, RIDER));
    const before = await row();
    await patchMe({ status: "available" });
    const after = await row();
    expect(after.manualOffline).toBe(false);
    expect(ms(after.locationUpdatedAt)).toBe(ms(before.locationUpdatedAt));
  });

  it("a phone that pings but sends no GPS is online, with its old position", async () => {
    await patchMe({ heartbeat: true });
    expect(await reconcileRiderStatus(CO, RIDER)).toBe("available");
    const r = await row();
    expect(Date.now() - ms(r.locationUpdatedAt)!).toBeGreaterThan(39 * MIN);
  });

  it("a phone that has gone quiet is offline", async () => {
    expect(await reconcileRiderStatus(CO, RIDER)).toBe("offline");
  });
});

describe("fixTime", () => {
  const NOW = Date.UTC(2026, 9, 28, 15, 0);
  it("takes the phone's fix time", () => {
    expect(fixTime(NOW - 90_000, NOW).getTime()).toBe(NOW - 90_000);
  });
  it("never in the future (a phone clock ahead of ours)", () => {
    expect(fixTime(NOW + 10 * MIN, NOW).getTime()).toBe(NOW);
  });
  it("no older than a day (a phone clock far behind)", () => {
    expect(fixTime(NOW - 7 * 24 * 60 * MIN, NOW).getTime()).toBe(NOW - 24 * 60 * MIN);
  });
  it("now when the phone didn't say", () => {
    expect(fixTime(undefined, NOW).getTime()).toBe(NOW);
  });
});
