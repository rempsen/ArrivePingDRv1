/**
 * What to change in the phone's calendar so it matches the technician's jobs.
 *
 * Pure (no react-native imports) so bun tests can load it; lib/calendar-sync.ts
 * does the native reads and writes.
 *
 * Every event ArrivePing writes ends its notes with a reference line,
 * "ArrivePing ref: booking-…@nvc360" (the same UID as the .ics feed). That tag
 * is how a sync finds its own events again, and the rule that keeps it safe in
 * someone's personal Google or Outlook calendar: an event without the tag is
 * never updated or removed.
 */

export const REF_LABEL = "ArrivePing ref:";
// The uid's own characters only, so a calendar that turns notes into HTML
// (Exchange can) still reads back "booking-1@nvc360", not "booking-1@nvc360</p>".
const REF_RE = /ArrivePing ref:\s*([A-Za-z0-9._~@-]+)/;

/** One job as GET /api/calendar/events returns it. */
export interface ServerEvent {
  uid: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  url: string | null;
  alarmMinutesBefore: number | null;
}

/** The fields of a phone calendar event the sync reads. */
export interface DeviceEvent {
  id: string;
  title?: string | null;
  notes?: string | null;
  location?: string | null;
  startDate: string | Date;
  endDate: string | Date;
}

/** An event as it should look on the phone. */
export interface DesiredEvent {
  uid: string;
  title: string;
  notes: string;
  location: string;
  start: Date;
  end: Date;
  url: string | null;
  alarmMinutesBefore: number | null;
}

export interface SyncPlan {
  create: DesiredEvent[];
  update: { id: string; event: DesiredEvent }[];
  /** Device event ids to delete. Only ever events carrying ArrivePing's tag. */
  remove: string[];
  /** Jobs already matching, untouched. */
  unchanged: number;
}

/** The reference a device event carries, or null if ArrivePing didn't write it. */
export function refOf(notes: string | null | undefined): string | null {
  const m = notes ? REF_RE.exec(notes) : null;
  return m ? m[1]! : null;
}

/** The job's notes as written to the phone: the job details, then the tag. */
export function notesFor(e: Pick<ServerEvent, "description" | "uid">): string {
  const body = e.description.trim();
  return `${body ? body + "\n\n" : ""}${REF_LABEL} ${e.uid}`;
}

export function desiredFrom(e: ServerEvent): DesiredEvent {
  return {
    uid: e.uid,
    title: e.title,
    notes: notesFor(e),
    location: e.location,
    start: new Date(e.start),
    end: new Date(e.end),
    url: e.url,
    alarmMinutesBefore: e.alarmMinutesBefore,
  };
}

// Calendar services re-wrap whitespace and some drop seconds; neither is a
// real change, and treating it as one would rewrite every event every sync.
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const ms = (d: string | Date) => new Date(d).getTime();
const minute = (d: string | Date) => Math.round(ms(d) / 60_000);

/** Does the phone's copy already say what the job says? */
export function sameEvent(device: DeviceEvent, want: DesiredEvent): boolean {
  return (
    norm(device.title) === norm(want.title) &&
    norm(device.location) === norm(want.location) &&
    norm(device.notes) === norm(want.notes) &&
    minute(device.startDate) === minute(want.start) &&
    minute(device.endDate) === minute(want.end)
  );
}

/**
 * Compare the jobs with the phone's events in the same window.
 *   - a job with no event yet → create;
 *   - a job whose event differs → update;
 *   - a cancelled job, or a tagged event whose job is gone (unassigned,
 *     deleted, moved out of the window) → remove;
 *   - a second copy of the same job (e.g. after a restore from backup) → remove.
 * Cancelled jobs are taken off the phone rather than shown: a technician's
 * calendar should show only work they're going to.
 *
 * `from` is the start of the server's window. The phone is read a little
 * wider than the window (Android only returns events that END inside the
 * range asked for, so a late-evening job on the last day would otherwise look
 * missing and be created again every sync). Events that started before `from`
 * are past jobs that have aged out of the window: they're history, so they're
 * left on the phone rather than treated as gone.
 */
export function planSync(server: ServerEvent[], device: DeviceEvent[], opts: { from?: Date | string } = {}): SyncPlan {
  const floor = opts.from ? ms(opts.from) : -Infinity;
  const mine = new Map<string, DeviceEvent>();
  const remove: string[] = [];
  for (const d of device) {
    const ref = refOf(d.notes);
    if (!ref) continue; // not ours: never touched
    if (ms(d.startDate) < floor) continue; // aged out of the window: kept as history
    if (mine.has(ref)) remove.push(d.id);
    else mine.set(ref, d);
  }

  const create: DesiredEvent[] = [];
  const update: { id: string; event: DesiredEvent }[] = [];
  let unchanged = 0;
  const live = new Set<string>();
  for (const e of server) {
    const existing = mine.get(e.uid);
    if (e.status === "CANCELLED") {
      if (existing) remove.push(existing.id);
      continue;
    }
    live.add(e.uid);
    const want = desiredFrom(e);
    if (!existing) create.push(want);
    else if (sameEvent(existing, want)) unchanged++;
    else update.push({ id: existing.id, event: want });
  }
  for (const [ref, d] of mine) {
    if (!live.has(ref) && !remove.includes(d.id)) remove.push(d.id);
  }
  return { create, update, remove, unchanged };
}
