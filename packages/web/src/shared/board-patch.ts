/**
 * Small, pure edits to a dispatch Board that the map applies the instant
 * something happens, before the server's next snapshot arrives:
 *
 *  - a technician's pin moves (live location frames from the stream);
 *  - a job is assigned, undone or rolled back (the optimistic drop).
 *
 * Every function returns the SAME object when nothing changed, so React Query
 * and the markers can skip work.
 */
import type { Board, BoardJob, BoardTech } from "../services/dispatch-board";
import { IN_FLIGHT_STATUSES } from "./job-status";

/** A location older than this greys the technician's pin ("last seen 12 min ago"). */
export const STALE_LOCATION_MS = 10 * 60_000;

export interface LocationFrame {
  techId: string;
  lat: number;
  lng: number;
  at: number;
}

export interface JobFields {
  id: string;
  status: string;
  assignStatus: string;
  riderId: string | null;
}

/** A job in these states takes up its technician. */
const OCCUPYING: readonly string[] = ["assigned", ...IN_FLIGHT_STATUSES];
const occupies = (j: Pick<BoardJob, "status" | "riderId">) => !!j.riderId && OCCUPYING.includes(j.status);

const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * @param now The clock frames are aged against: a frame can carry an old fix
 * (a phone that took it a while ago and is only now reporting), and an old
 * fix must stay grey, not light up as live.
 */
export function applyLocations(board: Board, frames: readonly LocationFrame[], now = Date.now()): Board {
  if (frames.length === 0) return board;
  const byTech = new Map<string, LocationFrame>();
  for (const f of frames) {
    if (!valid(f.lat) || !valid(f.lng) || Math.abs(f.lat) > 90 || Math.abs(f.lng) > 180) continue;
    const prev = byTech.get(f.techId);
    if (!prev || f.at >= prev.at) byTech.set(f.techId, f);
  }
  let changed = false;
  const techs = board.techs.map((t): BoardTech => {
    const f = byTech.get(t.id);
    if (!f) return t;
    // An older frame than what we already have is ignored.
    if (t.locationAt && new Date(t.locationAt).getTime() > f.at) return t;
    const stale = now - f.at > STALE_LOCATION_MS;
    if (t.lat === f.lat && t.lng === f.lng && t.stale === stale) return t;
    changed = true;
    return { ...t, lat: f.lat, lng: f.lng, locationAt: new Date(f.at).toISOString(), stale };
  });
  return changed ? { ...board, techs } : board;
}

export function applyJobPatch(board: Board, patch: JobFields): Board {
  const i = board.jobs.findIndex((j) => j.id === patch.id);
  if (i === -1) return board;
  const old = board.jobs[i]!;
  if (old.status === patch.status && old.assignStatus === patch.assignStatus && old.riderId === patch.riderId) return board;
  const next: BoardJob = { ...old, status: patch.status, assignStatus: patch.assignStatus, riderId: patch.riderId };

  const delta = new Map<string, number>();
  if (occupies(old)) delta.set(old.riderId!, (delta.get(old.riderId!) ?? 0) - 1);
  if (occupies(next)) delta.set(next.riderId!, (delta.get(next.riderId!) ?? 0) + 1);

  const jobs = board.jobs.slice();
  jobs[i] = next;
  const techs =
    delta.size === 0
      ? board.techs
      : board.techs.map((t) => {
          const d = delta.get(t.id);
          return d ? { ...t, openJobs: Math.max(0, t.openJobs + d) } : t;
        });
  return { ...board, jobs, techs };
}
