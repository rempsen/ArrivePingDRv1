/**
 * The rules for photos waiting to upload. Pure (no react-native, no file
 * system) so bun can test them; lib/photo-queue.ts does the I/O.
 *
 * Why this exists: on Oct 28 2026 a photo taken on a job hit a server error
 * while it was being saved, and it was gone. The camera doesn't put in-app
 * shots in the phone's library, and the app didn't keep a copy. Now every
 * photo is copied into the app's own storage first and stays there until the
 * server has it.
 */

export type PhotoPhase = "before" | "during" | "after";

export interface PendingPhoto {
  /** The photo's id on the server too, so a re-send is stored once. */
  clientId: string;
  bookingId: string;
  /** The company that was active when it was taken: a later send goes there even if the tech switched. */
  companyId?: string;
  /** The app's own copy (file:// in the document directory). */
  uri: string;
  fileName: string;
  mimeType: string;
  phase: PhotoPhase;
  caption?: string;
  customerVisible?: boolean;
  /** Job forms v2: the question this photo answers. */
  formItemId?: string;
  createdAt: number;
  /** Sends tried so far. */
  attempts: number;
  lastTriedAt?: number;
  /** Why the last send failed, in words for the technician. */
  lastError?: string;
  /** The server refused it in a way another try won't fix: wait for the tech. */
  stuck?: boolean;
}

/** Waits after each failed send: 15 s, 30 s, 1 min, 2 min, then every 5 min. */
export const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000, 300_000] as const;

export function retryDelayMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length) - 1]!;
}

/** Should the background sender try this one now? */
export function dueForRetry(p: PendingPhoto, now: number): boolean {
  if (p.stuck) return false;
  if (!p.lastTriedAt) return true;
  return now - p.lastTriedAt >= retryDelayMs(p.attempts);
}

/**
 * Will sending again never work? 404 (job gone), 409 (id taken by another
 * job), 413 / 415 and plain 400s (too big, wrong type). Not 0 (no signal),
 * 401 (signed out: works after signing in), 408, 429 or any 5xx.
 */
export function isPermanentFailure(status: number): boolean {
  if (status === 0 || status === 401 || status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

/** The pending record after a failed send. */
export function afterFailure(p: PendingPhoto, status: number, message: string, now: number): PendingPhoto {
  return {
    ...p,
    attempts: p.attempts + 1,
    lastTriedAt: now,
    lastError: status === 0 ? "No connection" : message,
    stuck: isPermanentFailure(status),
  };
}

/** Back in the line for an immediate send ("Retry now"). */
export function resetForRetry(p: PendingPhoto): PendingPhoto {
  return { ...p, stuck: false, lastTriedAt: undefined };
}

/** What the badge on a waiting photo says. */
export function pendingLabel(p: PendingPhoto): string {
  if (p.stuck) return "Not uploaded";
  return p.attempts > 0 ? "Waiting to upload" : "Uploading…";
}

/** A UUID v4 for a photo (no crypto module in the app, and none needed: it only has to be unique). */
export function newPhotoId(random: () => number = Math.random): string {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(random() * 16).toString(16)).join("");
  const variant = "89ab"[Math.floor(random() * 4)];
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}

/** Read the saved queue; anything unreadable is dropped rather than crashing the app. */
export function parseQueue(text: string | null | undefined): PendingPhoto[] {
  try {
    const v = JSON.parse(text || "[]");
    if (!Array.isArray(v)) return [];
    return v.filter(
      (p): p is PendingPhoto =>
        p && typeof p.clientId === "string" && typeof p.bookingId === "string" && typeof p.uri === "string",
    );
  } catch {
    return [];
  }
}
