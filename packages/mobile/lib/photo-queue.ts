/**
 * Photos that haven't reached the server yet. Every job photo goes through
 * here: it is copied into the app's own storage first, then sent. If the send
 * fails (no signal, the server down, a storage hiccup) the copy stays and is
 * sent again in the background (on reconnect, when the app comes back to the
 * front, and on a timer) until the server has it. Each photo carries its own
 * id, so a send that did land but whose answer got lost is not stored twice.
 *
 * The rules (backoff, which failures are permanent) live in photo-queue-core.ts.
 */
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { Directory, File, Paths } from "expo-file-system";
import { getActiveCompany } from "./active-company";
import { PhotoUploadError, uploadJobPhoto, type JobPhoto, type UploadAsset } from "./job-photos";
import {
  afterFailure,
  dueForRetry,
  newPhotoId,
  parseQueue,
  resetForRetry,
  type PendingPhoto,
  type PhotoPhase,
} from "./photo-queue-core";

export type { PendingPhoto } from "./photo-queue-core";
export { pendingLabel } from "./photo-queue-core";

let dir: Directory | null = null;
function folder(): Directory {
  if (!dir) {
    dir = new Directory(Paths.document, "pending-photos");
    try {
      dir.create({ intermediates: true, idempotent: true });
    } catch {
      /* already there */
    }
  }
  return dir;
}
const indexFile = () => new File(folder(), "queue.json");

let items: PendingPhoto[] | null = null;
const sending = new Set<string>();
const listeners = new Set<() => void>();
const uploadedListeners = new Set<(p: PendingPhoto, photo: JobPhoto) => void>();

function all(): PendingPhoto[] {
  if (items === null) {
    try {
      const f = indexFile();
      items = f.exists ? parseQueue(f.textSync()) : [];
    } catch {
      items = [];
    }
  }
  return items;
}

/** Replace the queue. Returns false when it couldn't be written to the phone's storage. */
function save(next: PendingPhoto[]): boolean {
  items = next;
  let written = true;
  try {
    indexFile().write(JSON.stringify(next));
  } catch {
    // The in-memory copy still drives this session; addJobPhoto checks this
    // before it tells anyone a photo is kept.
    written = false;
  }
  for (const l of listeners) l();
  return written;
}

function deleteCopy(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists && f.uri.includes("pending-photos")) f.delete();
  } catch {
    /* a leftover file is harmless */
  }
}

function update(clientId: string, fn: (p: PendingPhoto) => PendingPhoto) {
  save(all().map((p) => (p.clientId === clientId ? fn(p) : p)));
}

function drop(p: PendingPhoto) {
  save(all().filter((x) => x.clientId !== p.clientId));
  deleteCopy(p.uri);
}

/**
 * Copy the picked photo into the app's storage; the camera's temp file can be
 * cleared by iOS. Null when it couldn't be copied (storage full, say): then
 * the photo is NOT safe on the phone and nobody may be told it is.
 */
