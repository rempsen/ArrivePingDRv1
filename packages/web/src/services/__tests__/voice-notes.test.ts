import { describe, expect, it } from "bun:test";
import { isOwnVoiceNote, parseMeta, removeVoiceNoteLine, voiceNoteKey } from "../voice-notes";

describe("parseMeta", () => {
  it("is empty for junk", () => {
    expect(parseMeta("nope")).toEqual({});
    expect(parseMeta("[1]")).toEqual({});
    expect(parseMeta(undefined)).toEqual({});
    expect(parseMeta('{"userId":"u1"}')).toEqual({ userId: "u1" });
  });
});

describe("isOwnVoiceNote", () => {
  it("goes by the author's user id", () => {
    expect(isOwnVoiceNote({ userId: "u1" }, { id: "u1" })).toBe(true);
    expect(isOwnVoiceNote({ userId: "u2" }, { id: "u1" })).toBe(false);
  });
  it("is nobody's when the note has no author, or there's no signed-in user", () => {
    expect(isOwnVoiceNote({}, { id: "u1" })).toBe(false);
    expect(isOwnVoiceNote({ userId: "" }, { id: "" })).toBe(false);
    expect(isOwnVoiceNote({ userId: "u1" }, null)).toBe(false);
  });
});

describe("voiceNoteKey", () => {
  const job = "job-1";
  it("uses the stored key, but only inside this job's folder", () => {
    expect(voiceNoteKey({ key: "voice-notes/job-1/a.m4a" }, job)).toBe("voice-notes/job-1/a.m4a");
    expect(voiceNoteKey({ key: "voice-notes/job-2/a.m4a" }, job)).toBeNull();
    expect(voiceNoteKey({ key: "avatars/me.png" }, job)).toBeNull();
    expect(voiceNoteKey({ key: "voice-notes/job-1/../job-2/a.m4a" }, job)).toBeNull();
    expect(voiceNoteKey({ key: "voice-notes/job-1/" }, job)).toBeNull();
  });
  it("doesn't guess a key from the url", () => {
    expect(voiceNoteKey({ url: "/api/public/file/voice-notes%2Fjob-1%2Fa.m4a" }, job)).toBeNull();
    expect(voiceNoteKey({}, job)).toBeNull();
  });
});

describe("removeVoiceNoteLine", () => {
  const mine = "[Voice note — Jo Ng, Oct 20, 2026, 9:14 PM] Replaced the valve.";
  const other = "[Voice note — Al Fox, Oct 20, 2026, 9:20 PM] Customer not home.";
  const typed = "Gate code is 1234.";

  it("removes the exact line it added, and its newline", () => {
    expect(removeVoiceNoteLine(`${typed}\n${mine}\n${other}`, { line: mine })).toBe(`${typed}\n${other}`);
    expect(removeVoiceNoteLine(`${mine}\n${other}`, { line: mine })).toBe(other);
    expect(removeVoiceNoteLine(mine, { line: mine })).toBe("");
  });
  it("leaves the notes alone when the line is gone, edited, or there never was one", () => {
    expect(removeVoiceNoteLine(typed, { line: mine })).toBe(typed);
    expect(removeVoiceNoteLine(`${mine} (edited)`.replace("valve.", "valve"), { line: mine })).toBe(`${mine} (edited)`.replace("valve.", "valve"));
    expect(removeVoiceNoteLine(`${other}\n${typed}`, { line: "" })).toBe(`${other}\n${typed}`);
    expect(removeVoiceNoteLine(`${other}\n${typed}`, {})).toBe(`${other}\n${typed}`);
    expect(removeVoiceNoteLine(null, { line: mine })).toBe("");
  });
});
