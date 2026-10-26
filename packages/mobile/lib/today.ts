/**
 * The Today dashboard's numbers and queues, derived from one board read
 * (`GET /api/dispatch/board`) plus, after hours, the next days' board. Pure:
 * no react-native imports, so bun tests load it.
 *
 * Four bands, see the "ArrivePing iPad Office" canvas:
 *   pulse    — the day as numbers and a strip of blocks with a now-marker
 *   crew     — the roster grouped by what each person is doing now
 *   needs    — one action queue, each item with its reason and a fix
 *   upNext   — assigned jobs starting soon (never a job already in `needs`)
 */
import { IN_FIELD, TERMINAL, isUnassigned, type OfficeJob, type OfficeTech } from "./board";
import { durationOf, jobMinutes } from "./timeline";

type J = Pick<OfficeJob, "id" | "scheduledAt" | "durationMins" | "status" | "riderId" | "assignStatus" | "late">;

// ------------------------------------------------------------------- pulse --

export interface Pulse {
  total: number;
  done: number;
  inProgress: number;
  remaining: number;
  late: number;
  unassigned: number;
  offered: number;
  unconfirmed: number;
  cancelled: number;
  /** Minutes of the company day; null when there are no jobs. */
  firstStart: number | null;
  lastEnd: number | null;
  /** Start minute of the hour with the most jobs running (ties: earliest). */
  busiestHour: number | null;
  /** Nothing left to run today: every job finished or cancelled, or none at all. */
  wrapped: boolean;
}

/** `jobs` are today's (the board for one day). */
export function pulseOf<T extends J>(jobs: readonly T[], tz: string): Pulse {
  const p: Pulse = { total: 0, done: 0, inProgress: 0, remaining: 0, late: 0, unassigned: 0, offered: 0, unconfirmed: 0, cancelled: 0, firstStart: null, lastEnd: null, busiestHour: null, wrapped: true };
  const perHour = new Map<number, number>();
  for (const j of jobs) {
    if (j.status === "cancelled") {
      p.cancelled++;
      continue;
    }
    p.total++;
    const start = jobMinutes(j.scheduledAt, tz).min;
    const end = start + durationOf(j);
    p.firstStart = p.firstStart == null ? start : Math.min(p.firstStart, start);
    p.lastEnd = p.lastEnd == null ? end : Math.max(p.lastEnd, end);
    for (let h = Math.floor(start / 60) * 60; h < end; h += 60) perHour.set(h, (perHour.get(h) ?? 0) + 1);
    if (TERMINAL.has(j.status)) {
      p.done++;
      continue;
    }
    if (IN_FIELD.has(j.status)) p.inProgress++;
    else p.remaining++;
    if (j.late) p.late++;
    if (isUnassigned(j)) p.unassigned++;
    else if (j.assignStatus === "offered") p.offered++;
    if (j.status === "pending") p.unconfirmed++;
  }
  let best = 0;
  for (const [h, n] of [...perHour].sort((a, b) => a[0] - b[0])) {
    if (n > best) {
      best = n;
      p.busiestHour = h;
    }
  }
  p.wrapped = p.inProgress === 0 && p.remaining === 0;
  return p;
}

export type BlockKind = "done" | "active" | "scheduled" | "unassigned" | "late";

/** The strip under the numbers: one block per job, placed in a window that always shows 7 AM – 6 PM and grows to fit. */
export function pulseBlocks<T extends J>(jobs: readonly T[], tz: string): { startMin: number; endMin: number; blocks: Array<{ id: string; from: number; to: number; kind: BlockKind }> } {
  let startMin = 7 * 60;
  let endMin = 18 * 60;
  const raw: Array<{ id: string; s: number; e: number; kind: BlockKind }> = [];
  for (const j of jobs) {
    if (j.status === "cancelled") continue;
    const s = jobMinutes(j.scheduledAt, tz).min;
    const e = s + durationOf(j);
    startMin = Math.min(startMin, Math.floor(s / 60) * 60);
    endMin = Math.max(endMin, Math.ceil(e / 60) * 60);
    const kind: BlockKind = TERMINAL.has(j.status) ? "done" : j.late ? "late" : IN_FIELD.has(j.status) ? "active" : isUnassigned(j) ? "unassigned" : "scheduled";
    raw.push({ id: j.id, s, e, kind });
  }
  endMin = Math.min(endMin, 24 * 60);
  const span = endMin - startMin;
  return { startMin, endMin, blocks: raw.map((b) => ({ id: b.id, from: (b.s - startMin) / span, to: (Math.min(b.e, endMin) - startMin) / span, kind: b.kind })) };
}

// -------------------------------------------------------------------- crew --

export type CrewKey = "available" | "enroute" | "onsite" | "busy" | "offline";

export interface CrewGroup {
  key: CrewKey;
  techs: OfficeTech[];
  /** Soonest "free at" among on-site / busy people, ISO; null when unknown. */
  freeAt: string | null;
  /** ETA in minutes for a lone tech on the way, from their next job. */
  etaMins: number | null;
}

const CREW_ORDER: CrewKey[] = ["available", "enroute", "onsite", "busy", "offline"];

