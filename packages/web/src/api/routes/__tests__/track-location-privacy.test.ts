/**
 * Location privacy on the PUBLIC tracking link — GET /api/track/:token.
 *
 * Hard rule: the customer sees the technician's live location only after the
 * technician has tapped "Start Driving" for THIS job (status "enroute"), and
 * only until they arrive. Before that (assigned / accepted) and from arrival on,
 * the link still shows the job (title, time, price), but never where the tech
 * is, nor a live ETA or distance computed from it.
 *
 * Before this, buildSnapshot() returned the latest tracking ping (and the
 * rider's last lat/lng) whatever the job status, so the customer's map kept
 * following the technician after arrival.
 *
 * Harness: ephemeral in-memory DB, ids prefixed "tlp-".
 */
import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { Hono } from "hono";
import { getTableConfig, type PgColumn } from "drizzle-orm/pg-core";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { trackRoutes } = await import("../track");

const CO = "tlp-co";
const CUST = "tlp-cust";
const SVC = "tlp-svc";
const TECH_USER = "tlp-tech";
const RIDER = "tlp-rider";
const JOB = "tlp-job";
const TOKEN = "tlp-token";

const app = new Hono();
app.route("/track", trackRoutes);

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

async function seedJob(status: string) {
  const s = sqlClient();
  await s.execute({ sql: "DELETE FROM tracking_pings WHERE booking_id = ?", args: [JOB] });
  await s.execute({ sql: "DELETE FROM bookings WHERE id = ?", args: [JOB] });
  await s.execute({
    sql: `INSERT INTO bookings
            (id, company_id, customer_id, service_id, title, status, assign_status,
             scheduled_at, address, lat, lng, rider_id, price, public_token, finished_at,
             eta_mins, eta_distance_km)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      JOB, CO, CUST, SVC, "Furnace repair", status, "assigned",
      Date.now() - 3_600_000, "1 Test St", 49.8951, -97.1384, RIDER, 250, TOKEN,
      status === "completed" ? Date.now() : null,
      // A live ETA the ping handler would have stored from the tech's position.
      7, 3.2,
    ],
  });
  await s.execute({
    sql: "INSERT INTO tracking_pings (id, company_id, booking_id, lat, lng, created_at) VALUES (?,?,?,?,?,?)",
    args: ["tlp-ping", CO, JOB, 49.9, -97.14, Date.now()],
  });
}

async function snapshot() {
  const res = await app.request(`/track/${TOKEN}`);
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}

beforeAll(async () => {
  const s = sqlClient();
  for (const t of [
    schema.companies, schema.companySettings, schema.bookings, schema.services,
    schema.riders, schema.user, schema.messages, schema.reviews,
    schema.jobEvents, schema.jobPhotos, schema.trackingPings, schema.properties,
    schema.memberships,
  ]) {
    await s.execute(ddlFor(t));
  }
  await s.execute({
    sql: "INSERT OR IGNORE INTO companies (id, name) VALUES (?,?)",
    args: [CO, "TLP Co"],
  });
  for (const [id, name, role] of [[CUST, "Customer One", "customer"], [TECH_USER, "Tess Tech", "rider"]]) {
    await s.execute({
      sql: "INSERT OR IGNORE INTO user (id, company_id, name, email, role, email_verified) VALUES (?,?,?,?,?,0)",
      args: [id, CO, name, `${id}@t.test`, role],
    });
  }
  await s.execute({
    sql: "INSERT OR IGNORE INTO riders (id, user_id, company_id, lat, lng, approval) VALUES (?,?,?,?,?,?)",
    args: [RIDER, TECH_USER, CO, 49.91, -97.15, "active"],
  });
  await s.execute({
    sql: "INSERT OR IGNORE INTO services (id, company_id, name, category, base_price) VALUES (?,?,?,?,?)",
    args: [SVC, CO, "Furnace repair", "hvac", 250],
  });
});

describe("GET /api/track/:token — technician location", () => {
  beforeEach(() => seedJob("enroute"));

  it("shares the live location while the technician is on the way", async () => {
    const snap = await snapshot();
    expect(snap.techLocation).toEqual({ lat: 49.9, lng: -97.14 });
    expect(snap.tech.lat).toBe(49.91);
  });

  for (const status of ["assigned", "accepted", "arrived", "onsite", "in_progress", "paused", "completed", "cancelled"]) {
    it(`hides it while the job is ${status}, but keeps the job details`, async () => {
      await seedJob(status);
      const snap = await snapshot();
      expect(snap.techLocation).toBeNull();
      expect(snap.tech.lat).toBeNull();
      expect(snap.tech.lng).toBeNull();
      expect(snap.route ?? null).toBeNull();
      // No live ETA or distance either: both are computed from the tech's position.
      expect(snap.etaMins ?? null).toBeNull();
      expect(snap.etaDistanceKm ?? null).toBeNull();
      // The rest of the page still works: who, what, when, how much.
      expect(snap.tech.name).toBe("Tess Tech");
      expect(snap.status).toBe(status);
      expect(snap.destination.address).toBe("1 Test St");
      // Neither the latest ping (49.9) nor the rider's last fix (49.91) leaks anywhere.
      const body = JSON.stringify(snap);
      expect(body).not.toContain('"lat":49.9,');
      expect(body).not.toContain("49.91");
    });
  }
});
