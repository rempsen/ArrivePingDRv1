/**
 * Pure helpers over the dispatch board (`GET /api/dispatch/board`), shared by
 * the Today, Jobs and Team screens. No react-native imports so bun tests can
 * load this file.
 *
 * The shapes below mirror `services/dispatch-board.ts` in packages/web for
 * exactly the fields the office screens read. The typed client gives the full
 * response; these are the subset a helper needs.
 */
export type TechStatus = "offline" | "available" | "enroute" | "onsite" | "break" | "busy";

export interface OfficeTech {
  id: string;
  userId: string;
  name: string;
  phone: string;
  photoUrl: string;
  color: string;
  vehicle: string;
  status: string;
  lat: number | null;
  lng: number | null;
  locationAt: string | null;
  stale: boolean;
  openJobs: number;
  freeAt: string | null;
  currentJobId: string | null;
  nextJobIds: string[];
}

export interface OfficeJob {
  id: string;
  title: string;
  service: string;
  category: string;
  durationMins: number;
  status: string;
  /** none | offered | accepted */
  assignStatus: string;
  priority: string;
  lat: number | null;
  lng: number | null;
  address: string;
  scheduledAt: string;
  riderId: string | null;
  customerName: string;
  etaMins: number | null;
  late: boolean;
  isSample: boolean;
}

/** Stable empties so `board.data?.techs ?? NO_TECHS` keeps memo deps steady. */
export const NO_TECHS: readonly OfficeTech[] = Object.freeze([]) as readonly OfficeTech[];
export const NO_JOBS: readonly OfficeJob[] = Object.freeze([]) as readonly OfficeJob[];

export interface Tallies {
  enroute: number;
  onsite: number;
  available: number;
  busy: number;
  offline: number;
}

/** Status tiles: who is where right now. A tech on break counts as busy. */
export function tallies(techs: readonly Pick<OfficeTech, "status">[]): Tallies {
  const t: Tallies = { enroute: 0, onsite: 0, available: 0, busy: 0, offline: 0 };
  for (const tech of techs) {
    switch (tech.status) {
      case "enroute":
        t.enroute++;
        break;
      case "onsite":
        t.onsite++;
        break;
      case "available":
        t.available++;
        break;
      case "busy":
      case "break":
        t.busy++;
        break;
      default:
        t.offline++;
    }
  }
  return t;
}

export const TERMINAL = new Set(["completed", "cancelled"]);
export const IN_FIELD = new Set(["enroute", "arrived", "onsite", "in_progress", "paused"]);

export function isUnassigned(job: Pick<OfficeJob, "riderId" | "status">): boolean {
  return !job.riderId && !TERMINAL.has(job.status);
}

/**
 * What a dispatcher has to deal with: late jobs first, then anything with no
 * technician, each job once, soonest first within a group.
 */
export function needsAttention<J extends Pick<OfficeJob, "id" | "late" | "riderId" | "status" | "scheduledAt">>(
  jobs: readonly J[],
): J[] {
  const byTime = (a: J, b: J) => a.scheduledAt.localeCompare(b.scheduledAt);
  const late = jobs.filter((j) => j.late && !TERMINAL.has(j.status)).sort(byTime);
  const seen = new Set(late.map((j) => j.id));
  const open = jobs.filter((j) => !seen.has(j.id) && isUnassigned(j)).sort(byTime);
  return [...late, ...open];
}

/** The next jobs still to start, soonest first. */
export function nextUp<J extends Pick<OfficeJob, "status" | "scheduledAt">>(jobs: readonly J[], now: Date, limit = 5): J[] {
  const t0 = now.toISOString();
  return jobs
    .filter((j) => !TERMINAL.has(j.status) && !IN_FIELD.has(j.status) && j.scheduledAt >= t0)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, limit);
}

export type JobBucket = "unassigned" | "scheduled" | "in_progress" | "done";

export function bucketOf(job: Pick<OfficeJob, "riderId" | "status">): JobBucket {
  if (TERMINAL.has(job.status)) return "done";
  if (IN_FIELD.has(job.status)) return "in_progress";
  if (!job.riderId) return "unassigned";
  return "scheduled";
}

/** YYYY-MM-DD for `now` on the company's clock. */
export function dayKey(now: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "2 min ago", "1 h ago", "yesterday" — for a tech's last location. */
export function ageLabel(iso: string | null, now: Date): string {
  if (!iso) return "no location";
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return h < 48 ? "yesterday" : `${Math.round(h / 24)} d ago`;
}

export const STATUS_ORDER: readonly string[] = ["enroute", "onsite", "available", "busy", "break", "offline"];

export const STATUS_LABEL: Record<string, string> = {
  enroute: "On route",
  onsite: "On site",
  available: "Available",
  busy: "Busy",
  break: "On break",
  offline: "Off shift",
};
