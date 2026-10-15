/**
 * A company's office coordinates, for biasing address suggestions toward
 * where it actually works. Uses companies.office_lat/lng, which is NULL until
 * the company sets an office address. companySettings.lat/lng is not used:
 * it defaults to downtown Winnipeg for every company, so a Toronto company
 * that never changed it would get Winnipeg-first suggestions.
 *
 * Cached briefly: every keystroke on an address field asks for it.
 */
import { eq } from "drizzle-orm";
import { db } from "../api/database";
import * as schema from "../api/database/schema";

const TTL_MS = 10 * 60_000;
const MAX = 1_000;
const cache = new Map<string, { at: number; v: { lat: number; lng: number } | null }>();

export async function companyOfficeBias(companyId: string | null | undefined): Promise<{ lat: number; lng: number } | null> {
  if (!companyId || companyId === "default") return null;
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  let v: { lat: number; lng: number } | null = null;
  try {
    const [row] = await db
      .select({ lat: schema.companies.officeLat, lng: schema.companies.officeLng })
      .from(schema.companies)
      .where(eq(schema.companies.id, companyId))
      .limit(1);
    if (row && typeof row.lat === "number" && typeof row.lng === "number") v = { lat: row.lat, lng: row.lng };
  } catch {
    return null; // bias is a nicety; never fail the lookup over it
  }
  if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
  cache.set(companyId, { at: Date.now(), v });
  return v;
}

/** Test-only. */
export function _clearCompanyOfficeCache() {
  cache.clear();
}