function keepCopy(asset: UploadAsset, clientId: string): string | null {
  const ext = (asset.fileName?.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  try {
    const dest = new File(folder(), `${clientId}.${ext}`);
    new File(asset.uri).copy(dest);
    return dest.exists ? dest.uri : null;
  } catch {
    return null;
  }
}

async function send(p: PendingPhoto, attachToAnswer: boolean): Promise<JobPhoto | null> {
  if (sending.has(p.clientId)) return null;
  sending.add(p.clientId);
  try {
    const photo = await uploadJobPhoto({
      bookingId: p.bookingId,
      asset: { uri: p.uri, fileName: p.fileName, mimeType: p.mimeType },
      phase: p.phase,
      caption: p.caption,
      customerVisible: p.customerVisible,
      formItemId: p.formItemId,
      clientId: p.clientId,
      attachToAnswer,
      companyId: p.companyId,
    });
    drop(p);
    for (const l of uploadedListeners) l(p, photo);
    return photo;
  } catch (e) {
    const status = e instanceof PhotoUploadError ? e.status : 0;
    const message = e instanceof Error ? e.message : "Upload failed";
    update(p.clientId, (x) => afterFailure(x, status, message, Date.now()));
    throw e;
  } finally {
    sending.delete(p.clientId);
  }
}

export interface AddPhotoResult {
  /** The stored photo, when the first send worked. */
  photo?: JobPhoto;
  /** Kept on the phone and still to be sent, when it didn't. */
  pending?: PendingPhoto;
  /** Why the first send failed. */
  error?: string;
  /**
   * The send failed AND the photo couldn't be kept on the phone (no room to
   * copy it, or the waiting list couldn't be saved): it is gone, so ask for
   * it to be taken again.
   */
  lost?: boolean;
}

/**
 * Keep a copy of the photo, then send it. Never throws: when the send fails
 * the photo stays queued (`pending`) and goes up later on its own.
 */
export async function addJobPhoto(opts: {
  bookingId: string;
  asset: UploadAsset;
  phase: PhotoPhase;
  caption?: string;
  customerVisible?: boolean;
  formItemId?: string;
}): Promise<AddPhotoResult> {
  const clientId = newPhotoId();
  const copy = keepCopy(opts.asset, clientId);
  const p: PendingPhoto = {
    clientId,
    bookingId: opts.bookingId,
    companyId: getActiveCompany() || undefined,
    uri: copy ?? opts.asset.uri,
    fileName: opts.asset.fileName || "job.jpg",
    mimeType: opts.asset.mimeType || "image/jpeg",
    phase: opts.phase,
    caption: opts.caption,
    customerVisible: opts.customerVisible,
    formItemId: opts.formItemId,
    createdAt: Date.now(),
    attempts: 0,
  };
  const before = all();
  const kept = copy !== null && save([...before, p]);
  if (!kept) {
    // Not safe on the phone: send it once, and if that fails say so plainly
    // instead of promising a later upload that would never happen.
    if (copy !== null) {
      save(before);
      deleteCopy(copy);
    }
    try {
      const photo = await uploadJobPhoto({
        bookingId: p.bookingId,
        asset: opts.asset,
        phase: p.phase,
        caption: p.caption,
        customerVisible: p.customerVisible,
        formItemId: p.formItemId,
        clientId,
      });
      return { photo };
    } catch (e) {
      return { lost: true, error: e instanceof Error ? e.message : "Upload failed" };
    }
  }
  try {
    // First send: the screen that took it attaches it to its question itself.
    const photo = await send(p, false);
    return photo ? { photo } : { pending: p };
  } catch (e) {
    return { pending: all().find((x) => x.clientId === clientId) ?? p, error: e instanceof Error ? e.message : "Upload failed" };
  }
}

let flushing: Promise<void> | null = null;

/** Send everything that's due. Safe to call often; only one pass runs at a time. */
export function flushPendingPhotos(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      const now = Date.now();
      for (const p of all().filter((x) => dueForRetry(x, now))) {
        // A later send: the tech may be off the job screen, so the server
        // adds a form photo to its question.
        await send(p, Boolean(p.formItemId)).catch(() => {});
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** "Retry now" on a waiting photo. */
export function retryPendingPhoto(clientId: string): Promise<void> {
  update(clientId, resetForRetry);
  return flushPendingPhotos();
}

/** "Discard" on a photo the server keeps refusing. */
export function discardPendingPhoto(clientId: string) {
  const p = all().find((x) => x.clientId === clientId);
  if (p) drop(p);
}

/** Called after any queued photo lands, so screens can refresh. Returns an unsubscribe. */
export function onPhotoUploaded(fn: (p: PendingPhoto, photo: JobPhoto) => void): () => void {
  uploadedListeners.add(fn);
  return () => uploadedListeners.delete(fn);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Photos still to upload for a job (optionally one form question), newest last. */
export function usePendingPhotos(bookingId: string | undefined, formItemId?: string): PendingPhoto[] {
  const snapshot = useSyncExternalStore(subscribe, all, all);
  return snapshot.filter(
    (p) => p.bookingId === bookingId && (formItemId === undefined ? !p.formItemId : p.formItemId === formItemId),
  );
}

/** All waiting photos, for a count on screens that don't show them. */
export function usePendingPhotoCount(bookingId?: string): number {
  const snapshot = useSyncExternalStore(subscribe, all, all);
  return bookingId ? snapshot.filter((p) => p.bookingId === bookingId).length : snapshot.length;
}

let started = false;

/** Start the background sender once, at the app root. */
export function setupPhotoQueue(): () => void {
  if (started) return () => {};
  started = true;
  void flushPendingPhotos();
  const app = AppState.addEventListener("change", (s) => {
    if (s === "active") void flushPendingPhotos();
  });
  const net = NetInfo.addEventListener((s) => {
    if (s.isConnected) void flushPendingPhotos();
  });
  const timer = setInterval(() => {
    if (all().length) void flushPendingPhotos();
  }, 15_000);
  return () => {
    started = false;
    app.remove();
    net();
    clearInterval(timer);
  };
}
