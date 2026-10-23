/**
 * Job photo upload — the one code path the job screen's Photos block and the
 * job form's photo questions both use. POST /api/bookings/:id/photos
 * (multipart) returns the stored photo row.
 */
import Constants from "expo-constants";
import { authHeaders } from "./auth";
import { throwIfNotOk } from "./api-error";

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
  const res = await fetch(`${API}/api/bookings/${opts.bookingId}/photos`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  await throwIfNotOk(res, "Upload failed");
  const body = (await res.json().catch(() => null)) as any;
  return (body?.photo ?? body) as JobPhoto;
}
