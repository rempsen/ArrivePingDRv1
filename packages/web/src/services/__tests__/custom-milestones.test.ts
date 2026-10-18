/**
 * Custom milestones: a company's own moments, fired on the real dispatch path
 * against an in-memory Postgres.
 *
 * What this locks down:
 *  - each trigger fires (stage, checklist, before the appointment, after
 *    completion) and fires ONCE per job, however often it's poked;
 *  - the timed ones respect their window: not early, not hours late, not for
 *    a job booked after its reminder time, not for a cancelled job;
 *  - a rescheduled job gets its reminder again, for the new time;
 *  - sample jobs get the timeline line and nothing is sent;
 *  - nobody gets an empty message;
 *  - a milestone only ever touches its own company's jobs.
 *
 * No real message can leave: no Resend key, no Twilio credentials.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { and, eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.RESEND_API_KEY = "";
process.env.TWILIO_ACCOUNT_SID = "";
process.env.TWILIO_AUTH_TOKEN = "";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { fireEvent } = await import("../dispatch");
const cm = await import("../custom-milestones");
const { customEventKey, describeTrigger, milestoneProblem, formatOffset } = await import("../../shared/custom-milestones");

const CO = "cm-co";
const OTHER = "cm-other";
const CUST = "cm-cust";
const ADMIN = "cm-admin";
const SVC = "cm-svc";
const NOW = new Date("2026-10-18T15:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

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

async function job(id: string, o: Partial<typeof schema.bookings.$inferInsert> = {}) {
  await db.insert(schema.bookings).values({
    id,
    companyId: CO,
    customerId: CUST,
    serviceId: SVC,
    title: "Water heater",
    status: "assigned",
    scheduledAt: new Date(NOW.getTime() + DAY),
    address: "1 Test St",
    customerPhone: "+12045550100",
    publicToken: `tok-${id}`,
    price: 100,
    createdAt: new Date(NOW.getTime() - 7 * DAY),
    ...o,
  } as any);
}

const milestoneEvents = (bookingId: string) =>
  db.select().from(schema.jobEvents).where(and(eq(schema.jobEvents.bookingId, bookingId), eq(schema.jobEvents.kind, "milestone")));
const deliveries = (milestoneId: string, bookingId?: string) =>
  db
    .select()
    .from(schema.notificationDeliveries)
    .where(
      bookingId
        ? and(eq(schema.notificationDeliveries.event, customEventKey(milestoneId)), eq(schema.notificationDeliveries.bookingId, bookingId))
        : eq(schema.notificationDeliveries.event, customEventKey(milestoneId)),
    );
const fires = (milestoneId: string) =>
  db.select().from(schema.customMilestoneFires).where(eq(schema.customMilestoneFires.milestoneId, milestoneId));

const toCustomer = (text: string) => ({ client: { on: true, text } });

beforeAll(async () => {
  for (const v of Object.values(schema)) {
    if (v instanceof PgTable) await ensureTable(v);
  }
  // ensureTable makes columns only; "once per job" rests on this index.
  await (db as any).$client.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS custom_milestone_fire_once_uidx ON custom_milestone_fires (milestone_id, booking_id)`,
  );
  await db.insert(schema.companies).values([
    { id: CO, name: "Milestone Plumbing" },
    { id: OTHER, name: "Someone Else" },
  ] as any);
  await db.insert(schema.companySettings).values({ id: CO, companyId: CO, name: "Milestone Plumbing" } as any);
  await db.insert(schema.user).values([
    { id: CUST, companyId: CO, name: "Dana Customer", email: "dana@example.test", role: "customer" },
    { id: ADMIN, companyId: CO, name: "Olive Office", email: "olive@example.test", role: "admin" },
  ] as any);
  await db.insert(schema.services).values({ id: SVC, companyId: CO, name: "Water heater" } as any);
});

describe("shared rules", () => {
  it("describes a milestone in plain words", () => {
    expect(describeTrigger({ trigger: "stage", triggerEvent: "arrived" })).toBe("When the tech arrives");
    expect(describeTrigger({ trigger: "checklist", checklistLabel: "Water restored" })).toBe("When the tech ticks “Water restored”");
    expect(describeTrigger({ trigger: "before_start", offsetMinutes: 1440 })).toBe("1 day before the appointment");
    expect(describeTrigger({ trigger: "after_complete", offsetMinutes: 4320 })).toBe("3 days after the job is completed");
    expect(formatOffset(90)).toBe("90 minutes");
    expect(formatOffset(120)).toBe("2 hours");
  });

  it("says what is wrong before anything is saved", () => {
    expect(milestoneProblem({ name: " ", trigger: "stage", triggerEvent: "arrived" })).toContain("name");
    expect(milestoneProblem({ name: "X", trigger: "stage", triggerEvent: "created" })).toContain("moment");
    expect(milestoneProblem({ name: "X", trigger: "checklist", checklistLabel: "" })).toContain("checklist");
    expect(milestoneProblem({ name: "X", trigger: "before_start", offsetMinutes: 2 })).toContain("5 minutes");
    expect(milestoneProblem({ name: "X", trigger: "after_complete", offsetMinutes: 60 * 24 * 31 })).toContain("30 days");
    expect(milestoneProblem({ name: "X", trigger: "whenever" })).toContain("sets it off");
    expect(milestoneProblem({ name: "Water restored", trigger: "checklist", checklistLabel: "Water restored" })).toBeNull();
  });
});

describe("creating", () => {
  it("refuses a bad milestone", async () => {
    await expect(cm.createMilestone(CO, { name: "Nope", trigger: "stage", triggerEvent: "made-up" })).rejects.toThrow("moment");
  });

  it("writes one rule per recipient, and never stands in for the built-in matrix", async () => {
    const m = await cm.createMilestone(CO, { name: "Arrived photo", trigger: "stage", triggerEvent: "arrived" }, toCustomer("Hi {{firstName}}"));
    const rules = await cm.milestoneRules(CO, m.id);
    expect(rules.map((r) => r.recipient).sort()).toEqual(["client", "office", "tech"]);
    const client = rules.find((r) => r.recipient === "client")!;
    expect([client.sms, client.inApp, client.email, client.template]).toEqual([true, true, false, "Hi {{firstName}}"]);
    const tech = rules.find((r) => r.recipient === "tech")!;
    expect([tech.sms, tech.inApp, tech.email]).toEqual([false, false, false]);
    // The base matrix was seeded first, so the company still gets built-in messages.
    const builtIn = await db.select().from(schema.notificationRules).where(and(eq(schema.notificationRules.companyId, CO), eq(schema.notificationRules.event, "enroute")));
    expect(builtIn.length).toBeGreaterThan(0);
    await cm.deleteMilestone(CO, m.id);
  });
});

describe("stage trigger", () => {
  it("fires after the built-in event, once per job, with its own timeline line", async () => {
    const m = await cm.createMilestone(
      CO,
      { name: "Shoe covers on", trigger: "stage", triggerEvent: "arrived", customerTimeline: true },
      toCustomer("{{techName}} is putting shoe covers on."),
    );
    await job("cm-stage-1");
    await fireEvent("arrived", "cm-stage-1");
    const lines = await milestoneEvents("cm-stage-1");
    expect(lines.map((l) => [l.label, l.customerVisible])).toEqual([["Shoe covers on", true]]);
    // The customer's text was attempted (skipped: no Twilio here) and the in-app alert sent.
    const sent = await deliveries(m.id, "cm-stage-1");
    expect(sent.map((d) => d.channel).sort()).toEqual(["in_app", "sms"]);

    await fireEvent("arrived", "cm-stage-1");
    expect((await milestoneEvents("cm-stage-1")).length).toBe(1);
    expect((await deliveries(m.id, "cm-stage-1")).length).toBe(2);

    // A different event doesn't set it off.
    await job("cm-stage-2");
    await fireEvent("enroute", "cm-stage-2");
    expect((await milestoneEvents("cm-stage-2")).length).toBe(0);
    await cm.deleteMilestone(CO, m.id);
  });

  it("a paused milestone stays quiet", async () => {
    const m = await cm.createMilestone(CO, { name: "Paused one", trigger: "stage", triggerEvent: "started" }, toCustomer("hi"));
    await cm.updateMilestone(CO, m.id, { enabled: false });
    await job("cm-paused");
    await fireEvent("started", "cm-paused");
    expect((await milestoneEvents("cm-paused")).length).toBe(0);
    await cm.deleteMilestone(CO, m.id);
  });
});

describe("checklist trigger", () => {
  it("matches the wording loosely and fires once, even if re-ticked", async () => {
    const m = await cm.createMilestone(CO, { name: "Water restored", trigger: "checklist", checklistLabel: "Water  Restored " }, toCustomer("Water is back on at {{address}}."));
    expect(m.checklistLabel).toBe("Water Restored");
    await job("cm-check-1");
    expect(await cm.onChecklistTicked(CO, "cm-check-1", "  water restored")).toBe(1);
    expect(await cm.onChecklistTicked(CO, "cm-check-1", "Water restored")).toBe(0);
    expect(await cm.onChecklistTicked(CO, "cm-check-1", "Meter read")).toBe(0);
    expect((await milestoneEvents("cm-check-1")).map((l) => [l.label, l.customerVisible])).toEqual([["Water restored", false]]);
    const sms = (await deliveries(m.id, "cm-check-1")).find((d) => d.channel === "sms");
    expect(sms?.target).toBe("+12045550100");
    await cm.deleteMilestone(CO, m.id);
  });

  it("never fires on another company's job", async () => {
    const m = await cm.createMilestone(OTHER, { name: "Theirs", trigger: "checklist", checklistLabel: "Done" }, toCustomer("hi"));
    await job("cm-check-mine");
    // Their milestone, our job id: the claim is made under their company, but
    // the job isn't theirs, so nothing is logged or sent.
    expect(await cm.onChecklistTicked(CO, "cm-check-mine", "Done")).toBe(0);
    await cm.fireMilestone(m, "cm-check-mine");
    expect((await milestoneEvents("cm-check-mine")).length).toBe(0);
    expect((await deliveries(m.id)).length).toBe(0);
    await cm.deleteMilestone(OTHER, m.id);
  });
});

describe("before the appointment", () => {
  it("fires inside its window only, once, and again after a reschedule", async () => {
    const m = await cm.createMilestone(CO, { name: "Two hours out", trigger: "before_start", offsetMinutes: 120 }, toCustomer("See you at {{when}}"));
    const at = (mins: number) => new Date(NOW.getTime() + mins * MIN);
    await job("cm-before-due", { scheduledAt: at(110) }); // moment was 10 min ago
    await job("cm-before-early", { scheduledAt: at(130) }); // moment is in 10 min
    await job("cm-before-stale", { scheduledAt: at(120 - 90) }); // moment was 90 min ago
    await job("cm-before-late-booked", { scheduledAt: at(110), createdAt: at(-5) }); // booked after its moment
    await job("cm-before-cancelled", { scheduledAt: at(110), status: "cancelled" });

    expect((await cm.sweepCustomMilestones(NOW)).fired).toBe(1);
    expect((await milestoneEvents("cm-before-due")).length).toBe(1);
    for (const id of ["cm-before-early", "cm-before-stale", "cm-before-late-booked", "cm-before-cancelled"]) {
      expect({ id, n: (await milestoneEvents(id)).length }).toEqual({ id, n: 0 });
    }
    // Every minute after: nothing new.
    expect((await cm.sweepCustomMilestones(new Date(NOW.getTime() + MIN))).fired).toBe(0);
    // Ten minutes on, the early one's moment has come.
    expect((await cm.sweepCustomMilestones(new Date(NOW.getTime() + 11 * MIN))).fired).toBe(1);

    // Rescheduled: the reminder was about the old time, so it may go again.
    await fireEvent("rescheduled", "cm-before-due");
    expect((await fires(m.id)).some((f) => f.bookingId === "cm-before-due")).toBe(false);
    expect((await cm.sweepCustomMilestones(NOW)).fired).toBe(1);
    expect((await milestoneEvents("cm-before-due")).length).toBe(2);
    await cm.deleteMilestone(CO, m.id);
    expect((await fires(m.id)).length).toBe(0);
  });
});

describe("after completion", () => {
  it("fires a set time after the job is completed", async () => {
    const m = await cm.createMilestone(CO, { name: "Follow-up", trigger: "after_complete", offsetMinutes: 3 * 1440 }, toCustomer("How is everything?"));
    await job("cm-after-due", { status: "completed", finishedAt: new Date(NOW.getTime() - 3 * DAY - 5 * MIN) });
    await job("cm-after-early", { status: "completed", finishedAt: new Date(NOW.getTime() - 3 * DAY + 5 * MIN) });
    await job("cm-after-open", { status: "in_progress", finishedAt: new Date(NOW.getTime() - 3 * DAY - 5 * MIN) });
    expect((await cm.sweepCustomMilestones(NOW)).fired).toBe(1);
    expect((await milestoneEvents("cm-after-due")).length).toBe(1);
    expect((await milestoneEvents("cm-after-early")).length).toBe(0);
    expect((await milestoneEvents("cm-after-open")).length).toBe(0);
    await cm.deleteMilestone(CO, m.id);
  });
});

describe("never sends what it shouldn't", () => {
  it("a sample job gets the timeline line and no message", async () => {
    const m = await cm.createMilestone(CO, { name: "Sample stage", trigger: "stage", triggerEvent: "completed" }, {
      client: { on: true, text: "Done!" },
      office: { on: true, text: "Done at {{address}}" },
    });
    await job("cm-sample", { isSample: true });
    await fireEvent("completed", "cm-sample");
    expect((await milestoneEvents("cm-sample")).length).toBe(1);
    expect((await deliveries(m.id)).length).toBe(0);
    await cm.deleteMilestone(CO, m.id);
  });

  it("nobody gets an empty message", async () => {
    const m = await cm.createMilestone(CO, { name: "No words", trigger: "stage", triggerEvent: "started" });
    // Every channel on for every recipient, but nothing written.
    await db
      .update(schema.notificationRules)
      .set({ inApp: true, email: true, sms: true })
      .where(eq(schema.notificationRules.event, customEventKey(m.id)));
    await job("cm-empty");
    await fireEvent("started", "cm-empty");
    expect((await milestoneEvents("cm-empty")).length).toBe(1);
    expect((await deliveries(m.id)).length).toBe(0);
    await cm.deleteMilestone(CO, m.id);
  });

  it("a test send delivers without using up the real one", async () => {
    const m = await cm.createMilestone(CO, { name: "Test me", trigger: "stage", triggerEvent: "arrived" }, toCustomer("hello"));
    await job("cm-test");
    expect(await cm.fireMilestone(m, "cm-test", { test: true })).toBe(true);
    expect((await deliveries(m.id, "cm-test")).length).toBeGreaterThan(0);
    expect((await milestoneEvents("cm-test")).length).toBe(0);
    expect((await fires(m.id)).length).toBe(0);
    await fireEvent("arrived", "cm-test");
    expect((await milestoneEvents("cm-test")).length).toBe(1);
    await cm.deleteMilestone(CO, m.id);
  });
});

describe("editing and deleting", () => {
  it("switching a recipient off keeps the words; deleting removes rules and the once-per-job record", async () => {
    const m = await cm.createMilestone(CO, { name: "Editable", trigger: "stage", triggerEvent: "arrived" }, toCustomer("first"));
    await cm.updateMilestone(CO, m.id, { name: "Edited" }, { client: { on: false, text: "first" }, office: { on: true, text: "for the office" } });
    let rules = await cm.milestoneRules(CO, m.id);
    const client = rules.find((r) => r.recipient === "client")!;
    expect([client.sms, client.inApp, client.template]).toEqual([false, false, "first"]);
    const office = rules.find((r) => r.recipient === "office")!;
    expect([office.inApp, office.template]).toEqual([true, "for the office"]);
    expect((await cm.getMilestone(CO, m.id))?.name).toBe("Edited");
    // Switching the trigger clears the fields it no longer uses.
    const moved = await cm.updateMilestone(CO, m.id, { trigger: "before_start", offsetMinutes: 60 });
    expect([moved?.triggerEvent, moved?.offsetMinutes]).toEqual(["", 60]);
    await expect(cm.updateMilestone(CO, m.id, { trigger: "checklist" })).rejects.toThrow("checklist");

    await job("cm-del");
    await cm.fireMilestone({ ...m, trigger: "stage" }, "cm-del");
    expect((await fires(m.id)).length).toBe(1);
    expect(await cm.deleteMilestone(CO, m.id)).toBe(true);
    rules = await cm.milestoneRules(CO, m.id);
    expect(rules.length).toBe(0);
    expect((await fires(m.id)).length).toBe(0);
    // The line it already put on the job's timeline stays.
    expect((await milestoneEvents("cm-del")).length).toBe(1);
    expect(await cm.deleteMilestone(CO, m.id)).toBe(false);
  });

  it("suggests checklist items from the company's templates", async () => {
    await db.insert(schema.taskTemplates).values([
      { companyId: CO, name: "Leak", checklist: JSON.stringify([{ id: "a", label: "Water restored" }, { id: "b", label: "Meter read" }]) },
      { companyId: CO, name: "Old", checklist: JSON.stringify(["water  restored", "Photos taken"]) },
      { companyId: OTHER, name: "Theirs", checklist: JSON.stringify([{ id: "c", label: "Secret step" }]) },
    ] as any);
    expect(await cm.checklistLabels(CO)).toEqual(["Meter read", "Photos taken", "Water restored"]);
  });
});
