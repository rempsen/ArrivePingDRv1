/**
 * The sample day must look alive and must never reach a real person.
 * Runs the real service against an in-memory Postgres.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { and, eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const sd = await import("../sample-day");
const { fireEvent } = await import("../dispatch");
const { driverSeatCount } = await import("../billing-subscription");
const { loadDataset } = await import("../../api/routes/export");
const { tdb } = await import("../../api/database/tenant");
const { isFictionalPhone, isUndeliverableEmail } = await import("../../shared/sample-contact");
const { Hono } = await import("hono");
const { payoutsRoutes } = await import("../../api/routes/payouts");

const CO = "sample-day-co";
const OTHER = "sample-day-other";
const NOW = new Date("2026-10-15T15:02:00Z");
const MIN = 60_000;

function colDdl(col: PgColumn, withPk: boolean): string {
  const parts = [`"${col.name}"`, col.getSQLType()];
  if (withPk && col.primary) parts.push("PRIMARY KEY");
  const dflt = (col as any).default;
  const lit =
    dflt === undefined ? null
    : typeof dflt === "string" ? `'${dflt.replace(/'/g, "''")}'`
    : typeof dflt === "boolean" ? (dflt ? "TRUE" : "FALSE")
    : typeof dflt === "number" ? String(dflt)
    : null;
  if (lit !== null) parts.push(`DEFAULT ${lit}`);
  return parts.join(" ");
}

/** Create the table, and add any column an earlier suite's table is missing. */
async function ensureTable(table: PgTable) {
  const s = (db as any).$client;
  const cfg = getTableConfig(table);
  await s.execute(`CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cfg.columns.map((c) => colDdl(c, true)).join(", ")})`);
  for (const c of cfg.columns) {
    if (c.primary) continue;
    await s.execute(`ALTER TABLE "${cfg.name}" ADD COLUMN IF NOT EXISTS ${colDdl(c, false)}`);
  }
}

const count = async (table: PgTable, where: any) => (await db.select().from(table as any).where(where)).length;

beforeAll(async () => {
  for (const v of Object.values(schema)) {
    if (v instanceof PgTable) await ensureTable(v);
  }
  await db.insert(schema.companies).values([
    { id: CO, name: "Sample Day Co", officeLat: 49.9, officeLng: -97.1 },
    { id: OTHER, name: "Someone Else" },
  ]);
  await db.insert(schema.companySettings).values({ id: CO, companyId: CO } as any);
});

describe("seedSampleDay", () => {
  it("lays out 3 techs, 6 customers and 8 jobs, all flagged and undeliverable", async () => {
    const r = await sd.seedSampleDay(CO, { now: NOW });
    expect(r).toMatchObject({ seeded: true, techs: 3, customers: 6, jobs: 8 });

    const users = await db.select().from(schema.user).where(eq(schema.user.companyId, CO));
    expect(users.length).toBe(9);
    for (const u of users) {
      expect(u.isSample).toBe(true);
      expect(isUndeliverableEmail(u.email)).toBe(true);
      expect(isFictionalPhone(u.phone)).toBe(true);
      expect(u.name).toContain("(sample)");
    }
    const riders = await db.select().from(schema.riders).where(eq(schema.riders.companyId, CO));
    expect(riders.every((r) => r.isSample && isFictionalPhone(r.phone))).toBe(true);
    const jobs = await db.select().from(schema.bookings).where(eq(schema.bookings.companyId, CO));
    expect(jobs.length).toBe(8);
    expect(jobs.every((b) => b.isSample && isFictionalPhone(b.customerPhone))).toBe(true);
    const byStatus = (s: string) => jobs.filter((b) => b.status === s).length;
    expect([byStatus("completed"), byStatus("in_progress"), byStatus("enroute"), byStatus("assigned"), byStatus("pending")]).toEqual([2, 1, 1, 3, 1]);
    // No login was created for anyone.
    expect(await count(schema.account, eq(schema.account.userId, users[0]!.id))).toBe(0);
    // A service was created because the company had none.
    const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, CO));
    expect(sd.parseSampleState(co!.sampleData)?.createdServiceId).toBeTruthy();
  });

  it("does nothing the second time", async () => {
    const r = await sd.seedSampleDay(CO, { now: NOW });
    expect(r.seeded).toBe(false);
    expect(await count(schema.bookings, eq(schema.bookings.companyId, CO))).toBe(8);
  });
});

