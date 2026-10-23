/**
 * iCalendar (RFC 5545) generation — used for:
 *  - Per-user subscription feeds (Google Calendar / Outlook auto-refresh)
 *  - Single-event .ics attachments in confirmation emails
 *  - "Add to Google / Outlook" web links
 */

const PRODID = "-//ArrivePing//Dispatch//EN";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Format a Date to iCal UTC timestamp: 20260601T132500Z */
export function icsDate(d: Date): string {
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

/** Escape text per RFC 5545 (commas, semicolons, newlines, backslashes). */
function esc(s: string): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

const utf8 = new TextEncoder();

/**
 * Fold one content line to at most 75 octets per RFC 5545 §3.1: CRLF plus a
 * single space starts each continuation, and the space counts toward that
 * line's 75. Counts UTF-8 bytes, not JavaScript characters, and only breaks
 * between whole code points, so an em dash, an accented name or an emoji is
 * never split into invalid bytes. Google Calendar and Outlook reject or
 * garble feeds that get this wrong; Apple Calendar is more forgiving.
 */
export function fold(line: string): string {
  if (utf8.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = utf8.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(cur);
      cur = "";
      bytes = 0;
      limit = 74;
    }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

export interface CalEvent {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  url?: string;
  organizer?: { name?: string; email?: string };
  alarmMinutesBefore?: number; // pop reminder N mins before
  lat?: number | null;
  lng?: number | null;
}

/** One event's content lines, not yet folded. */
function eventLines(ev: CalEvent): string[] {
  const lines: string[] = [
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(ev.start)}`,
    `DTEND:${icsDate(ev.end)}`,
    `SUMMARY:${esc(ev.title)}`,
  ];
  if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
  if (ev.lat != null && ev.lng != null) lines.push(`GEO:${ev.lat};${ev.lng}`);
  // A URI value is not TEXT: escaping would put backslashes into the link.
  if (ev.url) lines.push(`URL:${ev.url}`);
  const status = ev.status ?? "CONFIRMED";
  lines.push(`STATUS:${status}`);
  if (ev.organizer?.email) {
    lines.push(
      `ORGANIZER;CN=${esc(ev.organizer.name ?? "ArrivePing")}:mailto:${ev.organizer.email}`,
    );
  }
  // A cancelled job no longer takes up the technician's time.
  lines.push("SEQUENCE:0", `TRANSP:${status === "CANCELLED" ? "TRANSPARENT" : "OPAQUE"}`);
  if (ev.alarmMinutesBefore && ev.alarmMinutesBefore > 0 && status !== "CANCELLED") {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(ev.title)}`,
      `TRIGGER:-PT${ev.alarmMinutesBefore}M`,
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

export function buildEvent(ev: CalEvent): string {
  return eventLines(ev).map(fold).join("\r\n");
}

export interface CalendarOpts {
  name?: string;
  refreshMinutes?: number; // hint to clients
}

export function buildCalendar(events: CalEvent[], opts: CalendarOpts = {}): string {
  const refresh = opts.refreshMinutes ?? 60;
  const head = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(opts.name ?? "ArrivePing Schedule")}`,
    `X-WR-TIMEZONE:UTC`,
    `REFRESH-INTERVAL;VALUE=DURATION:PT${refresh}M`,
    `X-PUBLISHED-TTL:PT${refresh}M`,
  ];
  // Fold each content line exactly once. Folding whole event blocks would
  // insert breaks at arbitrary points inside lines that were already folded.
  const body = events.flatMap(eventLines);
  return [...head, ...body, "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
}

/** Single-event .ics document (for email attachment). */
export function buildSingleEventIcs(ev: CalEvent): string {
  return buildCalendar([ev], { name: ev.title });
}

/** "Add to Google Calendar" template link. */
export function googleCalLink(ev: CalEvent): string {
  const fmt = (d: Date) => icsDate(d);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${fmt(ev.start)}/${fmt(ev.end)}`,
    details: ev.description ?? "",
    location: ev.location ?? "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** "Add to Outlook (web)" compose-event link. */
export function outlookCalLink(ev: CalEvent): string {
  const iso = (d: Date) => d.toISOString();
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: ev.title,
    startdt: iso(ev.start),
    enddt: iso(ev.end),
    body: ev.description ?? "",
    location: ev.location ?? "",
  });
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}
