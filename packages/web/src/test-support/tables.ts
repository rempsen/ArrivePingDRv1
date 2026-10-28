/**
 * Test-only: create real tables (with their unique indexes) in the in-memory
 * PGlite database from the drizzle schema, so a test can use the actual
 * service code instead of hand-written SQL. Safe to call repeatedly.
 */
import { getTableConfig, PgDialect, type PgColumn, type PgTable } from "drizzle-orm/pg-core";
import { db } from "../api/database";

function colDdl(col: PgColumn, withPk: boolean): string {
  const parts = [`"${col.name}"`, col.getSQLType()];
  if (withPk && col.primary) parts.push("PRIMARY KEY");
  const dflt = (col as unknown as { default?: unknown }).default;
  const lit =
    dflt === undefined ? null
    : typeof dflt === "string" ? `'${dflt.replace(/'/g, "''")}'`
    : typeof dflt === "boolean" ? (dflt ? "TRUE" : "FALSE")
    : typeof dflt === "number" ? String(dflt)
    : null;
  if (lit !== null) parts.push(`DEFAULT ${lit}`);
  else if (col.name === "created_at" || col.name === "set_at" || col.name === "started_at") parts.push("DEFAULT now()");
  return parts.join(" ");
}

export async function ensureTables(...tables: PgTable[]) {
  const s = (db as unknown as { $client: { execute: (q: string) => Promise<unknown> } }).$client;
  for (const table of tables) {
    const cfg = getTableConfig(table);
    await s.execute(`CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cfg.columns.map((c) => colDdl(c, true)).join(", ")})`);
    for (const c of cfg.columns) {
      if (c.primary) continue;
      await s.execute(`ALTER TABLE "${cfg.name}" ADD COLUMN IF NOT EXISTS ${colDdl(c, false)}`);
    }
    for (const idx of cfg.indexes) {
      const ic = idx.config;
      if (!ic.unique || !ic.name) continue;
      const cols = ic.columns.map((c) => `"${(c as PgColumn).name}"`).join(", ");
      // partial indexes are written with plain SQL text (no bound params) in schema.ts
      const where = ic.where ? ` WHERE ${new PgDialect().sqlToQuery(ic.where).sql}` : "";
      await s.execute(`CREATE UNIQUE INDEX IF NOT EXISTS "${ic.name}" ON "${cfg.name}" (${cols})${where}`);
    }
  }
}
