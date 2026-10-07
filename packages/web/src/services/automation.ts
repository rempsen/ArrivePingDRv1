/**
 * Automation engine — makes the `automation_rules` table actually do something.
 *
 * Until now rules could be created in the admin UI but nothing ever evaluated
 * them. This module is that evaluator. It is deliberately small and boring:
 *
 *   runAutomations(trigger, ctx)  ->  for each enabled rule of that trigger in
 *                                     that tenant, check conditions, run action
 *
 * Design rules:
 * - Best effort. A failing rule logs and moves on; it must NEVER fail the job
 *   or notification that triggered it.
 * - No parallel notification system. Actions reuse services/sms.ts,
 *   services/notify.ts and the existing job-events log.
 * - Event-driven triggers fire from dispatch.fireEvent(). Time-based triggers
 *   (tech_idle, sla_risk) are swept by the scheduler every minute.
 */
import { sdb } from "../api/database";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { sendSms, trackingUrl } from "./sms";
import { logJobEvent } from "./job-events";
import { distKm, predictDelays, techWorkload } from "./ai-dispatch";
import { assignJob } from "./assign";
import { companyTimeZone } from "./company-tz";
import { zonedParts, fmtInZone } from "../shared/tz";
import { inPoly, type LatLng } from "../shared/zone-utils";

export type AutomationTrigger =
  | "wo_created"
  | "tech_enroute"
  | "wo_completed"
  | "tech_idle"
  | "sla_risk";

/** Map an NvcEvent (dispatch) onto an automation trigger, if any. */
export const EVENT_TO_TRIGGER: Record<string, AutomationTrigger> = {
  created: "wo_created",
  enroute: "tech_enroute",
  completed: "wo_completed",
};

export interface AutomationCtx {
  companyId: string;
  bookingId?: string | null;
  /** Anything the action templates can interpolate: {{customerName}} etc. */
  vars?: Record<string, string | number | null>;
  /** Fields conditions can match on. */
  facts?: Record<string, unknown>;
}

function parse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw || "") as T;
  } catch {
    return fallback;
  }
}

/**
 * Condition matching. The common form is a flat object where every key must
 * match (AND):
 *
 *   { priority: "high" }                exact match
 *   { priority: ["high", "urgent"] }    any-of
 *   { minMinutes: 30 }                  numeric >= (keys prefixed min*)
 *   { maxMinutes: 30 }                  numeric <= (keys prefixed max*)
 *   { beforeHour: 8 } / { fromHour: 18 } hourOfDay <  / hourOfDay >=
 *
 * Three structural keys compose those into a tree, so templates can express
 * "outside business hours" or "urgent OR after 6 PM" while every existing flat
 * rule keeps matching exactly as before:
 *
 *   { any: [cond, cond] }   at least one sub-condition matches
 *   { all: [cond, cond] }   every sub-condition matches
 *   { not: cond }           sub-condition does not match
 *
 * An empty condition object always matches — that's the common case.
 */
export function conditionsMatch(
  conditions: Record<string, unknown>,
  facts: Record<string, unknown>,
): boolean {
  for (const [key, want] of Object.entries(conditions ?? {})) {
    if (want === "" || want == null) continue; // unset filter — ignore

    if (key === "any") {
      const subs = Array.isArray(want) ? want : [want];
      if (!subs.length) continue;
      if (!subs.some((c) => conditionsMatch(asObj(c), facts))) return false;
      continue;
    }
    if (key === "all") {
      const subs = Array.isArray(want) ? want : [want];
      if (!subs.every((c) => conditionsMatch(asObj(c), facts))) return false;
      continue;
    }
    if (key === "not") {
      if (conditionsMatch(asObj(want), facts)) return false;
      continue;
    }
    if (key === "beforeHour") {
      if (!(Number(facts.hourOfDay ?? -1) < Number(want))) return false;
      continue;
    }
    if (key === "fromHour") {
      if (!(Number(facts.hourOfDay ?? -1) >= Number(want))) return false;
      continue;
    }

    if (key.startsWith("min") && key.length > 3) {
      const factKey = key.slice(3, 4).toLowerCase() + key.slice(4);
      if (Number(facts[factKey] ?? 0) < Number(want)) return false;
      continue;
    }
    if (key.startsWith("max") && key.length > 3) {
      const factKey = key.slice(3, 4).toLowerCase() + key.slice(4);
      if (Number(facts[factKey] ?? 0) > Number(want)) return false;
      continue;
    }
    const have = facts[key];
    if (Array.isArray(want)) {
      if (!want.length) continue; // empty list = no filter
      if (!want.map(String).includes(String(have))) return false;
    } else if (typeof want === "boolean") {
      if (Boolean(have) !== want) return false;
    } else if (String(have) !== String(want)) {
      return false;
    }
  }
  return true;
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function interpolate(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));
}

