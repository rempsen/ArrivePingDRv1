/**
 * Test-only: what a time zone's rules say, read straight from Intl by walking
 * the clock in 15-minute steps, with none of the code under test (shared/tz.ts)
 * involved. Tests use it to compute expected values instead of hardcoding
 * offsets, because the rules are data that changes under us: a runtime's
 * tzdata can drop or move a zone's DST (Manitoba's did), and a test that
 * assumes "Winnipeg falls back in November" then fails for reasons that have
 * nothing to do with the code.
 */

const STEP_MS = 15 * 60_000;
const DAY_MS = 24 * 3_600_000;

const fmts = new Map<string, Intl.DateTimeFormat>();
function localParts(ms: number, zone: string) {
  let f = fmts.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    fmts.set(zone, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = Number(part.value);
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour!, mi: p.minute! };
}

/** The instant at which `zone`'s wall clock first reads this time (month is
 * 1-12). Throws if it never does, i.e. the time falls in a spring-forward gap. */
export function localInstant(zone: string, y: number, mo: number, d: number, h = 0, mi = 0): Date {
  const centre = Date.UTC(y, mo - 1, d, h, mi);
  for (let ms = centre - DAY_MS - DAY_MS / 2; ms <= centre + DAY_MS + DAY_MS / 2; ms += STEP_MS) {
    const l = localParts(ms, zone);
    if (l.y === y && l.mo === mo && l.d === d && l.h === h && l.mi === mi) return new Date(ms);
  }
  throw new Error(`${zone} never shows ${y}-${mo}-${d} ${h}:${mi}`);
}

/** How many hours the local calendar day `y-mo-d` lasts: 24 normally, 23 or 25
 * across a DST change, whatever the zone's rules say it is. */
export function hoursInLocalDay(zone: string, y: number, mo: number, d: number): number {
  const centre = Date.UTC(y, mo - 1, d, 12);
  let steps = 0;
  for (let ms = centre - 2 * DAY_MS; ms <= centre + 2 * DAY_MS; ms += STEP_MS) {
    const l = localParts(ms, zone);
    if (l.y === y && l.mo === mo && l.d === d) steps++;
  }
  return (steps * STEP_MS) / 3_600_000;
}

/** Every local day of `year` in `zone` that isn't 24 hours long, as
 * { month, day, hours }. Empty for a zone with no DST that year. */
export function dstDays(zone: string, year: number): { month: number; day: number; hours: number }[] {
  const out: { month: number; day: number; hours: number }[] = [];
  for (let ms = Date.UTC(year, 0, 1, 12); new Date(ms).getUTCFullYear() === year; ms += DAY_MS) {
    const dt = new Date(ms);
    const month = dt.getUTCMonth() + 1;
    const day = dt.getUTCDate();
    const hours = hoursInLocalDay(zone, year, month, day);
    if (hours !== 24) out.push({ month, day, hours });
  }
  return out;
}
