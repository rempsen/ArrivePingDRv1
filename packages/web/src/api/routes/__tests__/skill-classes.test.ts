/**
 * SKILL CLASSES PER COMPANY (Settings → Skill Classes).
 *   - a company with nothing saved gets the built-in list;
 *   - saving a list replaces it, for that company only;
 *   - renaming carries technicians and open jobs across (and merges onto an
 *     existing class);
 *   - removing a class leaves the people on it alone, listed as "unlisted";
 *   - only people who can edit technicians change it.
 * In-memory database. Ids prefixed "sc-".
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { skillClassRoutes } = await import("../skill-classes");
const { DEFAULT_SKILL_CLASSES } = await import("../../../shared/skill-classes");

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

const CO = "sc-co";
const OTHER = "sc-other";
function appFor(co: string) {
  const app = new Hono<AppEnv>().use("*", async (c, next) => {
    c.set("companyId", co);
    const role = c.req.header("X-Role") ?? "admin";
    c.set("user", { id: `${co}-u`, role, email: `${co}@sc.test`, name: "Dana", companyId: co } as any);
    return next();
  });
  app.route("/api/skill-classes", skillClassRoutes);
  app.onError((e, c) => c.json({ message: e.message }, ((e as { status?: number }).status ?? 500) as 400));
  return app;
}
const app = appFor(CO);
const other = appFor(OTHER);
const call = (a: Hono<AppEnv>, method: string, path: string, body?: unknown, role = "admin") =>
  a.request(`/api/skill-classes${path}`, { method, headers: { "content-type": "application/json", "X-Role": role }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTable(v);
  for (const co of [CO, OTHER]) {
    await db.insert(schema.companies).values({ id: co, name: co, status: "active" } as any);
    await db.insert(schema.companySettings).values({ id: co, companyId: co, name: co } as any);
  }
  await db.insert(schema.user).values([
    { id: "sc-u1", name: "Brodie", email: "sc-u1@sc.test", companyId: CO, role: "rider" },
    { id: "sc-u2", name: "Mo", email: "sc-u2@sc.test", companyId: CO, role: "rider" },
    { id: "sc-cust", name: "Client", email: "sc-cust@sc.test", companyId: CO, role: "customer" },
  ] as any);
  await db.insert(schema.riders).values([
    { id: "sc-t1", userId: "sc-u1", companyId: CO, skillClass: "Carpentry" },
    { id: "sc-t2", userId: "sc-u2", companyId: CO, skillClass: "General" },
  ] as any);
  await db.insert(schema.bookings).values([
    { id: "sc-b1", companyId: CO, customerId: "sc-cust", title: "Floor", status: "pending", scheduledAt: new Date(), address: "1 St", requiredSkillClass: "Carpentry" },
    { id: "sc-b2", companyId: CO, customerId: "sc-cust", title: "Done one", status: "completed", scheduledAt: new Date(), address: "1 St", requiredSkillClass: "Carpentry" },
  ] as any);
});

describe("skill classes", () => {
  it("starts on the built-in list, with usage counts", async () => {
    const r = await (await call(app, "GET", "")).json();
    expect(r.custom).toBe(false);
    expect(r.classes.map((c: any) => c.name)).toEqual([...DEFAULT_SKILL_CLASSES]);
    expect(r.classes.find((c: any) => c.name === "Carpentry")).toMatchObject({ techs: 1, jobs: 1 });
  });

  it("saves this company's own list, leaving other companies alone", async () => {
    const list = ["Carpet Installation", "LVP Installation", "Tile Installation", "Sheet Vinyl", "Wall Base"];
    const res = await call(app, "PUT", "", { classes: list });
    expect(res.status).toBe(200);
    const r = await (await call(app, "GET", "")).json();
    expect(r.custom).toBe(true);
    expect(r.classes.map((c: any) => c.name)).toEqual(list);
    // People on classes that left the list keep them, shown as unlisted.
    expect(r.unlisted.map((c: any) => c.name).sort()).toEqual(["Carpentry", "General"]);
    const o = await (await call(other, "GET", "")).json();
    expect(o.classes.map((c: any) => c.name)).toEqual([...DEFAULT_SKILL_CLASSES]);
  });

  it("renames, moving technicians and open jobs (finished jobs keep their record)", async () => {
    const res = await call(app, "POST", "/rename", { from: "Carpentry", to: "Tile Installation" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.techs).toBe(1);
    const t1 = (await db.select().from(schema.riders).where(eq(schema.riders.id, "sc-t1")))[0]!;
    expect(t1.skillClass).toBe("Tile Installation");
    const b1 = (await db.select().from(schema.bookings).where(eq(schema.bookings.id, "sc-b1")))[0]!;
    expect(b1.requiredSkillClass).toBe("Tile Installation");
    const b2 = (await db.select().from(schema.bookings).where(eq(schema.bookings.id, "sc-b2")))[0]!;
    expect(b2.requiredSkillClass).toBe("Carpentry");
    // Merged onto the existing class: the list doesn't grow a duplicate.
    const r = await (await call(app, "GET", "")).json();
    expect(r.classes.filter((c: any) => c.name === "Tile Installation")).toHaveLength(1);
    expect(r.classes.find((c: any) => c.name === "Tile Installation").techs).toBe(1);
  });

  it("refuses an empty list and people who can't edit technicians", async () => {
    expect((await call(app, "PUT", "", { classes: [] })).status).toBe(400);
    expect((await call(app, "PUT", "", { classes: ["X"] }, "rider")).status).toBe(403);
    expect((await call(app, "POST", "/rename", { from: "Wall Base", to: "Base" }, "customer")).status).toBe(403);
  });
});
