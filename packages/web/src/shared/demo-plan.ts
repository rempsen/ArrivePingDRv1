/**
 * The demo tenant's schedule, as a pure function of the calendar.
 *
 * The sales demo (Prairie Comfort HVAC) has to look like a busy, healthy HVAC
 * shop at whatever moment a prospect opens it: a full board today, the rest of
 * the week booked, techs moving, and nothing "running late". Seeding it once
 * can't do that — by the next morning every job is in the past and the board
 * is a wall of red. So the schedule is not stored anywhere; it is *computed*
 * from the date by `planDay()`, and services/demo-refresh.ts makes the
 * database match it a little at a time.
 *
 * Everything here is deterministic (a hash of the day and slot code, never
 * Math.random) so two server instances, or a re-run after a crash, compute the
 * identical plan and can never create a second copy of a job.
 *
 * Shape of a day (local wall clock of the tenant):
 *   Weekdays  every tech booked 8:00 a.m. – 6:30 p.m., two jobs left
 *             unassigned for dispatch, one daytime emergency
 *   Weekends  a lighter Saturday/Sunday crew plus daytime emergencies
 *   Nightly   after-hours emergency calls at 7 p.m., 10 p.m., 1 a.m. and
 *             4 a.m., shared by two on-call techs, so the demo is never idle
 */
import { zonedTimeToInstant } from "./tz";

export interface DemoTech {
  id: string;
  name: string;
}

/** A job the tenant already has that we can copy content from, keyed by title. */
export interface DemoTemplate {
  title: string;
  durationMins: number;
}

export type DemoKind = "regular" | "unassigned" | "emergency" | "weekend";

export interface DemoSlot {
  /** Stable identity: "<day>|<code>". Stored on the booking (fieldData.__demo). */
  key: string;
  /** The plan day this slot belongs to (YYYY-MM-DD) — a 1 a.m. call belongs to the previous evening. */
  day: string;
  code: string;
  kind: DemoKind;
  start: Date;
  durationMins: number;
  /** Drive time before `start` — the job is "en route" for this long. */
  leadMins: number;
  /** The tech who does the job. For `unassigned` slots dispatch hands it over at `assignAt`. */
  techId: string | null;
  /** Booking exists from this instant (emergencies "come in" shortly before; the rest are pre-booked). */
  appearAt: Date;
  /** `unassigned` slots only: when dispatch assigns the job to `techId`. */
  assignAt: Date | null;
  /** Sent to the tech as an offer they haven't accepted yet, until this instant. */
  offerUntil: Date | null;
  /** Title of the existing job whose content (service, parts, notes, price) is copied. */
  templateTitle: string;
  title: string;
  priority: "normal" | "high" | "urgent";
  /** Replaces the template's homeowner notes (emergencies). */
  notes?: string;
  /** Index into the tenant's customer pool. Distinct within a day while the pool is big enough. */
  customerIndex: number;
}

/* ─────────────────────────── content pools ─────────────────────────── */

/** Bread-and-butter HVAC work. Tune-ups are listed more than once on purpose: it's October. */
export const REGULAR_TITLES = [
  "Furnace tune-up",
  "Furnace tune-up",
  "Furnace tune-up",
  "Furnace tune-up",
  "Smart thermostat install",
  "AC seasonal shutdown",
  "Humidifier install",
  "Humidifier pad replacement",
  "HRV maintenance",
  "Boiler annual service",
  "Ductwork cleaning estimate",
  "Air quality assessment",
  "Water heater flush",
  "Heat pump install consult",
  "Carbon monoxide safety check",
  "Thermostat not responding",
  "Furnace filter + IAQ check",
  "Ductless mini-split service",
  "Draft complaint — duct balancing",
  "Water heater replacement quote",
  "No heat — pilot keeps going out",
  "Furnace making noise",
] as const;

/** What the licensed gas fitter gets booked on. */
export const GAS_TITLES = [
  "Gas line inspection",
  "Gas fireplace annual service",
  "Fireplace insert service",
  "Boiler annual service",
  "Boiler pressure issue",
  "Carbon monoxide safety check",
  "Water heater flush",
] as const;

/** Install days for the service lead. */
export const BIG_TITLES = ["Furnace replacement — day 1", "Heat pump install"] as const;

