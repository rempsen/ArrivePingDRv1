/**
 * Assigning from the dispatch map with Undo: Undo puts the job back exactly as
 * it was, and an undone drop never notifies anyone.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { and, eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const da = await import("../dispatch-assign");

const CO = "asg-co";
const OTHER = "asg-other";
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
  const id = `asg-job-${++n}`;
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
const tasks = async (id: string) => db.select().from(schema.scheduledTasks).where(and(eq(schema.scheduledTasks.bookingId, id), eq(schema.scheduledTasks.kind, da.ASSIGNED_NOTICE_TASK)));

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

describe("dispatchAssign + undoAssign", () => {
  it("assigns at once, holds the notice, and Undo restores a pending job exactly", async () => {
    const id = await job(CO, { status: "pending", assignStatus: "none" });
    const r = await da.dispatchAssign(CO, { bookingId: id, riderId: `${CO}-t1`, by: "Dana" }, NOW.getTime());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job).toEqual({ id, status: "assigned", assignStatus: "offered", riderId: `${CO}-t1` });
    expect(typeof r.undo).toBe("string");
    expect((await row(id)).riderId).toBe(`${CO}-t1`);
    // nobody has been told yet
    expect(await events(id)).not.toContain("assigned");
    expect((await tasks(id)).map((t) => t.status)).toEqual(["pending"]);

    const u = await da.undoAssign(CO, r.undo, "Dana", NOW.getTime() + 3_000);
    expect(u).toEqual({ ok: true, job: { id, status: "pending", assignStatus: "none", riderId: null } });
    const after = await row(id);
    expect(after).toMatchObject({ riderId: null, status: "pending", assignStatus: "none", assignedAt: null });
    expect((await tasks(id)).map((t) => t.status)).toEqual(["cancelled"]);
    expect(await events(id)).toContain("note_added");

    // the held notice wakes up and finds nothing to say
    await flushNotices();
    expect(await events(id)).not.toContain("assigned");
  });

  it("restores a confirmed job as confirmed", async () => {
    const id = await job(CO, { status: "confirmed", assignStatus: "released" });
    const r = await da.dispatchAssign(CO, { bookingId: id, riderId: `${CO}-t2`, by: "Dana" }, NOW.getTime());
    expect(r.ok).toBe(true);
    const u = await da.undoAssign(CO, r.ok ? r.undo : "", "Dana", NOW.getTime());
    expect(u.ok && u.job).toEqual({ id, status: "confirmed", assignStatus: "released", riderId: null });
    await flushNotices();
  });

  it("sends the notice once the Undo window passes", async () => {
    const id = await job(CO);
    const r = await da.dispatchAssign(CO, { bookingId: id, riderId: `${CO}-t1`, by: "Dana" }, NOW.getTime());
    expect(r.ok).toBe(true);
    await flushNotices();
    expect(await events(id)).toContain("assigned");
    expect((await tasks(id)).map((t) => t.status)).toEqual(["done"]);
  });

  it("won't undo once the technician accepted", async () => {
    const id = await job(CO);
    const r = await da.dispatchAssign(CO, { bookingId: id, riderId: `${CO}-t1`, by: "Dana" }, NOW.getTime());
    await db.update(schema.bookings).set({ assignStatus: "accepted", acceptedAt: new Date() }).where(eq(schema.bookings.id, id));
    const u = await da.undoAssign(CO, r.ok ? r.undo : "", "Dana", NOW.getTime());
    expect(u).toEqual({ ok: false, status: 409, message: "Tom Rivera already accepted this job — open it to change the assignment." });
    expect((await row(id)).riderId).toBe(`${CO}-t1`);
    await flushNotices();
  });

  it("refuses a tampered, expired or other company's token", async () => {
    const id = await job(CO);
    const r = await da.dispatchAssign(CO, { bookingId: id, riderId: `${CO}-t1`, by: "Dana" }, NOW.getTime());
    const token = r.ok ? r.undo! : "";
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), s: "completed" })).toString("base64url");
    expect(await da.undoAssign(CO, `${forged}.${mac}`, "Dana", NOW.getTime())).toMatchObject({ ok: false, status: 400 });
    expect(await da.undoAssign(CO, "garbage", "Dana", NOW.getTime())).toMatchObject({ ok: false, status: 400 });
    expect(await da.undoAssign(CO, 42, "Dana", NOW.getTime())).toMatchObject({ ok: false, status: 400 });
    expect(await da.undoAssign(CO, token, "Dana", NOW.getTime() + da.UNDO_TOKEN_TTL_MS + 1)).toMatchObject({ ok: false, status: 410 });
    expect(await da.undoAssign(OTHER, token, "Dana", NOW.getTime())).toMatchObject({ ok: false, status: 404 });
    expect((await row(id)).riderId).toBe(`${CO}-t1`);
    await flushNotices();
  });

  it("treats moving a job between technicians as a reassignment: notified now, no Undo", async () => {
    const id = await job(CO, { riderId: `${CO}-t2`, status: "assigned", assignStatus: "offered" });
    const r = await da.dispatchAssign(CO, { bookingId: id, riderId: `${CO}-t1`, by: "Dana" }, NOW.getTime());
    expect(r.ok && r.undo).toBeNull();
    expect(await events(id)).toContain("assigned");
    expect(await tasks(id)).toEqual([]);
  });

  it("passes a double booking through as a question the dispatcher can override", async () => {
    const first = await job(CO);
    const at = (await row(first)).scheduledAt;
    await db.update(schema.bookings).set({ riderId: `${CO}-t2`, status: "assigned", assignStatus: "accepted" }).where(eq(schema.bookings.id, first));
    const second = await job(CO, { scheduledAt: new Date(at.getTime() + 30 * 60_000) });
    const r = await da.dispatchAssign(CO, { bookingId: second, riderId: `${CO}-t2`, by: "Dana" }, NOW.getTime());
    expect(r).toMatchObject({ ok: false, status: 409, forceable: true, reason: "overlap" });
    const forced = await da.dispatchAssign(CO, { bookingId: second, riderId: `${CO}-t2`, by: "Dana", force: true }, NOW.getTime());
    expect(forced.ok).toBe(true);
    await flushNotices();
  });

  it("assigns at a new time in one write, checked at that time, and Undo puts both back", async () => {
    // t2 is busy at the job's current time, free at the new one.
    const blocker = await job(CO, { riderId: `${CO}-t2`, status: "assigned", assignStatus: "accepted" });
    const id = await job(CO, { scheduledAt: (await row(blocker)).scheduledAt });
    const before = (await row(id)).scheduledAt;
    const to = new Date(before.getTime() + 4 * HOUR).toISOString();
    const r = await da.dispatchAssign(CO, { bookingId: id, riderId: `${CO}-t2`, scheduledAt: to, by: "Dana" }, NOW.getTime());
    expect(r.ok).toBe(true);
    expect((await row(id)).scheduledAt.toISOString()).toBe(to);
    expect((await row(id)).riderId).toBe(`${CO}-t2`);
    const u = await da.undoAssign(CO, r.ok ? r.undo : "", "Dana", NOW.getTime());
    expect(u.ok).toBe(true);
    expect((await row(id)).riderId).toBeNull();
    expect((await row(id)).scheduledAt.toISOString()).toBe(before.toISOString());
    await flushNotices();
    expect(await events(id)).not.toContain("assigned");
  });

  it("reassigns and moves in one write, checked for the new technician at the new time", async () => {
    const theirs = await job(CO, { riderId: `${CO}-t1`, status: "assigned", assignStatus: "accepted" });
    const id = await job(CO, { riderId: `${CO}-t2`, status: "assigned", assignStatus: "accepted" });
    const target = (await row(theirs)).scheduledAt.toISOString();
    const r = await da.dispatchAssign(CO, { bookingId: id, riderId: `${CO}-t1`, scheduledAt: target, by: "Dana" }, NOW.getTime());
    expect(r).toMatchObject({ ok: false, status: 409, forceable: true, reason: "overlap" });
    expect((await row(id)).riderId).toBe(`${CO}-t2`);
    const later = new Date(new Date(target).getTime() + 3 * HOUR).toISOString();
    const ok = await da.dispatchAssign(CO, { bookingId: id, riderId: `${CO}-t1`, scheduledAt: later, by: "Dana" }, NOW.getTime());
    expect(ok.ok && ok.undo).toBeNull();
    expect((await row(id)).riderId).toBe(`${CO}-t1`);
    expect((await row(id)).scheduledAt.toISOString()).toBe(later);
    expect(await events(id)).toContain("assigned");
  });

  it("still checks the new time when taking a job off a live visit", async () => {
    const theirs = await job(CO, { riderId: `${CO}-t1`, status: "assigned", assignStatus: "accepted" });
    const live = await job(CO, { riderId: `${CO}-t2`, status: "enroute", assignStatus: "accepted" });
    const target = (await row(theirs)).scheduledAt.toISOString();
    const first = await da.dispatchAssign(CO, { bookingId: live, riderId: `${CO}-t1`, scheduledAt: target, forceBusy: false, by: "Dana" }, NOW.getTime());
    expect(first).toMatchObject({ ok: false, status: 409, forceable: true });
    expect((first as { reason?: string }).reason).toBeUndefined();
    const second = await da.dispatchAssign(CO, { bookingId: live, riderId: `${CO}-t1`, scheduledAt: target, force: true, forceBusy: false, by: "Dana" }, NOW.getTime());
    expect(second).toMatchObject({ ok: false, status: 409, forceable: true, reason: "overlap" });
    const third = await da.dispatchAssign(CO, { bookingId: live, riderId: `${CO}-t1`, scheduledAt: target, force: true, forceBusy: true, by: "Dana" }, NOW.getTime());
    expect(third.ok).toBe(true);
    expect((await row(live)).riderId).toBe(`${CO}-t1`);
  });

  it("Undo restores why a declined job came back to the queue", async () => {
    const offeredAt = new Date(NOW.getTime() - HOUR);
    const id = await job(CO, { status: "confirmed", assignStatus: "declined", declineReason: "Truck in the shop", assignedAt: offeredAt });
    const r = await da.dispatchAssign(CO, { bookingId: id, riderId: `${CO}-t1`, by: "Dana" }, NOW.getTime());
    expect((await row(id)).declineReason).toBe("");
    expect((await da.undoAssign(CO, r.ok ? r.undo : "", "Dana", NOW.getTime())).ok).toBe(true);
    const back = await row(id);
    expect(back.declineReason).toBe("Truck in the shop");
    expect(back.assignedAt?.toISOString()).toBe(offeredAt.toISOString());
    expect(back.assignStatus).toBe("declined");
    await flushNotices();
  });

  it("a queue assignment replaces a move still waiting to be announced", async () => {
    const ds = await import("../dispatch-schedule");
    const id = await job(CO, { riderId: `${CO}-t2`, status: "assigned", assignStatus: "accepted" });
    await ds.dispatchSchedule(CO, { bookingId: id, scheduledAt: new Date((await row(id)).scheduledAt.getTime() + HOUR).toISOString(), by: "Dana" }, NOW.getTime());
    // the technician hands it back, and it goes straight out again
    await db.update(schema.bookings).set({ riderId: null, status: "confirmed", assignStatus: "released" }).where(eq(schema.bookings.id, id));
    const r = await da.dispatchAssign(CO, { bookingId: id, riderId: `${CO}-t1`, by: "Dana" }, NOW.getTime());
    expect(r.ok).toBe(true);
    await flushNotices();
    const kinds = await events(id);
    expect(kinds).toContain("assigned");
    expect(kinds).not.toContain("rescheduled");
  });

  it("won't put the time back on its own once the technician accepted", async () => {
    const id = await job(CO);
    const to = new Date((await row(id)).scheduledAt.getTime() + HOUR).toISOString();
    const r = await da.dispatchAssign(CO, { bookingId: id, riderId: `${CO}-t1`, scheduledAt: to, by: "Dana" }, NOW.getTime());
    await db.update(schema.bookings).set({ assignStatus: "accepted", acceptedAt: new Date() }).where(eq(schema.bookings.id, id));
    expect(await da.undoAssign(CO, r.ok ? r.undo : "", "Dana", NOW.getTime())).toMatchObject({ ok: false, status: 409 });
    expect((await row(id)).scheduledAt.toISOString()).toBe(to);
    expect((await row(id)).riderId).toBe(`${CO}-t1`);
    await flushNotices();
  });

  it("refuses unknown jobs, other companies' jobs and other companies' technicians", async () => {
    expect(await da.dispatchAssign(CO, { bookingId: "nope", riderId: `${CO}-t1`, by: "Dana" })).toMatchObject({ ok: false, status: 404 });
    const theirs = await job(OTHER);
    expect(await da.dispatchAssign(CO, { bookingId: theirs, riderId: `${CO}-t1`, by: "Dana" })).toMatchObject({ ok: false, status: 404 });
    const mine = await job(CO);
    expect(await da.dispatchAssign(CO, { bookingId: mine, riderId: `${OTHER}-t1`, by: "Dana" })).toMatchObject({ ok: false, status: 404 });
    expect((await row(mine)).riderId).toBeNull();
  });
});
