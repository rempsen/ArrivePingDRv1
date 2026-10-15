/**
 * Public-form address search: scoped to a real form, capped per form and
 * globally (caps a forged X-Forwarded-For can't dodge), billed per Places
 * session, and biased toward the company's office.
 *
 * Harness: ephemeral in-memory libsql, DDL derived from drizzle, ids prefixed
 * "pubgeo-". Google is a stubbed global fetch; no network.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";
import { getTableConfig, type PgColumn } from "drizzle-orm/pg-core";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { publicFormsRoutes } = await import("../public-forms");
const { _resetRateLimitStore } = await import("../../lib/rate-limit");
const { _clearCompanyOfficeCache } = await import("../../../services/company-office");

const CO = "pubgeo-company";
const OTHER = "pubgeo-other";
const SLUG = "get-a-quote";
const TOKEN = "3f1c2a8e-5b7d-4e2f-9a10-6c4d8e2b1f00";

const app = new Hono();
app.route("/public/forms", publicFormsRoutes);
app.onError((err, c) => c.json({ error: String((err as Error).message) }, ((err as any).status ?? 500) as 500));

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

// ---- Google stub ------------------------------------------------------------
const realFetch = globalThis.fetch;
let calls: { url: string; body: any }[] = [];
const ENV_KEYS = ["GOOGLE_MAPS_API_KEY_NEW", "RL_PUBLIC_GEO_LIMIT", "RL_PUBLIC_GEO_FORM_HOURLY", "RL_PUBLIC_GEO_GLOBAL_DAILY"];
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  const sql = (db as any).$client;
  for (const t of [schema.companies, schema.intakeForms]) await sql.execute(ddlFor(t));
  await sql.execute({
    sql: "INSERT OR IGNORE INTO companies (id, name, office_lat, office_lng) VALUES (?,?,?,?)",
    args: [CO, "Geo Co", 49.9, -97.1],
  });
  await sql.execute({ sql: "INSERT OR IGNORE INTO companies (id, name) VALUES (?,?)", args: [OTHER, "Other Co"] });
  for (const co of [CO, OTHER]) {
    await sql.execute({
      sql: "INSERT OR IGNORE INTO intake_forms (id, company_id, slug, title, active) VALUES (?,?,?,?,?)",
      args: [`pubgeo-form-${co}`, co, SLUG, "Request Service", 1],
    });
  }
  await sql.execute({
    sql: "INSERT OR IGNORE INTO intake_forms (id, company_id, slug, title, active) VALUES (?,?,?,?,?)",
    args: ["pubgeo-form-off", CO, "retired", "Old form", 0],
  });

  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.GOOGLE_MAPS_API_KEY_NEW = "test-key";
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes("places:autocomplete")) {
      return new Response(
        JSON.stringify({
          suggestions: [
            { placePrediction: { placeId: "ChIJ-one", text: { text: "1 Main St, Winnipeg" }, structuredFormat: { mainText: { text: "1 Main St" }, secondaryText: { text: "Winnipeg" } } } },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ formattedAddress: "1 Main St, Winnipeg, MB", location: { latitude: 49.89, longitude: -97.13 } }), { status: 200 });
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  _resetRateLimitStore();
});

beforeEach(() => {
  calls = [];
  _resetRateLimitStore();
  _clearCompanyOfficeCache();
  process.env.RL_PUBLIC_GEO_LIMIT = "1000";
  process.env.RL_PUBLIC_GEO_FORM_HOURLY = "600";
  process.env.RL_PUBLIC_GEO_GLOBAL_DAILY = "3000";
});

let n = 0;
function get(path: string) {
  n++;
  // a fresh forged X-Forwarded-For every time: the form and global caps must hold anyway
  return app.request(path, { headers: { "X-Forwarded-For": `198.51.${n % 250}.${(n * 7) % 250}` } });
}
const ac = (co = CO, slug = SLUG, q = "1 main", token = TOKEN) =>
  get(`/public/forms/${co}/${slug}/geo/autocomplete?q=${encodeURIComponent(q)}&sessionToken=${token}`);

describe("public form address search", () => {
  it("returns suggestions for an active form, with the session token and office bias", async () => {
    const res = await ac();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.predictions).toEqual([{ placeId: "ChIJ-one", description: "1 Main St, Winnipeg", main: "1 Main St", secondary: "Winnipeg" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.sessionToken).toBe(TOKEN);
    expect(calls[0]!.body.locationBias.circle.center).toEqual({ latitude: 49.9, longitude: -97.1 });
  });

  it("details closes the session with the same token", async () => {
    const res = await get(`/public/forms/${CO}/${SLUG}/geo/details?placeId=ChIJ-one&sessionToken=${TOKEN}&description=x`);
    expect(await res.json()).toEqual({ lat: 49.89, lng: -97.13, address: "1 Main St, Winnipeg, MB", provider: "google" });
    expect(calls[0]!.url).toBe(`https://places.googleapis.com/v1/places/ChIJ-one?sessionToken=${TOKEN}`);
  });

  it("an unknown or inactive form gets 404 and costs nothing", async () => {
    expect((await ac("pubgeo-nobody")).status).toBe(404);
    expect((await ac(CO, "retired")).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("the old unscoped endpoints are gone", async () => {
    const res = await get(`/public/forms/geo/autocomplete?q=1+main`);
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("the per-form cap holds even when every request forges a new IP", async () => {
    process.env.RL_PUBLIC_GEO_FORM_HOURLY = "3";
    for (let i = 0; i < 3; i++) expect((await (await ac()).json()).limited).toBeUndefined();
    const over = await (await ac()).json();
    expect(over).toEqual({ predictions: [], provider: "google", limited: true });
    expect(calls).toHaveLength(3);
    // another company's form has its own budget
    expect((await (await ac(OTHER)).json()).predictions).toHaveLength(1);
  });

  it("the global daily cap holds across forms", async () => {
    process.env.RL_PUBLIC_GEO_GLOBAL_DAILY = "2";
    await ac();
    await ac(OTHER);
    expect((await (await ac(OTHER)).json()).limited).toBe(true);
    const det = await (await get(`/public/forms/${CO}/${SLUG}/geo/details?placeId=ChIJ-one&description=typed`)).json();
    expect(det).toEqual({ lat: null, lng: null, address: "typed", provider: "google", limited: true });
    expect(calls).toHaveLength(2);
  });

  it("short input returns nothing without touching the form or Google", async () => {
    const res = await ac(CO, SLUG, "1m");
    expect((await res.json()).predictions).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
