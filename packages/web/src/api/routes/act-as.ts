/**
 * Leaving and checking Control Hub act-as (/api/act-as). Kept outside
 * /api/hub because these must work while the request is acting as someone
 * else (the hub itself refuses act-as requests).
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAuth } from "../middleware/auth";
import { jsonBody } from "../lib/validate";
import { currentSession, endActAs } from "../../services/act-as";

export const actAsRoutes = new Hono<AppEnv>()
  /** The session behind this request, or the staff member's open one. */
  .get("/current", requireAuth, async (c) => {
    const act = c.get("actAs");
    if (act) return c.json({ acting: true, session: act });
    if (!c.get("platformRole")) return c.json({ acting: false, session: null });
    const s = await currentSession((c.get("user") as { id: string }).id);
    return c.json({ acting: false, session: s ? { sessionId: s.id, companyId: s.companyId, targetName: s.targetName, expiresAt: s.expiresAt } : null });
  })
  /** Leave act-as: the session in the header, or one named in the body. */
  .post("/end", requireAuth, jsonBody(z.object({ sessionId: z.string().max(80).optional() })), async (c) => {
    const act = c.get("actAs");
    if (act) {
      await endActAs(act.sessionId, act.actorId);
      return c.json({ ok: true, companyId: act.companyId });
    }
    const { sessionId } = c.req.valid("json");
    if (!sessionId || !c.get("platformRole")) return c.json({ ok: true, companyId: null });
    await endActAs(sessionId, (c.get("user") as { id: string }).id);
    return c.json({ ok: true, companyId: null });
  });
