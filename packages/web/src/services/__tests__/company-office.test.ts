/**
 * syncOfficeFromBusinessAddress (services/company-office.ts): the business
 * address found at signup / re-scan / setup chat also becomes the office
 * location, fill-empty only.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { syncOfficeFromBusinessAddress } = await import("../company-office");

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

const ADDR = "100 – 1420 Taylor Avenue, Winnipeg, Manitoba R3N 1Y6, Canada";
const HIT = { lat: 49.8584, lng: -97.1823 };
const geocode = async () => HIT;
const noHit = async () => null;

async function makeCo(id: string, co: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) {
  await db.insert(schema.companies).values({ id, name: id, ...co } as any);
  await db.insert(schema.companySettings).values({ id, companyId: id, ...settings } as any);
}
const office = async (id: string) => (await db.select().from(schema.companies).where(eq(schema.companies.id, id)))[0]!;
const settings = async (id: string) => (await db.select().from(schema.companySettings).where(eq(schema.companySettings.id, id)))[0]!;

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTable(v);
});

describe("syncOfficeFromBusinessAddress", () => {
  it("fills a blank office with the business address and its coordinates", async () => {
    await makeCo("co-blank", {}, { address: ADDR });
    const r = await syncOfficeFromBusinessAddress("co-blank", ADDR, { geocode });
    expect(r).toEqual({ office: true, businessCoords: true, geocoded: true });
    const co = await office("co-blank");
    expect(co.officeAddress).toBe(ADDR);
    expect(co.officeLat).toBeCloseTo(HIT.lat, 3);
    expect(co.officeLng).toBeCloseTo(HIT.lng, 3);
    // business coords were the Winnipeg column default, so they now match too
    const s = await settings("co-blank");
    expect(s.lat).toBeCloseTo(HIT.lat, 3);
    expect(s.lng).toBeCloseTo(HIT.lng, 3);
  });

  it("never overwrites an office the admin already set", async () => {
    await makeCo("co-set", { officeAddress: "55 Other St, Winnipeg", officeLat: 49.9, officeLng: -97.1 }, { address: ADDR, lat: 49.85, lng: -97.18 });
    const r = await syncOfficeFromBusinessAddress("co-set", ADDR, { geocode });
    expect(r.office).toBe(false);
    expect(r.businessCoords).toBe(false);
    expect((await office("co-set")).officeAddress).toBe("55 Other St, Winnipeg");
  });

  it("still fills the office text when geocoding finds nothing", async () => {
    await makeCo("co-nogeo", {}, { address: ADDR });
    const r = await syncOfficeFromBusinessAddress("co-nogeo", ADDR, { geocode: noHit });
    expect(r).toEqual({ office: true, businessCoords: false, geocoded: false });
    const co = await office("co-nogeo");
    expect(co.officeAddress).toBe(ADDR);
    expect(co.officeLat).toBeNull();
  });

  it("ignores blank and demo-default addresses", async () => {
    await makeCo("co-empty");
    expect((await syncOfficeFromBusinessAddress("co-empty", "  ", { geocode })).office).toBe(false);
    expect((await syncOfficeFromBusinessAddress("co-empty", "423 Main Street, Winnipeg, Manitoba, Canada", { geocode })).office).toBe(false);
    expect((await office("co-empty")).officeAddress).toBe("");
  });

  it("a geocoder error does not throw", async () => {
    await makeCo("co-err", {}, { address: ADDR });
    const r = await syncOfficeFromBusinessAddress("co-err", ADDR, { geocode: async () => { throw new Error("boom"); } });
    expect(r.office).toBe(true);
    expect(r.geocoded).toBe(false);
  });
});
