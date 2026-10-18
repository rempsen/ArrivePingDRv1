/**
 * How the dispatch map classifies and orders jobs, in one place so the pins,
 * the queue and the tests agree.
 */
import { IN_FLIGHT_STATUSES, TERMINAL_STATUSES } from "./job-status";

/**
 *  wait      nobody holds it yet
 *  late      nobody holds it and its time has already passed
 *  assigned  offered or accepted, not started
 *  live      a technician is on the way, on site or working
 *  done      completed or cancelled
 */
export type JobKind = "wait" | "late" | "assigned" | "live" | "done";

interface KindInput {
  status: string;
  riderId: string | null;
  scheduledAt: string | number | Date;
}

export function jobKind(j: KindInput, now: number): JobKind {
  if ((TERMINAL_STATUSES as readonly string[]).includes(j.status)) return "done";
  if ((IN_FLIGHT_STATUSES as readonly string[]).includes(j.status)) return "live";
  if (j.riderId) return "assigned";
  return new Date(j.scheduledAt).getTime() < now ? "late" : "wait";
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

interface OrderInput {
  priority: string;
  scheduledAt: string | number | Date;
  id: string;
}

/**
 * The queue: urgent work first, then by the time it's due, so overdue jobs sit
 * above upcoming ones. A stable tie-break on id keeps the list from reshuffling.
 */
export function queueOrder(a: OrderInput, b: OrderInput): number {
  const pa = PRIORITY_RANK[a.priority] ?? 2;
  const pb = PRIORITY_RANK[b.priority] ?? 2;
  if (pa !== pb) return pa - pb;
  const ta = new Date(a.scheduledAt).getTime();
  const tb = new Date(b.scheduledAt).getTime();
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * A technician's jobs, in the order they'll do them: what they're on now, then
 * what's offered or accepted by time. A job whose time has already passed sorts
 * first, which is what makes a dropped overdue job their next stop. Finished
 * work is left out. Pure display order; assigning never changes a job's time.
 */
export function techRoute<T extends KindInput & { id: string }>(jobs: readonly T[], techId: string, now: number): T[] {
  const mine = jobs.filter((j) => j.riderId === techId && jobKind(j, now) !== "done");
  const rank = (j: T) => (jobKind(j, now) === "live" ? 0 : 1);
  return mine.sort((a, b) => rank(a) - rank(b) || new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime() || (a.id < b.id ? -1 : 1));
}
