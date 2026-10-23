/**
 * Layout maths for the iPad dispatch board: where a job sits on a
 * technician's row, when two jobs collide, how full a day is, and which
 * minute a tap landed on. A port of packages/web/src/shared/schedule-layout.ts
 * (the mobile package can't import the web source), kept pure so bun tests
 * load it. Every time is minutes since midnight on the COMPANY's clock.
 */
import { partsIn, toIso } from "./when";

export type Span = { id: string; startMin: number; endMin: number };
export type Range = { startMin: number; endMin: number };

/** 7 AM to 7 PM: the window a row shows unless a job sits outside it. */
export const DEFAULT_RANGE: Range = { startMin: 7 * 60, endMin: 19 * 60 };
/** One technician's working day, until per-technician shift hours exist. */
export const DAY_CAPACITY_MINS = 8 * 60;
/** Points per hour on the board: 15 minutes is 30 pt, a comfortable tap. */
export const HOUR_W = 120;
/** The technician gutter on the left and a row's height. */
export const GUTTER_W = 160;
export const ROW_H = 72;

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

/** Whole hours across the window, for the header and the grid lines. */
export function hoursIn(range: Range): number[] {
  const out: number[] = [];
  for (let h = Math.floor(range.startMin / 60); h * 60 < range.endMin; h++) out.push(h);
  return out;
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

/** Keep a placed job inside the window, so it never starts before it or runs past it. */
export function clampStart(startMin: number, dur: number, range: Range): number {
  return Math.min(Math.max(startMin, range.startMin), Math.max(range.startMin, range.endMin - dur));
}

/** Points from the window's left edge. */
export function xOf(min: number, range: Range, hourW = HOUR_W): number {
  return ((min - range.startMin) / 60) * hourW;
}

/** The minute a tap at `x` points from the window's left edge lands on (unsnapped). */
export function minuteAtX(x: number, range: Range, hourW = HOUR_W): number {
  return range.startMin + (x / hourW) * 60;
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

/** Minutes since midnight on the company's clock, and the company-time day. */
export function jobMinutes(iso: string, tz: string): { day: string; min: number } {
  const p = partsIn(new Date(iso), tz);
  return { day: p.day, min: p.hour * 60 + p.minute };
}

/** The board's jobs on `day` as spans, keyed to the job. */
export function spansFor<J extends { id: string; scheduledAt: string; durationMins?: number | null }>(
  jobs: readonly J[],
  day: string,
  tz: string,
): Array<Span & { job: J }> {
  const out: Array<Span & { job: J }> = [];
  for (const job of jobs) {
    const { day: d, min } = jobMinutes(job.scheduledAt, tz);
    if (d !== day) continue;
    out.push({ id: job.id, startMin: min, endMin: min + durationOf(job), job });
  }
  return out;
}

/** The ISO instant for a minute of `day` on the company's clock. */
export function instantFor(day: string, min: number, tz: string): string {
  return toIso(day, Math.floor(min / 60), min % 60, tz);
}

/** "9:15 AM" for a minute of the day. */
export function minLabel(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ampm = h < 12 ? "AM" : "PM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}
