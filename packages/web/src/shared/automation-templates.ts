/**
 * Automation template catalogue — shared by the admin UI (gallery + knob
 * forms) and the engine (services/automation.ts). Pure data + pure helpers;
 * no imports from either side so both can use it.
 *
 * A template is a prefilled rule (trigger / conditions / action / actionConfig)
 * plus a handful of plain-English "knobs" the office can turn. Knobs write to
 * a dotted path inside the rule (`conditions.priority`, `actionConfig.maxKm`).
 *
 * Engine contract (keys MUST match services/automation.ts):
 *   triggers: wo_created | tech_enroute | wo_completed | tech_idle | sla_risk
 *   actions:  notify_dispatch | send_sms | escalate | reroute |
 *             assign_nearest | assign_round_robin | assign_zone_owner | assign_least_loaded
 */

export const AUTOMATION_TRIGGERS = [
  { key: "wo_created", label: "Work order created" },
  { key: "tech_enroute", label: "Technician en route" },
  { key: "wo_completed", label: "Work order completed" },
  { key: "tech_idle", label: "Technician idle (time-based)" },
  { key: "sla_risk", label: "SLA at risk (time-based)" },
] as const;

export const AUTOMATION_ACTIONS = [
  { key: "notify_dispatch", label: "Notify dispatch", assigns: false },
  { key: "send_sms", label: "Send SMS", assigns: false },
  { key: "escalate", label: "Escalate to office", assigns: false },
  { key: "reroute", label: "Suggest reroute", assigns: false },
  { key: "assign_nearest", label: "Assign nearest available tech", assigns: true },
  { key: "assign_round_robin", label: "Assign by round-robin", assigns: true },
  { key: "assign_zone_owner", label: "Assign the zone's owner", assigns: true },
  { key: "assign_least_loaded", label: "Assign least-loaded tech", assigns: true },
  // legacy key kept so pre-existing rules still resolve to a label
  { key: "auto_assign", label: "Assign nearest available tech", assigns: true },
] as const;

export type AutomationTriggerKey = (typeof AUTOMATION_TRIGGERS)[number]["key"];
export type AutomationActionKey = (typeof AUTOMATION_ACTIONS)[number]["key"];

/** Actions that can really dispatch a job when the rule's mode is "assign". */
export const ASSIGNING_ACTIONS: ReadonlySet<string> = new Set(
  AUTOMATION_ACTIONS.filter((a) => a.assigns).map((a) => a.key),
);

export function actionAssigns(action: string): boolean {
  return ASSIGNING_ACTIONS.has(action);
}

export type RuleMode = "suggest" | "assign";

/**
 * zone_owners → Record<zoneId, techId>   (one tech per zone)
 * zone_roster → Record<zoneId, techId[]> (several techs per zone)
 * tech_pool   → techId[]
 */
export type KnobType = "select" | "multiselect" | "number" | "text" | "textarea" | "tech" | "zone_owners" | "zone_roster" | "tech_pool";

export interface Knob {
  key: string;
  label: string;
  help?: string;
  type: KnobType;
  /** dotted path into the rule: "conditions.priority" | "actionConfig.maxKm" */
  path: string;
  /** static options for select/multiselect; dynamic knobs (tech, zone_owners) load their own */
  options?: Array<{ value: string; label: string }>;
  /** named dynamic option source the UI resolves (skill classes, zones, techs) */
  source?: "skillClasses" | "zones" | "techs" | "priorities";
  min?: number;
  max?: number;
  placeholder?: string;
}

export interface AutomationTemplate {
  key: string;
  name: string;
  /** one line, shown on the gallery card */
  tagline: string;
  /** plain-English explanation of what it does, shown in the setup dialog */
  description: string;
  category: "assignment" | "customer" | "office";
  trigger: AutomationTriggerKey;
  action: AutomationActionKey;
  conditions: Record<string, unknown>;
  actionConfig: Record<string, unknown>;
  knobs: Knob[];
}