/** Notify every admin/dispatcher in the tenant, in-app. */
async function notifyOffice(
  companyId: string,
  title: string,
  body: string,
  bookingId?: string | null,
) {
  const t = tdb(companyId);
  const admins = await t.select(
    schema.user,
    or(eq(schema.user.role, "admin"), eq(schema.user.role, "dispatcher")),
  );
  for (const a of admins) {
    await t.insert(schema.notifications, {
      userId: a.id,
      bookingId: bookingId ?? null,
      type: "automation",
      title,
      body,
    });
  }
}


// ── Booking facts ────────────────────────────────────────────────────────────
// Event callers pass a few facts inline (priority, service, status, region).
// Anything that needs a lookup — skill class, which service zone the address
// falls in, local hour — is resolved here, once per evaluation, and only when
// at least one rule for the trigger exists (so the common no-rules case costs
// nothing extra).

type BookingRow = typeof schema.bookings.$inferSelect;
type RiderRow = typeof schema.riders.$inferSelect;
type ZoneRow = typeof schema.serviceZones.$inferSelect;

function zonePolygon(z: ZoneRow): LatLng[] {
  const poly = parse<unknown>(z.polygon, []);
  return Array.isArray(poly) ? (poly as LatLng[]) : [];
}

/** First active zone containing the point, or null. */
export function zoneFor(lat: number | null, lng: number | null, zones: ZoneRow[]): ZoneRow | null {
  if (lat == null || lng == null) return null;
  for (const z of zones) {
    if (!z.active) continue;
    const poly = zonePolygon(z);
    if (poly.length >= 3 && inPoly(lat, lng, poly)) return z;
  }
  return null;
}

async function bookingFacts(
  companyId: string,
  b: BookingRow,
  now: Date,
): Promise<{ facts: Record<string, unknown>; vars: Record<string, string | number | null>; zone: ZoneRow | null }> {
  const t = tdb(companyId);
  const [zones, tz] = await Promise.all([
    t.select(schema.serviceZones, eq(schema.serviceZones.active, true)).catch(() => [] as ZoneRow[]),
    companyTimeZone(companyId),
  ]);
  const zone = zoneFor(b.lat, b.lng, zones);
  const parts = zonedParts(now, tz);
  return {
    facts: {
      priority: b.priority,
      status: b.status,
      region: b.region,
      requiredSkillClass: b.requiredSkillClass || "",
      zoneId: zone?.id ?? "",
      zone: zone?.name ?? "",
      hourOfDay: parts.hour,
      weekday: fmtInZone(now, tz, { weekday: "short" }).toLowerCase(),
      assigned: !!b.riderId,
    },
    vars: {
      jobName: b.title,
      shortId: b.id.slice(0, 6).toUpperCase(),
      address: b.address,
      priority: b.priority,
      zone: zone?.name ?? "",
      localTime: fmtInZone(now, tz, { hour: "numeric", minute: "2-digit" }),
      token: b.publicToken,
      trackUrl: trackingUrl(b.publicToken),
    },
    zone,
  };
}

// ── Assignment actions ───────────────────────────────────────────────────────

interface Pick {
  rider: RiderRow;
  name: string;
  why: string;
}

