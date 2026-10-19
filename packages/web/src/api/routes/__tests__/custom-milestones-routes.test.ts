/**
 * The Notifications API for custom milestones: create, list, edit, delete,
 * the milestone's row in the rules table, its editor, and its Test button.
 * Each company only ever sees and changes its own.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.RESEND_API_KEY = "";
process.env.TWILIO_ACCOUNT_SID = "";
process.env.TWILIO_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { notifConfigRoutes } = await import("../notif-config");
const { AppError } = await import("../../lib/errors");
const { computeLaunchChecklist } = await import("../../../services/launch-checklist");

const CO = "cmr-co";
const OTHER = "cmr-other";

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", c.req.header("X-Test-Company") || CO);
  const role = c.req.header("X-Test-Role") || "admin";
  c.set("user", { id: `cmr-${role}`, role, email: `${role}@example.test`, name: role } as any);
  return next();
});
app.route("/n", notifConfigRoutes);
// As in the real app: a validation error is a 400 with its message.
app.onError((err, c) =>
  err instanceof AppError
    ? c.json({ message: err.message }, err.status as 400)
    : c.json({ message: String((err as Error).message) }, 500),
);

const call = (method: string, path: string, body?: unknown, co = CO, role = "admin") =>
  app.request(`/n${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Test-Company": co, "X-Test-Role": role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

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

beforeAll(async () => {
  for (const v of Object.values(schema)) {
    if (v instanceof PgTable) await ensureTable(v);
  }
  await (db as any).$client.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS custom_milestone_fire_once_uidx ON custom_milestone_fires (milestone_id, booking_id)`,
  );
  await db.insert(schema.companies).values([
    { id: CO, name: "Route Co" },
    { id: OTHER, name: "Other Co" },
  ] as any);
  await db.insert(schema.bookings).values({
    id: "cmr-job",
    companyId: CO,
    customerId: "cmr-nobody",
    serviceId: "cmr-svc",
    status: "assigned",
    scheduledAt: new Date(),
    address: "1 Test St",
    publicToken: "cmr-tok",
    price: 0,
  } as any);
  await db.insert(schema.bookings).values({
    id: "cmr-their-job",
    companyId: OTHER,
    customerId: "cmr-nobody",
    serviceId: "cmr-svc",
    status: "assigned",
    scheduledAt: new Date(),
    address: "2 Test St",
    publicToken: "cmr-tok2",
    price: 0,
  } as any);
});

const create = (body: Record<string, unknown>, co = CO) => call("POST", "/custom", body, co);

describe("custom milestones API", () => {
  let id = "";

  it("creates one, with a plain-English summary and its messages", async () => {
    const res = await create({
      name: "Water restored",
      trigger: "checklist",
      checklistLabel: "Water restored",
      customerTimeline: true,
      messages: { client: { on: true, text: "Water is back on, {{firstName}}." }, tech: { on: false, text: "" } },
    });
    expect(res.status).toBe(201);
    const { milestone } = (await res.json()) as any;
    id = milestone.id;
    expect(milestone.summary).toBe("When the tech ticks “Water restored”");
    expect(milestone.event).toBe(`custom:${id}`);
    expect(milestone.messages.client).toEqual({ on: true, text: "Water is back on, {{firstName}}.", designed: false });
    expect(milestone.messages.tech.on).toBe(false);
    // Writing a milestone of your own counts as making the messages yours.
    const launch = await computeLaunchChecklist(CO);
    expect(launch.items.find((i: any) => i.id === "milestone-copy")?.done).toBe(true);
  });

  it("refuses what would not work, in words", async () => {
    const bad = async (body: Record<string, unknown>) => {
      const res = await create(body);
      expect(res.status).toBe(400);
      return ((await res.json()) as any).message as string;
    };
    expect(await bad({ name: "", trigger: "stage", triggerEvent: "arrived" })).toContain("Name");
    expect(await bad({ name: "X", trigger: "stage", triggerEvent: "created" })).toContain("moment");
    expect(await bad({ name: "X", trigger: "before_start", offsetMinutes: 1 })).toContain("5 minutes");
    expect(await bad({ name: "X", trigger: "sometime" })).toBeTruthy();
    expect(
      await bad({ name: "X", trigger: "stage", triggerEvent: "arrived", messages: { office: { on: true, text: "  " } } }),
    ).toBe("Write the message for the office, or untick them.");
  });

  it("lists it with checklist suggestions, stages and the insertable details", async () => {
    const res = await call("GET", "/custom");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.milestones.map((m: any) => m.name)).toEqual(["Water restored"]);
    expect(body.stages.length).toBeGreaterThan(5);
    expect(body.vars.some((v: any) => v.key === "firstName")).toBe(true);
    expect(Array.isArray(body.checklistLabels)).toBe(true);
  });

  it("appears in the rules table after the built-in events, with all three recipient rows", async () => {
    const res = await call("GET", "/rules");
    const body = (await res.json()) as any;
    const last = body.events[body.events.length - 1];
    expect(last).toMatchObject({ event: `custom:${id}`, label: "Water restored", custom: true, enabled: true });
    expect(body.events[0].custom).toBeUndefined();
    const rows = body.rules.filter((r: any) => r.event === `custom:${id}`);
    expect(rows.length).toBe(3);
  });

  it("opens in the message editor with no built-in copy to fall back on", async () => {
    const res = await call("GET", `/events/${encodeURIComponent(`custom:${id}`)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.meta.label).toBe("Water restored");
    expect(body.defaults).toEqual({ client: "", tech: "", office: "" });
    expect(body.custom.summary).toContain("Water restored");
    expect((await call("GET", `/events/${encodeURIComponent("custom:nope")}`)).status).toBe(404);
  });

  it("Test sends the messages to the person testing only, and leaves the job alone", async () => {
    const eventsBefore = (await db.select().from(schema.jobEvents).where(eq(schema.jobEvents.bookingId, "cmr-job"))).length;
    const res = await call("POST", `/test/${encodeURIComponent(`custom:${id}`)}`, { phone: "(204) 777-0123", email: "me@example.test" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results.length).toBeGreaterThan(0);
    for (const r of body.results) expect(["(204) 777-0123", "me@example.test"]).toContain(r.target);
    // Texting isn't set up in tests: the result says so in words, not silence.
    const sms = body.results.find((r: any) => r.channel === "sms");
    if (sms) expect(sms.detail).toMatch(/isn't set up/);
    // Nothing on the job: the real milestone is still to come, and no timeline line.
    const fires = await db.select().from(schema.customMilestoneFires).where(eq(schema.customMilestoneFires.milestoneId, id));
    expect(fires.length).toBe(0);
    const eventsAfter = (await db.select().from(schema.jobEvents).where(eq(schema.jobEvents.bookingId, "cmr-job"))).length;
    expect(eventsAfter).toBe(eventsBefore);
    // Every logged test delivery went to the tester.
    const logged = await db.select().from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.event, `custom:${id}`));
    for (const d of logged) expect(["(204) 777-0123", "me@example.test"]).toContain(d.target);
    // The delivery log names it the way people know it.
    await db.insert(schema.notificationDeliveries).values([
      { companyId: CO, event: `custom:${id}`, bookingId: "cmr-job", recipient: "client", channel: "sms", status: "skipped" },
      { companyId: CO, event: "enroute", bookingId: "cmr-job", recipient: "client", channel: "sms", status: "skipped" },
    ] as any);
    const log = (await (await call("GET", "/deliveries")).json()) as any;
    const labels = log.deliveries.map((d: any) => d.eventLabel);
    expect(labels).toContain("Water restored");
    expect(labels).toContain("En route (on the way)");
  });

  it("Test asks for somewhere to send it, and a real mobile number", async () => {
    const none = await call("POST", "/test/enroute", {});
    expect(none.status).toBe(400);
    expect(((await none.json()) as any).message).toMatch(/mobile number or email/);
    const short = await call("POST", "/test/enroute", { phone: "555-1234" });
    expect(short.status).toBe(400);
    expect(((await short.json()) as any).message).toMatch(/area code/);
    const ok = await call("POST", "/test/enroute", { phone: "+1 204 777 0123" });
    expect(ok.status).toBe(200);
  });

  it("Test says why a text didn't go: texts switched off, or a sample number", async () => {
    await db.insert(schema.notificationRules).values({ companyId: CO, event: "arrived", recipient: "office", sms: true, enabled: true } as any);
    const sample = (await (await call("POST", "/test/arrived", { phone: "(204) 555-0142" })).json()) as any;
    expect(sample.results.find((r: any) => r.channel === "sms").detail).toMatch(/sample number/);
    const [existing] = await db.select().from(schema.notificationChannels).where(eq(schema.notificationChannels.companyId, CO));
    if (existing) await db.update(schema.notificationChannels).set({ smsEnabled: false }).where(eq(schema.notificationChannels.companyId, CO));
    else await db.insert(schema.notificationChannels).values({ id: "cmr-channels", companyId: CO, smsEnabled: false } as any);
    const off = (await (await call("POST", "/test/arrived", { phone: "(204) 777-0123" })).json()) as any;
    expect(off.results.find((r: any) => r.channel === "sms")).toMatchObject({ status: "skipped", detail: expect.stringMatching(/switched off/) });
    await db.update(schema.notificationChannels).set({ smsEnabled: true }).where(eq(schema.notificationChannels.companyId, CO));
  });

  it("edits, pauses and reports the change", async () => {
    const res = await call("PATCH", `/custom/${id}`, {
      name: "Water back on",
      enabled: false,
      messages: { office: { on: true, text: "#{{shortId}} has water again" } },
    });
    expect(res.status).toBe(200);
    const { milestone } = (await res.json()) as any;
    expect([milestone.name, milestone.enabled, milestone.messages.office.on]).toEqual(["Water back on", false, true]);
    // A recipient whose message is a designed email can stay on with no text.
    await db
      .update(schema.notificationRules)
      .set({ emailDesign: JSON.stringify([{ type: "text", text: "Hi" }]), email: true, template: "" })
      .where(eq(schema.notificationRules.event, `custom:${id}`));
    const view = (await (await call("GET", "/custom")).json()) as any;
    expect(view.milestones[0].messages.tech).toMatchObject({ designed: true });
    const designedOnly = await call("PATCH", `/custom/${id}`, { name: "Water back on", messages: { tech: { on: true, text: "" } } });
    expect(designedOnly.status).toBe(200);
    expect((await call("PATCH", `/custom/${id}`, { trigger: "after_complete" })).status).toBe(400);
    expect((await call("PATCH", `/custom/${id}`, {})).status).toBe(400);
  });

  it("another company can't see, edit, test or delete it", async () => {
    const list = (await (await call("GET", "/custom", undefined, OTHER)).json()) as any;
    expect(list.milestones.length).toBe(0);
    expect((await call("PATCH", `/custom/${id}`, { name: "Mine now" }, OTHER)).status).toBe(404);
    expect((await call("DELETE", `/custom/${id}`, undefined, OTHER)).status).toBe(404);
    expect((await call("POST", `/test/${encodeURIComponent(`custom:${id}`)}`, {}, OTHER)).status).toBe(404);
    const rules = (await (await call("GET", "/rules", undefined, OTHER)).json()) as any;
    expect(rules.events.some((e: any) => e.custom)).toBe(false);
  });

  it("a technician can't manage milestones", async () => {
    expect((await call("GET", "/custom", undefined, CO, "rider")).status).toBe(403);
  });

  it("deletes it with its rules", async () => {
    expect((await call("DELETE", `/custom/${id}`)).status).toBe(200);
    const left = await db.select().from(schema.notificationRules).where(eq(schema.notificationRules.event, `custom:${id}`));
    expect(left.length).toBe(0);
    expect((await call("DELETE", `/custom/${id}`)).status).toBe(404);
    const rules = (await (await call("GET", "/rules")).json()) as any;
    expect(rules.events.some((e: any) => e.custom)).toBe(false);
  });
});
