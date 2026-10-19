/**
 * DIRECTORY AI SEARCH, END TO END (Dan, 2026-10-18).
 *
 * POST /api/directory/ask on an in-memory database with a mock model:
 *   - the model gets the question, the property and team names, and nothing
 *     about any resident (no names, emails, phones, units);
 *   - its answer becomes a filter over this company's Directory only, with
 *     job history (open requests, last visit, work-order titles);
 *   - a name it can't place says so; words that match nobody are dropped
 *     only when the rest of the question still answers;
 *   - no AI, or a failing model, falls back to the keyword reading;
 *   - the page re-sends the filter to sort and page without the model.
 * Ids prefixed "da-".
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Hono } from "hono";
import { MockLanguageModelV3 } from "ai/test";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
delete process.env.AI_GATEWAY_API_KEY;

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { directoryRoutes } = await import("../directory");
const { setDirectoryAskModelForTests } = await import("../../../services/directory-ask");
const { emptyInterpretation } = await import("../../../shared/directory-ask");
const { zonedDayKey } = await import("../../../shared/tz");

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

const CO = "da-co";
const OTHER = "da-other";

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", c.req.header("X-Test-Company") || CO);
  c.set("user", { id: c.req.header("X-Test-User") || "da-boss", role: c.req.header("X-Test-Role") || "admin", email: "boss@da.test", name: "Dana Boss" } as any);
  return next();
});
app.route("/api/directory", directoryRoutes);
app.onError((e, c) => c.json({ message: e.message }, ((e as { status?: number }).status ?? 500) as 400));

const ask = (body: unknown, h: Record<string, string> = {}) =>
  app.request("/api/directory/ask", { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) });
const json = async (res: Response) => (await res.json()) as any;

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } };
/** A model that answers every question with this interpretation. */
function answering(partial: Record<string, unknown>) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify({ ...emptyInterpretation(), ...partial }) }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }) as never,
  });
}
const failing = () =>
  new MockLanguageModelV3({
    doGenerate: async () => {
      throw new Error("gateway down");
    },
  });

const MAPLE = "da-p-maple";
const BIRCH = "da-p-birch";

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTable(v);
  await db.insert(schema.companies).values([{ id: CO, name: "Towers Realty" } as any, { id: OTHER, name: "Other Co" } as any]);
  await db.insert(schema.companySettings).values({ id: CO, companyId: CO, name: "Towers Realty", customerNoun: "Resident", customerNounPlural: "Residents", workerNoun: "Property Manager", workerNounPlural: "Property Managers" } as any);
  await db.insert(schema.user).values([
    { id: "da-boss", name: "Dana Boss", email: "boss@da.test", role: "admin", companyId: CO } as any,
    { id: "da-jordan", name: "Jordan Patel", email: "jordan@da.test", role: "rider", companyId: CO } as any,
    { id: "da-sam", name: "Sam Ortiz", email: "sam@da.test", role: "dispatcher", companyId: CO } as any,
    { id: "da-zoe", name: "Zoe Adams", email: "zoe.secret@da.test", phone: "(204) 555-0101", role: "customer", companyId: CO } as any,
    { id: "da-ben", name: "Ben Kowalczyk", email: "ben@co.import.local", phone: "", role: "customer", companyId: CO } as any,
    { id: "da-amy", name: "Amy Chen", email: "amy@da.test", phone: "204-555-0103", role: "customer", companyId: CO } as any,
    { id: "da-x", name: "Xena Elsewhere", email: "xena@da.test", role: "customer", companyId: OTHER } as any,
  ]);
  await db.insert(schema.properties).values([
    { id: MAPLE, companyId: CO, name: "Maple Court", addressNormalized: "12 maple st", addressDisplay: "12 Maple St", managerId: "da-jordan" } as any,
    { id: BIRCH, companyId: CO, name: "Birch Towers", addressNormalized: "400 birch ave", addressDisplay: "400 Birch Ave", managerId: "da-sam" } as any,
    { id: "da-p-their", companyId: OTHER, name: "Their Place", addressNormalized: "1 their rd", addressDisplay: "1 Their Rd" } as any,
  ]);
  await db.insert(schema.memberships).values([
    { id: "da-m-boss", userId: "da-boss", companyId: CO, role: "admin", status: "active" } as any,
    { id: "da-m-jordan", userId: "da-jordan", companyId: CO, role: "rider", status: "active" } as any,
    { id: "da-m-sam", userId: "da-sam", companyId: CO, role: "dispatcher", status: "active" } as any,
    { id: "da-m-zoe", userId: "da-zoe", companyId: CO, role: "customer", status: "active", propertyId: MAPLE, unit: "4B" } as any,
    { id: "da-m-ben", userId: "da-ben", companyId: CO, role: "customer", status: "active", propertyId: MAPLE, unit: "10" } as any,
    { id: "da-m-amy", userId: "da-amy", companyId: CO, role: "customer", status: "active", propertyId: BIRCH, unit: "2" } as any,
    { id: "da-m-x", userId: "da-x", companyId: OTHER, role: "customer", status: "active", propertyId: "da-p-their" } as any,
  ]);
  await db.insert(schema.services).values({ id: "da-svc", companyId: CO, name: "Repair", price: 100 } as any);
  await db.insert(schema.bookings).values([
    { id: "da-j1", companyId: CO, customerId: "da-zoe", serviceId: "da-svc", title: "Leaky faucet", status: "confirmed", address: "12 Maple St", scheduledAt: new Date("2026-10-20T15:00:00Z") } as any,
    { id: "da-j2", companyId: CO, customerId: "da-amy", serviceId: "da-svc", title: "Furnace not igniting", status: "completed", address: "400 Birch Ave", scheduledAt: new Date("2026-01-15T15:00:00Z"), finishedAt: new Date("2026-01-15T17:00:00Z") } as any,
    // 9 pm Feb 28 in Winnipeg (the company's zone), Mar 1 in UTC.
    { id: "da-j4", companyId: CO, customerId: "da-amy", serviceId: "da-svc", title: "Late call", status: "completed", address: "400 Birch Ave", scheduledAt: new Date("2026-03-01T03:00:00Z") } as any,
    { id: "da-j3", companyId: CO, customerId: "da-ben", serviceId: "da-svc", title: "Leak under sink", status: "completed", address: "12 Maple St", scheduledAt: new Date("2025-12-01T15:00:00Z"), finishedAt: new Date("2025-12-01T16:00:00Z") } as any,
  ]);
});