interface TechCtx {
  techs: RiderRow[];
  names: Map<string, string>;
  load: Map<string, { openJobs: number; freeInMins: number }>;
  zones: ZoneRow[];
}

async function loadTechCtx(companyId: string): Promise<TechCtx> {
  const t = tdb(companyId);
  const techs = await t.select(schema.riders);
  const users = techs.length
    ? await t.select(schema.user, inArray(schema.user.id, techs.map((r) => r.userId)))
    : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  const svcRows = await t.select(schema.services);
  const durations = new Map(svcRows.map((x) => [x.id, x.durationMins]));
  const [load, zones] = await Promise.all([
    techWorkload(companyId, durations),
    t.select(schema.serviceZones, eq(schema.serviceZones.active, true)).catch(() => [] as ZoneRow[]),
  ]);
  return { techs, names: new Map(techs.map((r) => [r.id, names.get(r.userId) ?? "Technician"])), load, zones };
}

function skillOk(r: RiderRow, b: BookingRow): boolean {
  const want = (b.requiredSkillClass || "").trim().toLowerCase();
  if (!want) return true;
  if ((r.skillClass || "").trim().toLowerCase() === want) return true;
  return r.skills.toLowerCase().split(",").map((x) => x.trim()).includes(want);
}

const FREE = new Set(["available"]);
const WORKING = new Set(["available", "enroute", "onsite", "busy"]);

/**
 * Live presence (available / enroute / offline) only tells you who can take a
 * job RIGHT NOW. A job booked for tomorrow morning shouldn't be refused just
 * because the whole team has clocked off tonight — for those, every active
 * tech is a candidate and shifts/time-off are checked at assignment time.
 */
const SOON_MS = 2 * 60 * 60 * 1000;
export function startsSoon(b: { scheduledAt: Date | null }, now = Date.now()): boolean {
  if (!b.scheduledAt) return true;
  return Number(b.scheduledAt) - now <= SOON_MS;
}

/** Techs a rule may consider at all, after its own filters. */
function eligible(cfg: Record<string, any>, b: BookingRow, tc: TechCtx, opts: { onlyAvailable: boolean }): RiderRow[] {
  const requireSkill = cfg.requireSkill !== false && cfg.requireSkill !== "false";
  return tc.techs.filter((r) => {
    if (r.status === "offline" && opts.onlyAvailable) return false;
    if (opts.onlyAvailable && !FREE.has(r.status)) return false;
    if (!opts.onlyAvailable && !WORKING.has(r.status) && r.status !== "offline") return false;
    if (requireSkill && !skillOk(r, b)) return false;
    return true;
  });
}

function km(r: RiderRow, b: BookingRow): number | null {
  if (r.lat == null || r.lng == null || b.lat == null || b.lng == null) return null;
  return distKm(r.lat, r.lng, b.lat, b.lng);
}

function nearest(pool: RiderRow[], b: BookingRow, tc: TechCtx, maxKm: number): Pick | null {
  const ranked = pool
    .map((r) => ({ r, d: km(r, b) }))
    .filter((x) => x.d == null || x.d <= maxKm)
    .sort((a, z) => (a.d ?? 1e9) - (z.d ?? 1e9) || (tc.load.get(a.r.id)?.openJobs ?? 0) - (tc.load.get(z.r.id)?.openJobs ?? 0));
  const top = ranked[0];
  if (!top) return null;
  return {
    rider: top.r,
    name: tc.names.get(top.r.id) ?? "Technician",
    why: top.d != null ? `${top.d.toFixed(1)} km away, available` : "available (location unknown)",
  };
}

