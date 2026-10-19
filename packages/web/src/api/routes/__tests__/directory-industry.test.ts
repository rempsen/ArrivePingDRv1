/**
 * THE DIRECTORY SPEAKS EACH TENANT'S LANGUAGE (Dan, 2026-10-19).
 *
 * Three companies on an in-memory database:
 *   - Towers Realty (its own words: Residents, Property Managers): Properties,
 *     Unit, Property Manager; resident templates with Property and Unit;
 *   - Prairie Comfort HVAC: Customers and Technicians, no place layer, no
 *     places import, and a "Building" column in its customer file is ignored
 *     rather than quietly making places;
 *   - Riverbend Homes (a home builder): Communities, Lots, Superintendents.
 * Covers GET /directory's vocabulary and group labels, the import profile,
 * templates and imports, messages, the Settings switch, and the AI search's
 * prompt. Ids prefixed "di-".
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { MockLanguageModelV3 } from "ai/test";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { eq, and } from "drizzle-orm";
import ExcelJS from "exceljs";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.RESEND_API_KEY = "";
delete process.env.AI_GATEWAY_API_KEY;

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { directoryRoutes } = await import("../directory");
const { importRoutes } = await import("../import");
const { setDirectoryAskModelForTests } = await import("../../../services/directory-ask");
const { emptyInterpretation } = await import("../../../shared/directory-ask");

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

const TOWERS = "di-towers";
const HVAC = "di-hvac";
const BUILDER = "di-builder";

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  const co = c.req.header("X-Test-Company") || TOWERS;
  c.set("companyId", co);
  c.set("user", { id: `${co}-boss`, role: "admin", email: `boss@${co}.test`, name: "Boss" } as any);
  return next();
});
app.route("/api/directory", directoryRoutes);
app.route("/api/import", importRoutes);
app.onError((e, c) => c.json({ message: e.message }, ((e as { status?: number }).status ?? 500) as 400));

const h = (co: string) => ({ "content-type": "application/json", "X-Test-Company": co });
const get = (path: string, co: string) => app.request(path, { headers: h(co) });
const json = async (res: Response) => (await res.json()) as any;
const upload = (type: string, csv: string, co: string) => {
  const fd = new FormData();
  fd.append("file", new File([csv], `${type}.csv`, { type: "text/csv" }));
  return app.request(`/api/import/${type}`, { method: "POST", headers: { "X-Test-Company": co }, body: fd });
};
const header = async (type: string, co: string) => (await (await get(`/api/import/template/${type}?format=csv`, co)).text()).split("\n")[0];

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTable(v);
  await db.insert(schema.companies).values([
    { id: TOWERS, name: "Towers Realty Group", industry: "other" } as any,
    { id: HVAC, name: "Prairie Comfort HVAC", industry: "hvac-plumbing" } as any,
    { id: BUILDER, name: "Riverbend Homes", industry: "home-builder-developer" } as any,
  ]);
  await db.insert(schema.companySettings).values([
    { id: TOWERS, companyId: TOWERS, customerNoun: "Resident", customerNounPlural: "Residents", workerNoun: "Property Manager", workerNounPlural: "Property Managers", jobNoun: "Request", jobNounPlural: "Requests" } as any,
    { id: HVAC, companyId: HVAC } as any,
    { id: BUILDER, companyId: BUILDER, customerNoun: "Buyer", customerNounPlural: "Buyers", workerNoun: "Superintendent", workerNounPlural: "Superintendents", jobNoun: "Project", jobNounPlural: "Projects" } as any,
  ]);
  for (const co of [TOWERS, HVAC, BUILDER]) {
    await db.insert(schema.user).values([
      { id: `${co}-boss`, name: "Boss", email: `boss@${co}.test`, role: "admin", companyId: co } as any,
      { id: `${co}-staff`, name: "Jordan Patel", email: `jordan@${co}.test`, role: "rider", companyId: co } as any,
      { id: `${co}-c1`, name: "Ava Adams", email: `ava@${co}.test`, role: "customer", companyId: co } as any,
    ]);
    await db.insert(schema.memberships).values([
      { id: `${co}-m-boss`, userId: `${co}-boss`, companyId: co, role: "admin", status: "active" } as any,
      { id: `${co}-m-staff`, userId: `${co}-staff`, companyId: co, role: "rider", status: "active" } as any,
      { id: `${co}-m-c1`, userId: `${co}-c1`, companyId: co, role: "customer", status: "active" } as any,
    ]);
  }
});
afterAll(() => setDirectoryAskModelForTests(null));

describe("each tenant's Directory vocabulary", () => {
  it("Towers: properties, units, property managers (from its own words)", async () => {
    expect((await json(await get("/api/directory", TOWERS))).vocab).toMatchObject({ enabled: true, place: "Property", unit: "Unit", manager: "Property Manager" });
  });

  it("HVAC: no place layer at all", async () => {
    expect((await json(await get("/api/directory", HVAC))).vocab).toMatchObject({ enabled: false });
    expect((await json(await get("/api/directory/properties", HVAC))).vocab.enabled).toBe(false);
  });

  it("a builder: communities and lots, in group headers too", async () => {
    const body = await json(await get("/api/directory?kind=customer&groupBy=property", BUILDER));
    expect(body.vocab).toMatchObject({ enabled: true, place: "Community", places: "Communities", unit: "Lot", manager: "Superintendent" });
    expect(body.groups.map((g: any) => g.label)).toEqual(["No community"]);
  });

  it("messages use the tenant's words", async () => {
    const res = await app.request("/api/directory/assign", {
      method: "POST",
      headers: h(BUILDER),
      body: JSON.stringify({ userIds: [`${BUILDER}-staff`], propertyId: null }),
    });
    expect((await json(res)).message).toBe("Only buyers can belong to a community. Make a team member the community's superintendent instead.");
  });
});

describe("import templates match the tenant's Directory (Dan, 2026-10-19)", () => {
  it("the import menu's profile: names and which imports exist", async () => {
    const towers = (await json(await get("/api/import/profile", TOWERS))).profile;
    expect(towers.types).toEqual(["customer", "rider", "admin", "property"]);
    expect(towers.label).toMatchObject({ customer: "Residents", rider: "Property Managers", property: "Properties" });
    const hvac = (await json(await get("/api/import/profile", HVAC))).profile;
    expect(hvac.types).toEqual(["customer", "rider", "admin"]);
    expect(hvac.label).toMatchObject({ customer: "Customers", rider: "Technicians" });
  });

  it("downloaded templates: residents with Property and Unit; HVAC customers with company and address", async () => {
    expect(await header("customer", TOWERS)).toBe("First Name,Last Name,Email,Phone,Property,Unit");
    const hvac = await header("customer", HVAC);
    expect(hvac).toContain("Company");
    expect(hvac).toContain("Address");
    expect(hvac).not.toContain("Property");
    expect(await header("customer", BUILDER)).toBe("First Name,Last Name,Email,Phone,Community,Lot");
    expect(await header("property", BUILDER)).toBe("Community Name,Address,Superintendent (email or name),Notes");
    // File names in the tenant's words.
    expect((await get("/api/import/template/customer?format=csv", TOWERS)).headers.get("content-disposition")).toContain("residents-import-template");
    expect((await get("/api/import/template/rider?format=xlsx", TOWERS)).headers.get("content-disposition")).toContain("property-managers-import-template");
  });

  it("field-staff templates fit the job: technicians get vehicle and licence, property managers don't", async () => {
    expect(await header("rider", HVAC)).toContain("Vehicle");
    expect(await header("rider", TOWERS)).toBe("Full Name,Email,Phone,Address");
  });

  it("HVAC has no places import, and a Building column in its customer file makes no places", async () => {
    expect((await get("/api/import/template/property", HVAC)).status).toBe(400);
    expect((await upload("property", "Property Name\nMaple Court", HVAC)).status).toBe(400);
    const body = await json(await upload("customer", "First Name,Last Name,Email,Building\nBo,Ng,bo@hvac.test,Maple Court", HVAC));
    expect(body).toMatchObject({ created: 1, failedCount: 0 });
    expect(await db.select().from(schema.properties).where(eq(schema.properties.companyId, HVAC))).toHaveLength(0);
  });

  it("a builder's file with Community and Lot columns lands its buyers in communities", async () => {
    const body = await json(await upload("customer", "First Name,Last Name,Email,Community,Lot\nKai,Roy,kai@builder.test,Riverbend Estates,27", BUILDER));
    expect(body).toMatchObject({ created: 1, failedCount: 0 });
    const list = await json(await get("/api/directory?kind=customer&q=kai", BUILDER));
    expect(list.rows[0]).toMatchObject({ propertyName: "Riverbend Estates", unit: "27" });
  });

  it("a downloaded Excel template, filled in, imports back: the title row above the headers is skipped", async () => {
    const roundTrip = async (co: string, rows: string[][]) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await (await get("/api/import/template/customer?format=xlsx", co)).arrayBuffer()) as any);
      const ws = wb.worksheets[0]!;
      // Row 1 is the title, row 2 the headers, row 3 the example (skipped on import).
      rows.forEach((r, i) => { ws.getRow(4 + i).values = r; });
      const fd = new FormData();
      fd.append("file", new File([Buffer.from(await wb.xlsx.writeBuffer())], "filled.xlsx"));
      return json(await app.request("/api/import/customer", { method: "POST", headers: { "X-Test-Company": co }, body: fd }));
    };
    const towers = await roundTrip(TOWERS, [
      ["Robin", "Reyes", "robin@towers.test", "(204) 555-0101", "Birch Towers", "9Z"],
      ["Bad", "Email", "not-an-email", "", "Birch Towers", "1A"],
    ]);
    expect(towers).toMatchObject({ created: 1, failedCount: 1 });
    // The failure points at the sheet's own row number.
    expect(towers.failed[0]).toMatchObject({ row: 5, reason: "Invalid email" });
    const list = await json(await get("/api/directory?kind=customer&q=robin", TOWERS));
    expect(list.rows[0]).toMatchObject({ propertyName: "Birch Towers", unit: "9Z" });

    const hvac = await roundTrip(HVAC, [["Pat", "Lee", "pat@hvac.test", "(204) 555-0102", "Lee Bakery", "", "77 Test Ave", "Winnipeg", "MB", "R2C 0A1", "Canada", "repeat"]]);
    expect(hvac).toMatchObject({ created: 1, failedCount: 0 });
    expect(await db.select().from(schema.properties).where(eq(schema.properties.companyId, HVAC))).toHaveLength(0);
  });

  it("Settings can turn places on for an HVAC company: Sites, and a template for them", async () => {
    await db.update(schema.companySettings).set({ directoryPlaces: "on" } as any).where(and(eq(schema.companySettings.companyId, HVAC)));
    const profile = (await json(await get("/api/import/profile", HVAC))).profile;
    expect(profile.types).toContain("property");
    expect(profile.label.property).toBe("Sites");
    expect(await header("customer", HVAC)).toContain("Site,Unit");
    await db.update(schema.companySettings).set({ directoryPlaces: "auto" } as any).where(eq(schema.companySettings.companyId, HVAC));
  });
});

describe("the AI search in the tenant's words", () => {
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
  const answering = (partial: Record<string, unknown>) =>
    new MockLanguageModelV3({
      doGenerate: async () =>
        ({ content: [{ type: "text", text: JSON.stringify({ ...emptyInterpretation(), ...partial }) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] }) as never,
    });
  const ask = (question: string, co: string) => app.request("/api/directory/ask", { method: "POST", headers: h(co), body: JSON.stringify({ question }) });

  it("HVAC: the model is told there are no places, and a place in its answer is ignored", async () => {
    const model = answering({ kind: "customer", properties: ["Maple Court"], openRequests: "some" });
    setDirectoryAskModelForTests(model);
    const body = await json(await ask("Maple Court customers with open jobs", HVAC));
    expect(body.ask.filter.propertyIds).toEqual([]);
    expect(body.ask.chips).toEqual(["Customers", "Open jobs"]);
    const sent = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    expect(sent).toContain("doesn't group them by place");
    expect(sent).not.toContain("PROPERTIES:");
  });

  it("a builder: communities in the prompt and the chips", async () => {
    const model = answering({ kind: "customer", noProperty: true });
    setDirectoryAskModelForTests(model);
    const body = await json(await ask("buyers without a community", BUILDER));
    expect(body.ask.chips).toEqual(["Buyers", "No community"]);
    expect(JSON.stringify(model.doGenerateCalls[0]!.prompt)).toContain("COMMUNITIES:");
  });
});
