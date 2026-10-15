/**
 * The sales demo has to look live at any hour: today's board busy and on time,
 * the next seven days booked, emergencies coming in after hours, and nothing
 * ever "running late". These run the real refresh against an in-memory
 * Postgres seeded the way the original Prairie Comfort HVAC seed left it —
 * a week of jobs that are now all in the past.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { getTableConfig, type PgColumn } from "drizzle-orm/pg-core";
import { eq, like } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
delete process.env.DEMO_TENANT_ID;
delete process.env.DEMO_REFRESH;

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { demoTick, demoHealth, resetDemoCaches, stableId } = await import("../demo-refresh");
const { zonedDayKey, zonedParts, zonedTimeToInstant } = await import("../../shared/tz");
const { addDays, dayOfWeek } = await import("../../shared/demo-plan");

const CO = "prairie-comfort-hvac";
const OTHER = "someone-else";
const TZ = "America/Winnipeg";
const MIN = 60_000;

function ddlFor(table: any): string {
  const cfg = getTableConfig(table);
  const cols = cfg.columns.map((col: PgColumn) => {
    const parts = [`"${col.name}"`, col.getSQLType()];
    if (col.primary) parts.push("PRIMARY KEY");
    const dflt = (col as any).default;
    let lit: string | null = null;
    if (dflt !== undefined) {
      lit =
        typeof dflt === "string" ? `'${dflt.replace(/'/g, "''")}'`
        : typeof dflt === "boolean" ? (dflt ? "TRUE" : "FALSE")
        : typeof dflt === "number" ? String(dflt)
        : null;
    }
    if (col.notNull && (lit !== null || col.primary)) parts.push("NOT NULL");
    if (lit !== null) parts.push(`DEFAULT ${lit}`);
    return parts.join(" ");
  });
  return `CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cols.join(", ")})`;
}

const TECHS = ["Jordan Park", "Aisha Khan", "Liam Dubois", "Priya Sandhu", "Marcus Bell", "Elena Kowalski"];
const TITLES = [
  "Furnace tune-up", "No heat — igniter replacement", "Smart thermostat install", "AC seasonal shutdown",
  "Humidifier pad replacement", "Boiler annual service", "HRV maintenance", "Carbon monoxide safety check",
  "Ductless mini-split service", "No heat — furnace not igniting", "Gas line inspection", "Water heater flush",
  "Heat pump install consult", "Furnace filter + IAQ check", "Thermostat not responding",
  "Draft complaint — duct balancing", "Fireplace insert service", "Furnace replacement — day 1",
  "Humidifier install", "Boiler pressure issue", "Furnace making noise", "Gas fireplace annual service",
  "Ductwork cleaning estimate", "Heat pump install", "No heat — pilot keeps going out",
  "Water heater replacement quote", "Air quality assessment",
];
const SERVICES: Array<[string, number, RegExp]> = [
  ["Furnace Tune-Up", 60, /tune-up/i],
  ["Smart Thermostat Install", 60, /thermostat/i],
  ["Heat Pump Consultation", 45, /heat pump/i],
  ["Boiler Service", 90, /boiler/i],
  ["Water Heater Install", 180, /water heater/i],
  ["AC Repair", 90, /\bAC\b|mini-split/i],
  ["Indoor Air Quality Check", 60, /air quality|IAQ|HRV|humidifier|duct/i],
  ["Seasonal Maintenance", 60, /seasonal|fireplace|carbon|gas line/i],
  ["Furnace Repair", 90, /./],
];

/** A Thursday morning in Winnipeg, a week after the original seed ran. */
const NOW = zonedTimeToInstant(TZ, 2026, 10, 15, 10, 5);
const local = (d: Date) => zonedParts(d, TZ);
const localMins = (d: Date) => local(d).hour * 60 + local(d).minute;

async function managed() {
  return db.select().from(schema.bookings).where(like(schema.bookings.fieldData, '%"\\_\\_demo"%'));
}

