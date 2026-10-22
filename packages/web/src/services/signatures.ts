import { deleteObject } from "../api/lib/storage";

/**
 * A job's customer sign-off is one stored image (`signatures/<job>/<uuid>.svg`)
 * referenced by bookings.signatureUrl. Deleting it has to find that object
 * again from the url alone.
 */

/** The storage key behind a signature url, only ever one inside this job's
 * signature folder. Handles the three url shapes putObject produces: the
 * public proxy (`/api/public/file/<encoded key>`), a public base
 * (`<base>/<key>`) and the local-disk fallback (`/uploads/<key with "/" as "_">`). */
export function signatureKey(url: string | null | undefined, bookingId: string): string | null {
  if (!url) return null;
  let path = url.split("?")[0]!;
  try {
    path = decodeURIComponent(path);
  } catch {}
  const prefix = `signatures/${bookingId}/`;
  let key = "";
  const at = path.indexOf("signatures/");
  if (at >= 0) key = path.slice(at);
  else {
    const flat = `signatures_${bookingId}_`;
    const f = path.indexOf(flat);
    if (path.includes("/uploads/") && f >= 0) key = prefix + path.slice(f + flat.length);
  }
  if (!key.startsWith(prefix) || key.includes("..") || key.length === prefix.length) return null;
  return key;
}

/** Remove the stored image behind a signature url, best-effort: the booking
 * row is what counts, and a leftover object is harmless. */
export async function deleteSignatureObject(url: string | null | undefined, bookingId: string): Promise<void> {
  const key = signatureKey(url, bookingId);
  if (!key) return;
  await deleteObject(key).catch((e) => console.error("[signature] delete object failed", key, e));
}
