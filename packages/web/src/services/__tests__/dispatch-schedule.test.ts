/**
 * Moving a job in time from the dispatch calendar: at once, with Undo, and an
 * undone move texts nobody. Plus the per-day load behind the Month view.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { and, eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const da = await import("../dispatch-assign");
const ds = await import("../dispatch-schedule");

const CO = "sch-co";
const OTHER = "sch-other";
const NOW = new Date("2026-10-17T19:00:00Z");
const HOUR = 3_600_000;

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
async function ensureTable(table: PgTable) {
  const s = (db as any).$client;
  const cfg = getTableConfig(table);
  await s.execute(`CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cfg.columns.map((c) => colDdl(c, true)).join(", ")})`);
  for (const c of cfg.columns) {
    if (c.primary) continue;
    await s.execute(`ALTER TABLE "${cfg.name}" ADD COLUMN IF NOT EXISTS ${colDdl(c, false)}`);
  }
}

async function company(id: string) {
  await db.insert(schema.companies).values({ id, name: id } as any);
  await db.insert(schema.companySettings).values({ id, companyId: id, timezone: "America/Winnipeg" } as any);
  await db.insert(schema.services).values({ id: `${id}-svc`, companyId: id, name: "Furnace repair", category: "HVAC", durationMins: 90 });
  await db.insert(schema.user).values({ id: `${id}-cust`, name: "Customer", email: `${id}-cust@t.test`, companyId: id } as any);
  for (const n of [1, 2]) {
    await db.insert(schema.user).values({ id: `${id}-u${n}`, name: n === 1 ? "Tom Rivera" : "Priya Nair", email: `${id}-u${n}@t.test`, companyId: id, role: "rider" } as any);
    await db.insert(schema.riders).values({ id: `${id}-t${n}`, userId: `${id}-u${n}`, companyId: id, status: "available", locationUpdatedAt: new Date() });
  }
}

let n = 0;
async function job(co: string, extra: Partial<typeof schema.bookings.$inferInsert> = {}) {
  const id = `sch-job-${++n}`;
  await db.insert(schema.bookings).values({
    id,
    companyId: co,
    customerId: `${co}-cust`,
    serviceId: `${co}-svc`,
    title: "Furnace not heating",
    status: "pending",
    scheduledAt: new Date(NOW.getTime() + 2 * HOUR + n * 4 * HOUR),
    address: "1 Test St",
    ...extra,
  });
  return id;
}

const row = async (id: string) => (await db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0]!;
const events = async (id: string) => (await db.select().from(schema.jobEvents).where(eq(schema.jobEvents.bookingId, id))).map((e) => e.kind);
const tasks = async (id: string) => db.select().from(schema.scheduledTasks).where(and(eq(schema.scheduledTasks.bookingId, id), eq(schema.scheduledTasks.kind, ds.RESCHEDULED_NOTICE_TASK)));

const pending: (() => void)[] = [];

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTable(v);
  await company(CO);
  await company(OTHER);
  da._setGraceTimerForTests((run) => pending.push(run));
});
afterAll(() => da._setGraceTimerForTests(null));

/** Run the deferred "assigned" notices that are due. */
async function flushNotices() {
  const runs = pending.splice(0);
  for (const r of runs) r();
  // runTaskNow is async inside the timer callback; give it a moment.
  await new Promise((r) => setTimeout(r, 150));
}


const at = (iso: string) => new Date(iso);
const minutesLater = (d: Date, m: number) => new Date(d.getTime() + m * 60_000).toISOString();

