/**
 * SKILL CLASSES: each company's own list (Settings → Skill Classes).
 *
 *   GET    /api/skill-classes          the list, with how many technicians and open jobs use each
 *   PUT    /api/skill-classes          save the list (add, remove, reorder)
 *   POST   /api/skill-classes/rename   rename one, carrying its technicians and jobs with it
 *
 * Removing a class from the list doesn't touch anyone filed under it: the
 * technician keeps it (shown as "no longer in the list") until someone picks
 * another. Renaming is the way to move people and jobs across.
 */
import { Hono } from "hono";
import { z } from "zod";
import { and, isNull, sql } from "drizzle-orm";
import * as schema from "../database/schema";
import { officeCan, requireAuth, tx, tenantId } from "../middleware/auth";
import { jsonBody } from "../lib/validate";
import { audit } from "../lib/audit";
import { MAX_SKILL_CLASSES, MAX_SKILL_CLASS_LEN, cleanSkillClasses, parseSkillClasses, renameSkillClass } from "../../shared/skill-classes";
import type { AppEnv } from "../env";

type SessionUser = { id: string; name?: string; role?: string; email: string };

const name = z.string().trim().min(1, "A skill class needs a name").max(MAX_SKILL_CLASS_LEN, `Keep it under ${MAX_SKILL_CLASS_LEN} characters`);
const PutBody = z.object({ classes: z.array(name).min(1, "Keep at least one skill class").max(MAX_SKILL_CLASSES, `At most ${MAX_SKILL_CLASSES} skill classes`) });
const RenameBody = z.object({ from: name, to: name });

async function settingsRow(c: any) {
  const t = tx(c);
  let row = await t.selectOne(schema.companySettings);
  if (!row) [row] = await t.insert(schema.companySettings, { id: tenantId(c) });
  return row!;
}

/** Technicians and open jobs per class name (lower-cased key), for the list's counts. */
async function usage(c: any): Promise<Record<string, { techs: number; jobs: number; name: string }>> {
  const t = tx(c);
  const out: Record<string, { techs: number; jobs: number; name: string }> = {};
  const bump = (n: string | null | undefined, k: "techs" | "jobs") => {
    const v = (n ?? "").trim();
    if (!v) return;
    const key = v.toLowerCase();
    out[key] ??= { techs: 0, jobs: 0, name: v };
    out[key][k]++;
  };
  for (const r of await t.select(schema.riders)) bump(r.skillClass, "techs");
  const jobs = await t.select(
    schema.bookings,
    and(isNull(schema.bookings.deletedAt), sql`${schema.bookings.status} not in ('completed','cancelled')`, sql`${schema.bookings.requiredSkillClass} <> ''`),
  );
  for (const b of jobs) bump(b.requiredSkillClass, "jobs");
  return out;
}

export const skillClassRoutes = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const row = await settingsRow(c);
    const classes = parseSkillClasses(row.skillClasses);
    const used = await usage(c);
    const listed = new Set(classes.map((n) => n.toLowerCase()));
    return c.json(
      {
        classes: classes.map((n) => ({ name: n, techs: used[n.toLowerCase()]?.techs ?? 0, jobs: used[n.toLowerCase()]?.jobs ?? 0 })),
        // In use but not in the list (removed, or from before the list existed).
        unlisted: Object.entries(used)
          .filter(([k]) => !listed.has(k))
          .map(([, v]) => v)
          .sort((a, b) => a.name.localeCompare(b.name)),
        custom: !!row.skillClasses.trim(),
      },
      200,
    );
  })

  .put("/", requireAuth, jsonBody(PutBody), async (c) => {
    const u = c.get("user") as SessionUser;
    if (!(await officeCan(u, "techs:edit"))) return c.json({ message: "Forbidden" }, 403);
    const classes = cleanSkillClasses(c.req.valid("json").classes);
    if (!classes.length) return c.json({ message: "Keep at least one skill class" }, 400);
    await settingsRow(c);
    await tx(c).update(schema.companySettings, { skillClasses: JSON.stringify(classes), updatedAt: new Date() } as any, undefined);
    await audit({ actorId: u.id, actorName: u.name, action: "update", entityType: "company_settings", entityId: tenantId(c), summary: `Skill classes: ${classes.join(", ")}` });
    return c.json({ classes }, 200);
  })

  .post("/rename", requireAuth, jsonBody(RenameBody), async (c) => {
    const u = c.get("user") as SessionUser;
    if (!(await officeCan(u, "techs:edit"))) return c.json({ message: "Forbidden" }, 403);
    const { from, to } = c.req.valid("json");
    const row = await settingsRow(c);
    const list = parseSkillClasses(row.skillClasses);
    // A class that's only in use (not listed) can be renamed too: it joins the list.
    const base = list.some((n) => n.toLowerCase() === from.toLowerCase()) ? list : [...list, from];
    const next = renameSkillClass(base, from, to);
    const target = next.find((n) => n.toLowerCase() === to.replace(/\s+/g, " ").trim().toLowerCase()) ?? to.trim();
    const t = tx(c);
    await t.update(schema.companySettings, { skillClasses: JSON.stringify(next), updatedAt: new Date() } as any, undefined);
    const techs = await t.update(schema.riders, { skillClass: target } as any, sql`lower(${schema.riders.skillClass}) = ${from.toLowerCase()}`);
    const jobs = await t.update(schema.bookings, { requiredSkillClass: target } as any, and(sql`lower(${schema.bookings.requiredSkillClass}) = ${from.toLowerCase()}`, isNull(schema.bookings.deletedAt)));
    await audit({
      actorId: u.id, actorName: u.name, action: "update", entityType: "company_settings", entityId: tenantId(c),
      summary: `Renamed skill class "${from}" to "${target}" (${techs.length} technicians, ${jobs.length} jobs)`,
    });
    return c.json({ classes: next, techs: techs.length, jobs: jobs.length }, 200);
  });
