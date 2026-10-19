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
import { tdb } from "../api/database/tenant";

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

/** companySettings lat/lng column defaults (downtown Winnipeg) — "never set". */
const SETTINGS_DEFAULT_LAT = 49.8951;
const SETTINGS_DEFAULT_LNG = -97.1384;
/** The column default for companySettings.address — a demo value, not a real one. */
const SETTINGS_DEFAULT_ADDRESS = "423 Main Street, Winnipeg, Manitoba, Canada";

export interface OfficeSyncResult {
  /** companies.office_address / office_lat / office_lng were written. */
  office: boolean;
  /** companySettings.lat / lng were written (they were still the column default). */
  businessCoords: boolean;
  geocoded: boolean;
}

/**
 * When a tenant's business address is first known (signup scrape, or a
 * website re-scan that fills a blank address), use it as the office location
 * too, so the fleet map, sample day, practice jobs and address suggestions
 * centre on where the company actually is instead of an arbitrary default.
 *
 * Fill-empty only: an office address an admin already typed is never touched,
 * and the business coordinates are only written while they are still the
 * column default. One geocode serves both. Geocoding is best-effort — with no
 * hit the office address text is still filled (the map then falls back as
 * before) so Settings shows the same location in both fields.
 */
export async function syncOfficeFromBusinessAddress(
  companyId: string,
  address: string | null | undefined,
  deps: { geocode?: (q: string) => Promise<{ lat: number; lng: number } | null> } = {},
): Promise<OfficeSyncResult> {
  const out: OfficeSyncResult = { office: false, businessCoords: false, geocoded: false };
  const addr = (address ?? "").trim();
  if (!companyId || companyId === "default" || !addr || addr === SETTINGS_DEFAULT_ADDRESS) return out;

  const [co] = await db
    .select({ officeAddress: schema.companies.officeAddress, officeLat: schema.companies.officeLat, officeLng: schema.companies.officeLng })
    .from(schema.companies)
    .where(eq(schema.companies.id, companyId))
    .limit(1);
  if (!co) return out;
  const officeEmpty = !(co.officeAddress ?? "").trim() && co.officeLat == null && co.officeLng == null;

  const t = tdb(companyId);
  const s = await t.selectOne(schema.companySettings).catch(() => undefined);
  // real (float4) columns: compare with a tolerance, not ===.
  const coordsDefault = !!s && Math.abs(Number(s.lat) - SETTINGS_DEFAULT_LAT) < 1e-4 && Math.abs(Number(s.lng) - SETTINGS_DEFAULT_LNG) < 1e-4;
  if (!officeEmpty && !coordsDefault) return out;

  const geocode = deps.geocode ?? (async (q: string) => (await import("./geocode")).forwardGeocode(q));
  const hit = await geocode(addr).catch(() => null);
  out.geocoded = !!hit;

  if (officeEmpty) {
    await db
      .update(schema.companies)
      .set({ officeAddress: addr, ...(hit ? { officeLat: hit.lat, officeLng: hit.lng } : {}), updatedAt: new Date() } as never)
      .where(eq(schema.companies.id, companyId));
    out.office = true;
    cache.delete(companyId);
  }
  if (coordsDefault && hit) {
    await t.update(schema.companySettings, { lat: hit.lat, lng: hit.lng } as never);
    out.businessCoords = true;
  }
  return out;
}
