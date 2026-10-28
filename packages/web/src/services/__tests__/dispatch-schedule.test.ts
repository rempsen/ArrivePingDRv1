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
    dflt === undefined
      ? null
      : typeof dflt === "string"
        ? `'${dflt.replace(/'/g, "''")}'`
        : typeof dflt === "boolean"
          ? dflt
            ? "TRUE"
            : "FALSE"
          : typeof dflt === "number"
            ? String(dflt)
            : // sql`now()` defaults (createdAt and friends): notices compare against them.
              dflt &&
                typeof dflt === "object" &&
                "queryChunks" in dflt &&
                col.getSQLType().startsWith("timestamp")
              ? "now()"
              : null;
  if (lit !== null) parts.push(`DEFAULT ${lit}`);
  return parts.join(" ");
}
async function ensureTable(table: PgTable) {
  const s = (db as any).$client;
  const cfg = getTableConfig(table);
  await s.execute(
    `CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cfg.columns.map((c) => colDdl(c, true)).join(", ")})`,
  );
  for (const c of cfg.columns) {
    if (c.primary) continue;
    await s.execute(
      `ALTER TABLE "${cfg.name}" ADD COLUMN IF NOT EXISTS ${colDdl(c, false)}`,
    );
    // Another test file may have made this table first without the now()
    // default; the notice handlers compare event times, so make sure it's there.
    if (colDdl(c, false).endsWith("DEFAULT now()"))
      await s.execute(
        `ALTER TABLE "${cfg.name}" ALTER COLUMN "${c.name}" SET DEFAULT now()`,
      );
  }
}

async function company(id: string) {
  await db.insert(schema.companies).values({ id, name: id } as any);
  await db
    .insert(schema.companySettings)
    .values({ id, companyId: id, timezone: "America/Winnipeg" } as any);
  await db
    .insert(schema.services)
    .values({
      id: `${id}-svc`,
      companyId: id,
      name: "Furnace repair",
      category: "HVAC",
      durationMins: 90,
    });
  await db
    .insert(schema.user)
    .values({
      id: `${id}-cust`,
      name: "Customer",
      email: `${id}-cust@t.test`,
      companyId: id,
    } as any);
  for (const n of [1, 2]) {
    await db
      .insert(schema.user)
      .values({
        id: `${id}-u${n}`,
        name: n === 1 ? "Tom Rivera" : "Priya Nair",
        email: `${id}-u${n}@t.test`,
        companyId: id,
        role: "rider",
      } as any);
    await db
      .insert(schema.riders)
      .values({
        id: `${id}-t${n}`,
        userId: `${id}-u${n}`,
        companyId: id,
        status: "available",
        locationUpdatedAt: new Date(),
      });
  }
}

