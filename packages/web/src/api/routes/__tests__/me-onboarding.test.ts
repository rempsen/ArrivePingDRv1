/**
 * PATCH /api/me/onboarding — Guide progress on the membership.
 *  - Overlapping saves (finish the Welcome, then exit a chapter a moment later)
 *    must both land: the read-merge-write runs under a row lock.
 *  - A person with no membership here (superadmin acting as a tenant) gets
 *    persisted:false, so the client keeps progress in the browser instead.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { getTableConfig, type PgColumn } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { meRoutes } = await import("../me");

const CO = "onb-co";
const USER = "onb-user";
const SUPER = "onb-super";
const at = "2026-10-17T22:00:00.000Z";

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", CO);
  const uid = c.req.header("X-Test-User")!;
  c.set("user", { id: uid, role: uid === SUPER ? "superadmin" : "admin", email: `${uid}@t.test`, name: uid } as never);
  return next();
});
app.route("/me", meRoutes);

function colDdl(col: PgColumn, withPk: boolean): string {
  const parts = [`"${col.name}"`, col.getSQLType()];
  if (withPk && col.primary) parts.push("PRIMARY KEY");
  const d = (col as any).default;
  const lit = d === undefined ? null : typeof d === "string" ? `'${d.replace(/'/g, "''")}'` : typeof d === "boolean" ? (d ? "TRUE" : "FALSE") : typeof d === "number" ? String(d) : null;
  if (lit !== null) parts.push(`DEFAULT ${lit}`);
  return parts.join(" ");
}
async function ensureTable(table: any) {
  const s = (db as any).$client;
  const cfg = getTableConfig(table);
  await s.execute(`CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cfg.columns.map((c) => colDdl(c, true)).join(", ")})`);
  for (const c of cfg.columns) if (!c.primary) await s.execute(`ALTER TABLE "${cfg.name}" ADD COLUMN IF NOT EXISTS ${colDdl(c, false)}`);
}

const patch = (user: string, body: unknown) =>
  app.request("/me/onboarding", { method: "PATCH", headers: { "X-Test-User": user, "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  await ensureTable(schema.user);
  await ensureTable(schema.memberships);
  await db.insert(schema.user).values({ id: USER, companyId: CO, name: "U", email: "onb-u@t.test", role: "admin" } as any);
  await db.insert(schema.memberships).values({ id: "onb-m", userId: USER, companyId: CO, role: "admin", status: "active" } as any);
});

describe("PATCH /me/onboarding", () => {
  it("keeps both of two overlapping saves", async () => {
    const [a, b] = await Promise.all([
      patch(USER, { welcomeDoneAt: at, goal: "eta" }),
      patch(USER, { tours: { scheduler: { status: "completed", at } } }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, "onb-m"));
    const stored = JSON.parse(m!.onboarding!);
    expect(stored.welcomeDoneAt).toBe(at);
    expect(stored.goal).toBe("eta");
    expect(stored.tours.scheduler.status).toBe("completed");
  });

  it("tells a person with no membership that nothing was stored", async () => {
    const r = await patch(SUPER, { welcomeDoneAt: at });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { persisted: boolean; state: { welcomeDoneAt?: string } };
    expect(body.persisted).toBe(false);
    expect(body.state.welcomeDoneAt).toBe(at);
    const g = await app.request("/me/onboarding", { headers: { "X-Test-User": SUPER } });
    expect(((await g.json()) as { persisted: boolean }).persisted).toBe(false);
  });

  it("rejects a record over the size cap", async () => {
    const tours: Record<string, unknown> = {};
    for (let i = 0; i < 200; i++) tours[`chapter-${i}-${"x".repeat(20)}`] = { status: "completed", at };
    const r = await patch(USER, { tours });
    expect(r.status).toBe(413);
  });
});