describe("dispatchSchedule + undo", () => {
  it("moves the time at once, holds the notice, and Undo puts it back telling nobody", async () => {
    const id = await job(CO, { riderId: `${CO}-t1`, status: "assigned", assignStatus: "accepted" });
    const before = (await row(id)).scheduledAt;
    const to = minutesLater(before, 90);
    const r = await ds.dispatchSchedule(CO, { bookingId: id, scheduledAt: to, by: "Dana" }, NOW.getTime());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.scheduledAt).toBe(to);
    expect(typeof r.undo).toBe("string");
    expect((await row(id)).scheduledAt.toISOString()).toBe(to);
    expect(await events(id)).not.toContain("rescheduled");
    expect((await tasks(id)).map((t) => t.status)).toEqual(["pending"]);

    const u = await ds.undoAny(CO, r.undo, "Dana", NOW.getTime() + 3_000);
    expect(u.ok).toBe(true);
    expect((await row(id)).scheduledAt.toISOString()).toBe(before.toISOString());
    expect((await tasks(id)).map((t) => t.status)).toEqual(["cancelled"]);
    await flushNotices();
    expect(await events(id)).not.toContain("rescheduled");
  });

  it("announces the move once the Undo window passes", async () => {
    const id = await job(CO, { riderId: `${CO}-t1`, status: "assigned", assignStatus: "accepted" });
    const r = await ds.dispatchSchedule(CO, { bookingId: id, scheduledAt: minutesLater((await row(id)).scheduledAt, 60), by: "Dana" }, NOW.getTime());
    expect(r.ok).toBe(true);
    await flushNotices();
    expect(await events(id)).toContain("rescheduled");
  });

  it("only announces where a job ended up after two quick moves", async () => {
    const id = await job(CO, { riderId: `${CO}-t2`, status: "assigned", assignStatus: "accepted" });
    const base = (await row(id)).scheduledAt;
    await ds.dispatchSchedule(CO, { bookingId: id, scheduledAt: minutesLater(base, 30), by: "Dana" }, NOW.getTime());
    await ds.dispatchSchedule(CO, { bookingId: id, scheduledAt: minutesLater(base, 60), by: "Dana" }, NOW.getTime());
    expect((await tasks(id)).map((t) => t.status).sort()).toEqual(["cancelled", "pending"]);
    await flushNotices();
    expect((await events(id)).filter((k) => k === "rescheduled")).toHaveLength(1);
  });

  it("undoing the second of two quick moves still announces the first", async () => {
    const id = await job(CO, { riderId: `${CO}-t2`, status: "assigned", assignStatus: "accepted" });
    const base = (await row(id)).scheduledAt;
    await ds.dispatchSchedule(CO, { bookingId: id, scheduledAt: minutesLater(base, 30), by: "Dana" }, NOW.getTime());
    const second = await ds.dispatchSchedule(CO, { bookingId: id, scheduledAt: minutesLater(base, 60), by: "Dana" }, NOW.getTime());
    const u = await ds.undoAny(CO, second.ok ? second.undo : "", "Dana", NOW.getTime());
    expect(u.ok).toBe(true);
    expect((await row(id)).scheduledAt.toISOString()).toBe(minutesLater(base, 30));
    await flushNotices();
    expect((await events(id)).filter((k) => k === "rescheduled")).toHaveLength(1);
  });

  it("two moves undone back to the start tell nobody", async () => {
    const id = await job(CO, { riderId: `${CO}-t2`, status: "assigned", assignStatus: "accepted" });
    const base = (await row(id)).scheduledAt;
    const first = await ds.dispatchSchedule(CO, { bookingId: id, scheduledAt: minutesLater(base, 30), by: "Dana" }, NOW.getTime());
    const second = await ds.dispatchSchedule(CO, { bookingId: id, scheduledAt: minutesLater(base, 60), by: "Dana" }, NOW.getTime());
    expect((await ds.undoAny(CO, second.ok ? second.undo : "", "Dana", NOW.getTime())).ok).toBe(true);
    expect((await ds.undoAny(CO, first.ok ? first.undo : "", "Dana", NOW.getTime())).ok).toBe(true);
    await flushNotices();
    expect(await events(id)).not.toContain("rescheduled");
  });

  it("an Undo after the move was announced announces the time it went back to", async () => {
    const id = await job(CO, { riderId: `${CO}-t1`, status: "assigned", assignStatus: "accepted" });
    const r = await ds.dispatchSchedule(CO, { bookingId: id, scheduledAt: minutesLater((await row(id)).scheduledAt, 45), by: "Dana" }, NOW.getTime());
    await flushNotices();
    expect((await events(id)).filter((k) => k === "rescheduled")).toHaveLength(1);
    expect((await ds.undoAny(CO, r.ok ? r.undo : "", "Dana", NOW.getTime())).ok).toBe(true);
    await flushNotices();
    expect((await events(id)).filter((k) => k === "rescheduled")).toHaveLength(2);
  });

  it("a job placed from the queue gets one notice, not assigned and rescheduled", async () => {
    const id = await job(CO, { status: "pending", assignStatus: "none" });
    const a = await da.dispatchAssign(CO, { bookingId: id, riderId: `${CO}-t1`, by: "Dana" }, NOW.getTime());
    expect(a.ok).toBe(true);
    const m = await ds.dispatchSchedule(CO, { bookingId: id, scheduledAt: minutesLater((await row(id)).scheduledAt, 30), by: "Dana" }, NOW.getTime());
    expect(m.ok).toBe(true);
    expect(await tasks(id)).toHaveLength(0);
    await flushNotices();
    const kinds = await events(id);
    expect(kinds).toContain("assigned");
    expect(kinds).not.toContain("rescheduled");
  });

  it("a reassignment announced at once replaces the held reschedule notice", async () => {
    const { assignJob } = await import("../assign");
    const id = await job(CO, { riderId: `${CO}-t1`, status: "assigned", assignStatus: "offered" });
    await ds.dispatchSchedule(CO, { bookingId: id, scheduledAt: minutesLater((await row(id)).scheduledAt, 30), by: "Dana" }, NOW.getTime());
    const r = await assignJob(CO, id, `${CO}-t2`, { by: { kind: "dispatcher", name: "Dana" } });
    expect(r.ok).toBe(true);
    expect((await tasks(id)).map((t) => t.status)).toEqual(["cancelled"]);
    await flushNotices();
    const kinds = await events(id);
    expect(kinds).toContain("assigned");
    expect(kinds).not.toContain("rescheduled");
  });

  it("won't undo a job that has moved again since", async () => {
    const id = await job(CO);
    const base = (await row(id)).scheduledAt;
    const r = await ds.dispatchSchedule(CO, { bookingId: id, scheduledAt: minutesLater(base, 30), by: "Dana" }, NOW.getTime());
    await db.update(schema.bookings).set({ scheduledAt: at(minutesLater(base, 120)) }).where(eq(schema.bookings.id, id));
    const u = await ds.undoAny(CO, r.ok ? r.undo : "", "Dana", NOW.getTime());
    expect(u).toEqual({ ok: false, status: 409, message: "This job changed since you moved it — open it to see where it is now." });
    expect((await row(id)).scheduledAt.toISOString()).toBe(minutesLater(base, 120));
    await flushNotices();
  });

  it("refuses to move a finished job, and asks before a double booking", async () => {
    const done = await job(CO, { status: "completed" });
    const r1 = await ds.dispatchSchedule(CO, { bookingId: done, scheduledAt: minutesLater((await row(done)).scheduledAt, 60), by: "Dana" }, NOW.getTime());
    expect(r1).toMatchObject({ ok: false, status: 409, forceable: false });

    const first = await job(CO, { riderId: `${CO}-t2`, status: "assigned", assignStatus: "accepted" });
    const second = await job(CO, { riderId: `${CO}-t2`, status: "assigned", assignStatus: "accepted" });
    const target = (await row(first)).scheduledAt.toISOString();
    const r2 = await ds.dispatchSchedule(CO, { bookingId: second, scheduledAt: target, by: "Dana" }, NOW.getTime());
    expect(r2).toMatchObject({ ok: false, status: 409, forceable: true, reason: "overlap" });
    const forced = await ds.dispatchSchedule(CO, { bookingId: second, scheduledAt: target, by: "Dana", force: true }, NOW.getTime());
    expect(forced.ok).toBe(true);
    await flushNotices();
  });

  it("keeps assign tokens working through the shared undo, and rejects other companies", async () => {
    const id = await job(CO, { status: "pending", assignStatus: "none" });
    const a = await da.dispatchAssign(CO, { bookingId: id, riderId: `${CO}-t1`, by: "Dana" }, NOW.getTime());
    expect(a.ok).toBe(true);
    expect(await ds.undoAny(OTHER, a.ok ? a.undo : "", "Dana", NOW.getTime())).toMatchObject({ ok: false, status: 404 });
    const u = await ds.undoAny(CO, a.ok ? a.undo : "", "Dana", NOW.getTime());
    expect(u).toMatchObject({ ok: true, job: { riderId: null } });
    // a time token is not an assign token
    const m = await ds.dispatchSchedule(CO, { bookingId: id, scheduledAt: minutesLater((await row(id)).scheduledAt, 15), by: "Dana" }, NOW.getTime());
    expect(await da.undoAssign(CO, m.ok ? m.undo : "", "Dana", NOW.getTime())).toMatchObject({ ok: false, status: 400 });
    await flushNotices();
  });

  it("refuses unknown and other companies' jobs", async () => {
    expect(await ds.dispatchSchedule(CO, { bookingId: "nope", scheduledAt: NOW.toISOString(), by: "Dana" })).toMatchObject({ ok: false, status: 404 });
    const theirs = await job(OTHER);
    expect(await ds.dispatchSchedule(CO, { bookingId: theirs, scheduledAt: NOW.toISOString(), by: "Dana" })).toMatchObject({ ok: false, status: 404 });
  });
});

describe("loadDayLoad", () => {
  it("counts jobs and booked minutes per company-time day", async () => {
    const LC = "load-co";
    await company(LC);
    // 9 PM in Winnipeg on Oct 20 is 02:00 UTC on Oct 21: it belongs to the 20th.
    await job(LC, { scheduledAt: at("2026-10-21T02:00:00Z") });
    await job(LC, { scheduledAt: at("2026-10-20T15:00:00Z") });
    await job(LC, { scheduledAt: at("2026-10-22T15:00:00Z"), status: "cancelled" });
    const r = await ds.loadDayLoad(LC, { from: "2026-10-19", days: 4 });
    expect(r.techs).toBe(2);
    expect(r.days).toEqual([
      { day: "2026-10-19", jobs: 0, bookedMins: 0 },
      { day: "2026-10-20", jobs: 2, bookedMins: 180 },
      { day: "2026-10-21", jobs: 0, bookedMins: 0 },
      { day: "2026-10-22", jobs: 0, bookedMins: 0 },
    ]);
  });
});
