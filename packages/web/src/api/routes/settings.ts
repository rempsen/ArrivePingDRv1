import { Hono } from "hono";
import { eq } from "drizzle-orm";
import * as schema from "../database/schema";
import { db } from "../database";
import { requireAuth, requireAdmin, tx, tenantId } from "../middleware/auth";
import { audit } from "../lib/audit";
import type { AppEnv } from "../env";

type SessionUser = { id: string; name?: string };

/**
 * Resolve (creating if needed) the company_settings row for the ACTIVE tenant.
 * Tenancy: one row per company, keyed by companyId via the tdb facade — never
 * the legacy id="default" singleton (that leaked one config across all tenants).
 */
async function getOrInit(c: any) {
  const t = tx(c);
  let row = await t.selectOne(schema.companySettings);
  if (!row) {
    [row] = await t.insert(schema.companySettings, {
      id: tenantId(c), // unique per tenant (PK)
    });
  }
  return row;
}

export const settingsRoutes = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const settings = await getOrInit(c);
    // surface the tenant's Primary Industry (ICP) + free-text "other"
    // description so the UI (Form Builder category dropdown, etc.) can adapt.
    // Stored on companies, not settings.
    let industry = "";
    let industryOther = "";
    let officeAddress = "";
    let officeLat: number | null = null;
    let officeLng: number | null = null;
    try {
      const [co] = await db
        .select({
          industry: schema.companies.industry,
          industryOther: schema.companies.industryOther,
          officeAddress: schema.companies.officeAddress,
          officeLat: schema.companies.officeLat,
          officeLng: schema.companies.officeLng,
        })
        .from(schema.companies)
        .where(eq(schema.companies.id, tenantId(c)));
      industry = co?.industry ?? "";
      industryOther = co?.industryOther ?? "";
      officeAddress = co?.officeAddress ?? "";
      officeLat = co?.officeLat ?? null;
      officeLng = co?.officeLng ?? null;
    } catch {
      // best-effort; default to empty
    }
    return c.json({ settings: { ...settings, industry, industryOther, officeAddress, officeLat, officeLng } }, 200);
  })
  .put("/", requireAdmin, async (c) => {
    const me = c.get("user") as SessionUser;
    const body = await c.req.json();
    const existing = await getOrInit(c);
    // officeAddress/officeLat/officeLng live on `companies`, not
    // `company_settings` — they're the tenant's home base (fleet map
    // fallback center), separate from the tax/geofencing "business address"
    // below. Handled here too so Settings → Company can save both in one
    // "Save changes" click.
    if ("officeAddress" in body || "officeLat" in body || "officeLng" in body) {
      const officePatch: Record<string, unknown> = { updatedAt: new Date() };
      if ("officeAddress" in body) officePatch.officeAddress = String(body.officeAddress ?? "");
      if ("officeLat" in body) officePatch.officeLat = body.officeLat == null ? null : Number(body.officeLat);
      if ("officeLng" in body) officePatch.officeLng = body.officeLng == null ? null : Number(body.officeLng);
      await db.update(schema.companies).set(officePatch as any).where(eq(schema.companies.id, tenantId(c)));
    }
    const allowed = [
      "name", "legalName", "email", "phone", "address", "lat", "lng",
      "timezone", "currency", "taxRate", "taxLabel", "logo", "brandColor", "website",
      "defaultRegion", "autoTaxByRegion", "geofenceRadiusM",
      // review requests + reputation routing
      "reviewRequestEnabled", "reviewRequestDelayMins", "googleReviewUrl",
      // customer-initiated appointment changes (shared/change-policy.ts)
      "allowCustomerReschedule", "allowCustomerCancelRequest", "customerChangeCutoffHours",
      // who can be assigned work (routes/riders.ts GET /)
      "officeStaffAssignable",
      // running-late notices (shared/delay-policy.ts)
      "delayNoticeEnabled", "delayNoticeThresholdMins", "delayNoticeAutoSendAfterMins",
    ];
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of allowed) if (k in body) patch[k] = body[k];
    // This endpoint stores whatever it is handed, so the three change-policy
    // fields are normalised here: a NaN / negative / absurd cutoff would either
    // blow up the integer column or hand out a policy nobody chose.
    if ("customerChangeCutoffHours" in patch) {
      const n = Math.round(Number(patch.customerChangeCutoffHours));
      patch.customerChangeCutoffHours = Number.isFinite(n) ? Math.min(336, Math.max(0, n)) : 12;
    }
    for (const k of ["allowCustomerReschedule", "allowCustomerCancelRequest", "delayNoticeEnabled", "officeStaffAssignable"]) {
      if (k in patch) patch[k] = patch[k] === true || patch[k] === 1 || patch[k] === "true";
    }
    // Same normalisation for the running-late windows. A 1-minute threshold
    // would text every customer about traffic lights; a 0 threshold would text
    // them about nothing at all, so the floor is 5. Grace of 0 is meaningful
    // (dispatcher-only, never auto-send) and is kept.
    if ("delayNoticeThresholdMins" in patch) {
      const n = Math.round(Number(patch.delayNoticeThresholdMins));
      patch.delayNoticeThresholdMins = Number.isFinite(n) ? Math.min(240, Math.max(5, n)) : 15;
    }
    if ("delayNoticeAutoSendAfterMins" in patch) {
      const n = Math.round(Number(patch.delayNoticeAutoSendAfterMins));
      patch.delayNoticeAutoSendAfterMins = Number.isFinite(n) ? Math.min(240, Math.max(0, n)) : 10;
    }
    const [updated] = await tx(c).update(
      schema.companySettings,
      patch as any,
      undefined,
    );
    await audit({
      actorId: me?.id, actorName: me?.name, action: "update",
      entityType: "company_settings", entityId: existing.id,
      summary: "Updated company settings",
    });
    return c.json({ settings: updated }, 200);
  });