export const EMERGENCIES = [
  {
    title: "Emergency — no heat, furnace locked out",
    template: "No heat — furnace not igniting",
    notes:
      "Furnace shut down and won't restart. House is down to 16°C and there's a newborn at home. Please call on arrival.",
  },
  {
    title: "Emergency — boiler relief valve leaking",
    template: "Boiler pressure issue",
    notes:
      "Water coming out of the boiler relief valve and the pressure gauge is in the red. Homeowner has shut off the water feed.",
  },
  {
    title: "Emergency — CO alarm sounding",
    template: "Carbon monoxide safety check",
    notes:
      "CO alarm went off near the furnace room. Family is outside and has opened the windows. Meet them at the front door.",
  },
  {
    title: "Emergency — furnace bang, then shut off",
    template: "Furnace making noise",
    notes: "Loud bang on start-up, then the furnace shut off and won't come back on. Burning smell near the unit.",
  },
  {
    title: "Emergency — no heat, igniter failed",
    template: "No heat — igniter replacement",
    notes: "Furnace clicks but won't light. Elderly homeowner and the house is getting cold. Side door is unlocked.",
  },
] as const;

const HIGH_PRIORITY = /^(no heat|boiler pressure|thermostat not responding)/i;

/** Known demo crew → the role that shapes their day. Anyone else is treated as an HVAC tech. */
const ROLE_BY_NAME: Record<string, Role> = {
  "elena kowalski": "lead",
  "liam dubois": "gas",
  "jordan park": "hvac",
  "aisha khan": "hvac",
  "priya sandhu": "hvac",
  "marcus bell": "apprentice",
};
type Role = "lead" | "gas" | "hvac" | "apprentice";

/* ─────────────────────────── helpers ─────────────────────────── */

/** FNV-1a — small, fast, stable across runtimes. */
/** How far ahead regular work is booked. Must be more than the refresh's DAYS_AHEAD. */
export const PREBOOK_DAYS = 14;

export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const pick = <T>(arr: readonly T[], seed: string): T => arr[hash(seed) % arr.length]!;

/** "YYYY-MM-DD" ± n days (pure calendar arithmetic, no time zone involved). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + n));
  return t.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

/** Days since 1970-01-01 — used to rotate on-call crews and customers. */
function dayOrdinal(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}

const MIN = 60_000;
/** Last minute any daytime job may still be running (6:30 p.m.). */
const DAY_END_MINS = 18 * 60 + 30;

/* ─────────────────────────── the plan ─────────────────────────── */

export interface PlanOptions {
  tz: string;
  techs: DemoTech[];
  /** Templates actually available in the tenant; slots needing a missing one are skipped. */
  templates: DemoTemplate[];
  customerCount: number;
}

/**
 * Every job of one plan day. Pure: same inputs, same output, always.
 *
 * Day-time jobs are packed per tech so they never overlap, and none runs past
 * 6:30 p.m.
 */