describe("safety", () => {
  it("fireEvent logs the timeline for a sample job but notifies nobody", async () => {
    const job = (await sd.sampleRows(CO)).bookings.find((b) => b.status === "enroute")!;
    // Rules that WOULD notify the customer and every office admin on every channel.
    await db.insert(schema.notificationRules).values([
      { companyId: CO, event: "arrived", recipient: "client", inApp: true, email: true, sms: true, webhook: true, enabled: true },
      { companyId: CO, event: "arrived", recipient: "office", inApp: true, email: true, sms: true, enabled: true },
    ] as any);
    await db.insert(schema.user).values({ id: "real-admin", companyId: CO, name: "Real Admin", email: "admin@real.test", role: "admin" } as any);
    const before = await count(schema.jobEvents, eq(schema.jobEvents.bookingId, job.id));
    await fireEvent("arrived", job.id);
    expect(await count(schema.jobEvents, eq(schema.jobEvents.bookingId, job.id))).toBe(before + 1);
    expect(await count(schema.notifications, eq(schema.notifications.companyId, CO))).toBe(0);
    expect(await count(schema.notificationDeliveries, eq(schema.notificationDeliveries.companyId, CO))).toBe(0);
  });

  it("sample technicians are never billed seats", async () => {
    expect(await driverSeatCount(CO)).toBe(0);
  });

  it("payroll never pays a sample job", async () => {
    // Give the sample techs a real pay rate: the completed sample jobs would
    // then produce non-zero payouts if they were picked up.
    await db.update(schema.riders).set({ payRatePerHour: 40 }).where(eq(schema.riders.companyId, CO));
    const app = new Hono<any>().use("*", async (c, next) => {
      c.set("companyId", CO);
      c.set("user", { id: "real-admin", role: "admin", name: "Admin" });
      return next();
    });
    app.route("/payouts", payoutsRoutes);
    const res = await app.request("/payouts/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ periodStart: "2026-10-01", periodEnd: "2026-10-31" }),
    });
    expect(res.status).toBeLessThan(500);
    expect(await count(schema.payouts, eq(schema.payouts.companyId, CO))).toBe(0);
    const jobs = await db.select().from(schema.bookings).where(eq(schema.bookings.companyId, CO));
    expect(jobs.every((b) => !b.payoutId)).toBe(true);
  });

  it("exports leave every sample row out", async () => {
    const t = tdb(CO);
    for (const ds of ["work-orders", "technicians", "clients", "invoices"]) {
      expect((await loadDataset(ds, t)).length).toBe(0);
    }
  });
});

describe("sampleTick", () => {
  it("drives the van toward the job and counts the ETA down", async () => {
    const job = (await sd.sampleRows(CO)).bookings.find((b) => b.status === "enroute")!;
    const dist = (r: { lat: number | null; lng: number | null }) => Math.hypot(r.lat! - job.lat, r.lng! - job.lng);

    await sd.sampleTick(new Date(NOW.getTime() + 1 * MIN), CO);
    const [r1] = await db.select().from(schema.riders).where(eq(schema.riders.id, job.riderId!));
    const [b1] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, job.id));
    await sd.sampleTick(new Date(NOW.getTime() + 6 * MIN), CO);
    const [r2] = await db.select().from(schema.riders).where(eq(schema.riders.id, job.riderId!));
    const [b2] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, job.id));

    expect(r1!.status).toBe("enroute");
    expect(dist(r2!)).toBeLessThan(dist(r1!));
    expect(b2!.etaMins!).toBeLessThan(b1!.etaMins!);
    // Never arrives on its own (arriving would run the real notify flow).
    expect(b2!.status).toBe("enroute");
    expect(await count(schema.trackingPings, eq(schema.trackingPings.bookingId, job.id))).toBe(0);
  });

  it("keeps the other sample techs online", async () => {
    const t = new Date(NOW.getTime() + 7 * MIN);
    await sd.sampleTick(t, CO);
    const riders = await db.select().from(schema.riders).where(eq(schema.riders.companyId, CO));
    expect(riders.every((r) => Number(r.locationUpdatedAt) === t.getTime())).toBe(true);
    expect(riders.map((r) => r.status).sort()).toEqual(["available", "enroute", "onsite"]);
  });

  it("the van loops: it is back at the start of its trip after a lap", () => {
    const job = { lat: 49.9, lng: -97.1 };
    const a = sd.vanPosition(job, 0);
    const b = sd.vanPosition(job, sd.VAN_LAP_MS);
    expect(b).toEqual(a);
    expect(sd.vanPosition(job, sd.VAN_LAP_MS - 1).etaMins).toBe(1);
  });
});