function leastLoaded(pool: RiderRow[], b: BookingRow, tc: TechCtx): Pick | null {
  const ranked = [...pool].sort((a, z) => {
    const la = tc.load.get(a.id) ?? { openJobs: 0, freeInMins: 0 };
    const lz = tc.load.get(z.id) ?? { openJobs: 0, freeInMins: 0 };
    return la.openJobs - lz.openJobs || la.freeInMins - lz.freeInMins || (km(a, b) ?? 1e9) - (km(z, b) ?? 1e9);
  });
  const top = ranked[0];
  if (!top) return null;
  const l = tc.load.get(top.id) ?? { openJobs: 0, freeInMins: 0 };
  return {
    rider: top,
    name: tc.names.get(top.id) ?? "Technician",
    why: l.openJobs === 0 ? "nothing else on their plate" : `${l.openJobs} open stop${l.openJobs === 1 ? "" : "s"}, lightest load`,
  };
}

/**
 * Round-robin: stable rotation by rider id, pointer persisted per group in the
 * rule's actionConfig (`rr: { [groupKey]: lastRiderId }`). Pure so it can be
 * unit-tested; the caller writes the pointer back.
 */
export function pickRoundRobin<T extends { id: string }>(pool: T[], lastId: string | undefined | null): T | null {
  if (!pool.length) return null;
  const sorted = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  if (!lastId) return sorted[0]!;
  const next = sorted.find((r) => r.id.localeCompare(lastId) > 0);
  return next ?? sorted[0]!;
}

function roundRobin(
  cfg: Record<string, any>,
  b: BookingRow,
  tc: TechCtx,
  zone: ZoneRow | null,
): { pick: Pick | null; groupKey: string; nextCfg: Record<string, any> | null } {
  const scope = String(cfg.scope || "team");
  const onlyAvailable = cfg.onlyAvailable !== false && cfg.onlyAvailable !== "false" && startsSoon(b);
  let pool = eligible(cfg, b, tc, { onlyAvailable });
  let groupKey = "team";
  if (scope === "skill_class") {
    groupKey = `skill:${(b.requiredSkillClass || "any").toLowerCase()}`;
    if (b.requiredSkillClass) pool = pool.filter((r) => skillOk(r, b));
  } else if (scope === "zone") {
    if (!zone) return { pick: null, groupKey: "zone:none", nextCfg: null };
    groupKey = `zone:${zone.id}`;
    const roster: string[] = Array.isArray(cfg.zoneTechs?.[zone.id]) ? cfg.zoneTechs[zone.id] : [];
    pool = pool.filter((r) => roster.includes(r.id));
  } else if (scope === "custom") {
    groupKey = "custom";
    const roster: string[] = Array.isArray(cfg.pool) ? cfg.pool : [];
    pool = pool.filter((r) => roster.includes(r.id));
  }
  const rr: Record<string, string> = asObj(cfg.rr) as Record<string, string>;
  const chosen = pickRoundRobin(pool, rr[groupKey]);
  if (!chosen) return { pick: null, groupKey, nextCfg: null };
  return {
    pick: { rider: chosen, name: tc.names.get(chosen.id) ?? "Technician", why: "next in rotation" },
    groupKey,
    nextCfg: { ...cfg, rr: { ...rr, [groupKey]: chosen.id } },
  };
}

