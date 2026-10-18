/**
 * Ranked technicians for a job, each with how well they fit and — when they
 * don't — the one sentence the dispatch map stops on.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { loadCandidates } = await import("../dispatch-candidates");

const CO = "cand-co";
const OTHER = "cand-other";
// 2026-10-17 19:00 UTC = 2:00 PM in Winnipeg (CDT)
const NOW = new Date("2026-10-17T19:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (o: number) => new Date(NOW.getTime() + o);
const JOB_AT = { lat: 49.9, lng: -97.14 };

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
  await db.insert(schema.services).values([
    { id: `${id}-hvac`, companyId: id, name: "Furnace repair", category: "HVAC", durationMins: 90 },
    { id: `${id}-plumb`, companyId: id, name: "Leak repair", category: "Plumbing", durationMins: 60 },
  ]);
  await db.insert(schema.user).values({ id: `${id}-cust`, name: "Customer", email: `${id}-cust@t.test`, companyId: id } as any);
}

async function tech(co: string, key: string, name: string, extra: Partial<typeof schema.riders.$inferInsert>) {
  await db.insert(schema.user).values({ id: `${co}-u-${key}`, name, email: `${co}-${key}@t.test`, companyId: co, role: "rider" } as any);
  await db.insert(schema.riders).values({ id: `${co}-${key}`, userId: `${co}-u-${key}`, companyId: co, skills: "HVAC", skillClass: "HVAC", status: "available", ...extra });
}

async function job(co: string, id: string, extra: Partial<typeof schema.bookings.$inferInsert>) {
  await db.insert(schema.bookings).values({
    id,
    companyId: co,
    customerId: `${co}-cust`,
    serviceId: `${co}-hvac`,
    title: id,
    status: "pending",
    scheduledAt: NOW,
    address: "1 Test St",
    lat: JOB_AT.lat,
    lng: JOB_AT.lng,
    ...extra,
  });
}

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTable(v);
  await company(CO);
  await company(OTHER);
  await tech(CO, "ready", "Tom Rivera", { lat: 49.902, lng: -97.141 });
  await tech(CO, "far", "Lucia Gomez", { lat: 49.98, lng: -97.0 });
  await tech(CO, "unq", "Priya Nair", { skills: "Plumbing", skillClass: "Plumbing", lat: 49.901, lng: -97.14 });
  await tech(CO, "off", "Aisha Khan", { status: "offline", lat: 49.9, lng: -97.14 });
  await tech(CO, "busy", "Marcus Lee", { status: "onsite", lat: 49.91, lng: -97.12 });
  await tech(CO, "timeoff", "Diego Ramos", { lat: 49.87, lng: -97.11 });
  await tech(CO, "overlap", "Emma Wilson", { lat: 49.905, lng: -97.095 });
  await tech(CO, "gone", "Former Tech", { approval: "suspended", lat: 49.9, lng: -97.14 });
  await tech(OTHER, "x", "Elsewhere", { lat: 49.9, lng: -97.14 });

  await job(CO, "c-hvac", { requiredSkillClass: "HVAC", scheduledAt: NOW });
  await job(CO, "c-plumb", { serviceId: `${CO}-plumb`, scheduledAt: at(5 * HOUR) });
  // Marcus has been on a 90-minute job for 10 minutes.
  await job(CO, "c-busy-work", { riderId: `${CO}-busy`, status: "in_progress", assignStatus: "accepted", scheduledAt: at(-15 * MIN), startedAt: at(-10 * MIN) });
  // Emma is already booked at 2:00.
  await job(CO, "c-emma", { riderId: `${CO}-overlap`, status: "assigned", assignStatus: "accepted", title: "Duct cleaning", scheduledAt: at(15 * MIN) });
  await db.insert(schema.techShifts).values({ id: "cand-off", companyId: CO, riderId: `${CO}-timeoff`, kind: "timeoff", date: NOW, note: "Dentist" });
  await job(OTHER, "c-other", {});
});

describe("loadCandidates", () => {
  it("ranks ready technicians first, then busy, not qualified and offline", async () => {
    const r = await loadCandidates(CO, ["c-hvac"], NOW);
    const list = r["c-hvac"]!;
    expect(list.map((c) => c.techId)).not.toContain(`${CO}-gone`);
    expect(list.map((c) => c.techId)).not.toContain(`${OTHER}-x`);
    expect(list.map((c) => c.fit)).toEqual(["ready", "ready", "busy", "busy", "busy", "unqualified", "offline"]);
    expect(list.slice(0, 2).map((c) => c.techId)).toEqual([`${CO}-ready`, `${CO}-far`]);
    expect(list[0]).toMatchObject({ best: true, qualified: true, clash: null });
    expect(list[0]!.reason).toMatch(/^Qualified · \d+ min away · free now$/);
    expect(list.filter((c) => c.best)).toHaveLength(1);
  });

  it("says why each one would stop a drop", async () => {
    const list = (await loadCandidates(CO, ["c-hvac"], NOW))["c-hvac"]!;
    const by = (k: string) => list.find((c) => c.techId === `${CO}-${k}`)!;
    expect(by("busy").clash?.kind).toBe("busy");
    expect(by("busy").clash?.message).toMatch(/^Marcus Lee is on a job until 3:20\s?PM\.$/);
    expect(by("busy").reason).toMatch(/^Free at 3:20\s?PM$/);
    expect(by("timeoff").clash).toEqual({ kind: "timeoff", message: "Diego Ramos has time off booked that day (Dentist)." });
    expect(by("overlap").clash?.kind).toBe("overlap");
    expect(by("overlap").clash?.message).toContain('Emma Wilson is already booked at 2:15');
    expect(by("overlap").clash?.message).toContain('"Duct cleaning"');
    expect(by("unq")).toMatchObject({ fit: "unqualified", qualified: false, missing: ["HVAC"], reason: "Missing HVAC" });
    expect(by("unq").clash?.message).toBe("Priya Nair isn't set up for HVAC.");
    expect(by("off")).toMatchObject({ fit: "offline", reason: "Offline" });
  });

  it("falls back to the service category when nothing is required", async () => {
    const list = (await loadCandidates(CO, ["c-plumb"], NOW))["c-plumb"]!;
    expect(list[0]).toMatchObject({ techId: `${CO}-unq`, fit: "ready", best: true });
    const tom = list.find((c) => c.techId === `${CO}-ready`)!;
    expect(tom).toMatchObject({ fit: "unqualified", missing: ["Plumbing"] });
    // Marcus is busy now but free well before a 7 PM job — not a clash
    expect(list.find((c) => c.techId === `${CO}-busy`)!.fit).toBe("unqualified");
  });

  it("gives the same answer in a batch as one at a time", async () => {
    const both = await loadCandidates(CO, ["c-hvac", "c-plumb", "nope", "c-other"], NOW);
    expect(Object.keys(both).sort()).toEqual(["c-hvac", "c-plumb"]);
    expect(both["c-hvac"]).toEqual((await loadCandidates(CO, ["c-hvac"], NOW))["c-hvac"]!);
    expect(both["c-plumb"]).toEqual((await loadCandidates(CO, ["c-plumb"], NOW))["c-plumb"]!);
    expect(await loadCandidates(CO, [], NOW)).toEqual({});
  });

  it("doesn't count an offered job against its own technician", async () => {
    const list = (await loadCandidates(CO, ["c-emma"], NOW))["c-emma"]!;
    const emma = list.find((c) => c.techId === `${CO}-overlap`)!;
    expect(emma.clash?.kind).not.toBe("overlap");
    expect(emma.openJobs).toBe(0);
  });

  it("reads the same number of times for one job or several", async () => {
    const client = (db as any).$client;
    const origQuery = client.query.bind(client);
    const origTx = client.transaction.bind(client);
    let reads = 0;
    client.query = (...a: unknown[]) => (reads++, origQuery(...a));
    client.transaction = (...a: unknown[]) => (reads++, origTx(...a));
    try {
      reads = 0;
      await loadCandidates(CO, ["c-hvac"], NOW);
      const one = reads;
      reads = 0;
      await loadCandidates(CO, ["c-hvac", "c-plumb", "c-emma"], NOW);
      expect(reads).toBe(one);
      expect(one).toBe(5);
    } finally {
      client.query = origQuery;
      client.transaction = origTx;
    }
  });
});
