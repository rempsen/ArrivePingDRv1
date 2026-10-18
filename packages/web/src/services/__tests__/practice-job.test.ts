/**
 * Practice job (services/practice-job.ts): one pretend job for a new
 * technician's first run of the app.
 *
 *  - Only a real technician gets one; office staff and sample techs don't.
 *  - It's sample-flagged with an undeliverable customer, so running it through
 *    the real job events messages nobody.
 *  - One per technician per company: asking again returns the same job, and
 *    once removed it never comes back.
 *  - It doesn't switch on the office's sample day, doesn't stop one being
 *    seeded, and "Clear sample data" removes it.
 *  - It isn't earnings or today's work on the technician's phone.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { ensurePracticeJob, removePracticeJob, practiceJobId } = await import("../practice-job");
const { sampleStatus, seedSampleDay, clearSampleDay } = await import("../sample-day");
const { fireEvent } = await import("../dispatch");
const { meRoutes } = await import("../../api/routes/me");
const { bookingsRoutes } = await import("../../api/routes/bookings");
const { trackingRoutes } = await import("../../api/routes/tracking");

const CO = "pj-co";
const NOW = new Date("2026-10-15T15:00:00Z");

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

async function addTech(id: string, role = "rider") {
  await db.insert(schema.user).values({ id, companyId: CO, name: `Tech ${id}`, email: `${id}@real.test`, role } as any);
  await db.insert(schema.memberships).values({ id: `m-${id}`, userId: id, companyId: CO, role, status: "active" } as any);
  await db.insert(schema.riders).values({ id: `r-${id}`, companyId: CO, userId: id, status: "available", payRatePerHour: 40 } as any);
}

const app = new Hono<any>()
  .use("*", async (c, next) => {
    c.set("companyId", CO);
    const id = c.req.header("X-Test-User") ?? "pj-tech";
    c.set("user", { id, role: "rider", email: `${id}@real.test`, name: id });
    return next();
  })
  .route("/me", meRoutes)
  .route("/bookings", bookingsRoutes)
  .route("/tracking", trackingRoutes);

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTable(v);
  await db.insert(schema.companies).values({ id: CO, name: "Practice Co", officeLat: 49.9, officeLng: -97.1, officeAddress: "100 Main St, Winnipeg" } as any);
  await db.insert(schema.companySettings).values({ id: CO, companyId: CO } as any);
  await db.insert(schema.services).values({ id: "pj-svc", companyId: CO, name: "Service call", active: true } as any);
  await addTech("pj-tech");
  await addTech("pj-office", "dispatcher");
});

describe("practice job", () => {
  it("is only for real technicians", async () => {
    expect(await ensurePracticeJob(CO, "pj-office", NOW)).toEqual({ jobId: null, reason: "not a technician" });
    expect(await ensurePracticeJob(CO, "nobody", NOW)).toEqual({ jobId: null, reason: "not a technician" });
  });

  it("gives a new technician one assigned job at the office, sample-flagged with an undeliverable customer", async () => {
    const out = await ensurePracticeJob(CO, "pj-tech", NOW);
    expect(out).toEqual({ jobId: practiceJobId(CO, "r-pj-tech"), created: true });
    const [b] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, out.jobId!));
    expect(b).toMatchObject({ riderId: "r-pj-tech", status: "assigned", assignStatus: "accepted", isSample: true, price: 0, address: "100 Main St, Winnipeg", title: "Practice job" });
    expect(Number(b!.scheduledAt) - NOW.getTime()).toBe(30 * 60_000);
    const [cust] = await db.select().from(schema.user).where(eq(schema.user.id, b!.customerId));
    expect(cust!.isSample).toBe(true);
    expect(cust!.email.endsWith(".invalid")).toBe(true);
    expect(cust!.phone).toMatch(/555-01\d\d$/);
  });

  it("asking again returns the same job", async () => {
    expect(await ensurePracticeJob(CO, "pj-tech", NOW)).toEqual({ jobId: practiceJobId(CO, "r-pj-tech"), created: false });
    expect((await db.select().from(schema.bookings).where(eq(schema.bookings.riderId, "r-pj-tech"))).length).toBe(1);
  });

  it("running it through the real job events messages nobody", async () => {
    const id = practiceJobId(CO, "r-pj-tech");
    await db.insert(schema.notificationRules).values([
      { id: "pj-rule-1", companyId: CO, event: "enroute", recipient: "client", enabled: true, sms: true, email: true, inApp: true } as any,
      { id: "pj-rule-2", companyId: CO, event: "arrived", recipient: "client", enabled: true, sms: true, email: true, inApp: true } as any,
    ]);
    for (const ev of ["enroute", "arrived", "completed"] as const) await fireEvent(ev, id);
    expect((await db.select().from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.bookingId, id))).length).toBe(0);
  });

  it("isn't today's work or earnings on the technician's phone", async () => {
    const id = practiceJobId(CO, "r-pj-tech");
    await db.update(schema.bookings).set({ status: "completed", scheduledAt: new Date(), onSiteMinutes: 60, techPay: 40 } as any).where(eq(schema.bookings.id, id));
    const stats = await (await app.request("/bookings/today-stats")).json();
    expect(stats).toMatchObject({ jobsDone: 0, earnings: 0, totalToday: 0 });
    const earn = (await (await app.request("/me/earnings")).json()) as { jobs: unknown[]; totals: { jobsCount: number; pay: number } };
    expect(earn.jobs).toEqual([]);
    expect(earn.totals).toMatchObject({ jobsCount: 0, pay: 0 });
  });

  it("doesn't switch on the office's sample day or stop one being seeded", async () => {
    expect((await sampleStatus(CO)).active).toBe(false);
    const seeded = await seedSampleDay(CO, { now: NOW });
    expect(seeded.seeded).toBe(true);
    expect((await sampleStatus(CO)).jobs).toBe(8);
  });

  it("the technician can remove it, and it never comes back", async () => {
    expect(await removePracticeJob(CO, "pj-tech")).toEqual({ removed: 1 });
    expect(await removePracticeJob(CO, "pj-tech")).toEqual({ removed: 0 });
    expect(await ensurePracticeJob(CO, "pj-tech", NOW)).toEqual({ jobId: null, reason: "already had one" });
  });

  it("a technician who has already finished real work here gets none", async () => {
    await addTech("pj-vet");
    await db.insert(schema.bookings).values({ id: "pj-real", companyId: CO, customerId: "pj-office", serviceId: "pj-svc", riderId: "r-pj-vet", status: "completed", scheduledAt: NOW, address: "1 Real St" } as any);
    expect(await ensurePracticeJob(CO, "pj-vet", NOW)).toEqual({ jobId: null, reason: "experienced" });
  });

  it("never auto-arrives at the office, so the technician taps I've Arrived themselves (Codex on #45)", async () => {
    await addTech("pj-geo");
    const { jobId } = (await ensurePracticeJob(CO, "pj-geo", NOW)) as { jobId: string };
    const [job] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, jobId));
    await db.update(schema.bookings).set({ status: "enroute", enrouteAt: new Date() } as any).where(eq(schema.bookings.id, jobId));
    // A real job at the same spot, for contrast: that one does auto-arrive.
    await db.insert(schema.bookings).values({ id: "pj-geo-real", companyId: CO, customerId: "pj-office", serviceId: "pj-svc", riderId: "r-pj-geo", status: "enroute", enrouteAt: new Date(), scheduledAt: NOW, address: "100 Main St", lat: job!.lat, lng: job!.lng } as any);
    const ping = (id: string) =>
      app.request(`/tracking/${id}/ping`, { method: "POST", headers: { "X-Test-User": "pj-geo", "content-type": "application/json" }, body: JSON.stringify({ lat: job!.lat, lng: job!.lng }) });
    expect((await ping(jobId)).status).toBe(200);
    expect((await db.select().from(schema.bookings).where(eq(schema.bookings.id, jobId)))[0]!.status).toBe("enroute");
    expect((await ping("pj-geo-real")).status).toBe(200);
    expect((await db.select().from(schema.bookings).where(eq(schema.bookings.id, "pj-geo-real")))[0]!.status).toBe("arrived");
  });

  it("over the API: POST hands one out, DELETE removes it; Clear sample data removes it too", async () => {
    await addTech("pj-tech2");
    const post = (await (await app.request("/me/practice-job", { method: "POST", headers: { "X-Test-User": "pj-tech2" } })).json()) as { jobId: string };
    expect(post.jobId).toBe(practiceJobId(CO, "r-pj-tech2"));
    await clearSampleDay(CO, NOW);
    expect((await db.select().from(schema.bookings).where(eq(schema.bookings.id, post.jobId))).length).toBe(0);
    const del = await (await app.request("/me/practice-job", { method: "DELETE", headers: { "X-Test-User": "pj-tech2" } })).json();
    expect(del).toEqual({ removed: 0 });
  });
});
