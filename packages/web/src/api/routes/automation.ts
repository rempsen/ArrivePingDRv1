import { Hono } from "hono";
import * as schema from "../database/schema";
import { eq, inArray } from "drizzle-orm";
import { requireAuth, tx } from "../middleware/auth";
import { z } from "zod";
import { jsonBody, shortText, longText } from "../lib/validate";
import type { AppEnv } from "../env";
import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  actionAssigns,
} from "../../shared/automation-templates";

/**
 * Automation rules were written straight from `await c.req.json()` — unvalidated,
 * and invisible to the RPC types (so the admin screen's calls couldn't be checked
 * either). `conditions`/`actionConfig` stay free-form objects because rule shapes
 * differ per trigger, but they must at least BE objects.
 *
 * `trigger` / `action` must be keys the engine knows, otherwise the rule would be
 * saved and silently never fire. `mode` is only "assign" for assigning actions —
 * a "send_sms" rule can't be in assign mode, so we coerce it back to suggest.
 */
const TRIGGER_KEYS = AUTOMATION_TRIGGERS.map((t) => t.key) as [string, ...string[]];
const ACTION_KEYS = AUTOMATION_ACTIONS.map((a) => a.key) as [string, ...string[]];

const RuleBody = z.object({
  name: shortText("Name", 120),
  description: longText(1_000).optional(),
  trigger: z.enum(TRIGGER_KEYS),
  action: z.enum(ACTION_KEYS),
  conditions: z.record(z.string(), z.unknown()).optional(),
  actionConfig: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
  mode: z.enum(["suggest", "assign"]).optional(),
  templateKey: z.string().max(64).optional(),
});

const RulePatch = RuleBody.partial();

function effectiveMode(action: string, mode: string | undefined): "suggest" | "assign" {
  return mode === "assign" && actionAssigns(action) ? "assign" : "suggest";
}

export const automationRoutes = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const rows = await tx(c).select(schema.automationRules);
    return c.json({ rules: rows }, 200);
  })
  /**
   * Everything the template knobs need to offer real choices: the company's
   * technicians (for hand-picked pools and zone owners), the skill classes
   * actually in use, and the active service zones.
   */
  .get("/context", requireAuth, async (c) => {
    const t = tx(c);
    const [riders, zones] = await Promise.all([
      t.select(schema.riders),
      t.select(schema.serviceZones, eq(schema.serviceZones.active, true)),
    ]);
    const users = riders.length
      ? await t.select(schema.user, inArray(schema.user.id, riders.map((r) => r.userId)))
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    const techs = riders
      .filter((r) => r.approval === "active")
      .map((r) => ({ id: r.id, name: names.get(r.userId) ?? "Technician", skillClass: r.skillClass, status: r.status }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const skillClasses = Array.from(new Set(riders.map((r) => r.skillClass).filter(Boolean))).sort();
    return c.json(
      {
        techs,
        skillClasses,
        zones: zones.map((z) => ({ id: z.id, name: z.name, color: z.color })).sort((a, b) => a.name.localeCompare(b.name)),
      },
      200,
    );
  })
  .post("/", requireAuth, jsonBody(RuleBody), async (c) => {
    const b = c.req.valid("json");
    const [r] = await tx(c).insert(schema.automationRules, {
      name: b.name,
      description: b.description ?? "",
      trigger: b.trigger,
      conditions: JSON.stringify(b.conditions ?? {}),
      action: b.action,
      actionConfig: JSON.stringify(b.actionConfig ?? {}),
      enabled: b.enabled ?? true,
      mode: effectiveMode(b.action, b.mode),
      templateKey: b.templateKey ?? "",
    });
    return c.json({ rule: r }, 201);
  })
  .patch("/:id", requireAuth, jsonBody(RulePatch), async (c) => {
    const b = c.req.valid("json");
    const id = c.req.param("id");
    const t = tx(c);
    const set: Record<string, unknown> = {};
    for (const k of ["name", "description", "trigger", "action", "enabled", "templateKey"] as const)
      if (b[k] !== undefined) set[k] = b[k];
    if (b.conditions !== undefined) set.conditions = JSON.stringify(b.conditions);
    if (b.actionConfig !== undefined) set.actionConfig = JSON.stringify(b.actionConfig);
    if (b.mode !== undefined || b.action !== undefined) {
      const cur = await t.selectOne(schema.automationRules, eq(schema.automationRules.id, id));
      if (!cur) return c.json({ error: "Rule not found" }, 404);
      set.mode = effectiveMode(b.action ?? cur.action, b.mode ?? cur.mode);
    }
    const [r] = await t.update(schema.automationRules, set, eq(schema.automationRules.id, id));
    if (!r) return c.json({ error: "Rule not found" }, 404);
    return c.json({ rule: r }, 200);
  })
  .delete("/:id", requireAuth, async (c) => {
    await tx(c).delete(
      schema.automationRules,
      eq(schema.automationRules.id, c.req.param("id")),
    );
    return c.json({ ok: true }, 200);
  });
