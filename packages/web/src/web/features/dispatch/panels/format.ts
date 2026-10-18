import type { BoardJob } from "../data/types";

/** "Today 3:20 PM", "Tomorrow 9:00 AM", or "Oct 21, 9:00 AM", in the company's time zone. */
export function whenLabel(iso: string, tz: string, now = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
  const dd = day(d.getTime());
  if (dd === day(now)) return `Today ${time}`;
  if (dd === day(now + 86_400_000)) return `Tomorrow ${time}`;
  if (dd === day(now - 86_400_000)) return `Yesterday ${time}`;
  const date = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(d);
  return `${date}, ${time}`;
}

export const PRIORITY_COLOR: Record<string, string> = { urgent: "#ef4444", high: "#f59e0b", normal: "#38bdf8", low: "#64748b" };

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** The sub-line on a job card and the drag ghost: when, where. */
export function jobSub(j: BoardJob, tz: string): string {
  return [whenLabel(j.scheduledAt, tz), j.address].filter(Boolean).join(" · ");
}

export function jobTitle(j: BoardJob, noun: string): string {
  return j.title || j.service || `${noun} ${j.id.slice(-4)}`;
}

export const FIT_LABEL: Record<string, string> = { ready: "Ready", busy: "Busy", unqualified: "Not qualified", offline: "Offline" };