beforeAll(async () => {
  const s = (db as any).$client;
  for (const t of [
    schema.companies, schema.companySettings, schema.bookings, schema.services, schema.riders,
    schema.user, schema.memberships, schema.invoices, schema.jobEvents, schema.notificationChannels,
  ]) {
    await s.execute(ddlFor(t));
  }
  await db.insert(schema.companies).values([
    { id: CO, name: "Prairie Comfort HVAC", officeLat: 49.88, officeLng: -97.15 },
    { id: OTHER, name: "Real Customer Co" },
  ]);
  await db.insert(schema.companySettings).values({ id: "s1", companyId: CO } as any);
  await db.insert(schema.notificationChannels).values({ id: "nc1", companyId: CO, emailEnabled: true, smsEnabled: true });

  const svcId = new Map<string, string>();
  for (const [name, dur] of SERVICES) {
    const id = `svc-${name}`;
    svcId.set(name, id);
    await db.insert(schema.services).values({ id, companyId: CO, name, category: "HVAC", durationMins: dur, basePrice: 150 });
  }
  for (const [i, name] of TECHS.entries()) {
    await db.insert(schema.user).values({ id: `u-${i}`, companyId: CO, name, email: `t${i}@t.test`, role: "rider" } as any);
    await db.insert(schema.riders).values({ id: `r-${i}`, companyId: CO, userId: `u-${i}`, status: "offline" });
  }
  // The original seed: one job per title, 25 customers, all dated a week ago and
  // several left in live statuses — exactly what made the board show "late".
  const weekAgo = NOW.getTime() - 7 * 24 * 3_600_000;
  for (const [i, title] of TITLES.entries()) {
    const c = i % 25;
    await db.insert(schema.user).values({ id: `cust-${c}`, companyId: CO, name: `Customer ${c}`, email: `c${c}@t.test`, role: "customer" } as any).onConflictDoNothing();
    const svc = SERVICES.find(([, , re]) => re.test(title))![0];
    await db.insert(schema.bookings).values({
      id: `legacy-${i}`,
      companyId: CO,
      customerId: `cust-${c}`,
      serviceId: svcId.get(svc)!,
      riderId: i % 7 === 3 ? null : `r-${i % 6}`,
      title,
      status: i % 3 === 0 ? "completed" : i % 3 === 1 ? "assigned" : "confirmed",
      scheduledAt: new Date(weekAgo + i * 3_600_000),
      address: `${100 + c} Test St, Winnipeg, MB`,
      lat: 49.86 + c * 0.002,
      lng: -97.18 + c * 0.002,
      notes: `Homeowner notes for ${title}`,
      lineItems: JSON.stringify([{ name: "Part", unitPrice: 40, qty: 1 }]),
      subtotal: 189,
      taxAmount: 22.68,
      total: 211.68,
      region: "MB",
      delayFlaggedAt: i % 3 === 1 ? new Date(weekAgo) : null,
    });
  }
  // Another tenant's job must never be touched.
  await db.insert(schema.bookings).values({
    id: "other-job", companyId: OTHER, customerId: "cust-0", serviceId: svcId.get("Furnace Repair")!,
    title: "Their job", status: "assigned", scheduledAt: new Date(weekAgo), address: "1 Other St",
  });
  resetDemoCaches();
});

describe("demo refresh — first run on a stale demo", () => {
  let report: Awaited<ReturnType<typeof demoTick>>;
  beforeAll(async () => {
    report = await demoTick({ now: NOW, tidy: true });
  });

  it("finds the demo tenant by name and fills the window", () => {
    expect(report.companyId).toBe(CO);
    expect(report.created).toBeGreaterThan(100);
  });

  it("books today and every one of the next seven days, weekends included", async () => {
    const rows = await managed();
    const days = new Set(rows.map((b) => zonedDayKey(new Date(b.scheduledAt), TZ)));
    const today = zonedDayKey(NOW, TZ);
    for (let i = 0; i <= 7; i++) expect(days.has(addDays(today, i))).toBe(true);
    const weekendJobs = rows.filter((b) => {
      const d = zonedDayKey(new Date(b.scheduledAt), TZ);
      return [0, 6].includes(dayOfWeek(d)) && !b.title.startsWith("Emergency");
    });
    expect(weekendJobs.length).toBeGreaterThan(4);
  });

  it("keeps regular work between 8:00 a.m. and 6:30 p.m.", async () => {
    for (const b of await managed()) {
      if (b.priority === "urgent") continue;
      const start = localMins(new Date(b.scheduledAt));
      const svc = SERVICES.find(([n]) => `svc-${n}` === b.serviceId)!;
      expect(start).toBeGreaterThanOrEqual(8 * 60);
      expect(start + svc[1]).toBeLessThanOrEqual(18 * 60 + 30);
    }
  });

  it("has after-hours emergencies — past ones done, future ones not called in yet", async () => {
    const rows = await managed();
    const em = rows.filter((b) => b.title.startsWith("Emergency"));
    const night = em.filter((b) => { const m = localMins(new Date(b.scheduledAt)); return m >= 19 * 60 || m < 8 * 60; });
    expect(night.length).toBeGreaterThanOrEqual(4); // last night's calls
    for (const b of em) {
      expect(b.priority).toBe("urgent");
      // a call only exists once it has "come in" (≤ 50 min before the tech is due)
      expect(new Date(b.scheduledAt).getTime() - NOW.getTime()).toBeLessThanOrEqual(50 * MIN);
    }
  });

  it("shows nothing late: every job that should have started has started", async () => {
    for (const b of await managed()) {
      const started = new Date(b.scheduledAt).getTime() <= NOW.getTime();
      if (started) expect(["in_progress", "completed"]).toContain(b.status);
      else expect(["confirmed", "assigned", "enroute"]).toContain(b.status);
      expect(b.delayFlaggedAt).toBeNull();
    }
    const h = await demoHealth(NOW);
    expect(h.enabled).toBe(true);
    if (h.enabled) {
      expect(h.late).toBe(0);
      expect(h.emptyDays).toEqual([]);
      expect(h.activeNow).toBeGreaterThan(0);
      expect(h.healthy).toBe(true);
    }
  });

  it("closes out the old seed's stuck jobs and clears their late flags", async () => {
    const legacy = await db.select().from(schema.bookings).where(like(schema.bookings.id, "legacy-%"));
    for (const b of legacy) {
      if (b.deletedAt) { expect(b.riderId).toBeNull(); continue; }
      expect(b.status).toBe("completed");
      expect(b.delayFlaggedAt).toBeNull();
    }
    expect(report.closedLegacy).toBeGreaterThan(0);
  });

  it("puts the on-shift crew on the map with a fresh heartbeat", async () => {
    const riders = await db.select().from(schema.riders);
    const fresh = riders.filter((r) => r.locationUpdatedAt && Number(r.locationUpdatedAt) === NOW.getTime());
    expect(fresh.length).toBeGreaterThanOrEqual(4);
    for (const r of fresh) expect(["available", "enroute", "onsite"]).toContain(r.status);
  });

  it("copies content from the tenant's own jobs and never leaks the marker into notes", async () => {
    const rows = await managed();
    const tune = rows.find((b) => b.title === "Furnace tune-up")!;
    expect(tune.notes).toBe("Homeowner notes for Furnace tune-up");
    expect(tune.total).toBeCloseTo(211.68);
    expect(JSON.parse(tune.fieldData).__demo).toMatch(/^\d{4}-\d{2}-\d{2}\|/);
  });

  it("keeps email and SMS off for the demo tenant and leaves other tenants alone", async () => {
    const [ch] = await db.select().from(schema.notificationChannels).where(eq(schema.notificationChannels.companyId, CO));
    expect(ch!.smsEnabled).toBe(false);
    expect(ch!.emailEnabled).toBe(false);
    const [other] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, "other-job"));
    expect(other!.status).toBe("assigned");
  });
});

