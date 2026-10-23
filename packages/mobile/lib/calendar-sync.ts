import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import * as SecureStore from "expo-secure-store";
import { api } from "./api";
import { planSync, refOf, type DesiredEvent, type ServerEvent } from "./calendar-plan";

/**
 * Puts the technician's jobs into the phone's own calendar (Dan, 2026-10-23).
 *
 * Techs never sign in to the web console, so the phone is the only place a
 * calendar connection can be made. Two ways, both on Profile → Calendar sync:
 *
 *  1. Sync to this phone (this file). The app writes each job as a real event
 *     through the OS calendar store — EventKit on iPhone, CalendarContract on
 *     Android — into either:
 *       - its own "ArrivePing Jobs" calendar (iCloud or On My iPhone; a local
 *         calendar on Android), or
 *       - a calendar the tech already has on the phone. That is how Google
 *         Calendar and Outlook are reached from a phone: a Google or Outlook /
 *         Exchange account added to the phone exposes its calendars here, and
 *         whatever is written to them syncs to Google / Microsoft and shows in
 *         the Google Calendar and Outlook apps and on the web.
 *     Every event carries the "ArrivePing ref:" tag (lib/calendar-plan.ts) and
 *     only tagged events are ever changed or removed, so a personal calendar
 *     is safe to pick. Runs when the app opens, when it comes back to the
 *     foreground, every 15 minutes while open, and on "Sync now".
 *
 *  2. Subscribe with a link (the screen calls GET /api/calendar/feed): the
 *     same jobs as an iCalendar (.ics) feed that Apple, Google or Outlook
 *     fetches on its own schedule, even when the app is closed.
 *
 * expo-calendar is a native module that is new in app 1.0.4. An over-the-air
 * update must never reach a 1.0.3 binary that lacks it (runtimeVersion is
 * bumped with it), and even so every entry point checks the module is really
 * there and reports "not available" rather than crashing.
 */

type CalendarModule = typeof import("expo-calendar");

let mod: CalendarModule | null | undefined;
function cal(): CalendarModule | null {
  if (mod !== undefined) return mod;
  try {
    mod = Platform.OS !== "web" && requireOptionalNativeModule("ExpoCalendar") ? (require("expo-calendar") as CalendarModule) : null;
  } catch {
    mod = null;
  }
  return mod;
}

/** False on a build without the native module (older binary, web). */
export function calendarSyncAvailable(): boolean {
  return cal() !== null;
}

export const OWN_CALENDAR_TITLE = "ArrivePing Jobs";
const OWN_CALENDAR_COLOR = "#0ea5e9";
const KEY = "calendar_sync";
/**
 * Ids of the calendars this install created. Only these are ever reused as
 * "ArrivePing Jobs" or deleted whole: a calendar the tech made themselves
 * with the same name is just another calendar of theirs.
 */
const OWNED_KEY = "calendar_sync_owned";
const AUTO_SYNC_EVERY_MS = 15 * 60_000;
const MIN_GAP_MS = 60_000;

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  failed: number;
}

export interface CalendarSyncSettings {
  /** Whose jobs these are. A different person signed in on this phone is never synced into this calendar. */
  userId: string;
  calendarId: string;
  /** "own" = the ArrivePing Jobs calendar the app made; "existing" = one the tech picked. */
  mode: "own" | "existing";
  /** e.g. "ArrivePing Jobs · iCloud" or "Work · Google". */
  label: string;
  lastSyncAt?: string;
  lastResult?: SyncResult;
  lastError?: string | null;
  /**
   * Start of the earliest job this app has written to the calendar. Past jobs
   * stay on the phone as history after they leave the sync window, so turning
   * sync off has to reach back this far to remove all of them.
   */
  oldestWrittenAt?: string;
}

// ---------------------------------------------------------------- settings --

let cache: CalendarSyncSettings | null | undefined;
const listeners = new Set<(s: CalendarSyncSettings | null) => void>();

export function getCalendarSync(): CalendarSyncSettings | null {
  if (cache !== undefined) return cache;
  try {
    const raw = SecureStore.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as CalendarSyncSettings) : null;
  } catch {
    // A locked keychain or bad JSON reads as "not connected" — never a crash.
    return null;
  }
  return cache;
}

async function save(next: CalendarSyncSettings | null): Promise<void> {
  cache = next;
  try {
    if (next) await SecureStore.setItemAsync(KEY, JSON.stringify(next));
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Keeps working for this session; the next launch just asks again.
  }
  for (const fn of listeners) fn(next);
}