export function planDay(day: string, opts: PlanOptions): DemoSlot[] {
  const { tz, templates } = opts;
  if (!opts.techs.length || !templates.length || opts.customerCount < 1) return [];

  const techs = [...opts.techs].sort((a, b) => a.name.localeCompare(b.name));
  const roleOf = (t: DemoTech): Role => ROLE_BY_NAME[t.name.trim().toLowerCase()] ?? "hvac";
  const byRole = (r: Role) => techs.filter((t) => roleOf(t) === r);
  const lead = byRole("lead")[0] ?? techs[0]!;
  const gas = byRole("gas")[0] ?? techs[1 % techs.length]!;
  const apprentices = byRole("apprentice");
  const hvac = techs.filter((t) => t !== lead && t !== gas && !apprentices.includes(t));

  const durOf = new Map(templates.map((t) => [t.title, Math.max(15, Math.round(t.durationMins || 60))]));
  const has = (title: string) => durOf.has(title);
  const pool = (titles: readonly string[]) => {
    const p = titles.filter(has);
    return p.length ? p : templates.map((t) => t.title);
  };
  const regular = pool(REGULAR_TITLES);
  const gasPool = pool(GAS_TITLES);
  const bigPool = BIG_TITLES.filter(has);
  const emergencies = EMERGENCIES.filter((e) => has(e.template));

  const [Y, M, D] = day.split("-").map(Number);
  /** Instant for local wall-clock minutes on this plan day (minutes ≥ 1440 roll into the next day). */
  const at = (mins: number) =>
    zonedTimeToInstant(tz, Y!, M!, D! + Math.floor(mins / 1440), Math.floor((mins % 1440) / 60), mins % 60);

  const dow = dayOfWeek(day);
  const weekend = dow === 0 || dow === 6;
  const ord = dayOrdinal(day);

  // The two on-call techs for this day's emergencies (rotates daily).
  const onCallPairs: DemoTech[][] = weekend
    ? [[hvac[1] ?? lead, apprentices[0] ?? gas], [hvac[0] ?? lead, gas]]
    : [[gas, lead], [hvac[0] ?? lead, hvac[2] ?? gas]];
  const [onCallA, onCallB] = onCallPairs[ord % 2]!;

  const slots: DemoSlot[] = [];
  /** End (local minutes) of each tech's last packed daytime job. */
  const busyUntil = new Map<string, number>();
  /** Busy intervals per tech, local minutes, for finding a free tech for unassigned work. */
  const busy = new Map<string, Array<[number, number]>>();

  const leadFor = (code: string, gapMins: number) =>
    Math.max(10, Math.min(15 + (hash(`${day}|${code}|lead`) % 16), gapMins - 5));

  function add(
    code: string,
    kind: DemoKind,
    tech: DemoTech | null,
    startMins: number,
    templateTitle: string,
    extra: Partial<Pick<DemoSlot, "title" | "priority" | "notes" | "assignAt" | "offerUntil" | "appearAt" | "techId">> = {},
  ): DemoSlot | null {
    const dur = durOf.get(templateTitle);
    if (dur == null) return null;
    const before = tech ? (busy.get(tech.id) ?? []).map(([, e]) => e).filter((e) => e <= startMins) : [];
    const prevEnd = before.length ? Math.max(...before) : -Infinity;
    const leadMins = leadFor(code, Number.isFinite(prevEnd) ? startMins - prevEnd : 60);
    const start = at(startMins);
    const title = extra.title ?? templateTitle;
    const slot: DemoSlot = {
      key: `${day}|${code}`,
      day,
      code,
      kind,
      start,
      durationMins: dur,
      leadMins,
      techId: extra.techId !== undefined ? extra.techId : tech?.id ?? null,
      // Pre-booked well ahead: longer than the refresh fills (DAYS_AHEAD in
      // services/demo-refresh.ts), so a newly reached day arrives whole.
      appearAt: extra.appearAt ?? new Date(start.getTime() - PREBOOK_DAYS * 86_400_000),
      assignAt: extra.assignAt ?? null,
      offerUntil: extra.offerUntil ?? null,
      templateTitle,
      title,
      priority: extra.priority ?? (HIGH_PRIORITY.test(title) ? "high" : "normal"),
      notes: extra.notes,
      customerIndex: 0,
    };
    slots.push(slot);
    if (tech) {
      busyUntil.set(tech.id, Math.max(busyUntil.get(tech.id) ?? -Infinity, startMins + dur));
      const list = busy.get(tech.id) ?? [];
      list.push([startMins - leadMins, startMins + dur]);
      busy.set(tech.id, list);
    }
    return slot;
  }

  /** Pack a run of day jobs for one tech from nominal start times (weekends). */
  function packDay(tech: DemoTech, codePrefix: string, nominal: number[], titles: string[], kind: DemoKind, firstIndex = 1) {
    nominal.forEach((nom, i) => {
      const title = titles[i]!;
      const dur = durOf.get(title);
      if (dur == null) return;
      const prevEnd = busyUntil.get(tech.id) ?? -Infinity;
      const start = Math.max(nom, Number.isFinite(prevEnd) ? prevEnd + 30 : nom);
      const rounded = Math.ceil(start / 15) * 15;
      if (rounded + dur > DAY_END_MINS) return;
      add(`${codePrefix}${i + firstIndex}`, kind, tech, rounded, title);
    });
  }

  /**
   * Fill one tech's weekday back-to-back from `from` until 6:30 p.m. Each call
   * starts 30–75 minutes after the last one ends (the drive, plus the odd longer
   * gap for lunch), so at any moment most of the crew is driving or on site.
   * `holes` are windows kept free for work added separately — the daytime
   * emergency, or a job dispatch hands over later in the day.
   */
  function packRun(tech: DemoTech, prefix: string, from: number, titles: string[], maxJobs: number, holes: Array<[number, number]> = []) {
    let cursor = from;
    let n = 0;
    for (let i = 0; n < maxJobs && i < 12; i++) {
      let title = pick(titles, `${day}|${prefix}|${i}`);
      let dur = durOf.get(title);
      if (dur == null) continue;
      const start = Math.ceil(cursor / 15) * 15;
      const clash = holes.find(([s, e]) => start < e && start + dur! + 15 > s);
      if (clash) {
        // Something shorter may still fit before the reserved window; otherwise skip past it.
        const room = clash[0] - start - 15;
        const fits = titles.filter((x) => (durOf.get(x) ?? Infinity) <= room);
        if (start >= clash[0] || !fits.length) {
          cursor = clash[1] + 30;
          continue;
        }
        title = pick(fits, `${day}|${prefix}|fit|${i}`);
        dur = durOf.get(title)!;
      }
      if (start + dur > DAY_END_MINS) break;
      add(`${prefix}${n + 1}`, "regular", tech, start, title);
      n++;
      cursor = start + dur + 30 + (hash(`${day}|${prefix}|gap|${i}`) % 4) * 15;
    }
  }

  const h = (hh: number, mm = 0) => hh * 60 + mm;

  if (!weekend) {
    const light = regular.filter((x) => (durOf.get(x) ?? 999) <= 90);
    const holes = new Map<string, Array<[number, number]>>();
    const hole = (tech: DemoTech, s: number, e: number) => holes.set(tech.id, [...(holes.get(tech.id) ?? []), [s, e]]);

    // Work added on top of the packed days, decided first so the packing leaves room for it.
    const dayEm = emergencies.length ? pick(emergencies, `${day}|DE`) : null;
    const DE_AT = h(12, 15);
    if (dayEm) hole(lead, DE_AT - 45, DE_AT + (durOf.get(dayEm.template) ?? 90) + 20);
    const takers = [...hvac, ...apprentices];
    const unassigned = [h(14), h(16)].map((nom, i) => {
      const title = pick(light.length ? light : regular, `${day}|U${i}`);
      const tech = takers.length ? takers[(ord + i * 2) % takers.length]! : null;
      const dur = durOf.get(title) ?? 60;
      if (tech) hole(tech, nom - 45, nom + dur + 20);
      return { nom, title, tech, i };
    });

    // Service lead: an install morning on alternate days, then regular calls around the emergency.
    let leadFrom = h(8);
    if (bigPool.length && hash(`${day}|big`) % 2 === 0) {
      const big = pick(bigPool, `${day}|bigt`);
      if (add("LB", "regular", lead, h(8), big)) leadFrom = h(8) + (durOf.get(big) ?? 90) + 45;
    }
    packRun(lead, "L-", leadFrom, regular, 3, holes.get(lead.id));
    if (dayEm) {
      add("DE", "emergency", lead, DE_AT, dayEm.template, {
        title: dayEm.title,
        priority: "urgent",
        notes: dayEm.notes,
        appearAt: at(DE_AT - 50),
      });
    }

    // Gas fitter, HVAC techs (staggered starts), apprentices (lighter work, later start).
    packRun(gas, "G", h(8), gasPool, 5, holes.get(gas.id));
    hvac.forEach((t, ti) => packRun(t, `H${ti}-`, h(8) + (ti % 3) * 10, regular, 5, holes.get(t.id)));
    apprentices.forEach((t, ti) => packRun(t, `A${ti}-`, h(8, 30), light.length ? light : regular, 4, holes.get(t.id)));

    // Two jobs booked without a tech. Dispatch hands each over 90 minutes before it starts.
    for (const u of unassigned) {
      const dur = durOf.get(u.title);
      if (!u.tech || dur == null || u.nom + dur > DAY_END_MINS) continue;
      add(`U${u.i + 1}`, "unassigned", u.tech, u.nom, u.title, { assignAt: at(u.nom - 90) });
    }
  } else {
    // Weekend crew: Saturday three techs × two calls, Sunday two techs × one or two.
    const crew = [...hvac, gas, ...apprentices];
    const rot = ord % Math.max(1, crew.length);
    const rotated = [...crew.slice(rot), ...crew.slice(0, rot)];
    const team = rotated.slice(0, dow === 6 ? 3 : 2);
    team.forEach((t, ti) => {
      const nominal = dow === 6 ? [h(9), h(12)] : ti === 0 ? [h(10), h(13)] : [h(11)];
      packDay(t, `W${ti}-`, nominal, nominal.map((_, i) => pick(regular, `${day}|W${ti}|${i}`)), "weekend");
    });
    // Daytime emergencies on the weekend.
    for (const [i, nom, tech] of [[0, h(11, 15), onCallA], [1, h(15, 30), onCallB]] as const) {
      const em = emergencies.length ? pick(emergencies, `${day}|WE${i}`) : null;
      if (!em) continue;
      const prevEnd = busyUntil.get(tech!.id) ?? -Infinity;
      const start = Math.ceil(Math.max(nom, Number.isFinite(prevEnd) ? prevEnd + 30 : nom) / 15) * 15;
      add(`WE${i + 1}`, "emergency", tech!, start, em.template, {
        title: em.title,
        priority: "urgent",
        notes: em.notes,
        appearAt: at(start - 50),
      });
    }
  }

  // Nightly after-hours emergencies (every day), alternating between the two on-call techs.
  for (const [i, nom, tech] of [
    [0, h(19), onCallA],
    [1, h(22), onCallB],
    [2, h(25), onCallA],
    [3, h(28), onCallB],
  ] as const) {
    const em = emergencies.length ? pick(emergencies, `${day}|NE${i}`) : null;
    if (!em || !tech) continue;
    add(`NE${i + 1}`, "emergency", tech, nom, em.template, {
      title: em.title,
      priority: "urgent",
      notes: em.notes,
      appearAt: at(nom - 45),
    });
  }

  // One weekday job per day goes out as an offer the tech accepts the evening before.
  if (!weekend) {
    const candidates = slots.filter((s) => s.kind === "regular" && s.code.startsWith("H"));
    if (candidates.length) {
      const offer = candidates[hash(`${day}|offer`) % candidates.length]!;
      offer.offerUntil = zonedTimeToInstant(tz, Y!, M!, D! - 1, 18, 0);
    }
  }

  // Customers: rotate through the pool so nobody gets two visits in one day (while the pool allows).
  slots.sort((a, b) => a.start.getTime() - b.start.getTime() || a.code.localeCompare(b.code));
  const base = (ord * 7) % opts.customerCount;
  slots.forEach((s, i) => {
    s.customerIndex = (base + i) % opts.customerCount;
  });
  return slots;
}