export function crewGroups(techs: readonly OfficeTech[], jobs: readonly Pick<OfficeJob, "id" | "etaMins">[]): CrewGroup[] {
  const by = new Map<CrewKey, OfficeTech[]>();
  for (const t of techs) {
    const k: CrewKey = t.status === "break" ? "busy" : (CREW_ORDER as string[]).includes(t.status) ? (t.status as CrewKey) : "offline";
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  return CREW_ORDER.filter((k) => by.has(k)).map((key) => {
    const list = [...by.get(key)!].sort((a, b) => a.name.localeCompare(b.name));
    const frees = list.map((t) => t.freeAt).filter((x): x is string => !!x).sort();
    let etaMins: number | null = null;
    if (key === "enroute") {
      const etas = list
        .map((t) => jobs.find((j) => j.id === (t.currentJobId ?? t.nextJobIds[0]))?.etaMins)
        .filter((x): x is number => typeof x === "number");
      etaMins = etas.length ? Math.min(...etas) : null;
    }
    return { key, techs: list, freeAt: key === "onsite" || key === "busy" ? (frees[0] ?? null) : null, etaMins };
  });
}

// ------------------------------------------------------------------- needs --

export type NeedKind = "late" | "unassigned" | "offered" | "stale" | "unconfirmed";

export interface Need {
  key: string;
  kind: NeedKind;
  jobId: string | null;
  techId: string | null;
  /** Sort key: severity, then time. */
  rank: number;
}

const SEVERITY: Record<NeedKind, number> = { late: 0, unassigned: 1, offered: 2, stale: 3, unconfirmed: 4 };

/**
 * One queue, each job at most once under its most urgent reason: late, then
 * no technician, then an offer nobody has accepted, then unconfirmed by the
 * customer. On-shift technicians whose location has gone stale join it too.
 */
export function needsYou<T extends J>(jobs: readonly T[], techs: readonly Pick<OfficeTech, "id" | "status" | "stale">[]): Need[] {
  const out: Need[] = [];
  for (const j of jobs) {
    if (TERMINAL.has(j.status)) continue;
    const kind: NeedKind | null = j.late ? "late" : isUnassigned(j) ? "unassigned" : j.assignStatus === "offered" ? "offered" : j.status === "pending" ? "unconfirmed" : null;
    if (!kind) continue;
    out.push({ key: `job-${j.id}`, kind, jobId: j.id, techId: j.riderId, rank: SEVERITY[kind] * 1e13 + Date.parse(j.scheduledAt) });
  }
  for (const t of techs) {
    if (t.stale && t.status !== "offline") out.push({ key: `tech-${t.id}`, kind: "stale", jobId: null, techId: t.id, rank: SEVERITY.stale * 1e13 });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

// ----------------------------------------------------------------- up next --

/**
 * Assigned jobs that haven't started, soonest first, leaving out anything
 * already in the Needs-you queue. Prefers the next `horizonMins`; when that
 * window is empty it shows the next few anyway so the band is never blank
 * while work is still to come.
 */
export function upNext<T extends J>(jobs: readonly T[], now: Date, needs: readonly Need[], horizonMins = 120, limit = 5): T[] {
  const flagged = new Set(needs.map((n) => n.jobId).filter(Boolean));
  const t0 = now.getTime() - 15 * 60_000;
  const pool = jobs
    .filter((j) => !flagged.has(j.id) && !TERMINAL.has(j.status) && !IN_FIELD.has(j.status) && !!j.riderId && Date.parse(j.scheduledAt) >= t0)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const soon = pool.filter((j) => Date.parse(j.scheduledAt) <= now.getTime() + horizonMins * 60_000);
  return (soon.length ? soon : pool).slice(0, limit);
}

// --------------------------------------------------------------- tomorrow --

export interface DayAhead {
  day: string;
  total: number;
  unassigned: number;
  unconfirmed: number;
  firstStart: number | null;
  onRoster: number;
  offNames: string[];
}

/** Tomorrow's preview and the unassigned count for the rest of the range, from a multi-day board. */
export function dayAhead<T extends J>(
  jobs: readonly T[],
  techs: readonly Pick<OfficeTech, "id" | "name">[],
  timeOff: ReadonlyArray<{ techId: string; day: string }>,
  day: string,
  tz: string,
): { tomorrow: DayAhead; laterUnassigned: number } {
  const t: DayAhead = { day, total: 0, unassigned: 0, unconfirmed: 0, firstStart: null, onRoster: techs.length, offNames: [] };
  let later = 0;
  for (const j of jobs) {
    if (TERMINAL.has(j.status)) continue;
    const { day: d, min } = jobMinutes(j.scheduledAt, tz);
    if (d === day) {
      t.total++;
      if (isUnassigned(j)) t.unassigned++;
      if (j.status === "pending") t.unconfirmed++;
      t.firstStart = t.firstStart == null ? min : Math.min(t.firstStart, min);
    } else if (d > day && isUnassigned(j)) later++;
  }
  const off = new Set(timeOff.filter((x) => x.day === day).map((x) => x.techId));
  t.offNames = techs.filter((x) => off.has(x.id)).map((x) => x.name);
  t.onRoster = techs.length - off.size;
  return { tomorrow: t, laterUnassigned: later };
}

/** "10–11 AM" for an hour that starts at `min`. */
export function hourRange(min: number): string {
  const h = Math.floor(min / 60);
  const fmt = (x: number) => (x % 12 === 0 ? 12 : x % 12);
  const a = h < 12 ? "AM" : "PM";
  const b = h + 1 < 12 || h + 1 === 24 ? "AM" : "PM";
  return a === b ? `${fmt(h)}–${fmt(h + 1)} ${b}` : `${fmt(h)} ${a}–${fmt(h + 1)} ${b}`;
}
