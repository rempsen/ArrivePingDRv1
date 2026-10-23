import { describe, expect, test } from "bun:test";
import { notesFor, planSync, refOf, REF_LABEL, type DeviceEvent, type ServerEvent } from "../calendar-plan";

const job = (uid: string, over: Partial<ServerEvent> = {}): ServerEvent => ({
  uid,
  title: "Furnace repair",
  description: "Service: Furnace repair\nClient: Zoë Côté",
  location: "120 Maple St, Winnipeg",
  start: "2026-10-27T15:00:00.000Z",
  end: "2026-10-27T16:30:00.000Z",
  status: "CONFIRMED",
  url: "https://arriveping.com/t/abc",
  alarmMinutesBefore: 60,
  ...over,
});

/** A phone event exactly as the sync would have written it. */
const onPhone = (id: string, e: ServerEvent, over: Partial<DeviceEvent> = {}): DeviceEvent => ({
  id,
  title: e.title,
  notes: notesFor(e),
  location: e.location,
  startDate: e.start,
  endDate: e.end,
  ...over,
});

describe("calendar sync plan", () => {
  test("new jobs are created, with the reference tag at the end of the notes", () => {
    const p = planSync([job("booking-1@nvc360")], []);
    expect(p.create).toHaveLength(1);
    expect(p.create[0]!.notes.endsWith(`${REF_LABEL} booking-1@nvc360`)).toBe(true);
    expect(refOf(p.create[0]!.notes)).toBe("booking-1@nvc360");
    expect(p.update).toEqual([]);
    expect(p.remove).toEqual([]);
  });

  test("an unchanged job is left alone", () => {
    const e = job("booking-1@nvc360");
    const p = planSync([e], [onPhone("dev-1", e)]);
    expect(p).toEqual({ create: [], update: [], remove: [], unchanged: 1 });
  });

  test("a rescheduled or edited job updates the same phone event", () => {
    const before = job("booking-1@nvc360");
    const after = job("booking-1@nvc360", { start: "2026-10-28T15:00:00.000Z", end: "2026-10-28T16:30:00.000Z", location: "9 Elm St" });
    const p = planSync([after], [onPhone("dev-1", before)]);
    expect(p.create).toEqual([]);
    expect(p.update.map((u) => u.id)).toEqual(["dev-1"]);
    expect(p.update[0]!.event.start.toISOString()).toBe("2026-10-28T15:00:00.000Z");
  });

  test("a job that's gone (unassigned, deleted) is removed; a cancelled one too", () => {
    const keep = job("booking-1@nvc360");
    const gone = job("booking-2@nvc360");
    const cancelled = job("booking-3@nvc360", { status: "CANCELLED" });
    const p = planSync([keep, cancelled], [onPhone("dev-1", keep), onPhone("dev-2", gone), onPhone("dev-3", cancelled)]);
    expect(p.remove.sort()).toEqual(["dev-2", "dev-3"]);
    expect(p.create).toEqual([]);
  });

  test("a cancelled job is never created", () => {
    expect(planSync([job("booking-3@nvc360", { status: "CANCELLED" })], []).create).toEqual([]);
  });

  test("events without the tag are never touched, even in the same calendar", () => {
    const dentist: DeviceEvent = { id: "personal-1", title: "Dentist", notes: "Bring insurance card", startDate: "2026-10-27T15:00:00Z", endDate: "2026-10-27T16:00:00Z" };
    const noNotes: DeviceEvent = { id: "personal-2", title: "Lunch", notes: null, startDate: "2026-10-27T17:00:00Z", endDate: "2026-10-27T18:00:00Z" };
    const p = planSync([], [dentist, noNotes]);
    expect(p).toEqual({ create: [], update: [], remove: [], unchanged: 0 });
  });

  test("a duplicate copy of the same job is removed, keeping one", () => {
    const e = job("booking-1@nvc360");
    const p = planSync([e], [onPhone("dev-1", e), onPhone("dev-1b", e)]);
    expect(p.remove).toEqual(["dev-1b"]);
    expect(p.unchanged).toBe(1);
  });

  test("line endings and trailing spaces the phone adds don't cause rewrites", () => {
    const e = job("booking-1@nvc360");
    const phone = onPhone("dev-1", e, { notes: notesFor(e).replace(/\n/g, "\r\n") + "  ", startDate: new Date(e.start) });
    expect(planSync([e], [phone]).unchanged).toBe(1);
  });

  test("past jobs that aged out of the window stay on the phone as history", () => {
    const old = job("booking-9@nvc360", { start: "2026-10-01T15:00:00.000Z", end: "2026-10-01T16:00:00.000Z" });
    const recent = job("booking-8@nvc360", { start: "2026-10-20T15:00:00.000Z", end: "2026-10-20T16:00:00.000Z" });
    // The server's window starts Oct 9: the Oct 1 job isn't in its list any more.
    const p = planSync([], [onPhone("dev-old", old), onPhone("dev-recent", recent)], { from: "2026-10-09T00:00:00.000Z" });
    expect(p.remove).toEqual(["dev-recent"]); // inside the window and gone from the server: removed
  });

  test("turning sync off: an empty job list removes every tagged event and nothing else", () => {
    const e = job("booking-1@nvc360");
    const dentist: DeviceEvent = { id: "personal-1", title: "Dentist", notes: "x", startDate: e.start, endDate: e.end };
    expect(planSync([], [onPhone("dev-1", e), dentist]).remove).toEqual(["dev-1"]);
  });
});

describe("reading back what calendar services did to the event", () => {
  test("the tag survives notes turned into HTML", () => {
    expect(refOf("<p>Service: Furnace repair</p><p>ArrivePing ref: booking-x_1@nvc360</p>")).toBe("booking-x_1@nvc360");
  });
  test("re-wrapped notes and dropped seconds aren't changes", () => {
    const e = job("booking-1@nvc360", { start: "2026-10-27T15:00:20.000Z" });
    const phone = onPhone("dev-1", e, { notes: notesFor(e).replace(/\n\n/g, "\n"), startDate: "2026-10-27T15:00:00.000Z" });
    expect(planSync([e], [phone]).unchanged).toBe(1);
  });
});