/** Current settings, re-rendering when a sync (manual or automatic) finishes. */
export function useCalendarSyncSettings(): CalendarSyncSettings | null {
  const [s, setS] = useState(getCalendarSync);
  useEffect(() => {
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

function ownedCalendarIds(): string[] {
  try {
    const raw = SecureStore.getItem(OWNED_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function setOwnedCalendarIds(ids: string[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(OWNED_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    // Not recorded means not deleted later: the safe way to fail.
  }
}

// -------------------------------------------------------------- permission --

export type PermissionState = "granted" | "ask" | "blocked" | "unavailable";

export async function calendarPermission(): Promise<PermissionState> {
  const C = cal();
  if (!C) return "unavailable";
  const p = await C.getCalendarPermissionsAsync();
  if (p.granted) return "granted";
  return p.canAskAgain ? "ask" : "blocked";
}

/** Asks if it can; "blocked" means the tech has to turn it on in Settings. */
export async function requestCalendarPermission(): Promise<PermissionState> {
  const C = cal();
  if (!C) return "unavailable";
  const now = await calendarPermission();
  if (now !== "ask") return now;
  const p = await C.requestCalendarPermissionsAsync();
  if (p.granted) return "granted";
  return p.canAskAgain ? "ask" : "blocked";
}

// ----------------------------------------------------------------- targets --

export interface CalendarTarget {
  id: string;
  title: string;
  /** The account it belongs to, as the phone names it: "iCloud", "Gmail", an email address, "Outlook"… */
  account: string;
  color?: string;
  isPrimary?: boolean;
}

/** Calendars on this phone the app can write to, grouped by account. The calendar the app made is left out (it has its own option). */
export async function listWritableCalendars(): Promise<CalendarTarget[]> {
  const C = cal();
  if (!C) return [];
  const owned = ownedCalendarIds();
  const all = await C.getCalendarsAsync(C.EntityTypes.EVENT);
  return all
    .filter((c) => c.allowsModifications && !owned.includes(c.id))
    .filter((c) => {
      const t = String(c.source?.type ?? "").toLowerCase();
      return t !== "subscribed" && t !== "birthdays";
    })
    .map((c) => ({
      id: c.id,
      title: c.title,
      account: c.source?.name || (c.source?.isLocalAccount ? "This phone" : "Other"),
      color: c.color,
      isPrimary: c.isPrimary,
    }))
    .sort((a, b) => a.account.localeCompare(b.account) || Number(!!b.isPrimary) - Number(!!a.isPrimary) || a.title.localeCompare(b.title));
}

/**
 * Find or make the "ArrivePing Jobs" calendar. iPhone: in iCloud if the phone
 * has it (so it shows on the tech's other Apple devices), otherwise On My
 * iPhone — EventKit can't create calendars inside Google or Exchange accounts.
 * Android: a local calendar, which the Google Calendar app and the phone's
 * own calendar app both show.
 */
async function ensureOwnCalendar(): Promise<{ id: string; label: string }> {
  const C = cal()!;
  const owned = ownedCalendarIds();
  // Only one this install made: matching by name could adopt (and later
  // delete) a calendar of the tech's own that happens to share it.
  const existing = (await C.getCalendarsAsync(C.EntityTypes.EVENT)).find((c) => owned.includes(c.id) && c.allowsModifications);
  if (existing) return { id: existing.id, label: `${OWN_CALENDAR_TITLE} · ${existing.source?.name || "This phone"}` };
  const created = async (id: string, label: string) => {
    await setOwnedCalendarIds([...owned, id]);
    return { id, label };
  };

  if (Platform.OS === "ios") {
    const sources = await C.getSourcesAsync();
    const icloud = sources.find((s) => s.type === C.SourceType.CALDAV && /icloud/i.test(s.name));
    const local = sources.find((s) => s.type === C.SourceType.LOCAL);
    const candidates = [icloud, local].filter((s): s is NonNullable<typeof s> => !!s);
    let lastErr: unknown = null;
    for (const source of candidates) {
      try {
        const id = await C.createCalendarAsync({
          title: OWN_CALENDAR_TITLE,
          color: OWN_CALENDAR_COLOR,
          entityType: C.EntityTypes.EVENT,
          sourceId: source.id,
          source,
          name: OWN_CALENDAR_TITLE,
          ownerAccount: "personal",
          accessLevel: C.CalendarAccessLevel.OWNER,
        });
        return created(id, `${OWN_CALENDAR_TITLE} · ${source === icloud ? "iCloud" : "On My iPhone"}`);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr ?? new Error("This iPhone has no iCloud or On My iPhone calendar account to add a calendar to.");
  }

  const id = await C.createCalendarAsync({
    title: OWN_CALENDAR_TITLE,
    color: OWN_CALENDAR_COLOR,
    entityType: C.EntityTypes.EVENT,
    source: { isLocalAccount: true, name: "ArrivePing", type: "LOCAL" },
    name: "arriveping_jobs",
    ownerAccount: "ArrivePing",
    accessLevel: C.CalendarAccessLevel.OWNER,
    isVisible: true,
    isSynced: true,
  });
  return created(id, `${OWN_CALENDAR_TITLE} · This phone`);
}

// -------------------------------------------------------------------- sync --

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function eventFields(e: DesiredEvent) {
  const C = cal()!;
  return {
    title: e.title,
    startDate: e.start,
    endDate: e.end,
    location: e.location,
    notes: e.notes,
    timeZone: deviceTimeZone(),
    allDay: false,
    availability: C.Availability.BUSY,
    alarms:
      e.alarmMinutesBefore != null
        ? [{ relativeOffset: -e.alarmMinutesBefore, ...(Platform.OS === "android" ? { method: C.AlarmMethod.ALERT } : {}) }]
        : [],
    // iOS shows this as the event's link; Android has no URL field (the
    // notes already end with the "Track:" link).
    ...(Platform.OS === "ios" && e.url ? { url: e.url } : {}),
  };
}

function message(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? "");
  return m.length > 160 ? m.slice(0, 157) + "…" : m || "Something went wrong";
}

let inFlight: Promise<SyncResult | null> | null = null;
let lastStarted = 0;

/**
 * Bring the phone's calendar in line with the tech's jobs. Single-flight:
 * a second call while one is running gets the same result. Returns null when
 * sync isn't set up (or belongs to someone else on this phone).
 */
export function syncCalendarNow(userId?: string): Promise<SyncResult | null> {
  if (inFlight) return inFlight;
  lastStarted = Date.now();
  inFlight = runSync(userId).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSync(userId?: string): Promise<SyncResult | null> {
  const C = cal();
  const saved = getCalendarSync();
  if (!C || !saved) return null;
  const s = { ...saved };
  if (userId && s.userId !== userId) return null;

  const fail = async (err: string) => {
    await save({ ...s, lastError: err });
    return null;
  };

  if ((await calendarPermission()) !== "granted") {
    return fail("Calendar access is turned off for ArrivePing. Turn it on in Settings to keep syncing.");
  }

  let calendarId = s.calendarId;
  const calendars = await C.getCalendarsAsync(C.EntityTypes.EVENT);
  if (!calendars.some((c) => c.id === calendarId && c.allowsModifications)) {
    if (s.mode === "existing") return fail("The calendar you picked isn't on this phone any more. Choose another one.");
    // Someone deleted the ArrivePing Jobs calendar: make it again.
    try {
      const own = await ensureOwnCalendar();
      calendarId = own.id;
      s.calendarId = own.id;
      s.label = own.label;
    } catch (e) {
      return fail(`Couldn't make the ArrivePing Jobs calendar: ${message(e)}`);
    }
  }

  let body: { from: string; to: string; events: ServerEvent[] };
  try {
    const res = await api.calendar.events.$get();
    if (!res.ok) return fail(res.status === 401 ? "Sign in again to keep your calendar up to date." : "Couldn't reach ArrivePing. It will try again shortly.");
    body = (await res.json()) as typeof body;
  } catch {
    return fail("No connection. Your calendar will catch up when you're back online.");
  }

  const from = new Date(body.from);
  const to = new Date(body.to);
  const DAY = 86_400_000;
  const device = await C.getEventsAsync([calendarId], new Date(from.getTime() - DAY), new Date(to.getTime() + DAY));
  const plan = planSync(
    body.events,
    device.map((d) => ({ id: d.id, title: d.title, notes: d.notes, location: d.location, startDate: d.startDate, endDate: d.endDate })),
    { from },
  );

  const result: SyncResult = { added: 0, updated: 0, removed: 0, failed: 0 };
  for (const id of plan.remove) {
    try {
      await C.deleteEventAsync(id);
      result.removed++;
    } catch {
      result.failed++;
    }
  }
  for (const u of plan.update) {
    try {
      await C.updateEventAsync(u.id, eventFields(u.event));
      result.updated++;
    } catch {
      result.failed++;
    }
  }
  for (const e of plan.create) {
    try {
      await C.createEventAsync(calendarId, eventFields(e));
      result.added++;
    } catch {
      result.failed++;
    }
  }

  const written = [...plan.create, ...plan.update.map((u) => u.event)].map((e) => e.start.getTime());
  const oldest = Math.min(parseTime(s.oldestWrittenAt) ?? Infinity, ...written);
  await save({
    ...s,
    calendarId,
    oldestWrittenAt: Number.isFinite(oldest) ? new Date(oldest).toISOString() : s.oldestWrittenAt,
    lastSyncAt: new Date().toISOString(),
    lastResult: result,
    lastError: result.failed ? `${result.failed} job${result.failed === 1 ? "" : "s"} couldn't be written. It will try again next sync.` : null,
  });
  return result;
}

/** Calendar access was refused; the screen offers Settings. */
export class CalendarPermissionError extends Error {
  constructor(readonly state: PermissionState) {
    super(state === "blocked" ? "Calendar access is turned off for ArrivePing in Settings." : "ArrivePing needs calendar access to add your jobs.");
  }
}

/** Turn sync on into the app's own calendar, or into one the tech picked. Runs a first sync. */
export async function connectCalendar(userId: string, target: { mode: "own" } | { mode: "existing"; calendar: CalendarTarget }): Promise<SyncResult | null> {
  if (!cal()) throw new Error("Calendar sync needs the latest version of the app.");
  const perm = await requestCalendarPermission();
  if (perm !== "granted") throw new CalendarPermissionError(perm);
  const previous = getCalendarSync();
  const next =
    target.mode === "own"
      ? { ...(await ensureOwnCalendar()), mode: "own" as const }
      : { id: target.calendar.id, label: `${target.calendar.title} · ${target.calendar.account}`, mode: "existing" as const };
  // Moving to a different calendar: take the jobs out of the old one first so
  // they don't end up in both.
  if (previous && previous.calendarId !== next.id) await removeOurEvents(previous).catch(() => {});
  const sameCalendar = previous?.calendarId === next.id;
  await save({
    userId,
    calendarId: next.id,
    mode: next.mode,
    label: next.label,
    lastError: null,
    // Reconnecting the same calendar: its old jobs are still there to clean up later.
    ...(sameCalendar && previous?.oldestWrittenAt ? { oldestWrittenAt: previous.oldestWrittenAt } : {}),
  });
  return syncCalendarNow(userId);
}

function parseTime(iso?: string): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** Every ArrivePing-tagged event in this calendar, back to the oldest one the app wrote. */
async function removeOurEvents(s: CalendarSyncSettings): Promise<void> {
  const C = cal();
  if (!C || (await calendarPermission()) !== "granted") return;
  if (s.mode === "own" && ownedCalendarIds().includes(s.calendarId)) {
    // The calendar this install made: deleting it takes every job with it.
    await C.deleteCalendarAsync(s.calendarId).catch(() => {});
    await setOwnedCalendarIds(ownedCalendarIds().filter((id) => id !== s.calendarId));
    return;
  }
  // Anything else (a calendar the tech picked, or one we can't prove we made):
  // only the jobs ArrivePing tagged.
  const DAY = 86_400_000;
  const YEAR = 365 * DAY;
  const now = Date.now();
  const start = Math.min(now - 400 * DAY, (parseTime(s.oldestWrittenAt) ?? Infinity) - DAY);
  // Sync never writes past the server's 90-day window; 400 days is margin.
  const end = now + 400 * DAY;
  // A year at a time: iOS only searches the first four years of a longer
  // range. Chunks overlap by a day so a job crossing a boundary is still found
  // (Android only returns events that end inside the range asked for).
  const seen = new Set<string>();
  for (let a = start; a < end; a += YEAR) {
    const events = await C.getEventsAsync([s.calendarId], new Date(a - DAY), new Date(Math.min(a + YEAR, end) + DAY));
    for (const e of events) {
      if (seen.has(e.id) || !refOf(e.notes)) continue;
      seen.add(e.id);
      await C.deleteEventAsync(e.id).catch(() => {});
    }
  }
}

/**
 * Stop syncing. With removeEvents, the jobs come off the phone too (the
 * ArrivePing Jobs calendar is deleted; in a picked calendar only tagged
 * events go). Sign-out and account deletion always remove them: a customer's
 * name and address shouldn't stay on a phone after the tech has left it.
 */
export async function disconnectCalendar(opts: { removeEvents: boolean }): Promise<void> {
  const s = getCalendarSync();
  if (!s) return;
  if (opts.removeEvents) {
    await Promise.race([removeOurEvents(s).catch(() => {}), new Promise((r) => setTimeout(r, 8_000))]);
  }
  await save(null);
}

/**
 * Keeps the phone's calendar current while the app is open: once on mount,
 * every time the app returns to the foreground, and every 15 minutes. Mounted
 * once, in the technician tab layout.
 */
export function useCalendarAutoSync(userId: string | undefined) {
  useEffect(() => {
    if (!userId || !cal()) return;
    const kick = () => {
      const s = getCalendarSync();
      if (!s || s.userId !== userId) return;
      if (Date.now() - lastStarted < MIN_GAP_MS) return;
      syncCalendarNow(userId).catch(() => {});
    };
    kick();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") kick();
    }, AUTO_SYNC_EVERY_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") kick();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [userId]);
}