let n = 0;
async function job(
  co: string,
  extra: Partial<typeof schema.bookings.$inferInsert> = {},
) {
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

const row = async (id: string) =>
  (
    await db.select().from(schema.bookings).where(eq(schema.bookings.id, id))
  )[0]!;
const events = async (id: string) =>
  (
    await db
      .select()
      .from(schema.jobEvents)
      .where(eq(schema.jobEvents.bookingId, id))
  ).map((e) => e.kind);
const tasks = async (id: string) =>
  db
    .select()
    .from(schema.scheduledTasks)
    .where(
      and(
        eq(schema.scheduledTasks.bookingId, id),
        eq(schema.scheduledTasks.kind, ds.RESCHEDULED_NOTICE_TASK),
      ),
    );

const pending: (() => void)[] = [];

beforeAll(async () => {
  for (const v of Object.values(schema))
    if (v instanceof PgTable) await ensureTable(v);
  await company(CO);
  await company(OTHER);
  da._setGraceTimerForTests((run) => pending.push(run));
});
afterAll(() => da._setGraceTimerForTests(null));

/** Run the deferred "assigned" notices that are due. */
async function flushNotices() {
  // A notice may hold another (a move notice waiting for an assignment
  // notice), so keep going until nothing new is queued.
  for (let round = 0; round < 8 && pending.length > 0; round++) {
    const runs = pending.splice(0);
    for (const r of runs) r();
    // runTaskNow is async inside the timer callback: wait until every notice
    // that started has finished (a slow CI box can take a while).
    await new Promise((r) => setTimeout(r, 50));
    for (let i = 0; i < 100; i++) {
      const running = await db
        .select()
        .from(schema.scheduledTasks)
        .where(eq(schema.scheduledTasks.status, "running"));
      if (running.length === 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

const at = (iso: string) => new Date(iso);
const minutesLater = (d: Date, m: number) =>
  new Date(d.getTime() + m * 60_000).toISOString();

describe("dispatchSchedule + undo", () => {
  it("moves the time at once, holds the notice, and Undo puts it back telling nobody", async () => {
    const id = await job(CO, {
      riderId: `${CO}-t1`,
      status: "assigned",
      assignStatus: "accepted",
    });
    const before = (await row(id)).scheduledAt;
    const to = minutesLater(before, 90);
    const r = await ds.dispatchSchedule(
      CO,
      { bookingId: id, scheduledAt: to, by: "Dana" },
      NOW.getTime(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.scheduledAt).toBe(to);
    expect(typeof r.undo).toBe("string");
    expect((await row(id)).scheduledAt.toISOString()).toBe(to);
    expect(await events(id)).not.toContain("rescheduled");
    expect((await tasks(id)).map((t) => t.status)).toEqual(["pending"]);

    const u = await ds.undoAny(CO, r.undo, "Dana", NOW.getTime() + 3_000);
    expect(u).toMatchObject({ ok: true, notified: false });
    expect((await row(id)).scheduledAt.toISOString()).toBe(
      before.toISOString(),
    );
    await flushNotices();
    expect(await events(id)).not.toContain("rescheduled");
  });

  it("announces the move once the Undo window passes", async () => {
    const id = await job(CO, {
      riderId: `${CO}-t1`,
      status: "assigned",
      assignStatus: "accepted",
    });
    const r = await ds.dispatchSchedule(
      CO,
      {
        bookingId: id,
        scheduledAt: minutesLater((await row(id)).scheduledAt, 60),
        by: "Dana",
      },
      NOW.getTime(),
    );
    expect(r.ok).toBe(true);
    await flushNotices();
    expect(await events(id)).toContain("rescheduled");
  });

  it("only announces where a job ended up after two quick moves", async () => {
    const id = await job(CO, {
      riderId: `${CO}-t2`,
      status: "assigned",
      assignStatus: "accepted",
    });
    const base = (await row(id)).scheduledAt;
    await ds.dispatchSchedule(
      CO,
      { bookingId: id, scheduledAt: minutesLater(base, 30), by: "Dana" },
      NOW.getTime(),
    );
    await ds.dispatchSchedule(
      CO,
      { bookingId: id, scheduledAt: minutesLater(base, 60), by: "Dana" },
      NOW.getTime(),
    );
    expect((await tasks(id)).map((t) => t.status).sort()).toEqual([
      "cancelled",
      "pending",
    ]);
    await flushNotices();
    expect((await events(id)).filter((k) => k === "rescheduled")).toHaveLength(
      1,
    );
  });

  it("undoing the second of two quick moves still announces the first", async () => {
    const id = await job(CO, {
      riderId: `${CO}-t2`,
      status: "assigned",
      assignStatus: "accepted",
    });
    const base = (await row(id)).scheduledAt;
    await ds.dispatchSchedule(
      CO,
      { bookingId: id, scheduledAt: minutesLater(base, 30), by: "Dana" },
      NOW.getTime(),
    );
    const second = await ds.dispatchSchedule(
      CO,
      { bookingId: id, scheduledAt: minutesLater(base, 60), by: "Dana" },
      NOW.getTime(),
    );
    const u = await ds.undoAny(
      CO,
      second.ok ? second.undo : "",
      "Dana",
      NOW.getTime(),
    );
    expect(u.ok).toBe(true);
    expect((await row(id)).scheduledAt.toISOString()).toBe(
      minutesLater(base, 30),
    );
    await flushNotices();
    expect((await events(id)).filter((k) => k === "rescheduled")).toHaveLength(
      1,
    );
  });

  it("two moves undone back to the start tell nobody", async () => {
    const id = await job(CO, {
      riderId: `${CO}-t2`,
      status: "assigned",
      assignStatus: "accepted",
    });
    const base = (await row(id)).scheduledAt;
    const first = await ds.dispatchSchedule(
      CO,
      { bookingId: id, scheduledAt: minutesLater(base, 30), by: "Dana" },
      NOW.getTime(),
    );
    const second = await ds.dispatchSchedule(
      CO,
      { bookingId: id, scheduledAt: minutesLater(base, 60), by: "Dana" },
      NOW.getTime(),
    );
    expect(
      (
        await ds.undoAny(
          CO,
          second.ok ? second.undo : "",
          "Dana",
          NOW.getTime(),
        )
      ).ok,
    ).toBe(true);
    expect(
      (await ds.undoAny(CO, first.ok ? first.undo : "", "Dana", NOW.getTime()))
        .ok,
    ).toBe(true);
    await flushNotices();
    expect(await events(id)).not.toContain("rescheduled");
  });

  it("a notice for an earlier move stays quiet once the job has moved again", async () => {
    // As if the first move's notice was already running when the second move landed.
    const id = await job(CO, {
      riderId: `${CO}-t2`,
      status: "assigned",
      assignStatus: "accepted",
    });
    const base = (await row(id)).scheduledAt;
    await ds.dispatchSchedule(
      CO,
      { bookingId: id, scheduledAt: minutesLater(base, 30), by: "Dana" },
      NOW.getTime(),
    );
    const [first] = await tasks(id);
    await db
      .update(schema.scheduledTasks)
      .set({ status: "running" })
      .where(eq(schema.scheduledTasks.id, first!.id));
    await ds.dispatchSchedule(
      CO,
      { bookingId: id, scheduledAt: minutesLater(base, 60), by: "Dana" },
      NOW.getTime(),
    );
    // the running one finishes now, the new one after its window
    await db
      .update(schema.scheduledTasks)
      .set({ status: "pending" })
      .where(eq(schema.scheduledTasks.id, first!.id));
    const { runTaskNow } = await import("../scheduler");
    await runTaskNow(first!.id);
    await flushNotices();
    expect((await events(id)).filter((k) => k === "rescheduled")).toHaveLength(
      1,
    );
  });

  it("two moves noting their notices at the same moment end with the latest move's", async () => {
    const notices = await import("../dispatch-notices");
    const id = await job(CO, {
      riderId: `${CO}-t2`,
      status: "assigned",
      assignStatus: "accepted",
    });
    const a = (await row(id)).scheduledAt;
    const b = at(minutesLater(a, 30));
    const c = at(minutesLater(a, 60));
    // Move one (A to B) lands and starts noting; move two (B to C) lands while it does.
    await db
      .update(schema.bookings)
      .set({ scheduledAt: b })
      .where(eq(schema.bookings.id, id));
    const first = notices.noteMove(CO, id, { from: a, to: b });
    await db
      .update(schema.bookings)
      .set({ scheduledAt: c })
      .where(eq(schema.bookings.id, id));
    const second = notices.noteMove(CO, id, { from: b, to: c });
    const [, g2] = await Promise.all([first, second]);
    expect(g2).not.toBeNull();
    expect(await notices.currentMoveGen(CO, id)).toBe(g2);
    const waiting = (await tasks(id))
      .filter((t) => t.status === "pending")
      .map((t) => JSON.parse(t.payload));
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({
      from: a.toISOString(),
      at: c.toISOString(),
      gen: g2,
    });
    await flushNotices();
    expect((await events(id)).filter((k) => k === "rescheduled")).toHaveLength(
      1,
    );
  });

  it("an Undo while the move's notice is mid-flight sends no needless correction", async () => {
    const id = await job(CO, {
      riderId: `${CO}-t1`,
      status: "assigned",
      assignStatus: "accepted",
    });
    const r = await ds.dispatchSchedule(
      CO,
      {
        bookingId: id,
        scheduledAt: minutesLater((await row(id)).scheduledAt, 45),
        by: "Dana",
      },
      NOW.getTime(),
    );
    const [notice] = await tasks(id);
    // claimed by the scheduler, not yet sent, when the Undo lands
    await db
      .update(schema.scheduledTasks)
      .set({ status: "running" })
      .where(eq(schema.scheduledTasks.id, notice!.id));
    expect(
      await ds.undoAny(CO, r.ok ? r.undo : "", "Dana", NOW.getTime()),
    ).toMatchObject({ ok: true, notified: false });
    await db
      .update(schema.scheduledTasks)
      .set({ status: "pending" })
      .where(eq(schema.scheduledTasks.id, notice!.id));
    const { runTaskNow } = await import("../scheduler");
    await runTaskNow(notice!.id); // it reads the restored time and stays quiet
    await flushNotices();
    expect(await events(id)).not.toContain("rescheduled");
  });

  it("an Undo after the move was announced announces the time it went back to", async () => {
    const id = await job(CO, {
      riderId: `${CO}-t1`,
      status: "assigned",
      assignStatus: "accepted",
    });
    const r = await ds.dispatchSchedule(
      CO,
      {
        bookingId: id,
        scheduledAt: minutesLater((await row(id)).scheduledAt, 45),
        by: "Dana",
      },
      NOW.getTime(),
    );
    await flushNotices();
    expect((await events(id)).filter((k) => k === "rescheduled")).toHaveLength(
      1,
    );
    // too late to keep it quiet, and the Undo says so
    expect(
      await ds.undoAny(CO, r.ok ? r.undo : "", "Dana", NOW.getTime()),
    ).toMatchObject({ ok: true, notified: true });
    await flushNotices();
    expect((await events(id)).filter((k) => k === "rescheduled")).toHaveLength(
      2,
    );
  });

  it("a move after a queue assignment is announced as well (the two messages are set up separately)", async () => {
    const id = await job(CO, { status: "pending", assignStatus: "none" });
    const a = await da.dispatchAssign(
      CO,
      { bookingId: id, riderId: `${CO}-t1`, by: "Dana" },
      NOW.getTime(),
    );
    expect(a.ok).toBe(true);
    const m = await ds.dispatchSchedule(
      CO,
      {
        bookingId: id,
        scheduledAt: minutesLater((await row(id)).scheduledAt, 30),
        by: "Dana",
      },
      NOW.getTime(),
    );
    expect(m.ok).toBe(true);
    await flushNotices();
    const kinds = await events(id);
    expect(kinds.filter((k) => k === "assigned")).toHaveLength(1);
    expect(kinds.filter((k) => k === "rescheduled")).toHaveLength(1);
  });

  it("a move still gets announced if the offer is declined before its notice goes", async () => {
    const id = await job(CO, { status: "pending", assignStatus: "none" });
    await da.dispatchAssign(
      CO,
      { bookingId: id, riderId: `${CO}-t1`, by: "Dana" },
      NOW.getTime(),
    );
    await ds.dispatchSchedule(
      CO,
      {
        bookingId: id,
        scheduledAt: minutesLater((await row(id)).scheduledAt, 30),
        by: "Dana",
      },
      NOW.getTime(),
    );
    // the technician declines inside the window: the "assigned" notice won't go
    await db
      .update(schema.bookings)
      .set({ riderId: null, status: "confirmed", assignStatus: "declined" })
      .where(eq(schema.bookings.id, id));
    await flushNotices();
    const kinds = await events(id);
    expect(kinds).not.toContain("assigned");
    expect(kinds).toContain("rescheduled");
  });

  it("a move and an immediate reassignment are each announced", async () => {
    const { assignJob } = await import("../assign");
    const id = await job(CO, {
      riderId: `${CO}-t1`,
      status: "assigned",
      assignStatus: "offered",
    });
    await ds.dispatchSchedule(
      CO,
      {
        bookingId: id,
        scheduledAt: minutesLater((await row(id)).scheduledAt, 30),
        by: "Dana",
      },
      NOW.getTime(),
    );
    const r = await assignJob(CO, id, `${CO}-t2`, {
      by: { kind: "dispatcher", name: "Dana" },
    });
    expect(r.ok).toBe(true);
    await flushNotices();
    const kinds = await events(id);
    expect(kinds).toContain("assigned");
    expect(kinds.filter((k) => k === "rescheduled")).toHaveLength(1);
  });

  it("won't undo a time move once the job has gone to another technician", async () => {
    const id = await job(CO, {
      riderId: `${CO}-t1`,
      status: "assigned",
      assignStatus: "offered",
    });
    const base = (await row(id)).scheduledAt;
    const r = await ds.dispatchSchedule(
      CO,
      { bookingId: id, scheduledAt: minutesLater(base, 30), by: "Dana" },
      NOW.getTime(),
    );
    await db
      .update(schema.bookings)
      .set({ riderId: `${CO}-t2` })
      .where(eq(schema.bookings.id, id));
    const u = await ds.undoAny(CO, r.ok ? r.undo : "", "Dana", NOW.getTime());
    expect(u).toMatchObject({ ok: false, status: 409 });
    expect((await row(id)).scheduledAt.toISOString()).toBe(
      minutesLater(base, 30),
    );
    await flushNotices();
  });

  it("won't undo into a slot someone else has taken since", async () => {
    const a = await job(CO, {
      riderId: `${CO}-t1`,
      status: "assigned",
      assignStatus: "accepted",
    });
    const base = (await row(a)).scheduledAt;
    const r = await ds.dispatchSchedule(
      CO,
      { bookingId: a, scheduledAt: minutesLater(base, 180), by: "Dana" },
      NOW.getTime(),
    );
    await job(CO, {
      riderId: `${CO}-t1`,
      status: "assigned",
      assignStatus: "accepted",
      scheduledAt: base,
    });
    const u = await ds.undoAny(CO, r.ok ? r.undo : "", "Dana", NOW.getTime());
    expect(u).toMatchObject({ ok: false, status: 409 });
    expect((await row(a)).scheduledAt.toISOString()).toBe(
      minutesLater(base, 180),
    );
    await flushNotices();
  });

  it("won't undo an older move after the job was moved away and back", async () => {
    const id = await job(CO, {
      riderId: `${CO}-t1`,
      status: "assigned",
      assignStatus: "accepted",
    });
    const base = (await row(id)).scheduledAt;
    const first = await ds.dispatchSchedule(
      CO,
      { bookingId: id, scheduledAt: minutesLater(base, 60), by: "Dana" },
      NOW.getTime(),
    );
    await ds.dispatchSchedule(
      CO,
      { bookingId: id, scheduledAt: minutesLater(base, 120), by: "Dana" },
      NOW.getTime(),
    );
    await ds.dispatchSchedule(
      CO,
      { bookingId: id, scheduledAt: minutesLater(base, 60), by: "Dana" },
      NOW.getTime(),
    );
    expect(
      await ds.undoAny(CO, first.ok ? first.undo : "", "Dana", NOW.getTime()),
    ).toMatchObject({ ok: false, status: 409 });
    expect((await row(id)).scheduledAt.toISOString()).toBe(
      minutesLater(base, 60),
    );
    await flushNotices();
  });

  it("won't undo a job that has moved again since", async () => {
    const id = await job(CO);
    const base = (await row(id)).scheduledAt;
    const r = await ds.dispatchSchedule(
      CO,
      { bookingId: id, scheduledAt: minutesLater(base, 30), by: "Dana" },
      NOW.getTime(),
    );
    await db
      .update(schema.bookings)
      .set({ scheduledAt: at(minutesLater(base, 120)) })
      .where(eq(schema.bookings.id, id));
    const u = await ds.undoAny(CO, r.ok ? r.undo : "", "Dana", NOW.getTime());
    expect(u).toEqual({
      ok: false,
      status: 409,
      message:
        "This job changed since you moved it — open it to see where it is now.",
    });
    expect((await row(id)).scheduledAt.toISOString()).toBe(
      minutesLater(base, 120),
    );
    await flushNotices();
  });

  it("refuses to move a finished job, and asks before a double booking", async () => {
    const done = await job(CO, { status: "completed" });
    const r1 = await ds.dispatchSchedule(
      CO,
      {
        bookingId: done,
        scheduledAt: minutesLater((await row(done)).scheduledAt, 60),
        by: "Dana",
      },
      NOW.getTime(),
    );
    expect(r1).toMatchObject({ ok: false, status: 409, forceable: false });

    const first = await job(CO, {
      riderId: `${CO}-t2`,
      status: "assigned",
      assignStatus: "accepted",
    });
    const second = await job(CO, {
      riderId: `${CO}-t2`,
      status: "assigned",
      assignStatus: "accepted",
    });
    const target = (await row(first)).scheduledAt.toISOString();
    const r2 = await ds.dispatchSchedule(
      CO,
      { bookingId: second, scheduledAt: target, by: "Dana" },
      NOW.getTime(),
    );
    expect(r2).toMatchObject({
      ok: false,
      status: 409,
      forceable: true,
      reason: "overlap",
    });
    const forced = await ds.dispatchSchedule(
      CO,
      { bookingId: second, scheduledAt: target, by: "Dana", force: true },
      NOW.getTime(),
    );
    expect(forced.ok).toBe(true);
    await flushNotices();
  });

  it("sizes a job by its own length when the office set one", async () => {
    // A 90-minute service; this first job was stretched to 4 hours.
    const long = await job(CO, { riderId: `${CO}-t2`, status: "assigned", assignStatus: "accepted", durationMins: 240 });
    const next = await job(CO, { riderId: `${CO}-t2`, status: "assigned", assignStatus: "accepted" });
    // Two hours after the long one starts: clear of a 90-minute job, inside a 4-hour one.
    const twoHoursIn = minutesLater((await row(long)).scheduledAt, 120);
    const r = await ds.dispatchSchedule(CO, { bookingId: next, scheduledAt: twoHoursIn, by: "Dana" }, NOW.getTime());
    expect(r).toMatchObject({ ok: false, status: 409, forceable: true, reason: "overlap" });
    // Back to the service's length: the same slot is free.
    await db.update(schema.bookings).set({ durationMins: null }).where(eq(schema.bookings.id, long));
    const ok = await ds.dispatchSchedule(CO, { bookingId: next, scheduledAt: twoHoursIn, by: "Dana" }, NOW.getTime());
    expect(ok.ok).toBe(true);
    await flushNotices();
  });

  it("keeps assign tokens working through the shared undo, and rejects other companies", async () => {
    const id = await job(CO, { status: "pending", assignStatus: "none" });
    const a = await da.dispatchAssign(
      CO,
      { bookingId: id, riderId: `${CO}-t1`, by: "Dana" },
      NOW.getTime(),
    );
    expect(a.ok).toBe(true);
    expect(
      await ds.undoAny(OTHER, a.ok ? a.undo : "", "Dana", NOW.getTime()),
    ).toMatchObject({ ok: false, status: 404 });
    const u = await ds.undoAny(CO, a.ok ? a.undo : "", "Dana", NOW.getTime());
    expect(u).toMatchObject({ ok: true, job: { riderId: null } });
    // a time token is not an assign token
    const m = await ds.dispatchSchedule(
      CO,
      {
        bookingId: id,
        scheduledAt: minutesLater((await row(id)).scheduledAt, 15),
        by: "Dana",
      },
      NOW.getTime(),
    );
    expect(
      await da.undoAssign(CO, m.ok ? m.undo : "", "Dana", NOW.getTime()),
    ).toMatchObject({ ok: false, status: 400 });
    await flushNotices();
  });

  it("refuses unknown and other companies' jobs", async () => {
    expect(
      await ds.dispatchSchedule(CO, {
        bookingId: "nope",
        scheduledAt: NOW.toISOString(),
        by: "Dana",
      }),
    ).toMatchObject({ ok: false, status: 404 });
    const theirs = await job(OTHER);
    expect(
      await ds.dispatchSchedule(CO, {
        bookingId: theirs,
        scheduledAt: NOW.toISOString(),
        by: "Dana",
      }),
    ).toMatchObject({ ok: false, status: 404 });
  });
});

describe("loadDayLoad", () => {
  it("counts jobs and booked minutes per company-time day", async () => {
    const LC = "load-co";
    await company(LC);
    // 9 PM in Winnipeg on Oct 20 is 02:00 UTC on Oct 21: it belongs to the 20th.
    await job(LC, {
      scheduledAt: at("2026-10-21T02:00:00Z"),
      riderId: `${LC}-t1`,
      status: "assigned",
    });
    await job(LC, {
      scheduledAt: at("2026-10-20T15:00:00Z"),
      riderId: `${LC}-t2`,
      status: "assigned",
    });
    // queued: counts as a job that day, not as booked time
    await job(LC, { scheduledAt: at("2026-10-20T17:00:00Z") });
    // one technician off on the 21st
    await db
      .insert(schema.techShifts)
      .values({
        companyId: LC,
        riderId: `${LC}-t1`,
        kind: "timeoff",
        date: at("2026-10-21T17:00:00Z"),
      });
    await job(LC, {
      scheduledAt: at("2026-10-22T15:00:00Z"),
      status: "cancelled",
    });
    const r = await ds.loadDayLoad(LC, { from: "2026-10-19", days: 4 });
    expect(r.techs).toBe(2);
    expect(r.days).toEqual([
      { day: "2026-10-19", jobs: 0, bookedMins: 0, techs: 2 },
      { day: "2026-10-20", jobs: 3, bookedMins: 180, techs: 2 },
      { day: "2026-10-21", jobs: 0, bookedMins: 0, techs: 1 },
      { day: "2026-10-22", jobs: 0, bookedMins: 0, techs: 2 },
    ]);
  });
});