export const PRIORITY_OPTIONS = [
  { value: "", label: "Any priority" },
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const PRIORITY_KNOB: Knob = {
  key: "priority",
  label: "Only for jobs with priority",
  type: "multiselect",
  path: "conditions.priority",
  source: "priorities",
  help: "Leave empty to apply to every job.",
};

const SKILL_CLASS_KNOB: Knob = {
  key: "requiredSkillClass",
  label: "Only for jobs needing this skill class",
  type: "multiselect",
  path: "conditions.requiredSkillClass",
  source: "skillClasses",
  help: "Leave empty for all skill classes.",
};

const REQUIRE_SKILL_KNOB: Knob = {
  key: "requireSkill",
  label: "Technician must match the job's skill class",
  type: "select",
  path: "actionConfig.requireSkill",
  options: [
    { value: "true", label: "Yes — skip techs without the skill" },
    { value: "false", label: "No — any tech will do" },
  ],
};

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  // ── Assignment ──────────────────────────────────────────────────────────
  {
    key: "nearest_tech",
    name: "Nearest available tech",
    tagline: "New job → the closest free, qualified tech.",
    description:
      "When a work order is created, find the technician who is available, has the right skill and is closest to the address. In Suggest mode the office gets a recommendation; in Auto-assign mode the job is dispatched immediately and marked with an A.",
    category: "assignment",
    trigger: "wo_created",
    action: "assign_nearest",
    conditions: {},
    actionConfig: { requireSkill: true, maxKm: 60 },
    knobs: [
      PRIORITY_KNOB,
      SKILL_CLASS_KNOB,
      REQUIRE_SKILL_KNOB,
      {
        key: "maxKm",
        label: "Ignore techs farther than (km)",
        type: "number",
        path: "actionConfig.maxKm",
        min: 1,
        max: 500,
        help: "Techs without a known location are considered last.",
      },
    ],
  },
  {
    key: "round_robin",
    name: "Round-robin",
    tagline: "Share new jobs evenly, in rotation.",
    description:
      "Each new work order goes to the next technician in the rotation. Choose who is in the rotation: the whole team, only techs of the job's skill class, a per-zone roster, or a hand-picked list.",
    category: "assignment",
    trigger: "wo_created",
    action: "assign_round_robin",
    conditions: {},
    actionConfig: { scope: "team", requireSkill: false, onlyAvailable: true },
    knobs: [
      {
        key: "scope",
        label: "Rotate among",
        type: "select",
        path: "actionConfig.scope",
        options: [
          { value: "team", label: "The whole team" },
          { value: "skill_class", label: "Techs with the job's skill class" },
          { value: "zone", label: "A roster per service zone" },
          { value: "custom", label: "A hand-picked list of techs" },
        ],
      },
      {
        key: "zoneTechs",
        label: "Zone rosters",
        type: "zone_roster",
        path: "actionConfig.zoneTechs",
        help: "Only used when rotating per zone. Pick the techs who cover each zone.",
      },
      {
        key: "pool",
        label: "Hand-picked techs",
        type: "tech_pool",
        path: "actionConfig.pool",
        help: "Only used for a hand-picked list.",
      },
      {
        key: "onlyAvailable",
        label: "Skip techs who are offline or busy",
        type: "select",
        path: "actionConfig.onlyAvailable",
        options: [
          { value: "true", label: "Yes — rotate only among free techs" },
          { value: "false", label: "No — strict rotation, even if busy" },
        ],
      },
      PRIORITY_KNOB,
      SKILL_CLASS_KNOB,
    ],
  },
  {
    key: "zone_owner",
    name: "Zone owner",
    tagline: "Each service zone has its tech.",
    description:
      "Map every service zone to the technician who owns it. A new job inside a zone goes to that tech. Jobs outside any mapped zone can fall back to the nearest tech or be left for the office.",
    category: "assignment",
    trigger: "wo_created",
    action: "assign_zone_owner",
    conditions: {},
    actionConfig: { zoneOwners: {}, fallback: "none" },
    knobs: [
      {
        key: "zoneOwners",
        label: "Who owns each zone",
        type: "zone_owners",
        path: "actionConfig.zoneOwners",
      },
      {
        key: "fallback",
        label: "Job outside every mapped zone",
        type: "select",
        path: "actionConfig.fallback",
        options: [
          { value: "none", label: "Leave it for the office" },
          { value: "nearest", label: "Use the nearest available tech" },
        ],
      },
      PRIORITY_KNOB,
    ],
  },
  {
    key: "least_loaded",
    name: "Load balance",
    tagline: "New job → whoever has the lightest day.",
    description:
      "Looks at each technician's open stops and projected free time and gives the new work order to the one with the least on their plate. Ties go to the closest tech.",
    category: "assignment",
    trigger: "wo_created",
    action: "assign_least_loaded",
    conditions: {},
    actionConfig: { requireSkill: true },
    knobs: [PRIORITY_KNOB, SKILL_CLASS_KNOB, REQUIRE_SKILL_KNOB],
  },

  // ── Office alerts ───────────────────────────────────────────────────────
  {
    key: "urgent_alert",
    name: "Urgent job → alert the office",
    tagline: "Nobody misses a high-priority call.",
    description:
      "The moment a high or urgent work order lands, every admin and dispatcher gets an in-app alert with the job details.",
    category: "office",
    trigger: "wo_created",
    action: "notify_dispatch",
    conditions: { priority: ["high", "urgent"] },
    actionConfig: {
      title: "Urgent job: {{jobName}}",
      message: "{{priority}} priority · {{address}} · {{customerName}}. Needs a tech now.",
    },
    knobs: [
      { ...PRIORITY_KNOB, label: "Alert for these priorities" },
      {
        key: "message",
        label: "Alert text",
        type: "textarea",
        path: "actionConfig.message",
        help: "You can use {{jobName}}, {{address}}, {{customerName}}, {{priority}}, {{shortId}}.",
      },
    ],
  },
  {
    key: "unassigned_alarm",
    name: "Unassigned-job alarm",
    tagline: "A job is almost due and nobody has it.",
    description:
      "If a work order is still unassigned this close to its appointment time, escalate to the office so it doesn't fall through the cracks.",
    category: "office",
    trigger: "sla_risk",
    action: "escalate",
    conditions: { risk: "unassigned", minMinutes: 60 },
    actionConfig: {
      title: "Unassigned: {{jobName}} in {{minutesUntil}} min",
      message: "{{address}} — still has no technician. Assign someone now.",
    },
    knobs: [
      {
        key: "leadMinutes",
        label: "Warn when the appointment is within (minutes)",
        type: "number",
        path: "conditions.minMinutes",
        min: 5,
        max: 1440,
      },
      { ...PRIORITY_KNOB, label: "Only for these priorities" },
    ],
  },
  {
    key: "idle_backlog",
    name: "Idle tech → pull from backlog",
    tagline: "A free tech and open work shouldn't coexist.",
    description:
      "When a technician has been available with nothing to do for a while, remind dispatch to hand them something from the unassigned queue.",
    category: "office",
    trigger: "tech_idle",
    action: "notify_dispatch",
    conditions: { minMinutes: 30 },
    actionConfig: {
      title: "{{techName}} has been idle {{idleMinutes}} min",
      message: "Check the unassigned queue for something nearby.",
    },
    knobs: [
      {
        key: "idleMinutes",
        label: "After how many idle minutes",
        type: "number",
        path: "conditions.minMinutes",
        min: 5,
        max: 480,
      },
    ],
  },
  {
    key: "after_hours",
    name: "After-hours routing",
    tagline: "Night and weekend jobs get a second look.",
    description:
      "Work orders created outside your business hours are flagged to the office instead of being treated like a daytime call.",
    category: "office",
    trigger: "wo_created",
    action: "escalate",
    conditions: { any: [{ beforeHour: 8 }, { fromHour: 18 }] },
    actionConfig: {
      title: "After-hours job: {{jobName}}",
      message: "Created at {{localTime}} · {{address}} · {{customerName}}.",
    },
    knobs: [
      {
        key: "openHour",
        label: "Business day starts at (hour, 0–23)",
        type: "number",
        path: "conditions.any.0.beforeHour",
        min: 0,
        max: 23,
        help: "Jobs created before this hour count as after-hours. 8 = anything before 8:00 AM.",
      },
      {
        key: "closeHour",
        label: "Business day ends at (hour, 0–23)",
        type: "number",
        path: "conditions.any.1.fromHour",
        min: 0,
        max: 23,
        help: "Jobs created at or after this hour count as after-hours. 18 = 6 PM.",
      },
    ],
  },

  // ── Customer messages ───────────────────────────────────────────────────
  {
    key: "running_late_sms",
    name: "Running late → warn the customer",
    tagline: "Text before they start wondering.",
    description:
      "When a technician is projected to arrive late by more than your threshold, text the customer a heads-up with their live tracking link.",
    category: "customer",
    trigger: "sla_risk",
    action: "send_sms",
    conditions: { risk: "running_late", minMinutesLate: 15 },
    actionConfig: {
      message:
        "Hi {{customerName}}, {{techName}} is running about {{minutesLate}} minutes behind for {{jobName}}. Track their arrival here: {{trackUrl}}",
    },
    knobs: [
      {
        key: "minutesLate",
        label: "Text when running late by more than (minutes)",
        type: "number",
        path: "conditions.minMinutesLate",
        min: 5,
        max: 240,
      },
      {
        key: "message",
        label: "Text message",
        type: "textarea",
        path: "actionConfig.message",
        help: "You can use {{customerName}}, {{techName}}, {{minutesLate}}, {{jobName}}, {{trackUrl}}.",
      },
    ],
  },
  {
    key: "job_done_thanks",
    name: "Job done → thank-you text",
    tagline: "Close the loop the moment the tech leaves.",
    description:
      "As soon as a work order is completed, send the customer a short thank-you text. Review requests are handled separately in Settings, so this is just the courtesy message.",
    category: "customer",
    trigger: "wo_completed",
    action: "send_sms",
    conditions: {},
    actionConfig: {
      message:
        "Thanks {{customerName}} — {{techName}} has finished {{jobName}}. Questions? Just reply to this text.",
    },
    knobs: [
      {
        key: "message",
        label: "Text message",
        type: "textarea",
        path: "actionConfig.message",
        help: "You can use {{customerName}}, {{techName}}, {{jobName}}.",
      },
    ],
  },
];