beforeEach(() => setDirectoryAskModelForTests(null));
afterAll(() => setDirectoryAskModelForTests(null));

describe("asking with the AI", () => {
  it("“Maple Court residents with open requests”: the right people, and the model never saw a resident", async () => {
    const model = answering({ kind: "customer", properties: ["Maple Court"], openRequests: "some", summary: "Maple Court residents with open requests" });
    setDirectoryAskModelForTests(model);
    const body = await json(await ask({ question: "Maple Court residents with open requests" }));
    expect(body.rows.map((r: any) => r.id)).toEqual(["da-zoe"]);
    expect(body.ask).toMatchObject({ usedAI: true, summary: "Maple Court residents with open requests", notes: [] });
    expect(body.ask.filter.propertyIds).toEqual([MAPLE]);
    expect(body.ask.chips).toEqual(["Residents", "Maple Court", "Open requests"]);

    const sent = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    expect(sent).toContain("Maple Court");
    expect(sent).toContain("Jordan Patel");
    expect(sent).toContain("Residents");
    for (const secret of ["Zoe Adams", "zoe.secret", "555-0101", "Ben Kowalczyk", "Amy Chen", "4B", "Xena", "Their Place"]) expect(sent).not.toContain(secret);
  });

  it("job history: who had a leak (work-order titles), and last visit before a date", async () => {
    setDirectoryAskModelForTests(answering({ kind: "customer", jobText: "leak" }));
    expect((await json(await ask({ question: "who had a leak?" }))).rows.map((r: any) => r.id).sort()).toEqual(["da-ben", "da-zoe"]);
    setDirectoryAskModelForTests(answering({ kind: "customer", lastVisitBefore: "2026-01-01" }));
    expect((await json(await ask({ question: "residents not visited this year" }))).rows.map((r: any) => r.id)).toEqual(["da-ben"]);
  });

  it("“today” and day boundaries are the company's calendar, not UTC (Codex on #116)", async () => {
    const model = answering({ kind: "customer", jobAfter: "2026-02-28", jobBefore: "2026-03-01" });
    setDirectoryAskModelForTests(model);
    const body = await json(await ask({ question: "who had a job on February 28?" }));
    expect(body.rows.map((r: any) => r.id)).toEqual(["da-amy"]);
    expect(JSON.stringify(model.doGenerateCalls[0]!.prompt)).toContain(`TODAY: ${zonedDayKey(new Date(), "America/Winnipeg")}`);
  });

  it("a manager's residents, sorted by unit, with no email on file", async () => {
    setDirectoryAskModelForTests(answering({ kind: "customer", managers: ["Jordan Patel"], sort: "unit" }));
    expect((await json(await ask({ question: "Jordan's residents by unit" }))).rows.map((r: any) => r.unit)).toEqual(["4B", "10"]);
    setDirectoryAskModelForTests(answering({ kind: "customer", managers: ["Jordan"], missing: ["email"] }));
    const body = await json(await ask({ question: "Jordan's residents with no email" }));
    expect(body.rows.map((r: any) => r.id)).toEqual(["da-ben"]);
    expect(body.ask.chips).toContain("No email");
  });

  it("a property it can't place: says so and shows nobody", async () => {
    setDirectoryAskModelForTests(answering({ kind: "customer", properties: ["Willow Gardens"] }));
    const body = await json(await ask({ question: "residents at Willow Gardens" }));
    expect(body.total).toBe(0);
    expect(body.ask.notes).toEqual(["No property called “Willow Gardens”."]);
  });

  it("words that match nobody are dropped when the rest still answers, and it says so", async () => {
    setDirectoryAskModelForTests(answering({ kind: "customer", properties: ["Birch Towers"], keywords: "penthouse" }));
    const body = await json(await ask({ question: "Birch Towers penthouse" }));
    expect(body.rows.map((r: any) => r.id)).toEqual(["da-amy"]);
    expect(body.ask.notes).toEqual(["Nobody matched “penthouse” as well, so those words were left out."]);
    // A name search alone is never widened to everybody.
    setDirectoryAskModelForTests(answering({ kind: "customer", keywords: "nobody by this name" }));
    expect((await json(await ask({ question: "nobody by this name" }))).total).toBe(0);
    // Words close to a property's name get a suggestion.
    setDirectoryAskModelForTests(answering({ kind: "customer", keywords: "maple hall" }));
    expect((await json(await ask({ question: "maple hall" }))).ask.notes).toEqual(["No one matched “maple hall”. Did you mean Maple Court?"]);
  });

  it("can't reach another company: their property names don't resolve, a crafted id matches nothing", async () => {
    setDirectoryAskModelForTests(answering({ kind: "customer", properties: ["Their Place"] }));
    expect((await json(await ask({ question: "Their Place" }))).total).toBe(0);
    const filter = { ...(await json(await ask({ question: "Their Place" }))).ask.filter, propertyIds: ["da-p-their"] };
    expect((await json(await ask({ filter }))).total).toBe(0);
    const theirs = await json(await ask({ filter: { ...filter, propertyIds: [] } }, { "X-Test-Company": OTHER }));
    expect(theirs.rows.map((r: any) => r.id)).toEqual(["da-x"]);
  });
});

