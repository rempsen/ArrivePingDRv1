/**
 * A technician's open jobs, grouped the way a dispatcher reads them: what's
 * happening now (en route, on site, in progress, paused), then overdue,
 * today, tomorrow, each later day, and unscheduled last; by time within each.
 */
const ACTIVE = new Set(["enroute", "arrived", "onsite", "in_progress", "paused"]);

export type ListJob = { id: string; status: string; title?: string | null; scheduledAt?: unknown; address?: string | null; service?: { name?: string | null } | null };

/** "Now" first (en route / on site / in progress), then Today, Tomorrow, each later day, then unscheduled; by time within a group. */
export function groupTechJobs<T extends ListJob>(jobs: T[], now = new Date()): { label: string; jobs: T[] }[] {
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86_400_000;
  const when = (b: T) => (b.scheduledAt ? new Date(b.scheduledAt as string).getTime() : NaN);
  const groups = new Map<string, { label: string; order: number; jobs: T[] }>();
  const put = (key: string, label: string, order: number, b: T) => {
    const g = groups.get(key) ?? { label, order, jobs: [] };
    g.jobs.push(b);
    groups.set(key, g);
  };
  for (const b of jobs) {
    const t = when(b);
    if (ACTIVE.has(b.status)) put("now", "Now", -1, b);
    else if (Number.isNaN(t)) put("none", "Not scheduled", 1e15, b);
    else {
      const d = new Date(t);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const diff = Math.round((start - day0) / DAY);
      const label =
        diff < 0 ? "Overdue" : diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
      put(diff < 0 ? "overdue" : String(start), label, diff < 0 ? -0.5 : start, b);
    }
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map((g) => ({ label: g.label, jobs: g.jobs.sort((x, y) => (when(x) || Infinity) - (when(y) || Infinity)) }));
}