async function runAssignment(
  rule: typeof schema.automationRules.$inferSelect,
  ctx: AutomationCtx,
  cfg: Record<string, any>,
): Promise<string> {
  if (!ctx.bookingId) return "skipped: no job in context";
  const t = tdb(rule.companyId);
  const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, ctx.bookingId));
  if (!b) return "skipped: job not found";
  // Never steal a job somebody already has, and never touch finished work.
  if (b.riderId) return "skipped: job already has a technician";
  if (!["pending", "confirmed"].includes(b.status)) return `skipped: job is ${b.status}`;

  const tc = await loadTechCtx(rule.companyId);
  const zone = zoneFor(b.lat, b.lng, tc.zones);
  const action = rule.action === "auto_assign" ? "assign_nearest" : rule.action;
  let pick: Pick | null = null;
  let nextCfg: Record<string, any> | null = null;
  const soon = startsSoon(b);

  if (action === "assign_nearest") {
    const pool = eligible(cfg, b, tc, { onlyAvailable: soon });
    pick = nearest(pool, b, tc, Number(cfg.maxKm) > 0 ? Number(cfg.maxKm) : 1e9);
  } else if (action === "assign_least_loaded") {
    const pool = eligible(cfg, b, tc, { onlyAvailable: soon });
    pick = leastLoaded(pool, b, tc);
  } else if (action === "assign_round_robin") {
    const rr = roundRobin(cfg, b, tc, zone);
    pick = rr.pick;
    nextCfg = rr.nextCfg;
    if (!pick && rr.groupKey === "zone:none") return "skipped: job is outside every service zone";
  } else if (action === "assign_zone_owner") {
    const owners = asObj(cfg.zoneOwners) as Record<string, string>;
    const ownerId = zone ? owners[zone.id] : undefined;
    const owner = ownerId ? tc.techs.find((r) => r.id === ownerId) : undefined;
    if (owner && (!soon || owner.status !== "offline")) {
      pick = { rider: owner, name: tc.names.get(owner.id) ?? "Technician", why: `owns the ${zone!.name} zone` };
    } else if (String(cfg.fallback) === "nearest") {
      pick = nearest(eligible(cfg, b, tc, { onlyAvailable: soon }), b, tc, 1e9);
    } else {
      return zone
        ? `skipped: no available owner mapped for zone "${zone.name}"`
        : "skipped: job is outside every mapped zone";
    }
  } else {
    return `unknown assignment action "${rule.action}"`;
  }

  if (!pick) return "skipped: no eligible technician right now";

  if (rule.mode !== "assign") {
    await notifyOffice(
      rule.companyId,
      `Suggested: ${pick.name} for ${b.title || "this job"}`,
      `Rule "${rule.name}" recommends ${pick.name} (${pick.why}). Assign from the scheduler to confirm.`,
      b.id,
    );
    return `suggested ${pick.name} (${pick.why})`;
  }

  const r = await assignJob(rule.companyId, b.id, pick.rider.id, {
    by: { kind: "automation", ruleId: rule.id, ruleName: rule.name },
  });
  if (!r.ok) {
    await notifyOffice(
      rule.companyId,
      `Couldn't auto-assign ${b.title || "job"}`,
      `Rule "${rule.name}" picked ${pick.name} but the assignment was refused: ${r.message}`,
      b.id,
    );
    return `assign refused for ${pick.name}: ${r.message}`;
  }
  if (nextCfg) {
    await t.update(
      schema.automationRules,
      { actionConfig: JSON.stringify(nextCfg) },
      eq(schema.automationRules.id, rule.id),
    );
  }
  await notifyOffice(
    rule.companyId,
    `Auto-assigned: ${pick.name} → ${b.title || "job"}`,
    `Rule "${rule.name}" dispatched ${pick.name} (${pick.why}). The job carries an A badge.`,
    b.id,
  );
  return `auto-assigned to ${pick.name} (${pick.why})`;
}

/** Execute one rule's action. Throws only on programmer error; callers catch. */
async function runAction(
  rule: typeof schema.automationRules.$inferSelect,
  ctx: AutomationCtx,
): Promise<string> {
  const cfg = parse<Record<string, any>>(rule.actionConfig, {});
  const vars = ctx.vars ?? {};

  switch (rule.action) {
    case "send_sms": {
      const to = String(cfg.to || vars.customerPhone || "");
      const body = interpolate(String(cfg.message || ""), vars);
      if (!to || !body) return "skipped: no recipient or message";
      const res = await sendSms(to, body);
      return res.ok ? `sms sent to ${to}` : `sms failed: ${res.error}`;
    }
    case "notify_dispatch":
    case "escalate": {
      const title = interpolate(
        String(cfg.title || rule.name || "Automation"),
        vars,
      );
      const body = interpolate(
        String(cfg.message || rule.description || ""),
        vars,
      );
      await notifyOffice(rule.companyId, title, body, ctx.bookingId);
      return "office notified";
    }
    case "auto_assign":
    case "assign_nearest":
    case "assign_round_robin":
    case "assign_zone_owner":
    case "assign_least_loaded":
      return runAssignment(rule, ctx, cfg);
    case "reroute": {
      await notifyOffice(
        rule.companyId,
        "Reroute suggested",
        `Rule "${rule.name}" suggests rerouting. ${
          ctx.bookingId ? trackingUrl(String(vars.token ?? "")) : ""
        }`.trim(),
        ctx.bookingId,
      );
      return "reroute suggested";
    }
    default:
      return `unknown action "${rule.action}"`;
  }
}

