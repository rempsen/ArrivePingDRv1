/**
 * Layout maths for the dispatch calendar (web/pages/admin/scheduler): where a
 * job sits on a technician's row, when two jobs collide, how full a day is, and
 * which open slots fit a waiting job best. Pure functions so they can be tested
 * without a browser; every time is minutes since midnight in the COMPANY's time
 * zone, never the browser's.
 */
import { haversineKm } from "./geo-distance";
import { zonedMinutesOfDay, zonedTimeToInstant } from "./tz";

export type Span = { id: string; startMin: number; endMin: number };
export type Range = { startMin: number; endMin: number };
type Point = { lat: number | null; lng: number | null };

/** 7 AM to 7 PM: the window a row shows unless a job sits outside it. */
export const DEFAULT_RANGE: Range = { startMin: 7 * 60, endMin: 19 * 60 };
/** One technician's working day, until per-technician shift hours exist. */
export const DAY_CAPACITY_MINS = 8 * 60;
/** Urban average speed for straight-line drive estimates (same as services/ai-dispatch AVG_KMH). */
export const AVG_KMH = 32;
/** Gap left between a suggested slot and the next job, so it isn't back-to-back. */
const SLACK_MINS = 10;

/** The visible window: the default, widened to whole hours around any job outside it. */
export function timelineRange(spans: readonly Span[], base: Range = DEFAULT_RANGE): Range {
  let startMin = base.startMin;
  let endMin = base.endMin;
  for (const s of spans) {
    startMin = Math.min(startMin, Math.floor(s.startMin / 60) * 60);
    endMin = Math.max(endMin, Math.ceil(s.endMin / 60) * 60);
  }
  return { startMin: Math.max(0, startMin), endMin: Math.min(24 * 60, endMin) };
}

/**
 * Lays one technician's jobs into at most two lanes. A technician can't be in
 * two places, so any overlap is a conflict to flag, not a layout to make room
 * for: a third simultaneous job shares lane 1 and stays flagged.
 */
export function packLanes(spans: readonly Span[]): Array<{ id: string; lane: 0 | 1; lanes: 1 | 2; conflict: boolean }> {
  const sorted = [...spans].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const laneEnd = [-Infinity, -Infinity];
  const placed = sorted.map((s) => {
    const lane: 0 | 1 = s.startMin >= laneEnd[0]! ? 0 : 1;
    laneEnd[lane] = Math.max(laneEnd[lane]!, s.endMin);
    return { s, lane };
  });
  return placed.map(({ s, lane }) => {
    const overlapping = sorted.some((o) => o !== s && o.startMin < s.endMin && s.startMin < o.endMin);
    return { id: s.id, lane, lanes: overlapping ? 2 : 1, conflict: overlapping };
  });
}

export function snapMinutes(min: number, step = 15): number {
  return Math.round(min / step) * step;
}

/** Keep a dropped job inside the window, so it never starts before it or runs past it. */
export function clampStart(startMin: number, dur: number, range: Range): number {
  return Math.min(Math.max(startMin, range.startMin), Math.max(range.startMin, range.endMin - dur));
}

/** Position within the window, 0–100. */
export function pct(min: number, range: Range): number {
  return ((min - range.startMin) / (range.endMin - range.startMin)) * 100;
}

/** Minutes since midnight in company time. */
export function jobMinutes(scheduledAt: string | Date, tz: string): number {
  return zonedMinutesOfDay(scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt), tz);
}

/** The instant a company-time day ("YYYY-MM-DD") and minute of the day name. */
export function instantFor(dayKey: string, minutes: number, tz: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
  return zonedTimeToInstant(tz, y, m, d, Math.floor(minutes / 60), minutes % 60);
}

