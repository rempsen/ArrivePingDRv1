/**
 * Custom milestones: the rules both sides share (the Notifications page and
 * the API), so the dialog and the server agree on what is valid and both
 * describe a milestone the same way.
 *
 * A custom milestone is a moment the company names itself ("Water restored",
 * "Day-before reminder"). It goes off once per job, on one of four triggers,
 * and its messages are ordinary notification rules keyed `custom:<id>`.
 * Server side: services/custom-milestones.ts.
 */

export const MILESTONE_TRIGGERS = ["stage", "checklist", "before_start", "after_complete"] as const;
export type MilestoneTrigger = (typeof MILESTONE_TRIGGERS)[number];

/** The built-in moments a custom milestone can ride on, worded as "When …". */
export const STAGE_OPTIONS = [
  { event: "assigned", label: "A tech is assigned" },
  { event: "accepted", label: "The tech accepts the job" },
  { event: "enroute", label: "The tech is on the way" },
  { event: "arrived", label: "The tech arrives" },
  { event: "started", label: "Work starts" },
  { event: "completed", label: "The job is completed" },
  { event: "cancelled", label: "The job is cancelled" },
  { event: "rescheduled", label: "The appointment is rescheduled" },
  { event: "delayed", label: "The tech is running late" },
] as const;
export type StageEvent = (typeof STAGE_OPTIONS)[number]["event"];
export const STAGE_EVENTS: readonly string[] = STAGE_OPTIONS.map((o) => o.event);

export const MILESTONE_RECIPIENTS = ["client", "tech", "office"] as const;
export type MilestoneRecipient = (typeof MILESTONE_RECIPIENTS)[number];

/** Longest offset for the two timed triggers: 30 days. */
export const MAX_OFFSET_MINUTES = 30 * 24 * 60;
export const MAX_MILESTONE_NAME = 60;
export const MAX_MILESTONES_PER_COMPANY = 50;
export const MAX_MILESTONE_MESSAGE = 1_000;

export const CUSTOM_EVENT_PREFIX = "custom:";
export function customEventKey(id: string): string {
  return `${CUSTOM_EVENT_PREFIX}${id}`;
}
/** The milestone id inside a `custom:<id>` event key, or null for a built-in event. */
export function customMilestoneId(eventKey: string): string | null {
  return eventKey.startsWith(CUSTOM_EVENT_PREFIX) ? eventKey.slice(CUSTOM_EVENT_PREFIX.length) || null : null;
}

/** Checklist labels are matched loosely: case, outer spaces and runs of spaces don't matter. */
export function normalizeChecklistLabel(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 90 -> "90 minutes", 120 -> "2 hours", 1440 -> "1 day", 2160 -> "36 hours". */
export function formatOffset(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (m >= 1440 && m % 1440 === 0) return plural(m / 1440, "day");
  if (m >= 60 && m % 60 === 0) return plural(m / 60, "hour");
  return plural(m, "minute");
}

export interface MilestoneTriggerFields {
  trigger: string;
  triggerEvent?: string | null;
  checklistLabel?: string | null;
  offsetMinutes?: number | null;
}

/** One line saying when a milestone goes off, e.g. "2 hours before the appointment". */
export function describeTrigger(m: MilestoneTriggerFields): string {
  switch (m.trigger) {
    case "stage": {
      const opt = STAGE_OPTIONS.find((o) => o.event === m.triggerEvent);
      return opt ? `When ${opt.label.charAt(0).toLowerCase()}${opt.label.slice(1)}` : "When a job reaches a stage";
    }
    case "checklist":
      return `When the tech ticks “${(m.checklistLabel ?? "").trim()}”`;
    case "before_start":
      return `${formatOffset(m.offsetMinutes ?? 0)} before the appointment`;
    case "after_complete":
      return `${formatOffset(m.offsetMinutes ?? 0)} after the job is completed`;
    default:
      return "";
  }
}

/**
 * What is wrong with a milestone's name and trigger, in words for the person
 * filling in the form, or null when it is good to save.
 */
export function milestoneProblem(m: MilestoneTriggerFields & { name: string }): string | null {
  const name = m.name.trim();
  if (!name) return "Give the milestone a name.";
  if (name.length > MAX_MILESTONE_NAME) return `Keep the name under ${MAX_MILESTONE_NAME} characters.`;
  switch (m.trigger) {
    case "stage":
      if (!STAGE_EVENTS.includes(m.triggerEvent ?? "")) return "Pick the moment it goes off.";
      return null;
    case "checklist": {
      const label = (m.checklistLabel ?? "").trim();
      if (!label) return "Type the checklist item it waits for.";
      if (label.length > 200) return "That checklist item is too long.";
      return null;
    }
    case "before_start":
    case "after_complete": {
      const off = m.offsetMinutes;
      if (off == null || !Number.isInteger(off) || off < 0) return "Set how long before or after.";
      if (off > MAX_OFFSET_MINUTES) return "Keep it within 30 days.";
      // Under 5 minutes is the stage trigger in disguise, and the sweep only
      // runs once a minute.
      if (off < 5) return "Make it at least 5 minutes.";
      return null;
    }
    default:
      return "Pick what sets it off.";
  }
}
