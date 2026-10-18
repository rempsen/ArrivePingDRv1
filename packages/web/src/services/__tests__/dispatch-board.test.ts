/**
 * The Map v2 board snapshot: what's on it, in the company's day, in a fixed
 * number of reads whatever the team size.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { loadBoard, freeAtFor, BOARD_JOB_LIMIT } = await import("../dispatch-board");

const CO = "board-co";
const OTHER = "board-other";
const BIG = "board-big";
const SMALL = "board-small";
// 2026-10-17 19:00 UTC = 2:00 PM in Winnipeg (CDT)
const NOW = new Date("2026-10-17T19:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

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

async function company(id: string, opts: { internal?: boolean; tz?: string } = {}) {
  await db.insert(schema.companies).values({ id, name: id, officeLat: 49.8951, officeLng: -97.1384, isInternal: opts.internal ?? false } as any);
  await db.insert(schema.companySettings).values({ id, companyId: id, timezone: opts.tz ?? "America/Winnipeg", workerNoun: "Technician", jobNoun: "Job" } as any);
  await db.insert(schema.services).values({ id: `${id}-svc`, companyId: id, name: "Furnace repair", category: "HVAC", durationMins: 90 });
  await db.insert(schema.user).values({ id: `${id}-cust`, name: "Sarah Mitchell", email: `${id}-cust@t.test`, companyId: id, role: "customer" } as any);
}

async function tech(co: string, n: number, extra: Partial<typeof schema.riders.$inferInsert> = {}) {
  const uid = `${co}-u${n}`;
  await db.insert(schema.user).values({ id: uid, name: `Tech ${co} ${n}`, email: `${uid}@t.test`, companyId: co, role: "rider" } as any);
  await db.insert(schema.riders).values({ id: `${co}-t${n}`, userId: uid, companyId: co, skills: "HVAC", skillClass: "HVAC", status: "available", lat: 49.9, lng: -97.1, locationUpdatedAt: at(-MIN), ...extra });
}

async function job(co: string, id: string, extra: Partial<typeof schema.bookings.$inferInsert>) {
  await db.insert(schema.bookings).values({
    id,
    companyId: co,
    customerId: `${co}-cust`,
    serviceId: `${co}-svc`,
    title: id,
    status: "pending",
    scheduledAt: NOW,
    address: "1 Test St",
    lat: 49.89,
    lng: -97.13,
    ...extra,
  });
}

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTable(v);
  await company(CO, { internal: true });
  await company(OTHER);
  await tech(CO, 1);
  await tech(CO, 2, { status: "onsite" });
  await tech(CO, 3, { approval: "suspended" });
  await tech(CO, 4, { lat: null, lng: null, locationUpdatedAt: null });
  await tech(CO, 5, { locationUpdatedAt: at(-25 * MIN) });
  await tech(OTHER, 1);

  await job(CO, "b-day", { riderId: `${CO}-t1`, status: "assigned", assignStatus: "accepted", scheduledAt: at(HOUR) });
  await job(CO, "b-day-later", { riderId: `${CO}-t1`, status: "assigned", assignStatus: "offered", scheduledAt: at(3 * HOUR) });
  await job(CO, "b-wait-old", { scheduledAt: at(-72 * HOUR), status: "pending", requiredSkills: "HVAC, Boiler" });
  await job(CO, "b-wait-future", { scheduledAt: at(120 * HOUR), status: "confirmed" });
  await job(CO, "b-done-old", { riderId: `${CO}-t1`, status: "completed", scheduledAt: at(-48 * HOUR) });
  await job(CO, "b-done-today", { riderId: `${CO}-t1`, status: "completed", scheduledAt: at(-4 * HOUR) });
  await job(CO, "b-cancel-today", { status: "cancelled", scheduledAt: at(HOUR) });
  await job(CO, "b-live", { riderId: `${CO}-t2`, status: "in_progress", assignStatus: "accepted", scheduledAt: at(-30 * HOUR), startedAt: at(-30 * MIN) });
  await job(CO, "b-archived", { status: "pending", deletedAt: at(-HOUR) });
  await job(CO, "b-unplaced", { lat: 43.6532, lng: -79.3832 });
  // 23:30 on Oct 17 in Winnipeg is already Oct 18 in UTC.
  await job(CO, "b-late-evening", { riderId: `${CO}-t1`, status: "assigned", assignStatus: "accepted", scheduledAt: new Date("2026-10-18T04:30:00Z") });
  await job(CO, "b-two-days-on", { riderId: `${CO}-t1`, status: "assigned", assignStatus: "accepted", scheduledAt: at(50 * HOUR) });
  await job(OTHER, "b-other", { status: "pending" });
});

describe("loadBoard", () => {
  it("puts the day, the waiting queue and live work on the board — nothing else", async () => {
    const b = await loadBoard(CO, { now: NOW });
    expect(b.day).toBe("2026-10-17");
    expect(b.tz).toBe("America/Winnipeg");
    expect(b.mapV2Default).toBe(true);
    expect(b.office).toEqual({ lat: 49.8951, lng: -97.1384 });
    expect(b.truncated).toBe(false);
    const ids = b.jobs.map((j) => j.id).sort();
    expect(ids).toEqual(
      ["b-day", "b-day-later", "b-done-today", "b-late-evening", "b-live", "b-unplaced", "b-wait-future", "b-wait-old"].sort(),
    );
    // soonest first
    const times = b.jobs.map((j) => j.scheduledAt);
    expect(times).toEqual([...times].sort());
  });

  it("shapes jobs for the map", async () => {
    const b = await loadBoard(CO, { now: NOW });
    const w = b.jobs.find((j) => j.id === "b-wait-old")!;
    expect(w).toMatchObject({
      service: "Furnace repair",
      category: "HVAC",
      durationMins: 90,
      riderId: null,
      customerName: "Sarah Mitchell",
      requiredSkills: ["HVAC", "Boiler"],
      lat: 49.89,
      lng: -97.13,
    });
    // never geocoded: the schema's Toronto default isn't a real place for a Winnipeg company
    const u = b.jobs.find((j) => j.id === "b-unplaced")!;
    expect(u.lat).toBeNull();
    expect(u.lng).toBeNull();
  });

  it("describes each technician's day without extra reads", async () => {
    const b = await loadBoard(CO, { now: NOW });
    expect(b.techs.map((t) => t.id).sort()).toEqual([`${CO}-t1`, `${CO}-t2`, `${CO}-t4`, `${CO}-t5`]);
    const t1 = b.techs.find((t) => t.id === `${CO}-t1`)!;
    expect(t1.nextJobIds).toEqual(["b-day", "b-day-later", "b-late-evening"]);
    expect(t1.currentJobId).toBeNull();
    expect(t1.openJobs).toBe(3);
    expect(t1.freeAt).toBeNull();
    expect(t1.name).toBe(`Tech ${CO} 1`);
    const t2 = b.techs.find((t) => t.id === `${CO}-t2`)!;
    expect(t2.currentJobId).toBe("b-live");
    // 90-minute job started 30 minutes ago → about an hour left
    expect(Date.parse(t2.freeAt!)).toBe(NOW.getTime() + 60 * MIN);
    expect(b.techs.find((t) => t.id === `${CO}-t4`)).toMatchObject({ lat: null, lng: null, locationAt: null, stale: false });
    expect(b.techs.find((t) => t.id === `${CO}-t5`)!.stale).toBe(true);
    expect(t1.stale).toBe(false);
  });

  it("uses the company's calendar day, not UTC's", async () => {
    const next = await loadBoard(CO, { now: NOW, day: "2026-10-18" });
    expect(next.day).toBe("2026-10-18");
    expect(next.jobs.some((j) => j.id === "b-late-evening")).toBe(false);
    expect(next.jobs.some((j) => j.id === "b-day")).toBe(false);
    // the waiting queue and live work are there whatever the day
    expect(next.jobs.map((j) => j.id)).toEqual(expect.arrayContaining(["b-wait-old", "b-wait-future", "b-live"]));
    // a bad day falls back to today
    expect((await loadBoard(CO, { now: NOW, day: "17/10/2026" })).day).toBe("2026-10-17");
  });

  it("covers several days for the calendar's week view", async () => {
    const one = await loadBoard(CO, { now: NOW });
    expect(one.days).toBe(1);
    expect(one.jobs.some((j) => j.id === "b-two-days-on")).toBe(false);
    const three = await loadBoard(CO, { now: NOW, days: 3 });
    expect(three.day).toBe("2026-10-17");
    expect(three.days).toBe(3);
    expect(three.jobs.map((j) => j.id)).toEqual(expect.arrayContaining(["b-day", "b-late-evening", "b-two-days-on"]));
    // asking for more than a week is capped, not an unbounded read
    expect((await loadBoard(CO, { now: NOW, days: 30 })).days).toBe(7);
  });

  it("marks jobs an automation rule assigned", async () => {
    await db.update(schema.bookings).set({ autoAssignedRuleId: "rule-1" }).where(eq(schema.bookings.id, "b-day"));
    const b = await loadBoard(CO, { now: NOW });
    expect(b.jobs.find((j) => j.id === "b-day")!.autoAssignedRuleId).toBe("rule-1");
    expect(b.jobs.find((j) => j.id === "b-day-later")!.autoAssignedRuleId).toBe("");
    await db.update(schema.bookings).set({ autoAssignedRuleId: "" }).where(eq(schema.bookings.id, "b-day"));
  });

  it("lists the days off in range, in company time", async () => {
    // Noon Winnipeg on the 18th; and one on the 25th, outside a 3-day board.
    await db.insert(schema.techShifts).values([
      { companyId: CO, riderId: `${CO}-t1`, kind: "timeoff", date: new Date("2026-10-18T17:00:00Z") },
      { companyId: CO, riderId: `${CO}-t1`, kind: "shift", date: new Date("2026-10-17T17:00:00Z") },
      { companyId: CO, riderId: `${CO}-t2`, kind: "timeoff", date: new Date("2026-10-25T17:00:00Z") },
    ]);
    const b = await loadBoard(CO, { now: NOW, days: 3 });
    expect(b.timeOff).toEqual([{ techId: `${CO}-t1`, day: "2026-10-18" }]);
    expect((await loadBoard(OTHER, { now: NOW, days: 3 })).timeOff).toEqual([]);
  });

  it("never shows another company's technicians or jobs", async () => {
    const b = await loadBoard(CO, { now: NOW });
    expect(b.jobs.some((j) => j.id === "b-other")).toBe(false);
    expect(b.techs.some((t) => t.id.startsWith(OTHER))).toBe(false);
    const o = await loadBoard(OTHER, { now: NOW });
    expect(o.jobs.map((j) => j.id)).toEqual(["b-other"]);
    expect(o.mapV2Default).toBe(false);
  });

  it("costs the same number of reads for 5 technicians as for 50", async () => {
    await company(SMALL);
    await company(BIG);
    for (let i = 0; i < 5; i++) await tech(SMALL, i);
    for (let i = 0; i < 50; i++) await tech(BIG, i);
    for (let i = 0; i < 10; i++) await job(SMALL, `small-${i}`, { riderId: `${SMALL}-t${i % 5}`, status: "assigned" });
    for (let i = 0; i < 200; i++) await job(BIG, `big-${i}`, { riderId: i % 2 ? `${BIG}-t${i % 50}` : null, status: i % 2 ? "assigned" : "pending" });

    const client = (db as any).$client;
    const origQuery = client.query.bind(client);
    const origTx = client.transaction.bind(client);
    let reads = 0;
    client.query = (...a: unknown[]) => {
      reads++;
      return origQuery(...a);
    };
    client.transaction = (...a: unknown[]) => {
      reads++;
      return origTx(...a);
    };
    try {
      reads = 0;
      const small = await loadBoard(SMALL, { now: NOW });
      const smallReads = reads;
      reads = 0;
      const big = await loadBoard(BIG, { now: NOW });
      const bigReads = reads;
      expect(small.techs).toHaveLength(5);
      expect(big.techs).toHaveLength(50);
      expect(big.jobs).toHaveLength(200);
      expect(bigReads).toBe(smallReads);
      // the spy really saw the reads: settings, technicians, jobs, company, time off
      expect(smallReads).toBe(5);
    } finally {
      client.query = origQuery;
      client.transaction = origTx;
    }
  });

  it("caps a huge board and says so, keeping live work", async () => {
    const HUGE = "board-huge";
    await company(HUGE);
    await tech(HUGE, 1);
    await job(HUGE, "huge-live", { riderId: `${HUGE}-t1`, status: "enroute", scheduledAt: at(-50 * HOUR) });
    const rows = Array.from({ length: BOARD_JOB_LIMIT + 5 }, (_, i) => ({
      id: `huge-${i}`,
      companyId: HUGE,
      customerId: `${HUGE}-cust`,
      serviceId: `${HUGE}-svc`,
      title: "x",
      status: "pending",
      scheduledAt: at(-100 * HOUR + i * MIN),
      address: "1 Test St",
    }));
    for (let i = 0; i < rows.length; i += 500) await db.insert(schema.bookings).values(rows.slice(i, i + 500));
    const b = await loadBoard(HUGE, { now: NOW });
    expect(b.truncated).toBe(true);
    expect(b.jobs).toHaveLength(BOARD_JOB_LIMIT);
    expect(b.jobs.some((j) => j.id === "huge-live")).toBe(true);
  });
});

describe("freeAtFor", () => {
  const now = NOW.getTime();
  it("is null when nothing is in the field", () => {
    expect(freeAtFor([{ status: "assigned", scheduledAt: now, startedAt: null, durationMins: 60, etaMins: null }], now)).toBeNull();
  });
  it("adds the drive to the job when they're on the way", () => {
    expect(freeAtFor([{ status: "enroute", scheduledAt: now, startedAt: null, durationMins: 60, etaMins: 12 }], now)).toBe(now + 72 * MIN);
    expect(freeAtFor([{ status: "enroute", scheduledAt: now, startedAt: null, durationMins: 60, etaMins: null }], now)).toBe(now + 70 * MIN);
  });
  it("counts down a job in progress, never below five minutes", () => {
    expect(freeAtFor([{ status: "in_progress", scheduledAt: now, startedAt: now - 20 * MIN, durationMins: 60, etaMins: null }], now)).toBe(now + 40 * MIN);
    expect(freeAtFor([{ status: "in_progress", scheduledAt: now, startedAt: now - 3 * HOUR, durationMins: 60, etaMins: null }], now)).toBe(now + 5 * MIN);
    // 10 minutes worked, then paused for two hours: 50 minutes still to do.
    expect(
      freeAtFor([{ status: "in_progress", scheduledAt: now, startedAt: now - 130 * MIN, durationMins: 60, etaMins: null, clockState: "paused", accumulatedMs: 10 * MIN, lastResumeAt: now - 130 * MIN }], now),
    ).toBe(now + 50 * MIN);
    // running again for 5 more minutes after 10 banked
    expect(
      freeAtFor([{ status: "in_progress", scheduledAt: now, startedAt: now - 60 * MIN, durationMins: 60, etaMins: null, clockState: "running", accumulatedMs: 10 * MIN, lastResumeAt: now - 5 * MIN }], now),
    ).toBe(now + 45 * MIN);
  });
});
