/**
 * SUPERADMIN — platform analytics (Admin → Analytics).
 *
 * Read-only, cross-tenant KPIs from services/platform-analytics, plus one
 * write: marking a company as a test tenant so it stays out of the numbers.
 * Every route here is superadmin-only.
 *
 * Query string, shared by every read:
 *   start, end   YYYY-MM-DD, inclusive, in America/Winnipeg (default: last 30 days)
 *   test         1 = include test / internal tenants (default: leave them out)
 *   tenant       one company id
 *   industry     one industry id
 *   billing      trialing | active | past_due | canceled | none
 *   grain        day | week | month (charts)
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireSuperadmin } from "../middleware/auth";
import { audit } from "../lib/audit";
import { jsonBody } from "../lib/validate";
import {
  catalog,
  explore,
  overview,
  setInternal,
  tenantDetail,
  tenants,
  type AnalyticsParams,
  type Dimension,
} from "../../services/platform-analytics";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 3660;

const Query = z.object({
  start: z.string().regex(DAY).optional(),
  end: z.string().regex(DAY).optional(),
  test: z.enum(["0", "1"]).optional(),
  tenant: z.string().trim().min(1).max(80).optional(),
  industry: z.string().trim().min(1).max(80).optional(),
  billing: z.enum(["trialing", "active", "past_due", "canceled", "unpaid", "none"]).optional(),
  grain: z.enum(["day", "week", "month"]).optional(),
});

type ParseResult = { ok: true; params: AnalyticsParams } | { ok: false; message: string };

/** Validate the shared filters; dates must be real, in order and at most ten years apart. */
export function parseParams(raw: Record<string, string | undefined>): ParseResult {
  const q = Query.safeParse(raw);
  if (!q.success) return { ok: false, message: q.error.issues[0]?.message ?? "Invalid filters" };
  const { start, end } = q.data;
  for (const d of [start, end]) {
    if (d && Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return { ok: false, message: `"${d}" isn't a date` };
  }
  if (start && end) {
    const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
    if (days < 1) return { ok: false, message: "The start date is after the end date" };
    if (days > MAX_DAYS) return { ok: false, message: "Pick a range of ten years or less" };
  }
  let grain = q.data.grain ?? null;
  // Thousands of daily bars help nobody and cost a long query: step up.
  if (grain === "day" && start && end) {
    const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
    if (days > 400) grain = "week";
  }
  return {
    ok: true,
    params: {
      start_day: start ?? null,
      end_day: end ?? null,
      include_test: q.data.test === "1",
      tenant: q.data.tenant ?? null,
      industry: q.data.industry ?? null,
      billing: q.data.billing ?? null,
      grain,
    },
  };
}

type SessionUser = { id?: string; name?: string };

const DIMENSIONS = new Set<Dimension>([
  "time", "tenant", "industry", "billing", "status", "priority", "channel", "recipient", "role", "rating", "kind", "currency",
]);

export const platformAnalyticsRoutes = new Hono<AppEnv>()
  .use("*", requireSuperadmin)

  .get("/catalog", async (c) => c.json(await catalog()))

  .get("/overview", async (c) => {
    const p = parseParams(c.req.query());
    if (!p.ok) return c.json({ message: p.message }, 400);
    return c.json(await overview(p.params));
  })

  .get("/tenants", async (c) => {
    const p = parseParams(c.req.query());
    if (!p.ok) return c.json({ message: p.message }, 400);
    return c.json({ tenants: await tenants(p.params), generatedAt: new Date().toISOString() });
  })

  .get("/tenants/:id", async (c) => {
    const p = parseParams(c.req.query());
    if (!p.ok) return c.json({ message: p.message }, 400);
    return c.json(await tenantDetail(c.req.param("id"), p.params));
  })

  .get("/explore", async (c) => {
    const p = parseParams(c.req.query());
    if (!p.ok) return c.json({ message: p.message }, 400);
    const metric = c.req.query("metric") ?? "";
    const by = (c.req.query("by") ?? "time") as Dimension;
    if (!DIMENSIONS.has(by)) return c.json({ message: `Unknown breakdown "${by}"` }, 400);
    try {
      return c.json(await explore(metric, by, p.params));
    } catch (e) {
      const msg = (e as Error).message;
      // The registry refuses unknown metrics and unsupported breakdowns: a bad request, not a crash.
      if (/^Unknown metric|can't be broken down/.test(msg)) return c.json({ message: msg }, 400);
      throw e;
    }
  })

  .patch("/tenants/:id", jsonBody(z.object({ internal: z.boolean() })), async (c) => {
    const me = c.get("user") as SessionUser | undefined;
    const id = c.req.param("id");
    const { internal } = c.req.valid("json");
    const row = await setInternal(id, internal);
    if (!row) return c.json({ message: "Company not found" }, 404);
    await audit({
      actorId: me?.id,
      actorName: me?.name,
      action: "update",
      entityType: "company",
      entityId: id,
      summary: internal
        ? `Marked "${row.name}" as a test tenant (left out of platform analytics)`
        : `Counted "${row.name}" in platform analytics again`,
      companyId: id,
    });
    return c.json({ tenant: row });
  });
