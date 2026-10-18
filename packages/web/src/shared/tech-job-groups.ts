/**
 * A technician's open jobs, grouped the way a dispatcher reads them: what's
 * happening now (en route, on site, in progress, paused), then overdue,
 * today, tomorrow, each later day, and unscheduled last; by time within each.
 *
 * Days are the company's days (its timezone), not the viewer's browser's, so
 * an office user travelling or in another zone sees the same headings.
 */
import { fmtInZone, safeTimeZone, zonedDayKey } from "./tz";

const ACTIVE = new Set(["enroute", "arrived", "onsite", "in_progress", "paused"]);

export type ListJob = {
  id: string;
  status: string;
  title?: string | null;
  scheduledAt?: unknown;
  address?: string | null;
  service?: { name?: string | null } | null;
};

const DAY = 86_400_000;
/** Whole days between two "YYYY-MM-DD" keys. */
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY);

export function groupTechJobs<T extends ListJob>(jobs: T[], tzIn?: string | null, now = new Date()): { label: string; jobs: T[] }[] {
  const tz = safeTimeZone(tzIn);
  const today = zonedDayKey(now, tz);
  const when = (b: T) => (b.scheduledAt ? new Date(b.scheduledAt as string).getTime() : NaN);
  const groups = new Map<string, { label: string; order: number; jobs: T[] }>();
  const put = (key: string, label: string, order: number, b: T) => {
    const g = groups.get(key) ?? { label, order, jobs: [] };
    g.jobs.push(b);
    groups.set(key, g);
  };
  for (const b of jobs) {
    const t = when(b);
    if (ACTIVE.has(b.status)) put("now", "Now", -2, b);
    else if (Number.isNaN(t)) put("none", "Not scheduled", Number.MAX_SAFE_INTEGER, b);
    else {
      const key = zonedDayKey(new Date(t), tz);
      const diff = dayDiff(key, today);
      if (diff < 0) put("overdue", "Overdue", -1, b);
      else
        put(
          key,
          diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : fmtInZone(t, tz, { weekday: "short", month: "short", day: "numeric" }),
          diff,
          b,
        );
    }
  }
  const at = (b: T) => (Number.isNaN(when(b)) ? Infinity : when(b));
  return [...groups.values()].sort((a, b) => a.order - b.order).map((g) => ({ label: g.label, jobs: g.jobs.sort((x, y) => at(x) - at(y)) }));
}

/** "2:30 PM" in the company's timezone, "—" when unscheduled. */
export function jobClock(scheduledAt: unknown, tz?: string | null): string {
  return fmtInZone(scheduledAt as string | null, tz, { hour: "numeric", minute: "2-digit" });
}