describe("refreshSampleDay", () => {
  it("leaves a fresh plan alone and re-lays a stale one around now", async () => {
    expect(await sd.refreshSampleDay(CO, new Date(NOW.getTime() + 2 * 3_600_000))).toBe(false);
    const later = new Date(NOW.getTime() + 3 * 24 * 3_600_000);
    expect(await sd.refreshSampleDay(CO, later)).toBe(true);
    const jobs = await db.select().from(schema.bookings).where(eq(schema.bookings.companyId, CO));
    const live = jobs.find((b) => b.status === "enroute")!;
    expect(Math.abs(Number(live.scheduledAt) - later.getTime())).toBeLessThan(30 * MIN);
    // The timeline was rebuilt, not doubled.
    const events = await db.select().from(schema.jobEvents).where(eq(schema.jobEvents.bookingId, live.id));
    expect(events.map((e) => e.kind)).toEqual(["created", "assigned", "enroute"]);
  });
});

describe("clearSampleDay", () => {
  it("removes every sample row and keeps the company's own work", async () => {
    const { riders, users, bookings } = await sd.sampleRows(CO);
    const sampleCustomer = users.find((u) => u.role === "customer")!;
    const svc = bookings[0]!.serviceId;
    await db.insert(schema.user).values({ id: "real-cust", companyId: CO, name: "Real Customer", email: "c@real.test", role: "customer" } as any);
    await db.insert(schema.bookings).values([
      // Their own job, given to a sample tech: kept, back in the queue.
      { id: "own-1", companyId: CO, customerId: "real-cust", serviceId: svc, riderId: riders[0]!.id, status: "assigned", scheduledAt: NOW, address: "1 Real St" },
      // Their own job a sample tech had already started: back in the queue too.
      { id: "own-3", companyId: CO, customerId: "real-cust", serviceId: svc, riderId: riders[1]!.id, status: "in_progress", scheduledAt: NOW, address: "3 Real St" },
      // A job they booked for a sample customer: goes with the customer.
      { id: "own-2", companyId: CO, customerId: sampleCustomer.id, serviceId: svc, status: "pending", scheduledAt: NOW, address: "2 Real St" },
    ]);
    // Another company is never touched.
    await db.insert(schema.user).values({ id: "other-u", companyId: OTHER, name: "Other", email: "o@other.test", role: "customer" } as any);

    const r = await sd.clearSampleDay(CO, NOW);
    expect(r).toEqual({ jobs: 8, people: 9, linkedJobs: 1, unassigned: 2 });

    expect(await count(schema.bookings, and(eq(schema.bookings.companyId, CO), eq(schema.bookings.isSample, true)))).toBe(0);
    expect(await count(schema.user, eq(schema.user.isSample, true))).toBe(0);
    expect(await count(schema.riders, eq(schema.riders.isSample, true))).toBe(0);
    expect(await count(schema.memberships, eq(schema.memberships.companyId, CO))).toBe(0);
    const [own1] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, "own-1"));
    expect(own1).toMatchObject({ riderId: null, status: "pending" });
    const [own3] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, "own-3"));
    expect(own3).toMatchObject({ riderId: null, status: "pending" });
    expect(await count(schema.bookings, eq(schema.bookings.id, "own-2"))).toBe(0);
    expect(await count(schema.user, eq(schema.user.id, "real-cust"))).toBe(1);
    expect(await count(schema.user, eq(schema.user.id, "other-u"))).toBe(1);
    // The sample service is still used by own-1, so it stays.
    expect(await count(schema.services, eq(schema.services.id, svc))).toBe(1);

    const status = await sd.sampleStatus(CO);
    expect(status).toMatchObject({ active: false, jobs: 0, clearedAt: NOW.toISOString() });
  });

  it("is never re-seeded on its own after clearing, but can be added back", async () => {
    expect((await sd.seedSampleDay(CO, { now: NOW })).seeded).toBe(false);
    expect((await sd.seedSampleDay(CO, { now: NOW, force: true })).seeded).toBe(true);
    expect((await sd.sampleStatus(CO)).active).toBe(true);
  });
});