export const TEMPLATE_BY_KEY: Record<string, AutomationTemplate> = Object.fromEntries(
  AUTOMATION_TEMPLATES.map((t) => [t.key, t]),
);

/* ── Dotted-path helpers (pure) ─────────────────────────────────────────── */

export function getPath(obj: unknown, path: string): unknown {
  let cur: any = obj;
  for (const seg of path.split(".")) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Immutable set along a dotted path; numeric segments create arrays. */
export function setPath<T extends object>(obj: T, path: string, value: unknown): T {
  const segs = path.split(".");
  const walk = (cur: any, i: number): any => {
    const seg = segs[i]!;
    const last = i === segs.length - 1;
    const isIdx = /^\d+$/.test(segs[i + 1] ?? "");
    const base = Array.isArray(cur) ? [...cur] : { ...cur };
    base[seg] = last ? value : walk(cur?.[seg] ?? (isIdx ? [] : {}), i + 1);
    return base;
  };
  return walk(obj, 0) as T;
}

export interface RuleDraft {
  name: string;
  description: string;
  trigger: string;
  action: string;
  conditions: Record<string, unknown>;
  actionConfig: Record<string, unknown>;
  mode: RuleMode;
  templateKey: string;
  enabled: boolean;
}

/** A fresh, disabled, suggest-mode rule from a template. */
export function draftFromTemplate(t: AutomationTemplate): RuleDraft {
  return {
    name: t.name,
    description: t.tagline,
    trigger: t.trigger,
    action: t.action,
    conditions: structuredClone(t.conditions),
    actionConfig: structuredClone(t.actionConfig),
    mode: "suggest",
    templateKey: t.key,
    enabled: false,
  };
}

/** Coerce a knob's UI string value to what the engine expects at that path. */
export function coerceKnobValue(knob: Knob, raw: unknown): unknown {
  if (knob.type === "number") {
    if (raw === "" || raw == null) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  if (knob.type === "select" && (raw === "true" || raw === "false")) return raw === "true";
  if (knob.type === "multiselect") {
    const arr = Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
    return arr.length ? arr : undefined;
  }
  return raw;
}