describe("demo refresh — later ticks", () => {
  it("is idempotent: running again at the same moment creates nothing", async () => {
    const before = (await managed()).length;
    const r = await demoTick({ now: NOW });
    expect(r.created).toBe(0);
    expect((await managed()).length).toBe(before);
  });

  it("moves jobs forward through the day and logs a clean timeline", async () => {
    const later = new Date(NOW.getTime() + 3 * 3_600_000);
    await demoTick({ now: later });
    const rows = await managed();
    for (const b of rows) {
      if (new Date(b.scheduledAt).getTime() <= later.getTime()) expect(["in_progress", "completed"]).toContain(b.status);
    }
    const done = rows.find((b) => b.status === "completed" && b.riderId)!;
    const ev = await db.select().from(schema.jobEvents).where(eq(schema.jobEvents.bookingId, done.id));
    const kinds = ev.map((e) => e.kind);
    for (const k of ["created", "assigned", "enroute", "arrived", "started", "completed"]) expect(kinds).toContain(k);
    expect(new Set(kinds).size).toBe(kinds.length); // no duplicates after repeated ticks
  });

  it("hands unassigned work to a tech 90 minutes before it starts", async () => {
    const today = zonedDayKey(NOW, TZ);
    const [u] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, stableId(`demo|${CO}|${today}|U2`)));
    expect(u).toBeDefined();
    if (!u) return;
    const startMs = new Date(u.scheduledAt).getTime();
    await demoTick({ now: new Date(startMs - 120 * MIN) });
    let [b] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, u.id));
    expect(b!.riderId).toBeNull();
    await demoTick({ now: new Date(startMs - 80 * MIN) });
    [b] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, u.id));
    expect(b!.riderId).not.toBeNull();
    expect(b!.status).toBe("assigned");
  });

  it("rolls forward: a day later, a new eighth day appears", async () => {
    const tomorrow = new Date(NOW.getTime() + 24 * 3_600_000);
    const r = await demoTick({ now: tomorrow });
    expect(r.created).toBeGreaterThan(0);
    const days = new Set((await managed()).map((b) => zonedDayKey(new Date(b.scheduledAt), TZ)));
    expect(days.has(addDays(zonedDayKey(tomorrow, TZ), 7))).toBe(true);
    const h = await demoHealth(tomorrow);
    if (h.enabled) expect(h.late).toBe(0);
  });

  it("never undoes a change made by hand during a demo", async () => {
    const future = (await managed()).find((b) => b.status === "assigned" && new Date(b.scheduledAt).getTime() > NOW.getTime() + 24 * 3_600_000)!;
    await db.update(schema.bookings).set({ status: "cancelled" }).where(eq(schema.bookings.id, future.id));
    await demoTick({ now: new Date(new Date(future.scheduledAt).getTime() + 5 * 3_600_000) });
    const [b] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, future.id));
    expect(b!.status).toBe("cancelled");
  });

  it("does nothing when switched off", async () => {
    process.env.DEMO_REFRESH = "off";
    resetDemoCaches();
    const r = await demoTick({ now: NOW });
    expect(r.companyId).toBeNull();
    delete process.env.DEMO_REFRESH;
    resetDemoCaches();
  });
});
