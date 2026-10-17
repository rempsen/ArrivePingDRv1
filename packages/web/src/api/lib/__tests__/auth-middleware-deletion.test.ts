/**
 * authMiddleware behaviour around self-service account deletion:
 *   - an anonymized ("deleted") user is refused outright, even with a session;
 *   - the two deletion routes stay reachable for people whose only membership
 *     was deactivated, or whose company was closed — every other route is
 *     still gated for them.
 * `auth.api.getSession` is mocked; everything else is the real middleware on
 * a real pglite database.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import { Hono } from "hono";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

type FakeUser = { id: string; role: string; companyId: string; email: string; name: string };
let current: FakeUser | null = null;

const realAuth = { ...(await import("../../auth")) };
beforeAll(() => {
  mock.module("../../auth", () => ({
    ...realAuth,
    auth: { ...realAuth.auth, api: { ...realAuth.auth.api, getSession: async () => (current ? { user: current, session: { id: "s" } } : null) } },
  }));
});
afterAll(() => {
  mock.module("../../auth", () => realAuth);
});

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { authMiddleware } = await import("../../middleware/auth");

function ddlFor(table: any): string {
  const cfg = getTableConfig(table);
  const cols = cfg.columns.map((col: any) => {
    const parts = [`"${col.name}"`, col.getSQLType()];
    if (col.primary) parts.push("PRIMARY KEY");
    const d = col.default;
    const lit = typeof d === "string" ? `'${d.replace(/'/g, "''")}'` : typeof d === "boolean" ? (d ? "TRUE" : "FALSE") : typeof d === "number" ? String(d) : null;
    if (col.notNull && (lit !== null || col.primary)) parts.push("NOT NULL");
    if (lit !== null) parts.push(`DEFAULT ${lit}`);
    return parts.join(" ");
  });
  return `CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cols.join(", ")})`;
}

const OPEN = "amd-open";
const CLOSED = "amd-closed";

const app = new Hono<AppEnv>()
  .use("*", authMiddleware)
  .get("/api/me/companies", (c) => c.json({ reached: true, user: !!c.get("user") }))
  .get("/api/me/deletion-preview", (c) => c.json({ reached: true }))
  .delete("/api/me", (c) => c.json({ reached: true }));

beforeAll(async () => {
  const s = (db as any).$client;
  for (const t of [schema.companies, schema.memberships]) await s.execute(ddlFor(t));
  await s.execute(`DELETE FROM memberships WHERE company_id IN ('${OPEN}','${CLOSED}')`);
  await s.execute(`DELETE FROM companies WHERE id IN ('${OPEN}','${CLOSED}')`);
  await s.execute({ sql: "INSERT INTO companies (id, name, status) VALUES (?,?,?)", args: [OPEN, "Open Co", "active"] });
  await s.execute({ sql: "INSERT INTO companies (id, name, status) VALUES (?,?,?)", args: [CLOSED, "Closed Co", "closed"] });
  // amd-deact: only membership is disabled (deactivated by the office).
  await s.execute({ sql: "INSERT INTO memberships (id, user_id, company_id, role, status) VALUES (?,?,?,?,?)", args: ["amd-m1", "amd-deact", OPEN, "rider", "disabled"] });
  // amd-closed-user: active member of a closed company.
  await s.execute({ sql: "INSERT INTO memberships (id, user_id, company_id, role, status) VALUES (?,?,?,?,?)", args: ["amd-m2", "amd-closed-user", CLOSED, "rider", "active"] });
});

const as = (u: FakeUser | null) => {
  current = u;
};
const user = (id: string, companyId: string, role = "rider"): FakeUser => ({ id, role, companyId, email: `${id}@t.test`, name: id });

describe("deleted accounts", () => {
  it("are refused with 401 account_deleted even when a session row survived", async () => {
    as({ ...user("amd-gone", "default"), role: "deleted" });
    const res = await app.request("/api/me/companies");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("account_deleted");
  });
});

describe("deactivated-only member", () => {
  it("is blocked everywhere except the deletion routes", async () => {
    as(user("amd-deact", OPEN));
    expect((await app.request("/api/me/companies")).status).toBe(403);
    expect((await app.request("/api/me/deletion-preview")).status).toBe(200);
    expect((await app.request("/api/me", { method: "DELETE" })).status).toBe(200);
  });
});

describe("member of a closed company", () => {
  it("is blocked everywhere except the deletion routes", async () => {
    as(user("amd-closed-user", CLOSED));
    const blocked = await app.request("/api/me/companies");
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("company_closed");
    expect((await app.request("/api/me/deletion-preview")).status).toBe(200);
    expect((await app.request("/api/me", { method: "DELETE" })).status).toBe(200);
  });
});
