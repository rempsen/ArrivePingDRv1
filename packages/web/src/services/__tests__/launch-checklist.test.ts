/**
 * The Launch checklist ticks from real data only: the sample day must never
 * tick anything, an admin who happens to carry a rider profile is not "a
 * technician who signed in", and channel toggles are not "editing a message".
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { computeLaunchChecklist } = await import("../launch-checklist");
const { seedSampleDay } = await import("../sample-day");
const { notifConfigRoutes } = await import("../../api/routes/notif-config");

const CO = "launch-co";
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

const state = async () => {
  const r = await computeLaunchChecklist(CO);
  return Object.fromEntries(r.items.map((i) => [i.id, i.waiting ? "waiting" : i.done]));
};

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTable(v);
  await db.insert(schema.companies).values({ id: CO, name: "Launch Co", officeLat: 49.9, officeLng: -97.1 });
  await db.insert(schema.companySettings).values({ id: CO, companyId: CO } as any);
  await db.insert(schema.user).values({ id: "lc-admin", companyId: CO, name: "Admin", email: "lc-admin@real.test", role: "admin" } as any);
  await db.insert(schema.memberships).values({ id: "lc-m-admin", userId: "lc-admin", companyId: CO, role: "admin", status: "active" } as any);
});

describe("launch checklist", () => {
  it("starts empty, and a sample day ticks nothing", async () => {
    expect(await state()).toEqual({ "first-job": false, "invite-tech": false, "live-eta": false, "reply-to": false, "milestone-copy": false });
    expect((await seedSampleDay(CO, { now: NOW })).seeded).toBe(true);
    expect(await state()).toEqual({ "first-job": false, "invite-tech": false, "live-eta": false, "reply-to": false, "milestone-copy": false });
  });

  it("an admin with a rider profile who signs in is not a technician", async () => {
    await db.insert(schema.riders).values({ id: "lc-r-admin", companyId: CO, userId: "lc-admin", locationUpdatedAt: NOW } as any);
    await db.insert(schema.session).values({ id: "lc-s-admin", userId: "lc-admin", token: "lc-t-admin", expiresAt: new Date(NOW.getTime() + 864e5) } as any);
    expect((await state())["invite-tech"]).toBe(false);
  });

  it("first real job ticks", async () => {
    const svc = (await db.select().from(schema.services))[0]!;
    await db.insert(schema.user).values({ id: "lc-cust", companyId: CO, name: "Real Cust", email: "lc-cust@real.test", role: "customer" } as any);
    await db.insert(schema.bookings).values({ id: "lc-job", companyId: CO, customerId: "lc-cust", serviceId: svc.id, status: "pending", scheduledAt: NOW, address: "1 Real St" });
    expect((await state())["first-job"]).toBe(true);
  });

  it("inviting office staff doesn't put the technician step in waiting", async () => {
    await db.insert(schema.techInvites).values({ id: "lc-inv-office", companyId: CO, email: "dispatch@real.test", role: "dispatcher", status: "pending" } as any);
    expect((await state())["invite-tech"]).toBe(false);
  });

  it("an existing login invited as a technician is 'waiting'", async () => {
    await db.insert(schema.user).values({ id: "lc-tech-x", companyId: "other-co", name: "Shared Tech", email: "lc-tech-x@real.test", role: "rider" } as any);
    await db.insert(schema.memberships).values({ id: "lc-m-tech-x", userId: "lc-tech-x", companyId: CO, role: "rider", status: "invited" } as any);
    await db.insert(schema.riders).values({ id: "lc-r-tech-x", companyId: CO, userId: "lc-tech-x" } as any);
    expect((await state())["invite-tech"]).toBe("waiting");
    // Their sessions from the other company don't count while still invited here.
    await db.insert(schema.session).values({ id: "lc-s-tech-x", userId: "lc-tech-x", token: "lc-t-tech-x", userAgent: "ArrivePing/1.0 CFNetwork", expiresAt: new Date(NOW.getTime() + 864e5) } as any);
    expect((await state())["invite-tech"]).toBe("waiting");
  });

  it("a new technician is 'waiting' until they sign in themselves, not when the server provisions them", async () => {
    await db.insert(schema.user).values({ id: "lc-tech", companyId: CO, name: "Real Tech", email: "lc-tech@real.test", role: "rider" } as any);
    await db.insert(schema.memberships).values({ id: "lc-m-tech", userId: "lc-tech", companyId: CO, role: "rider", status: "active" } as any);
    await db.insert(schema.riders).values({ id: "lc-r-tech", companyId: CO, userId: "lc-tech" } as any);
    expect((await state())["invite-tech"]).toBe("waiting");
    // Adding a technician signs the new login in on the server: no user agent.
    await db.insert(schema.session).values({ id: "lc-s-prov", userId: "lc-tech", token: "lc-t-prov", userAgent: "", expiresAt: new Date(NOW.getTime() + 864e5) } as any);
    expect((await state())["invite-tech"]).toBe("waiting");
    // They sign in on their phone.
    await db.insert(schema.session).values({ id: "lc-s-tech", userId: "lc-tech", token: "lc-t-tech", userAgent: "ArrivePing/1.0 CFNetwork/1568 Darwin/24.0.0", expiresAt: new Date(NOW.getTime() + 864e5) } as any);
    expect((await state())["invite-tech"]).toBe(true);
  });

  it("a push token on the technician's phone also counts as signed in", async () => {
    await db.delete(schema.session).where(eq(schema.session.id, "lc-s-tech"));
    expect((await state())["invite-tech"]).toBe("waiting");
    await db.insert(schema.pushTokens).values({ id: "lc-pt", companyId: CO, userId: "lc-tech", token: "ExponentPushToken[lc]" } as any);
    expect((await state())["invite-tech"]).toBe(true);
  });

  it("a delivered on-the-way message on a real job ticks the live ETA", async () => {
    await db.insert(schema.notificationDeliveries).values({ companyId: CO, event: "enroute", bookingId: "lc-job", recipient: "client", channel: "sms", status: "failed" } as any);
    expect((await state())["live-eta"]).toBe(false);
    await db.insert(schema.notificationDeliveries).values({ companyId: CO, event: "enroute", bookingId: "lc-job", recipient: "client", channel: "sms", status: "sent" } as any);
    expect((await state())["live-eta"]).toBe(true);
  });

  it("a reply-to address ticks", async () => {
    await db.insert(schema.notificationChannels).values({ id: "lc-nc", companyId: CO, emailReplyTo: "office@launch.test" } as any);
    expect((await state())["reply-to"]).toBe(true);
  });

  it("editing a message's words ticks; toggling a channel doesn't", async () => {
    await db.insert(schema.notificationRules).values({ id: "lc-rule", companyId: CO, event: "enroute", recipient: "client", sms: false, template: "Seeded copy" } as any);
    const app = new Hono<any>().use("*", async (c, next) => {
      c.set("companyId", CO);
      c.set("user", { id: "lc-admin", role: "admin", name: "Admin" });
      return next();
    });
    app.route("/notif-config", notifConfigRoutes);
    const patch = (body: unknown) =>
      app.request("/notif-config/rules/lc-rule", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await patch({ sms: true })).status).toBe(200);
    expect((await patch({ template: "Seeded copy" })).status).toBe(200); // same words: not an edit
    expect((await state())["milestone-copy"]).toBe(false);
    expect((await patch({ template: "Hi {{firstName}}, {{techName}} is on the way: {{trackUrl}}" })).status).toBe(200);
    expect((await state())["milestone-copy"]).toBe(true);
  });

  it("complete once all five are done, with the setup group alongside", async () => {
    const r = await computeLaunchChecklist(CO);
    expect(r.complete).toBe(true);
    expect(r.setup.map((s) => s.id)).toEqual(["industry", "service-area", "catalog", "forms", "templates", "team"]);
    expect(r.setup.find((s) => s.id === "team")!.done).toBe(true);
  });
});