/** Day-key arithmetic without touching any time zone. */
export function addDays(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The Monday of the week a day key falls in. */
export function mondayOf(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(dayKey, -((dow + 6) % 7));
}

/** A job with no service duration is booked as an hour. */
export function durationOf(job: { durationMins?: number | null }): number {
  const d = Number(job.durationMins);
  return Number.isFinite(d) && d > 0 ? d : 60;
}

export function bookedMinutes(jobs: ReadonlyArray<{ durationMins?: number | null }>): number {
  return jobs.reduce((sum, j) => sum + durationOf(j), 0);
}

/** "ok", "high" over 83% of the day, "over" past a full day. */
export function loadLevel(booked: number, capacity = DAY_CAPACITY_MINS): "ok" | "high" | "over" {
  if (booked > capacity) return "over";
  if (booked > capacity * 0.83) return "high";
  return "ok";
}

/**
 * Straight-line drive estimate, rounded up to 5 minutes (at least 5). Null when
 * either end has no coordinates: no hatch is drawn and the ranking uses a
 * neutral guess instead of pretending to know.
 */
export function driveMinutes(a: Point | null, b: Point | null, kmh = AVG_KMH): number | null {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const mins = (haversineKm(a.lat, a.lng, b.lat, b.lng) / kmh) * 60;
  return Math.max(5, Math.ceil(mins / 5) * 5);
}

export interface SlotTech {
  id: string;
  qualified: boolean;
  /** On shift and not on a break or day off. */
  available: boolean;
  /** Not before this (minutes since midnight): when a live job really finishes. */
  earliestMin?: number;
  /**
   * Where they set out from before their first job of the day, and from when
   * (minutes since midnight): their live position today, the office otherwise.
   */
  origin?: Point & { atMin: number };
  /** Minutes of work already finished that day: counts toward how full the day is, holds no time. */
  doneMins?: number;
  dayJobs: ReadonlyArray<{ startMin: number; endMin: number } & Point>;
}

export interface Slot {
  techId: string;
  startMin: number;
  driveMins: number | null;
  /** Booked minutes on that technician's day if they take the job. */
  bookedAfter: number;
}

/**
 * The best open slots for a waiting job: each qualified technician's first gap
 * long enough for it (plus the drive in, and the drive on to their next job or
 * 10 minutes of slack, whichever is longer), ranked by how
 * soon it starts, how far they'd drive, and how full their day already is.
 */
export function rankSlots(input: {
  job: { durationMins: number } & Point;
  techs: readonly SlotTech[];
  earliestMin: number;
  range: Range;
  limit?: number;
}): Slot[] {
  const { job, range } = input;
  const dur = durationOf(job);
  const found: Array<Slot & { score: number }> = [];
  for (const t of input.techs) {
    if (!t.qualified || !t.available) continue;
    const jobs = [...t.dayJobs].sort((a, b) => a.startMin - b.startMin);
    const booked = jobs.reduce((s, j) => s + (j.endMin - j.startMin), 0) + (t.doneMins ?? 0);
    let prev: (typeof jobs)[number] | null = null;
    for (let i = 0; i <= jobs.length; i++) {
      const next = jobs[i] ?? null;
      // Coming from the last job, or before any, from where they start the day.
      const start = prev ?? (t.origin && driveMinutes(t.origin, job) !== null ? t.origin : null);
      const drive = driveMinutes(start, job);
      const readyAt = prev ? prev.endMin : (t.origin?.atMin ?? 0);
      const from = Math.max(input.earliestMin, t.earliestMin ?? 0, range.startMin, start ? readyAt + (drive ?? 15) : 0);
      const startMin = Math.ceil(from / 15) * 15;
      // They have to get from this job to the next one in time, too.
      const limit = next ? next.startMin - Math.max(SLACK_MINS, driveMinutes(job, next) ?? SLACK_MINS) : range.endMin;
      if (startMin + dur <= limit && startMin + dur <= range.endMin) {
        const driveMins = start ? drive : null;
        found.push({
          techId: t.id,
          startMin,
          driveMins,
          bookedAfter: booked + dur,
          score: startMin + 2 * (driveMins ?? 20) + booked / 6,
        });
        break;
      }
      // Where they are free from is the end of the latest job so far, which with
      // overlapping jobs isn't always the one just passed.
      if (next && (!prev || next.endMin > prev.endMin)) prev = next;
    }
  }
  return found
    .sort((a, b) => a.score - b.score)
    .slice(0, input.limit ?? 3)
    .map(({ score: _score, ...s }) => s);
}
