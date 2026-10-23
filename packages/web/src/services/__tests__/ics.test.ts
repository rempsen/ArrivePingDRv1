/**
 * The iCalendar (RFC 5545) the subscription feed and email attachments use.
 * Google Calendar and Outlook parse strictly, so the structure matters:
 * every physical line ≤ 75 octets, continuation lines start with one space,
 * CRLF line ends, and folding must unfold back to exactly what was written.
 */
import { describe, it, expect } from "bun:test";
import { buildCalendar, buildEvent, fold, type CalEvent } from "../ics";

const utf8 = new TextEncoder();
const physical = (ics: string) => ics.replace(/\r\n$/, "").split("\r\n");
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

const job = (over: Partial<CalEvent> = {}): CalEvent => ({
  uid: "booking-abc@nvc360",
  title: "Furnace repair — no heat, basement unit 🔥",
  description:
    "Service: Furnace repair\nClient: Zoë Côté-Ångström\nNotes: Gate code 1234, ring twice; dog in yard. Bring the 16x25x1 filter, the customer has asked twice already.",
  location: "120 Maple St, Winnipeg, MB R3C 1A1",
  start: new Date("2026-10-27T15:00:00Z"),
  end: new Date("2026-10-27T16:30:00Z"),
  url: "https://arriveping.com/t/abc,def;ghi",
  alarmMinutesBefore: 60,
  ...over,
});

describe("folding (RFC 5545 §3.1)", () => {
  it("keeps every line within 75 octets, counting UTF-8 bytes, not characters", () => {
    const line = "SUMMARY:" + "é".repeat(60) + "—".repeat(20) + "🔥".repeat(10);
    const folded = fold(line);
    for (const l of folded.split("\r\n")) expect(utf8.encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").slice(1).every((l) => l.startsWith(" "))).toBe(true);
  });

  it("never splits a character, so unfolding gives back the exact text", () => {
    const line = "DESCRIPTION:" + "Zoë 🔥 — ".repeat(30);
    expect(unfold(fold(line))).toBe(line);
    // No lone surrogate halves (an emoji cut in two) anywhere.
    expect(fold(line).split("\r\n").some((l) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(l))).toBe(false);
  });

  it("leaves short lines alone", () => {
    expect(fold("UID:booking-1@nvc360")).toBe("UID:booking-1@nvc360");
  });
});

describe("a calendar feed", () => {
  const ics = buildCalendar([job(), job({ uid: "booking-def@nvc360", title: "Drain clearing" })], { name: "ArrivePing — Zoë's Jobs", refreshMinutes: 30 });

  it("every physical line is ≤ 75 octets and ends in CRLF", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "").includes("\n")).toBe(false);
    for (const l of physical(ics)) expect(utf8.encode(l).length).toBeLessThanOrEqual(75);
  });

  it("is folded once: unfolding yields whole, well-formed content lines", () => {
    const lines = unfold(ics).replace(/\r\n$/, "").split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.at(-1)).toBe("END:VCALENDAR");
    // Every unfolded line is NAME[;params]:value — nothing cut mid-line.
    for (const l of lines) expect(l).toMatch(/^[A-Z-]+[;:]/);
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(2);
    expect(lines).toContain("SUMMARY:Furnace repair — no heat\\, basement unit 🔥");
    expect(lines).toContain("X-WR-CALNAME:ArrivePing — Zoë's Jobs");
  });

  it("writes the link as a URI, not escaped text", () => {
    expect(unfold(ics)).toContain("URL:https://arriveping.com/t/abc,def;ghi\r\n");
  });
});

describe("a cancelled job", () => {
  const ev = unfold(buildEvent(job({ status: "CANCELLED" })));
  it("is free time with no reminder", () => {
    expect(ev).toContain("STATUS:CANCELLED");
    expect(ev).toContain("TRANSP:TRANSPARENT");
    expect(ev).not.toContain("BEGIN:VALARM");
  });
  it("a confirmed one blocks time and reminds an hour ahead", () => {
    const ok = unfold(buildEvent(job()));
    expect(ok).toContain("TRANSP:OPAQUE");
    expect(ok).toContain("TRIGGER:-PT60M");
  });
});
