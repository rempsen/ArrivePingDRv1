/**
 * `bookings.field_data` is a JSON blob that holds two very different things:
 *
 *   - customer-facing custom fields (`_customFields`, plus any legacy
 *     top-level key/value pairs from older booking forms), and
 *   - server-internal bookkeeping that must NEVER leave the API — today the
 *     iOS Live Activity push tokens written by `tracking.ts`
 *     (`__la_push_start_token` / `__la_push_update_token`, see
 *     `services/apns.ts` LA_TOKEN_KEYS).
 *
 * Convention: any key starting with `__` is internal. These helpers strip
 * them on the way out and preserve them on the way in, so a client that
 * round-trips `fieldData` (the work-order editor sends the whole object back)
 * can neither see nor accidentally erase them.
 */

export const INTERNAL_FIELD_PREFIX = "__";

export function isInternalFieldKey(key: string): boolean {
  return key.startsWith(INTERNAL_FIELD_PREFIX);
}

function parseObject(raw: unknown): Record<string, unknown> | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Remove internal keys from a raw `field_data` JSON string. Returns the input
 * untouched when it has nothing to strip (so legacy / non-object payloads pass
 * through byte-for-byte).
 */
export function publicFieldData<T extends string | null | undefined>(raw: T): T {
  if (typeof raw !== "string" || !raw.includes(INTERNAL_FIELD_PREFIX)) return raw;
  const obj = parseObject(raw);
  if (!obj) return raw;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isInternalFieldKey(k)) changed = true;
    else out[k] = v;
  }
  return (changed ? JSON.stringify(out) : raw) as T;
}

/**
 * Build the `field_data` string to store when a client submits a new
 * `fieldData` object for an existing booking: the client's (public) keys win,
 * but internal keys already on the row are carried forward instead of being
 * wiped by the overwrite.
 */
export function mergeInternalFieldData(
  previousRaw: string | null | undefined,
  incoming: Record<string, unknown> | null | undefined,
): string {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(incoming ?? {})) {
    if (!isInternalFieldKey(k)) next[k] = v; // clients can't inject internal keys
  }
  const prev = parseObject(previousRaw);
  if (prev) {
    for (const [k, v] of Object.entries(prev)) {
      if (isInternalFieldKey(k)) next[k] = v;
    }
  }
  return JSON.stringify(next);
}
