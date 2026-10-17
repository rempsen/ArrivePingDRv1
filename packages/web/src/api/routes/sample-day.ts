/**
 * /api/sample-day — the banner that sits over a new company's sample day.
 *
 *   GET    status (office roles). Also re-lays the day around "now" when the
 *          plan is more than 12 hours old (services/sample-day.ts).
 *   DELETE clear every sample row (admins).
 *   POST   add the sample day back after it was cleared (admins).
 */
import { Hono } from "hono";
import { requireAdmin, requireAuth, tenantId } from "../middleware/auth";
import { audit } from "../lib/audit";
import { capture } from "../lib/analytics";
import { clearSampleDay, refreshSampleDay, sampleStatus, seedSampleDay } from "../../services/sample-day";
import type { AppEnv } from "../env";

const OFFICE = new Set(["superadmin", "admin", "manager", "dispatcher", "project_manager"]);

export const sampleDayRoutes = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const me = c.get("user") as { role?: string };
    if (!OFFICE.has(me.role ?? "")) return c.json({ active: false }, 200);
    const cid = tenantId(c);
    await refreshSampleDay(cid).catch((e) => console.error("[sample-day] refresh failed", e));
    return c.json(await sampleStatus(cid), 200);
  })
  .delete("/", requireAdmin, async (c) => {
    const cid = tenantId(c);
    const me = c.get("user") as { id: string; name?: string; email?: string };
    const r = await clearSampleDay(cid);
    await audit({
      companyId: cid,
      actorId: me.id,
      actorName: me.name ?? me.email ?? "",
      action: "delete",
      entityType: "sample_day",
      entityId: cid,
      summary: `Cleared sample data (${r.jobs} jobs, ${r.people} people${r.linkedJobs ? `, ${r.linkedJobs} jobs for sample customers` : ""}${r.unassigned ? `, ${r.unassigned} jobs unassigned` : ""})`,
    });
    capture("guide.sample_cleared", me.id, { companyId: cid, ...r });
    return c.json(r, 200);
  })
  .post("/", requireAdmin, async (c) => {
    const cid = tenantId(c);
    const me = c.get("user") as { id: string };
    const r = await seedSampleDay(cid, { force: true });
    if (!r.seeded) return c.json({ message: r.reason === "already present" ? "Sample data is already here." : "Couldn't add sample data." }, 409);
    capture("guide.sample_added", me.id, { companyId: cid });
    return c.json(r, 201);
  });
