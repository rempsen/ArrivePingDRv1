/**
 * Job offers: the "Details" step between an offer and the tech's answer.
 *
 * - GET /bookings/:id/offer gives the tech it's offered to (or the office)
 *   drive time, an estimated pay and the scope. Nobody else may read it.
 * - Accept and Decline only work for that tech or the office. Before this,
 *   any signed-in user in the tenant could accept or decline anyone's offer.
 * - Decline takes a fixed reason code and an optional note; the reason is on
 *   the row before the "declined" event fires, so the office notice and the
 *   job timeline say why. Older apps' free-text `reason` still works.
 *
 * Harness: ephemeral in-memory database, ids prefixed "ofr-". No notification
 * rules are seeded, so fireEvent sends nothing.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { getTableConfig, type PgColumn } from "drizzle-orm/pg-core";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { bookingsRoutes } = await import("../bookings");
const { AppError } = await import("../../lib/errors");
const { buildOfferPreview } = await import("../../../services/job-offer");

const CO = "ofr-co";
const HOLDER_USER = "ofr-user-holder";
const OTHER_USER = "ofr-user-other";
const ADMIN_USER = "ofr-user-admin";
const CUST = "ofr-cust";
const HOLDER_RIDER = "ofr-rider-holder";
const OTHER_RIDER = "ofr-rider-other";
const SVC = "ofr-svc";

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", CO);
  const uid = c.req.header("X-Test-User");
  const role = c.req.header("X-Test-Role") || "rider";
  c.set("user", uid ? { id: uid, role, email: `${uid}@t.test`, name: uid } : null);
  return next();
});
app.route("/bookings", bookingsRoutes);
app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.expose ? err.message : "error" } }, err.status as 400);
  }
  return c.json({ error: { code: "internal", message: String((err as Error).message) } }, 500);
});

function ddlFor(table: any): string {
  const cfg = getTableConfig(table);
  const cols = cfg.columns.map((col: PgColumn) => {
    const parts = [`"${col.name}"`, col.getSQLType()];
    if (col.primary) parts.push("PRIMARY KEY");
    const dflt = (col as any).default;
    let lit: string | null = null;
    if (dflt !== undefined) {
      lit =
        typeof dflt === "string" ? `'${dflt.replace(/'/g, "''")}'`
        : typeof dflt === "boolean" ? (dflt ? "TRUE" : "FALSE")
        : typeof dflt === "number" ? String(dflt)
        : null;
    }
    if (col.notNull && (lit !== null || col.primary)) parts.push("NOT NULL");
    if (lit !== null) parts.push(`DEFAULT ${lit}`);
    return parts.join(" ");
  });
  return `CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cols.join(", ")})`;
}

const sqlClient = () => (db as any).$client;

async function seedOffer(id: string, opts: { riderId?: string | null; assignStatus?: string; lat?: number; lng?: number } = {}) {
  const s = sqlClient();
  await s.execute({ sql: "DELETE FROM bookings WHERE id = ?", args: [id] });
  await s.execute({
    sql: `INSERT INTO bookings
            (id, company_id, customer_id, service_id, title, status, assign_status, scheduled_at,
             address, rider_id, price, public_token, lat, lng, priority, required_skills,
             line_items, checklist_state)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id, CO, CUST, SVC, "Furnace repair", "assigned", opts.assignStatus ?? "offered",
      Date.now() + 3_600_000, "1 Test St", opts.riderId === undefined ? HOLDER_RIDER : opts.riderId,
      250, `tok-${id}`, opts.lat ?? 49.9, opts.lng ?? -97.2, "high", "gas, refrigerant",
      JSON.stringify([{ itemId: "x", kind: "unit", name: "Duct run", sku: "", unit: "ft", qty: 20, unitCost: 2, unitPrice: 5, taxable: true, cost: 40, price: 100 }]),
      JSON.stringify([{ label: "Check filter", done: false, required: true }, "Photo of unit"]),
    ],
  });
}

async function row(id: string) {
  const r = await sqlClient().execute({ sql: "SELECT * FROM bookings WHERE id = ?", args: [id] });
  return r.rows[0] as any;
}

function call(method: "GET" | "POST", path: string, user: string, body?: unknown, role = "rider") {
  return app.request(`/bookings${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Test-User": user, "X-Test-Role": role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  const s = sqlClient();
  for (const t of [
    schema.companySettings, schema.bookings, schema.services, schema.riders,
    schema.user, schema.invoices, schema.serviceZones, schema.properties, schema.jobEvents,
    schema.notificationRules, schema.notifications, schema.notificationDeliveries,
    schema.webhookEndpoints, schema.automationRules, schema.reviews,
    schema.notificationChannels, schema.trackingPings, schema.memberships,
    schema.templateVersions, schema.jobFormResponses, schema.customMilestones,
  ]) {
    await s.execute(ddlFor(t));
  }
  for (const [id, name, role] of [
    [HOLDER_USER, "Holder Tech", "rider"],
    [OTHER_USER, "Other Tech", "rider"],
    [ADMIN_USER, "Office", "admin"],
    [CUST, "Customer One", "customer"],
  ] as const) {
    await s.execute({
      sql: "INSERT OR IGNORE INTO user (id, company_id, name, email, role, email_verified) VALUES (?,?,?,?,?,0)",
      args: [id, CO, name, `${id}@t.test`, role],
    });
  }
  for (const [rid, uid] of [
    [HOLDER_RIDER, HOLDER_USER],
    [OTHER_RIDER, OTHER_USER],
  ] as const) {
    await s.execute({
      sql: "INSERT OR IGNORE INTO riders (id, company_id, user_id, status, pay_rate_per_hour, pay_rate_per_km) VALUES (?,?,?,?,?,?)",
      args: [rid, CO, uid, "available", 40, 0.5],
    });
  }
  await s.execute({
    sql: "INSERT OR IGNORE INTO services (id, company_id, name, category, base_price, duration_mins, description) VALUES (?,?,?,?,?,?,?)",
    args: [SVC, CO, "Furnace repair", "hvac", 250, 90, "Diagnose and repair a gas furnace"],
  });
});

describe("GET /bookings/:id/offer", () => {
  it("is for the tech it's offered to and the office only", async () => {
    await seedOffer("ofr-1");
    expect((await call("GET", "/ofr-1/offer", OTHER_USER)).status).toBe(403);
    expect((await call("GET", "/ofr-1/offer", ADMIN_USER, undefined, "admin")).status).toBe(200);
    const res = await call("GET", "/ofr-1/offer", HOLDER_USER);
    expect(res.status).toBe(200);
    const { offer } = (await res.json()) as any;
    expect(offer.assignStatus).toBe("offered");
    expect(offer.duration).toEqual({ mins: 90, source: "service" });
    // The tech has never reported a location.
    expect(offer.drive).toBeNull();
    expect(offer.driveUnavailable).toBe("no_location");
    expect(offer.scope.serviceName).toBe("Furnace repair");
    expect(offer.scope.priority).toBe("high");
    expect(offer.scope.skills).toEqual(["gas", "refrigerant"]);
    expect(offer.scope.lines).toEqual([{ name: "Duct run", qty: 20, unit: "ft", kind: "unit" }]);
    expect(offer.scope.checklist).toEqual([
      { label: "Check filter", required: true },
      { label: "Photo of unit", required: false },
    ]);
    expect(offer.declineReasons.map((r: any) => r.key)).toContain("too_far");
  });

  it("works out the drive from the tech's position and prices the job on it", async () => {
    await seedOffer("ofr-2");
    const s = sqlClient();
    await s.execute({
      sql: "UPDATE riders SET lat = ?, lng = ?, location_updated_at = ? WHERE id = ?",
      args: [49.8, -97.1, Date.now() - 2 * 60_000, HOLDER_RIDER],
    });
    const b = (await sqlClient().execute({ sql: "SELECT id FROM bookings WHERE id='ofr-2'", args: [] })).rows[0];
    expect(b).toBeTruthy();
    const { tdb } = await import("../../database/tenant");
    const t = tdb(CO);
    const booking = await t.selectOne(schema.bookings, (await import("drizzle-orm")).eq(schema.bookings.id, "ofr-2"));
    const rider = await t.selectOne(schema.riders, (await import("drizzle-orm")).eq(schema.riders.id, HOLDER_RIDER));
    const offer = await buildOfferPreview(CO, booking!, rider, {
      route: async () => ({ path: [], durationSec: 1260, staticDurationSec: null, distanceM: 14_250, provider: "osrm" }),
    });
    expect(offer.drive).toEqual({ km: 14.3, mins: 21, provider: "osrm", locationAgeMins: 2, fresh: true });
    // Someone who may not see payouts gets everything but the pay.
    const noPay = await buildOfferPreview(CO, booking!, rider, {
      showPay: false,
      route: async () => ({ path: [], durationSec: 1260, staticDurationSec: null, distanceM: 14_250, provider: "osrm" }),
    });
    expect(noPay.pay).toBeNull();
    if (offer.pay) {
      // 1.5 h at $40 + 20 ft at $2 + 14.3 km each way at $0.50
      expect(offer.pay.hourlyPay).toBe(60);
      expect(offer.pay.unitPay).toBe(40);
      expect(offer.pay.mileagePay).toBe(14.3);
      expect(offer.pay.estimate).toBe(114.3);
    }
  });

  it("doesn't invent a drive to a job that never got a location", async () => {
    await seedOffer("ofr-3", { lat: 43.6532, lng: -79.3832 });
    const { tdb } = await import("../../database/tenant");
    const { eq } = await import("drizzle-orm");
    const t = tdb(CO);
    const booking = await t.selectOne(schema.bookings, eq(schema.bookings.id, "ofr-3"));
    const rider = await t.selectOne(schema.riders, eq(schema.riders.id, HOLDER_RIDER));
    let routed = false;
    const offer = await buildOfferPreview(CO, booking!, rider, {
      route: async () => {
        routed = true;
        return null;
      },
    });
    expect(routed).toBe(false);
    expect(offer.drive).toBeNull();
    expect(offer.driveUnavailable).toBe("no_job_location");
  });
});

describe("POST /bookings/:id/accept", () => {
  it("refuses a tech the job isn't offered to", async () => {
    await seedOffer("ofr-acc-1");
    expect((await call("POST", "/ofr-acc-1/accept", OTHER_USER)).status).toBe(403);
    expect((await row("ofr-acc-1")).assign_status).toBe("offered");
  });

  it("accepts for the tech it's offered to", async () => {
    await seedOffer("ofr-acc-2");
    expect((await call("POST", "/ofr-acc-2/accept", HOLDER_USER)).status).toBe(200);
    const b = await row("ofr-acc-2");
    expect(b.assign_status).toBe("accepted");
    expect(b.accepted_at).toBeTruthy();
  });

  it("answers 409 once the offer has gone", async () => {
    await seedOffer("ofr-acc-3", { assignStatus: "accepted" });
    expect((await call("POST", "/ofr-acc-3/accept", HOLDER_USER)).status).toBe(409);
  });
});

describe("POST /bookings/:id/decline", () => {
  it("records the picked reason and note, and the timeline says why", async () => {
    await seedOffer("ofr-dec-1");
    const res = await call("POST", "/ofr-dec-1/decline", HOLDER_USER, { code: "too_far", note: "Two jobs across town first" });
    expect(res.status).toBe(200);
    const b = await row("ofr-dec-1");
    expect(b.rider_id).toBeNull();
    expect(b.status).toBe("confirmed");
    expect(b.assign_status).toBe("declined");
    expect(b.decline_reason).toBe("Too far away — Two jobs across town first");
    const ev = await sqlClient().execute({
      sql: "SELECT detail FROM job_events WHERE booking_id = ? AND kind = 'declined'",
      args: ["ofr-dec-1"],
    });
    expect((ev.rows[0] as any)?.detail).toBe("Too far away — Two jobs across town first");
  });

  it("keeps an older app's free-text reason", async () => {
    await seedOffer("ofr-dec-2");
    expect((await call("POST", "/ofr-dec-2/decline", HOLDER_USER, { reason: "Declined from app" })).status).toBe(200);
    expect((await row("ofr-dec-2")).decline_reason).toBe("Declined from app");
  });

  it("refuses a tech the job isn't offered to", async () => {
    await seedOffer("ofr-dec-3");
    expect((await call("POST", "/ofr-dec-3/decline", OTHER_USER, { code: "too_far" })).status).toBe(403);
    const b = await row("ofr-dec-3");
    expect(b.assign_status).toBe("offered");
    expect(b.rider_id).toBe(HOLDER_RIDER);
  });

  it("reads a reason it doesn't know (an older app's list) as Other", async () => {
    await seedOffer("ofr-dec-5");
    expect((await call("POST", "/ofr-dec-5/decline", HOLDER_USER, { code: "bored", note: "x" })).status).toBe(200);
    expect((await row("ofr-dec-5")).decline_reason).toBe("Other — x");
  });

  it("tells the office once when the tech taps Decline twice", async () => {
    await seedOffer("ofr-dec-6");
    const [a, b] = await Promise.all([
      call("POST", "/ofr-dec-6/decline", HOLDER_USER, { code: "personal" }),
      call("POST", "/ofr-dec-6/decline", HOLDER_USER, { code: "personal" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const ev = await sqlClient().execute({
      sql: "SELECT count(*) AS n FROM job_events WHERE booking_id = ? AND kind = 'declined'",
      args: ["ofr-dec-6"],
    });
    expect(Number((ev.rows[0] as any).n)).toBe(1);
  });

  it("lets the office decline on a tech's behalf", async () => {
    await seedOffer("ofr-dec-4");
    expect((await call("POST", "/ofr-dec-4/decline", ADMIN_USER, { code: "personal" }, "admin")).status).toBe(200);
    expect((await row("ofr-dec-4")).decline_reason).toBe("Personal reason");
  });
});
