/**
 * Voice notes a technician dictates on a job (POST /api/bookings/:id/voice-note):
 * the pure parts of listening back and deleting them. A note is a `voice_note`
 * job event whose `meta` points at the stored recording and names its author,
 * plus a transcript line appended to the booking's field notes (driverNotes).
 *
 * Notes recorded before `meta` carried `userId`, `key` and `line` have no
 * author, so nobody owns them: they stay on the job for the office but can't
 * be listed or deleted by a technician.
 */

export interface VoiceNoteMeta {
  url?: string;
  /** Storage key of the recording. */
  key?: string;
  durationSecs?: number;
  /** User id of whoever recorded it. */
  userId?: string;
  /** The exact line appended to driverNotes ("" when nothing was transcribed). */
  line?: string;
}

export function parseMeta(raw: string | null | undefined): VoiceNoteMeta {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as VoiceNoteMeta) : {};
  } catch {
    return {};
  }
}

/** Is this note the caller's? Only by the author's user id: a note without one
 * belongs to no one. */
export function isOwnVoiceNote(meta: VoiceNoteMeta, me: { id: string } | null | undefined): boolean {
  return !!me?.id && !!meta.userId && meta.userId === me.id;
}

/** The storage key to delete, only ever one inside this job's voice-note
 * folder (a note's meta is data, not a licence to delete any object). */
export function voiceNoteKey(meta: VoiceNoteMeta, bookingId: string): string | null {
  const key = typeof meta.key === "string" ? meta.key : "";
  const prefix = `voice-notes/${bookingId}/`;
  if (!key.startsWith(prefix) || key.includes("..") || key.length === prefix.length) return null;
  return key;
}

/** driverNotes with this note's transcript line taken out (and one neighbouring
 * newline, so no blank line is left behind). Unchanged if the line was edited
 * away or there never was one. */
export function removeVoiceNoteLine(driverNotes: string | null | undefined, meta: VoiceNoteMeta): string {
  const notes = driverNotes ?? "";
  if (!meta.line) return notes;
  const at = notes.indexOf(meta.line);
  if (at < 0) return notes;
  let start = at;
  let end = at + meta.line.length;
  if (start > 0 && notes[start - 1] === "\n") start -= 1;
  else if (notes[end] === "\n") end += 1;
  return notes.slice(0, start) + notes.slice(end);
}