/**
 * Evaluate every enabled rule for a trigger. Never throws.
 * Returns the number of rules that actually ran.
 */
export async function runAutomations(
  trigger: AutomationTrigger,
  ctxIn: AutomationCtx,
): Promise<number> {
  let ctx = ctxIn;
  let ran = 0;
  try {
    const t = tdb(ctx.companyId);
    const rules = await t.select(
      schema.automationRules,
      and(
        eq(schema.automationRules.trigger, trigger),
        eq(schema.automationRules.enabled, true),
      ),
    );

    if (!rules.length) return 0;
    rules.sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0));

    // Resolve lookup-backed facts (zone, skill class, local hour) once.
    if (ctx.bookingId) {
      const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, ctx.bookingId));
      if (b) {
        const extra = await bookingFacts(ctx.companyId, b, new Date());
        ctx = {
          ...ctx,
          facts: { ...extra.facts, ...ctx.facts },
          vars: { ...extra.vars, ...ctx.vars },
        };
      }
    }

    // Assignment rules run in priority order (nearest/zone first is arbitrary
    // but stable: creation order), and only the first one that actually
    // dispatches wins — the job has a tech after that, so later ones skip.
    for (const rule of rules) {
      try {
        const conds = parse<Record<string, unknown>>(rule.conditions, {});
        if (!conditionsMatch(conds, ctx.facts ?? {})) continue;

        const outcome = await runAction(rule, ctx);
        ran++;

        await t.update(
          schema.automationRules,
          {
            runsCount: (rule.runsCount ?? 0) + 1,
            lastRunAt: new Date(),
          },
          eq(schema.automationRules.id, rule.id),
        );

        if (ctx.bookingId) {
          await logJobEvent({
            companyId: ctx.companyId,
            bookingId: ctx.bookingId,
            kind: "note_added",
            actorRole: "system",
            actorName: "Automation",
            label: `Automation: ${rule.name}`,
            detail: outcome,
          });
        }
      } catch (e) {
        console.error("[automation] rule failed", rule.id, rule.name, e);
      }
    }
  } catch (e) {
    console.error("[automation] evaluation failed", trigger, e);
  }
  return ran;
}

// ── Time-based triggers ──────────────────────────────────────────────────────
// Event triggers fire inline from dispatch. These two are conditions of time
// passing, so nothing fires them — the scheduler sweeps for them each minute.

const IDLE_FLAGGED = new Map<string, number>(); // riderId -> last flagged ms
const SLA_FLAGGED = new Map<string, number>(); // bookingId -> last flagged ms
const REFLAG_AFTER_MS = 60 * 60 * 1000; // don't nag more than hourly

function recentlyFlagged(map: Map<string, number>, key: string): boolean {
  const last = map.get(key);
  if (last && Date.now() - last < REFLAG_AFTER_MS) return true;
  map.set(key, Date.now());
  return false;
}

/**
 * Sweep for time-based automation triggers. Called by the scheduler.
 * Only walks tenants that actually have an enabled time-based rule, so the
 * common case (nobody uses them) costs one indexed query per minute.
 */
