/**
 * Small display helpers shared by the calendar's views. Layout maths lives in
 * shared/schedule-layout.ts (tested); this file is only how things look.
 */
import type { BoardJob, BoardTech } from "../../../features/dispatch/data/types";
import { qualifies } from "../../../../shared/qualify";
import { durationOf, jobMinutes } from "../../../../shared/schedule-layout";
import { zonedDayKey } from "../../../../shared/tz";

export type View = "day" | "week" | "month";

/** How a block is painted, by where the job is in its life. */
export type Phase = "done" | "onsite" | "enroute" | "scheduled";

export function phaseOf(status: string): Phase {
  if (status === "completed") return "done";
  if (status === "enroute") return "enroute";
  if (["arrived", "onsite", "in_progress", "paused"].includes(status)) return "onsite";
  return "scheduled";
}

export const PHASE_STYLE: Record<Phase, { bg: string; border: string; text: string; dot: string; label: string }> = {
  done: { bg: "rgba(100,116,139,.16)", border: "rgba(148,163,184,.28)", text: "#94a3b8", dot: "#64748b", label: "Done" },
  onsite: { bg: "rgba(16,185,129,.15)", border: "rgba(16,185,129,.55)", text: "#e6edf7", dot: "#10b981", label: "On site" },
  enroute: { bg: "rgba(14,165,233,.17)", border: "rgba(14,165,233,.6)", text: "#e6edf7", dot: "#0ea5e9", label: "En route" },
  scheduled: { bg: "#15223a", border: "#2c3f62", text: "#e6edf7", dot: "#5b7299", label: "Scheduled" },
};

export const TECH_STATUS: Record<string, { dot: string; label: string }> = {
  available: { dot: "#a3e635", label: "Available" },
  enroute: { dot: "#0ea5e9", label: "En route" },
  onsite: { dot: "#10b981", label: "On site" },
  busy: { dot: "#10b981", label: "Busy" },
  break: { dot: "#f59e0b", label: "On break" },
  offline: { dot: "#475569", label: "Offline" },
};

/** Diagonal hatch for drive time between two stops. */
export const DRIVE_HATCH = "repeating-linear-gradient(135deg, rgba(142,160,180,.34) 0 2px, transparent 2px 6px)";

export const LOAD_COLOR = { ok: "#0ea5e9", high: "#f59e0b", over: "#f87171" } as const;

export function clock(min: number, compact = false): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (compact) return `${h12}:${String(m).padStart(2, "0")}`;
  return `${h12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export function hourLabel(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${h >= 12 ? "p" : "a"}`;
}

export function hours(mins: number): string {
  return `${(mins / 60).toFixed(mins % 60 === 0 ? 0 : 1)}h`;
}

/** A job's span on its day, in company minutes. */
export function spanOf(j: BoardJob, tz: string) {
  const startMin = jobMinutes(j.scheduledAt, tz);
  return { id: j.id, startMin, endMin: startMin + durationOf(j) };
}

export function dayOf(j: BoardJob, tz: string): string {
  return zonedDayKey(new Date(j.scheduledAt), tz);
}

/** Jobs a technician holds on a day, soonest first (cancelled ones never reach the board). */
export function techDayJobs(jobs: readonly BoardJob[], techId: string, day: string, tz: string): BoardJob[] {
  return jobs
    .filter((j) => j.riderId === techId && dayOf(j, tz) === day)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
}

/** Waiting for a technician: the queue. */
export function isWaiting(j: BoardJob): boolean {
  return !j.riderId && j.status !== "completed" && j.status !== "cancelled";
}

export function qualifiedFor(t: BoardTech, j: BoardJob): boolean {
  return qualifies(
    { skills: t.skills, skillClass: t.skillClass },
    { requiredSkillClass: j.requiredSkillClass, requiredSkills: j.requiredSkills, serviceCategory: j.category },
  ).qualified;
}

export function matches(q: string, ...parts: Array<string | null | undefined>): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return parts.some((p) => (p ?? "").toLowerCase().includes(s));
}

export function dayTitle(dayKey: string, opts: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });
}