/* ─────────────────────────── where a job is right now ─────────────────────────── */

/** Forward-only lifecycle. The sweep never moves a job backwards. */
export const STATUS_RANK: Record<string, number> = {
  pending: 0,
  confirmed: 1,
  assigned: 2,
  accepted: 2,
  enroute: 3,
  arrived: 4,
  in_progress: 5,
  completed: 6,
};

export interface DemoPhase {
  status: "confirmed" | "assigned" | "enroute" | "in_progress" | "completed";
  /** "none" while unassigned, "offered" while an unaccepted offer, else "accepted". */
  assignStatus: "none" | "offered" | "accepted";
  hasTech: boolean;
  assignedAt: Date | null;
  acceptedAt: Date | null;
  enrouteAt: Date | null;
  /** Arrival = work start (the demo tech starts the moment they arrive). */
  startedAt: Date | null;
  finishedAt: Date | null;
  /** Minutes left on the drive, while en route. */
  etaMins: number | null;
}

export interface PhaseInput {
  start: Date;
  durationMins: number;
  leadMins: number;
  appearAt: Date;
  assignAt: Date | null;
  offerUntil: Date | null;
  hasTech: boolean;
}

/** The state a job should be in at `now`. Pure. */
export function phaseAt(j: PhaseInput, now: Date): DemoPhase {
  const t = now.getTime();
  const start = j.start.getTime();
  const enroute = start - j.leadMins * MIN;
  const end = start + j.durationMins * MIN;
  const assignedAt = j.assignAt ?? new Date(Math.min(j.appearAt.getTime(), start - 3 * 3_600_000));
  const assigned = j.hasTech && t >= assignedAt.getTime();
  const offered = assigned && !!j.offerUntil && t < j.offerUntil.getTime();
  const acceptedAt = !assigned
    ? null
    : j.offerUntil
      ? j.offerUntil
      : assignedAt;

  if (!assigned) {
    return {
      status: "confirmed", assignStatus: "none", hasTech: false, assignedAt: null, acceptedAt: null,
      enrouteAt: null, startedAt: null, finishedAt: null, etaMins: null,
    };
  }
  const base = {
    hasTech: true,
    assignedAt,
    acceptedAt: offered ? null : acceptedAt,
    assignStatus: (offered ? "offered" : "accepted") as DemoPhase["assignStatus"],
  };
  if (t < enroute) {
    return { ...base, status: "assigned", enrouteAt: null, startedAt: null, finishedAt: null, etaMins: null };
  }
  if (t < start) {
    return {
      ...base, status: "enroute", enrouteAt: new Date(enroute), startedAt: null, finishedAt: null,
      etaMins: Math.max(1, Math.ceil((start - t) / MIN)),
    };
  }
  if (t < end) {
    return { ...base, status: "in_progress", enrouteAt: new Date(enroute), startedAt: new Date(start), finishedAt: null, etaMins: null };
  }
  return {
    ...base, status: "completed", enrouteAt: new Date(enroute), startedAt: new Date(start),
    finishedAt: new Date(end), etaMins: null,
  };
}

/** Straight-line position between two points, `f` in [0, 1]. */
export function lerp(a: { lat: number; lng: number }, b: { lat: number; lng: number }, f: number) {
  const k = Math.max(0, Math.min(1, f));
  return { lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k };
}
