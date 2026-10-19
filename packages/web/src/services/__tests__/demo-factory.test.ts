/**
 * Control Hub demo factory and the sales pack: a demo is a real tenant marked
 * "demo" with an end date and a sample day placed in the prospect's city;
 * reset, extend and convert do what they say; an expired demo stops
 * re-laying its day; the sales pack adds its meeting types once and moves
 * leads along. Provisioning (the slow, AI-assisted part) is stubbed with the
 * same rows it writes. Ids prefixed "df-".
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { PgTable } from "drizzle-orm/pg-core";
import { and, eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db, sdb } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { ensureTables } = await import("../../test-support/tables");
const df = await import("../demo-factory");
const sd = await import("../sample-day");
const sales = await import("../sales-pack");
const { isFeatureOn } = await import("../features");

const actor = { id: "df-owner", name: "Dan R." };

/** Stand-in for provisionCompany: the rows a real signup gets, no AI. */
const provision = (async (b: { name: string; slug?: string; industry?: string; plan?: string; adminEmail: string }) => {
  const id = b.slug!;
  await db.insert(schema.companies).values({ id, name: b.name, industry: b.industry ?? "", plan: b.plan ?? "starter" } as never);
  await db.insert(schema.companySettings).values({ id: `${id}-s`, companyId: id } as never);
  await db.insert(schema.user).values({ id: `${id}-admin`, name: `${b.name} Admin`, email: b.adminEmail, role: "admin", companyId: id } as never);
  await sd.seedSampleDay(id);
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
  return { company, admin: { id: `${id}-admin`, email: b.adminEmail }, manager: null, apiKey: { prefix: "", secret: "" }, seeded: {} };
}) as never;

const geocode = (async (q: string) => (q === "Nowhere" ? null : { lat: 51.0447, lng: -114.0719, address: "Calgary, AB, Canada", provider: "test" })) as never;

beforeAll(async () => {
  await ensureTables(...(Object.values(schema).filter((v) => v instanceof PgTable) as PgTable[]));
});

describe("createDemo", () => {
  it("makes a demo tenant with an end date, in the prospect's city", async () => {
    const d = await df.createDemo({ name: "Bow River Heating", industry: "hvac-plumbing", city: "Calgary", actor, provision, geocode });
    expect(d.id).toBe("demo-bow-river-heating");
    expect(d.located).toBe(true);
    const [co] = await sdb.select().from(schema.companies).where(eq(schema.companies.id, d.id));
    expect(co).toMatchObject({ kind: "demo", isInternal: true, officeAddress: "Calgary, AB, Canada", plan: "pro" });
    const days = (co!.demoExpiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    // demos get the new map and stay out of HubSpot
    expect(await isFeatureOn(d.id, "dispatch.map_v2")).toBe(true);
    expect(await isFeatureOn(d.id, "ops.hubspot_sync")).toBe(false);
    // the sample day moved with the office
    const techs = await sdb.select().from(schema.riders).where(and(eq(schema.riders.companyId, d.id), eq(schema.riders.isSample, true)));
    expect(techs.length).toBe(3);
    const jobs = await sdb.select().from(schema.bookings).where(and(eq(schema.bookings.companyId, d.id), eq(schema.bookings.isSample, true)));
    expect(jobs.every((j) => Math.abs(j.lat - 51.0447) < 0.5)).toBe(true);
  });
  it("picks a free id for a second demo with the same name", async () => {
    const d = await df.createDemo({ name: "Bow River Heating", industry: "hvac-plumbing", city: "Nowhere", actor, provision, geocode });
    expect(d.id).toBe("demo-bow-river-heating-2");
    expect(d.located).toBe(false);
  });
  it("refuses an unknown industry or an over-long run", async () => {
    await expect(df.createDemo({ name: "X Co", industry: "nope", actor, provision })).rejects.toMatchObject({ code: "bad_industry" });
    await expect(df.createDemo({ name: "X Co", industry: "hvac-plumbing", days: 400, actor, provision })).rejects.toMatchObject({ code: "bad_days" });
  });
});

describe("running a demo", () => {
  it("resets the sample day", async () => {
    const r = await df.resetDemo("demo-bow-river-heating", actor);
    expect(r).toMatchObject({ ok: true, jobs: 8, techs: 3 });
  });
  it("extends the end date", async () => {
    const r = await df.extendDemo("demo-bow-river-heating", 60, actor);
    expect(new Date(r.expiresAt).getTime() - Date.now()).toBeGreaterThan(59 * 86_400_000);
  });
  it("stops re-laying the day once it has ended", async () => {
    const id = "demo-bow-river-heating-2";
    await sdb.update(schema.companies).set({ demoExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.companies.id, id));
    expect(await sd.refreshSampleDay(id, new Date(Date.now() + 13 * 3_600_000))).toBe(false);
  });
  it("turns into a customer, clearing sample data", async () => {
    await df.convertDemo("demo-bow-river-heating-2", {}, actor);
    const [co] = await sdb.select().from(schema.companies).where(eq(schema.companies.id, "demo-bow-river-heating-2"));
    expect(co).toMatchObject({ kind: "customer", isInternal: false, demoExpiresAt: null });
    const left = await sdb.select().from(schema.bookings).where(and(eq(schema.bookings.companyId, "demo-bow-river-heating-2"), eq(schema.bookings.isSample, true)));
    expect(left.length).toBe(0);
    await expect(df.resetDemo("demo-bow-river-heating-2", actor)).rejects.toMatchObject({ code: "not_demo" });
  });
  it("records each step in the platform audit", async () => {
    const rows = await sdb.select().from(schema.platformAudit).where(eq(schema.platformAudit.companyId, "demo-bow-river-heating"));
    expect(rows.map((r) => r.action).sort()).toEqual(["demo.create", "demo.extend", "demo.reset"]);
  });
});

describe("sales pack", () => {
  it("adds the four meeting types to our own tenant once", async () => {
    const a = await sales.installSalesPack(actor);
    expect(a.added).toEqual(["Sales meeting", "Lunch", "Sales call", "Demo visit"]);
    const b = await sales.installSalesPack(actor);
    expect(b.added).toEqual([]);
    expect(b.services.map((s) => s.name)).toEqual(["Sales meeting", "Lunch", "Sales call", "Demo visit"]);
  });
  it("moves a lead along and logs it", async () => {
    await sdb.insert(schema.contactRequests).values({ id: "df-lead", name: "Pat Plumber", company: "Pat's Plumbing", email: "pat@pp.test" });
    const row = await sales.setLeadStatus("df-lead", "booked", actor, "Lunch Tuesday");
    expect(row?.status).toBe("booked");
    const [a] = await sdb.select().from(schema.platformAudit).where(eq(schema.platformAudit.entityId, "df-lead"));
    expect(a?.summary).toBe("Pat Plumber (Pat's Plumbing) marked booked: Lunch Tuesday");
    expect(await sales.setLeadStatus("df-missing", "closed", actor)).toBeNull();
  });
});
