import { Hono } from "hono";
import * as schema from "../database/schema";
import { desc } from "drizzle-orm";
import { requireAdmin, tx } from "../middleware/auth";
import type { AppEnv } from "../env";

export const auditRoutes = new Hono<AppEnv>()
  .get("/", requireAdmin, async (c) => {
    const limit = Math.min(Number(c.req.query("limit") || 200), 500);
    const t = tx(c);
    // Scope to the acting tenant — never leak another company's audit trail.
    // Runs inside t.transaction() so the RLS session var backing that scope
    // is actually set for this query.
    const where = t.scope(schema.auditLog);
    const rows = await t.transaction(async (dbtx) => {
      const q = dbtx.select().from(schema.auditLog);
      return await (where ? q.where(where) : q)
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(limit);
    });
    return c.json({ entries: rows.map((r) => ({ ...r, meta: JSON.parse(r.meta || "{}") })) }, 200);
  });
