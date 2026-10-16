/**
 * A deactivated membership must not let a person fall back to acting as their
 * home company. authMiddleware consults `deactivatedMembership()` for exactly
 * that case; this pins its behaviour against the real database.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { deactivatedMembership } = await import("../../middleware/auth");

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

const CO = "da-co";
beforeAll(async () => {
  const s = (db as any).$client;
  await s.execute(ddlFor(schema.memberships));
  await s.execute(`DELETE FROM memberships WHERE company_id = '${CO}'`);
  await s.execute({ sql: "INSERT INTO memberships (id, user_id, company_id, role, status) VALUES (?,?,?,?,?)", args: ["da-m1", "da-off", CO, "dispatcher", "disabled"] });
  await s.execute({ sql: "INSERT INTO memberships (id, user_id, company_id, role, status) VALUES (?,?,?,?,?)", args: ["da-m2", "da-on", CO, "dispatcher", "active"] });
});

describe("deactivatedMembership", () => {
  it("is true for a disabled membership at that company", async () => {
    expect(await deactivatedMembership("da-off", CO)).toBe(true);
  });
  it("is false for an active member and for someone with no membership row (legacy single-company user)", async () => {
    expect(await deactivatedMembership("da-on", CO)).toBe(false);
    expect(await deactivatedMembership("da-legacy", CO)).toBe(false);
  });
});
