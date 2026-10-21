/**
 * Picking a time on the company's clock without a native date picker.
 *
 * Everything here works in a named IANA timezone so a dispatcher in
 * Winnipeg scheduling for a company in Toronto gets Toronto times, the
 * same as the web scheduler. Pure for bun tests.
 */
export const STEP_MIN = 15;

/** The parts of an instant on the company's clock. */
export function partsIn(d: Date, tz: string): { day: string; hour: number; minute: number; weekday: number } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")), weekday: wd < 0 ? 0 : wd };
}

/** The UTC offset (minutes) the zone has at the given instant. */
function offsetMinutes(d: Date, tz: string): number {
  const p = partsIn(d, tz);
  const asUtc = Date.UTC(Number(p.day.slice(0, 4)), Number(p.day.slice(5, 7)) - 1, Number(p.day.slice(8, 10)), p.hour, p.minute);
  const truncated = Math.floor(d.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - truncated) / 60_000);
}

/** The instant for `day` at `hour:minute` on the company's clock, as ISO. */
export function toIso(day: string, hour: number, minute: number, tz: string): string {
  const guess = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), hour, minute);
  // Two passes handle a DST boundary between the guess and the real offset.
  let d = new Date(guess - offsetMinutes(new Date(guess), tz) * 60_000);
  d = new Date(guess - offsetMinutes(d, tz) * 60_000);
  return d.toISOString();
}

/** Now, rounded up to the next STEP_MIN boundary. */
export function asap(now: Date): Date {
  const ms = STEP_MIN * 60_000;
  return new Date(Math.ceil((now.getTime() + 1) / ms) * ms);
}

/** "9:30 AM" for a chip. */
export function slotLabel(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** The 15-minute slots of a working day, 6:00 to 21:45. */
export function daySlots(): Array<{ hour: number; minute: number }> {
  const out: Array<{ hour: number; minute: number }> = [];
  for (let h = 6; h < 22; h++) for (let m = 0; m < 60; m += STEP_MIN) out.push({ hour: h, minute: m });
  return out;
}

/** "Wed, Oct 21, 9:00 AM" on the company's clock, for labels next to the picker. */
export function fmtInTz(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
}