describe("without the AI", () => {
  it("says it's off, and the keyword reading still answers common questions", async () => {
    expect(await json(await app.request("/api/directory/ask"))).toEqual({ available: false });
    const body = await json(await ask({ question: "Maple Court residents with open requests" }));
    expect(body.ask.usedAI).toBe(false);
    expect(body.rows.map((r: any) => r.id)).toEqual(["da-zoe"]);
  });

  it("a failing model falls back, and says why", async () => {
    setDirectoryAskModelForTests(failing());
    const body = await json(await ask({ question: "Birch Towers" }));
    expect(body.ask.usedAI).toBe(false);
    expect(body.ask.notes[0]).toContain("keyword search");
    expect(body.rows.map((r: any) => r.id)).toEqual(["da-amy"]);
  });
});

describe("re-sending a filter (sort, group, page) never calls the model", () => {
  it("pages and sorts the same answer", async () => {
    const model = answering({ kind: "customer", properties: ["Maple Court"] });
    setDirectoryAskModelForTests(model);
    const first = await json(await ask({ question: "Maple Court", pageSize: 1 }));
    expect(first.total).toBe(2);
    const calls = model.doGenerateCalls.length;
    const p2 = await json(await ask({ filter: { ...first.ask.filter, sort: "unit", dir: "desc" }, page: 2, pageSize: 1 }));
    expect(p2.rows.map((r: any) => r.unit)).toEqual(["4B"]);
    expect(p2.ask.chips).toContain("Sorted by unit, highest first");
    expect(model.doGenerateCalls.length).toBe(calls);
    const all = await json(await ask({ filter: first.ask.filter, withIds: true }));
    expect(all.ids.sort()).toEqual(["da-ben", "da-zoe"]);
  });

  it("refuses a malformed request", async () => {
    expect((await ask({})).status).toBe(400);
    expect((await ask({ question: "x", filter: {} })).status).toBe(400);
    expect((await ask({ filter: { kind: "everyone" } })).status).toBe(400);
    expect((await ask({ question: "q".repeat(301) })).status).toBe(400);
  });
});

describe("who can ask", () => {
  it("office staff can; field staff and customers can't", async () => {
    expect((await ask({ question: "Maple Court" }, { "X-Test-Role": "dispatcher", "X-Test-User": "da-sam" })).status).toBe(200);
    expect((await ask({ question: "Maple Court" }, { "X-Test-Role": "rider", "X-Test-User": "da-jordan" })).status).toBe(403);
    expect((await ask({ question: "Maple Court" }, { "X-Test-Role": "customer", "X-Test-User": "da-zoe" })).status).toBe(403);
  });
});