export async function sweepTimeTriggers(now: Date = new Date()): Promise<number> {
  let fired = 0;
  try {
    // Scanning enabled rules across EVERY tenant to find which companies have
    // a time-based rule at all — same reasoning as services/scheduler.ts:
    // no single companyId to scope this initial scan to, so it runs on the
    // system (BYPASSRLS) connection. Everything after resolves a companyId
    // and goes back through tdb().
    const timeRules = await sdb
      .select()
      .from(schema.automationRules)
      .where(eq(schema.automationRules.enabled, true));
    const relevant = timeRules.filter(
      (r) => r.trigger === "tech_idle" || r.trigger === "sla_risk",
    );
    if (!relevant.length) return 0;

    const companies = [...new Set(relevant.map((r) => r.companyId))];

    for (const companyId of companies) {
      const rules = relevant.filter((r) => r.companyId === companyId);

      // ── tech_idle: available techs with no active job ──
      if (rules.some((r) => r.trigger === "tech_idle")) {
        const idleMins = Math.max(
          5,
          Math.min(
            ...rules
              .filter((r) => r.trigger === "tech_idle")
              .map((r) => Number(parse<any>(r.conditions, {}).minMinutes ?? 30)),
          ),
        );
        const t = tdb(companyId);
        const techs = await t.select(schema.riders, eq(schema.riders.status, "available"));
        for (const tech of techs) {
          const since = tech.locationUpdatedAt ? Number(tech.locationUpdatedAt) : null;
          const mins = since ? (now.getTime() - since) / 60000 : idleMins + 1;
          if (mins < idleMins) continue;
          const u = await t.selectOne(schema.user, eq(schema.user.id, tech.userId));
          if (recentlyFlagged(IDLE_FLAGGED, tech.id)) continue;
          fired += await runAutomations("tech_idle", {
            companyId,
            vars: { techName: u?.name ?? "", idleMinutes: Math.round(mins) },
            facts: { idleMinutes: Math.round(mins), minutes: Math.round(mins) },
          });
        }
      }

      // ── sla_risk: scheduled soon (or overdue) and still unassigned ──
      if (rules.some((r) => r.trigger === "sla_risk")) {
        const leadMins = Math.max(
          5,
          Math.min(
            ...rules
              .filter((r) => r.trigger === "sla_risk")
              .map((r) => Number(parse<any>(r.conditions, {}).minMinutes ?? 60)),
          ),
        );
        const t2 = tdb(companyId);
        const open = await t2.select(
          schema.bookings,
          and(eq(schema.bookings.status, "pending"), isNull(schema.bookings.deletedAt)),
        );
        for (const b of open) {
          if (!b.scheduledAt) continue;
          const minsUntil = (Number(b.scheduledAt) - now.getTime()) / 60000;
          if (minsUntil > leadMins) continue;
          if (recentlyFlagged(SLA_FLAGGED, b.id)) continue;
          fired += await runAutomations("sla_risk", {
            companyId,
            bookingId: b.id,
            vars: {
              jobName: b.title,
              shortId: b.id.slice(0, 6).toUpperCase(),
              address: b.address,
              minutesUntil: Math.round(minsUntil),
              token: b.publicToken,
            },
            facts: {
              minutesUntil: Math.round(minsUntil),
              minutes: Math.round(minsUntil),
              priority: b.priority,
              risk: "unassigned",
            },
          });
        }

        // ── sla_risk (Phase 5): jobs ALREADY assigned but projected to finish
        // late. The check above only ever saw unassigned work approaching its
        // window — it was blind to a tech running 40 minutes behind.
        const risks = await predictDelays(companyId, { graceMins: 15 });
        for (const r of risks) {
          if (recentlyFlagged(SLA_FLAGGED, r.bookingId)) continue;
          const bk = await tdb(companyId).selectOne(schema.bookings, eq(schema.bookings.id, r.bookingId));
          if (!bk) continue;
          fired += await runAutomations("sla_risk", {
            companyId,
            bookingId: r.bookingId,
            vars: {
              jobName: r.title,
              shortId: r.bookingId.slice(0, 6).toUpperCase(),
              address: r.address,
              techName: r.techName,
              minutesLate: r.minutesLate,
              minutesUntil: 0,
              token: bk.publicToken,
            },
            facts: {
              minutesLate: r.minutesLate,
              minutes: r.minutesLate,
              minutesUntil: 0,
              priority: bk.priority,
              risk: "running_late",
              status: r.status,
            },
          });
        }
      }
    }
  } catch (e) {
    console.error("[automation] time sweep failed", e);
  }
  return fired;
}
