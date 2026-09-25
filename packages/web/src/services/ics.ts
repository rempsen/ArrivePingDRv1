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

/** Fold long lines to <=75 octets per RFC 5545. */
function fold(line: string): string {
  if (line.length <= 73) return line;
  const out: string[] = [];
  let s = line;
  out.push(s.slice(0, 73));
  s = s.slice(73);
  while (s.length > 0) {
    out.push(" " + s.slice(0, 72));
    s = s.slice(72);
  }
  return out.join("\r\n");
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

export function buildEvent(ev: CalEvent): string {
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
  if (ev.url) lines.push(`URL:${esc(ev.url)}`);
  lines.push(`STATUS:${ev.status ?? "CONFIRMED"}`);
  if (ev.organizer?.email) {
    lines.push(
      `ORGANIZER;CN=${esc(ev.organizer.name ?? "ArrivePing")}:mailto:${ev.organizer.email}`,
    );
  }
  lines.push("SEQUENCE:0", "TRANSP:OPAQUE");
  if (ev.alarmMinutesBefore && ev.alarmMinutesBefore > 0) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(ev.title)}`,
      `TRIGGER:-PT${ev.alarmMinutesBefore}M`,
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT");
  return lines.map(fold).join("\r\n");
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
  const body = events.map(buildEvent);
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
