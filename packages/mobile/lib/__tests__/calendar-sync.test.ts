/**
 * lib/calendar-sync.ts against a fake phone calendar: what actually gets
 * written, and what is never touched. The native module, keychain and API are
 * stand-ins; the planning logic is the real one.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Ev = { id: string; calendarId: string; title: string; notes: string; location: string; startDate: string; endDate: string; alarms?: unknown[]; url?: string };
type Cal = { id: string; title: string; allowsModifications: boolean; source: { name: string; type?: string; id?: string; isLocalAccount?: boolean }; color?: string };

const phone = {
  os: "ios" as "ios" | "android",
  granted: true,
  calendars: [] as Cal[],
  events: [] as Ev[],
  nextId: 1,
  created: [] as string[],
};
const store = new Map<string, string>();
let serverEvents: unknown[] = [];
let apiCalls = 0;

const day = 86_400_000;
const now = Date.now();
const iso = (t: number) => new Date(t).toISOString();

mock.module("react-native", () => ({
  Platform: { get OS() { return phone.os; } },
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
}));
mock.module("expo", () => ({ requireOptionalNativeModule: () => ({}) }));
mock.module("expo-secure-store", () => ({
  getItem: (k: string) => store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void store.set(k, v),
  deleteItemAsync: async (k: string) => void store.delete(k),
}));
mock.module("../api", () => ({
  api: {
    calendar: {
      events: {
        $get: async () => {
          apiCalls++;
          return { ok: true, status: 200, json: async () => ({ from: iso(now - 14 * day), to: iso(now + 90 * day), events: serverEvents }) };
        },
      },
    },
  },
}));
mock.module("expo-calendar", () => ({
  EntityTypes: { EVENT: "event" },
  SourceType: { LOCAL: "local", CALDAV: "caldav" },
  CalendarAccessLevel: { OWNER: "owner" },
  Availability: { BUSY: "busy" },
  AlarmMethod: { ALERT: "alert" },
  getCalendarPermissionsAsync: async () => ({ granted: phone.granted, canAskAgain: true }),
  requestCalendarPermissionsAsync: async () => ({ granted: phone.granted, canAskAgain: true }),
  getCalendarsAsync: async () => phone.calendars,
  getSourcesAsync: async () => [
    { id: "src-google", name: "Gmail", type: "caldav" },
    { id: "src-icloud", name: "iCloud", type: "caldav" },
    { id: "src-local", name: "Default", type: "local" },
  ],
  createCalendarAsync: async (d: any) => {
    const id = `cal-${phone.nextId++}`;
    phone.calendars.push({ id, title: d.title, allowsModifications: true, source: d.source });
    phone.created.push(`${d.title}@${d.source?.name}`);
    return id;
  },
  deleteCalendarAsync: async (id: string) => {
    phone.calendars = phone.calendars.filter((c) => c.id !== id);
    phone.events = phone.events.filter((e) => e.calendarId !== id);
  },
  getEventsAsync: async (ids: string[], from: Date, to: Date) =>
    phone.events.filter((e) => ids.includes(e.calendarId) && new Date(e.startDate) >= from && new Date(e.startDate) <= to),
  createEventAsync: async (calendarId: string, d: any) => {
    const id = `ev-${phone.nextId++}`;
    phone.events.push({ id, calendarId, ...d, startDate: d.startDate.toISOString(), endDate: d.endDate.toISOString() });
    return id;
  },
  updateEventAsync: async (id: string, d: any) => {
    const e = phone.events.find((x) => x.id === id)!;
    Object.assign(e, d, { startDate: d.startDate.toISOString(), endDate: d.endDate.toISOString() });
    return id;
  },
  deleteEventAsync: async (id: string) => {
    phone.events = phone.events.filter((e) => e.id !== id);
  },
}));

const sync = await import("../calendar-sync");

const job = (id: string, inDays: number, over: Record<string, unknown> = {}) => ({
  uid: `booking-${id}@nvc360`,
  title: "Furnace repair",
  description: `Service: Furnace repair\nTrack: https://arriveping.com/t/${id}`,
  location: "120 Maple St",
  start: iso(now + inDays * day),
  end: iso(now + inDays * day + 90 * 60_000),
  status: "CONFIRMED",
  url: `https://arriveping.com/t/${id}`,
  alarmMinutesBefore: 60,
  ...over,
});
const ours = () => phone.events.filter((e) => /ArrivePing ref:/.test(e.notes));

beforeEach(async () => {
  await sync.disconnectCalendar({ removeEvents: false });
  phone.os = "ios";
  phone.granted = true;
  phone.calendars = [{ id: "gmail-work", title: "Work", allowsModifications: true, source: { name: "Gmail", type: "caldav" } }];
  phone.events = [
    { id: "dentist", calendarId: "gmail-work", title: "Dentist", notes: "Bring card", location: "", startDate: iso(now + day), endDate: iso(now + day + 3600_000) },
  ];
  phone.created = [];
  store.clear();
  serverEvents = [job("j1", 1), job("j2", 2)];
  apiCalls = 0;
});

describe("connecting", () => {
  test("own calendar on iPhone goes in iCloud, never inside the Google account", async () => {
    const r = await sync.connectCalendar("tech-1", { mode: "own" });
    expect(phone.created).toEqual(["ArrivePing Jobs@iCloud"]);
    expect(r).toMatchObject({ added: 2, updated: 0, removed: 0, failed: 0 });
    expect(sync.getCalendarSync()).toMatchObject({ userId: "tech-1", mode: "own", label: "ArrivePing Jobs · iCloud" });
    const e = ours().find((x) => x.notes.includes("booking-j1@nvc360"))!;
    expect(e).toMatchObject({ title: "Furnace repair", location: "120 Maple St", url: "https://arriveping.com/t/j1" });
    expect(e.alarms).toEqual([{ relativeOffset: -60 }]);
  });

  test("own calendar on Android is a local calendar; no url field, alarm is an alert", async () => {
    phone.os = "android";
    await sync.connectCalendar("tech-1", { mode: "own" });
    expect(phone.created).toEqual(["ArrivePing Jobs@ArrivePing"]);
    const e = ours()[0]!;
    expect(e.url).toBeUndefined();
    expect(e.alarms).toEqual([{ relativeOffset: -60, method: "alert" }]);
  });

  test("an existing Google calendar: jobs go in beside the tech's own events, which are left alone", async () => {
    const [work] = await sync.listWritableCalendars();
    expect(work).toMatchObject({ id: "gmail-work", account: "Gmail" });
    await sync.connectCalendar("tech-1", { mode: "existing", calendar: work! });
    expect(phone.created).toEqual([]);
    expect(ours().map((e) => e.calendarId)).toEqual(["gmail-work", "gmail-work"]);
    expect(phone.events.find((e) => e.id === "dentist")).toBeTruthy();
  });

  test("refused calendar access is reported as such, and nothing is saved", async () => {
    phone.granted = false;
    await expect(sync.connectCalendar("tech-1", { mode: "own" })).rejects.toBeInstanceOf(sync.CalendarPermissionError);
    expect(sync.getCalendarSync()).toBeNull();
  });
});

describe("keeping it in step", () => {
  test("a moved job updates in place, a cancelled one comes off, a new one is added", async () => {
    await sync.connectCalendar("tech-1", { mode: "own" });
    const before = ours().map((e) => e.id).sort();
    serverEvents = [job("j1", 3), job("j2", 2, { status: "CANCELLED", title: "Cancelled: Furnace repair" }), job("j3", 5)];
    const r = await sync.syncCalendarNow("tech-1");
    expect(r).toMatchObject({ added: 1, updated: 1, removed: 1, failed: 0 });
    const j1 = ours().find((e) => e.notes.includes("booking-j1@"))!;
    expect(before).toContain(j1.id); // same event, not a new copy
    expect(j1.startDate).toBe(iso(now + 3 * day));
    expect(ours().some((e) => e.notes.includes("booking-j2@"))).toBe(false);
  });

  test("a second sync with nothing changed writes nothing", async () => {
    await sync.connectCalendar("tech-1", { mode: "own" });
    expect(await sync.syncCalendarNow("tech-1")).toEqual({ added: 0, updated: 0, removed: 0, failed: 0 });
  });

  test("two syncs at once are one sync", async () => {
    await sync.connectCalendar("tech-1", { mode: "own" });
    apiCalls = 0;
    const [a, b] = await Promise.all([sync.syncCalendarNow("tech-1"), sync.syncCalendarNow("tech-1")]);
    expect(a).toBe(b);
    expect(apiCalls).toBe(1);
  });

  test("someone else signed in on this phone is never synced into this calendar", async () => {
    await sync.connectCalendar("tech-1", { mode: "own" });
    apiCalls = 0;
    expect(await sync.syncCalendarNow("tech-2")).toBeNull();
    expect(apiCalls).toBe(0);
  });

  test("if the ArrivePing Jobs calendar is deleted, the next sync makes it again", async () => {
    await sync.connectCalendar("tech-1", { mode: "own" });
    const old = sync.getCalendarSync()!.calendarId;
    phone.calendars = phone.calendars.filter((c) => c.id !== old);
    phone.events = phone.events.filter((e) => e.calendarId !== old);
    const r = await sync.syncCalendarNow("tech-1");
    expect(r?.added).toBe(2);
    expect(sync.getCalendarSync()!.calendarId).not.toBe(old);
  });

  test("a picked calendar that's gone is an error to show, not a new calendar", async () => {
    await sync.connectCalendar("tech-1", { mode: "existing", calendar: (await sync.listWritableCalendars())[0]! });
    phone.calendars = [];
    expect(await sync.syncCalendarNow("tech-1")).toBeNull();
    expect(sync.getCalendarSync()!.lastError).toMatch(/isn't on this phone/);
    expect(phone.created).toEqual([]);
  });
});

describe("turning it off", () => {
  test("from a picked calendar: only ArrivePing's jobs are removed", async () => {
    await sync.connectCalendar("tech-1", { mode: "existing", calendar: (await sync.listWritableCalendars())[0]! });
    await sync.disconnectCalendar({ removeEvents: true });
    expect(phone.events.map((e) => e.id)).toEqual(["dentist"]);
    expect(sync.getCalendarSync()).toBeNull();
  });

  test("own calendar: the calendar itself is removed", async () => {
    await sync.connectCalendar("tech-1", { mode: "own" });
    await sync.disconnectCalendar({ removeEvents: true });
    expect(phone.calendars.map((c) => c.title)).toEqual(["Work"]);
  });

  test("switching calendars moves the jobs rather than copying them", async () => {
    await sync.connectCalendar("tech-1", { mode: "own" });
    await sync.connectCalendar("tech-1", { mode: "existing", calendar: (await sync.listWritableCalendars())[0]! });
    expect(phone.calendars.map((c) => c.title)).toEqual(["Work"]);
    expect(ours().map((e) => e.calendarId)).toEqual(["gmail-work", "gmail-work"]);
  });
});
