/**
 * How well a technician fits a job right now, and the one sentence that stops
 * a drop when they don't.
 *
 * Dan's rule for the dispatch map (2026-10-17): dropping a job on a technician
 * assigns it at once with Undo, and only stops to ask when there's a clash —
 * not qualified, busy, time off or double-booked. This module decides which,
 * so the server (candidates API) and the tests agree on the exact words.
 *
 * Pure: no database, no clock. The caller passes the facts.
 */
import type { Qualification } from "./qualify";
import { clockLabel } from "./availability";

export type Fit = "ready" | "busy" | "unqualified" | "offline";
export type ClashKind = "offline" | "unqualified" | "timeoff" | "overlap" | "busy";

export interface Clash {
  kind: ClashKind;
  /** One sentence, ending in a full stop. The UI appends "Assign anyway?". */
  message: string;
}

export interface FitInput {
  /** Display name, e.g. "Tom Rivera". */
  name: string;
  /** riders.status: offline | available | enroute | onsite | break | busy */
  status: string;
  qualification: Qualification;
  /** overlapMessage(…) when they're already booked at the job's time, else null. */
  overlap: string | null;
  /** timeOffMessage(…) when they're booked off that day, else null. */
  timeoff: string | null;
  /** On a job in the field right now (driving to it, on site, working). */
  inField: boolean;
  /** When their current commitments are expected to clear (ms), if known. */
  freeAt: number | null;
  /** The job's scheduled start (ms). */
  jobStart: number;
  now: number;
  /** Company time zone, for "until 3:10 PM". */
  tz: string;
}

/** "A", "A and B", "A, B and C". */
export function listJoin(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Precedence when several apply: offline, then not qualified, then time off,
 * then double-booked, then busy on a job right now. Only the first is shown;
 * the dispatcher needs one reason to pause, not a list.
 */
export function classifyFit(i: FitInput): { fit: Fit; clash: Clash | null } {
  if (i.status === "offline") {
    return { fit: "offline", clash: { kind: "offline", message: `${i.name} is offline right now.` } };
  }
  if (!i.qualification.qualified) {
    const what = listJoin(i.qualification.missing);
    return {
      fit: "unqualified",
      clash: { kind: "unqualified", message: what ? `${i.name} isn't set up for ${what}.` : `${i.name} isn't set up for this job.` },
    };
  }
  if (i.timeoff) return { fit: "busy", clash: { kind: "timeoff", message: i.timeoff } };
  if (i.overlap) return { fit: "busy", clash: { kind: "overlap", message: i.overlap } };
  // Busy only matters if the job would start before they're free: a tech on a
  // job until 3:10 is still the right person for a 4:00 visit.
  if (i.inField && i.freeAt != null && Math.max(i.jobStart, i.now) < i.freeAt) {
    return {
      fit: "busy",
      clash: { kind: "busy", message: `${i.name} is on a job until ${clockLabel(i.freeAt, i.tz)}.` },
    };
  }
  return { fit: "ready", clash: null };
}
