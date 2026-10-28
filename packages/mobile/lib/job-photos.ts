/**
 * Job photo upload — the one code path the job screen's Photos block and the
 * job form's photo questions both use. POST /api/bookings/:id/photos
 * (multipart) returns the stored photo row.
 *
 * Screens don't call this directly any more: they go through
 * lib/photo-queue.ts, which keeps a copy of the photo on the phone until the
 * server has it.
 */
import Constants from "expo-constants";
import { authHeaders } from "./auth";
import { apiErrorMessage } from "./api-error";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");

export interface UploadAsset {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}

export interface JobPhoto {
  id: string;
  url: string;
  caption?: string;
  phase?: string;
  formItemId?: string;
  [k: string]: unknown;
}

/** A refused or failed upload. `status` 0 means the request never got an answer (no signal). */
export class PhotoUploadError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function uploadJobPhoto(opts: {
  bookingId: string;
  asset: UploadAsset;
  /** before | during | after */
  phase?: string;
  caption?: string;
  /** false = office only (the homeowner doesn't see it). Server default: true. */
  customerVisible?: boolean;
  /** Job forms v2: the question this photo answers. */
  formItemId?: string;
  /** The photo's id, chosen by the app, so sending it twice stores it once. */
  clientId?: string;
  /** Ask the server to add the photo to its question's answer (a later send). */
  attachToAnswer?: boolean;
  /** The company the job belongs to, if not the one active now (a later send after switching). */
  companyId?: string;
}): Promise<JobPhoto> {
  const form = new FormData();
  form.append("file", {
    uri: opts.asset.uri,
    name: opts.asset.fileName || "job.jpg",
    type: opts.asset.mimeType || "image/jpeg",
  } as any);
  if (opts.phase) form.append("phase", opts.phase);
  if (opts.caption) form.append("caption", opts.caption);
  if (opts.customerVisible !== undefined) form.append("customerVisible", String(opts.customerVisible));
  if (opts.formItemId) form.append("formItemId", opts.formItemId);
  if (opts.clientId) form.append("clientId", opts.clientId);
  if (opts.attachToAnswer) form.append("attachToAnswer", "1");
  let res: Response;
  try {
    res = await fetch(`${API}/api/bookings/${opts.bookingId}/photos`, {
      method: "POST",
      headers: authHeaders(opts.companyId ? { "X-Company-Id": opts.companyId } : undefined),
      body: form,
    });
  } catch {
    throw new PhotoUploadError("No connection", 0);
  }
  if (!res.ok) throw new PhotoUploadError(await apiErrorMessage(res, "Upload failed"), res.status);
  const body = (await res.json().catch(() => null)) as any;
  return (body?.photo ?? body) as JobPhoto;
}
