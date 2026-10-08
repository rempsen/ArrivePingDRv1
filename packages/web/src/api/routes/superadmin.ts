import type { AppEnv } from "../env";

/**
 * SUPERADMIN — B2B tenant provisioning & registry.
 *
 * The `companies` table IS the tenant catalog: each row's `id` (slug) becomes
 * the companyId stamped on every tenant-owned record. These endpoints are
 * guarded by `requireSuperadmin` (the only role allowed cross-tenant access).
 *
 * Three DB handles are in play here, deliberately:
 *  - `db` — plain, for the GLOBAL `companies` table only.
 *  - `tdb(id)` — for a normal tenant-scoped read/write against ONE known
 *    tenant (e.g. patching that tenant's companySettings row).
 *  - `sdb` (BYPASSRLS) — for the superadmin-only cross-tenant operations
 *    below that a normal tenant-scoped call can't do at all: the full
 *    tenant-teardown delete (explicit companyId filters across dozens of
 *    tables, not tdb()'s auto-scoping — RLS with no tenant context set would
 *    silently delete zero rows), the email-domains queue (lists/mutates rows
 *    across EVERY tenant at once), and moving a user's home company during
 *    teardown.
 */
import { Hono } from "hono";
import { eq, and, ne } from "drizzle-orm";
import { db, sdb } from "../database";
import { tdb } from "../database/tenant";
import * as schema from "../database/schema";
import { requireSuperadmin, invalidateCompanyCache } from "../middleware/auth";
import { audit } from "../lib/audit";
import { ensureDefaultTenantKey } from "../lib/tenant-keys";
import { scoutBrand } from "../../services/brand-scout";
import { runGoogleSmoke } from "../../services/google-smoke";
import { rescanWebsite, type RescanResult } from "../../services/rescan";
import { provisionNotificationBranding } from "../../services/dispatch";
import {
  resendAvailable,
  createDomainInResend,
  triggerVerify,
  removeDomain,
} from "../../services/email-domains";
import {
  provisionCompany,
  websiteUrlSchema,
  BrandProposal,
  CompanyCreateBody,
  slugify,
} from "../../services/company-provisioning";

import { z } from "zod";
import { jsonBody, parseBody, optText } from "../lib/validate";

/**
 * An upstream error surfaced to the console must be readable. When Resend's
 * edge (Cloudflare) answers with an HTML error page instead of JSON, the SDK
 * puts the whole page in error.message — that is what Dan saw as
 * "<!DOCTYPE html><!--[if lt IE 7]>…" under the icloud.com row.
 */
function plainError(msg: unknown, fallback: string): string {
  const raw = String(msg ?? "").trim();
  if (!raw) return fallback;
  if (/^\s*<(!doctype|html)/i.test(raw)) {
    return "The email provider returned an error page instead of an answer (upstream/edge error). Try again in a minute; if it keeps happening the domain is probably not one that can be verified.";
  }
  const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 300 ? text.slice(0, 297) + "…" : text || fallback;
}


type SessionUser = { id: string; name?: string };

/* -------------------------------------------------------------------------- */
/*  Request bodies                                                            */
/*                                                                            */
/*  Reproduced live on :4200 before this pass (mutations were aimed at the     */
/*  acme-hvac demo tenant and its settings row was snapshotted through         */
/*  drizzle first, then restored):                                            */
/*                                                                            */
/*   - POST /brand-scout { website: "http://127.0.0.1:4200/api/health" }       */
/*     -> 200, and the returned proposal carried primaryColor "#ffffff"        */
/*     scraped from that response. The server fetches whatever URL the caller  */
/*     supplies and echoes parsed content back: a working SSRF with an output  */
/*     channel. { website: "http://169.254.169.254/latest/meta-data/" } (cloud */
/*     instance metadata) was also accepted and attempted.                     */
/*   - PATCH /companies/:id/brand { brand: { logoUrl: "javascript:alert(1)" }} */
/*     -> 200 and STORED. That value is rendered as an <img src> in the tenant */
/*     UI and in outbound notification email headers.                          */
/*   - Same route: primaryColor "chartreuse-ish" stored (breaks the CSS custom */
/*     property and the email theme), email "not-an-email" stored as the        */
/*     tenant's public contact address (guaranteeing bounces on every reply),  */
/*     and a 20,000-character jobNoun stored — that noun is rendered in every  */
/*     label, table header and email subject line in the product.              */
/*   - POST /companies validated nothing beyond "name present": adminPassword  */
/*     had no minimum length, adminEmail was never checked for being an email  */
/*     address, and the slug-collision check ran BEFORE the credential checks, */
/*     so a request with both problems reported only the collision.            */
/* -------------------------------------------------------------------------- */

const BrandScoutBody = z.object({
  // websiteUrlSchema normalizes a bare domain ("acme.com" -> "https://acme.com")
  // and then runs outboundUrl(), which blocks javascript:, loopback,
  // link-local (169.254.x) and RFC1918 space — this URL is fetched BY THE
  // SERVER. Shared with the public self-serve onboarding flow so both front
  // doors reject the same bad input the same way.
  website: websiteUrlSchema,
  companyId: optText(120),
  name: optText(200),
});

const BrandPatchBody = z.object({ brand: BrandProposal });
const DeleteCompanyBody = z.object({ confirmName: optText(200) });

export const superadminRoutes = new Hono<AppEnv>()
  // ---- Google Maps Platform smoke check (modernization phase 0) ----------
  // One live call per API on the new project's key; returns status and a
  // short summary, never the key. ?key=current tests GOOGLE_MAPS_API_KEY
  // instead; ?raw=1 adds response bodies for recording test fixtures.
  .get("/google-smoke", requireSuperadmin, async (c) => {
    const choice = c.req.query("key") === "current" ? "current" : "new";
    const report = await runGoogleSmoke({ choice, includeRaw: c.req.query("raw") === "1" });
    return c.json(report, 200);
  })

  // ---- list all tenants -------------------------------------------------
  .get("/companies", requireSuperadmin, async (c) => {
    const rows = await db.select().from(schema.companies);
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return c.json({ companies: rows }, 200);
  })

  // ---- single tenant ----------------------------------------------------
  .get("/companies/:id", requireSuperadmin, async (c) => {
    const [row] = await db
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.id, c.req.param("id")));
    if (!row) return c.json({ message: "Not found" }, 404);
    return c.json({ company: row }, 200);
  })

  // ---- permanently delete a tenant + every row it owns -------------------
  // Irreversible. Guarded by a type-the-company-name confirmation on the
  // client (enforced server-side too via `confirmName`) since this wipes a
  // tenant's entire history: bookings, riders, catalog, forms, templates,
  // invoices, users... everything stamped with this companyId. "default" is
  // the platform's own bootstrap tenant and can never be deleted this way.
  .delete("/companies/:id", requireSuperadmin, jsonBody(DeleteCompanyBody), async (c) => {
    const me = c.get("user") as SessionUser;
    const id = c.req.param("id");
    if (id === "default")
      return c.json({ message: "The default tenant can't be deleted" }, 400);

    const [co] = await db
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.id, id));
    if (!co) return c.json({ message: "Not found" }, 404);

    const { confirmName: rawConfirmName } = c.req.valid("json");
    const confirmName = String(rawConfirmName ?? "").trim();
    if (confirmName !== co.name)
      return c.json(
        { message: `Type "${co.name}" to confirm — this cannot be undone` },
        400,
      );

    // Tear down in child -> parent order so no FK (task_templates.id,
    // riders.id, bookings.id, ...) is ever dropped while something still
    // points at it — the same NO-ACTION landmine that made deleting a single
    // work-order template with real bookings 500 (see templates.ts DELETE).
    const eqCo = (col: any) => eq(col, id);

    // 0) punchlist deficiencies — reference riders (NO ACTION), bookings and
    //    punchlistProjects (both CASCADE); deleted first so nothing downstream
    //    of them ever gets a chance to be pulled out from under them
    await sdb.delete(schema.deficiencies).where(eqCo(schema.deficiencies.companyId));
    // punchlist trades — reference riders (CASCADE); explicit, not relied on
    await sdb.delete(schema.punchlistTrades).where(eqCo(schema.punchlistTrades.companyId));

    // 1) everything hanging off a booking
    await sdb.delete(schema.jobPhotos).where(eqCo(schema.jobPhotos.companyId));
    await sdb.delete(schema.messages).where(eqCo(schema.messages.companyId));
    await sdb.delete(schema.trackingPings).where(eqCo(schema.trackingPings.companyId));
    await sdb.delete(schema.bookingOptionSelections).where(eqCo(schema.bookingOptionSelections.companyId));
    await sdb.delete(schema.notifications).where(eqCo(schema.notifications.companyId));
    await sdb.delete(schema.reviews).where(eqCo(schema.reviews.companyId));
    await sdb.delete(schema.invoices).where(eqCo(schema.invoices.companyId));
    await sdb.delete(schema.paymentLedger).where(eqCo(schema.paymentLedger.companyId));
    await sdb.delete(schema.intakeSubmissions).where(eqCo(schema.intakeSubmissions.companyId));
    // job timeline + reschedule/cancel requests — reference bookings (CASCADE)
    await sdb.delete(schema.jobEvents).where(eqCo(schema.jobEvents.companyId));
    await sdb.delete(schema.bookingChangeRequests).where(eqCo(schema.bookingChangeRequests.companyId));
    // scheduled reminder/automation jobs — reference bookings AND properties
    // (both CASCADE); must go before both
    await sdb.delete(schema.scheduledTasks).where(eqCo(schema.scheduledTasks.companyId));
    // punchlist projects — reference bookings (CASCADE, NOT NULL) and user
    // (NO ACTION); their deficiencies are already gone (step 0 above)
    await sdb.delete(schema.punchlistProjects).where(eqCo(schema.punchlistProjects.companyId));

    // 2) bookings themselves — safe now that every child row is gone
    await sdb.delete(schema.bookings).where(eqCo(schema.bookings.companyId));

    // 3) catalog / templates / options — nothing left referencing them
    await sdb.delete(schema.optionCategoryItems).where(eqCo(schema.optionCategoryItems.companyId));
    await sdb.delete(schema.optionCategories).where(eqCo(schema.optionCategories.companyId));
    await sdb.delete(schema.catalogItems).where(eqCo(schema.catalogItems.companyId));
    await sdb.delete(schema.taskTemplates).where(eqCo(schema.taskTemplates.companyId));

    // maintenance plans — reference services (NO ACTION), properties (CASCADE)
    // and user (NO ACTION); must go before all three are torn down below
    await sdb.delete(schema.maintenancePlans).where(eqCo(schema.maintenancePlans.companyId));

    // 4) riders — their booking/message/review/deficiency/trade references
    //    are already gone
    await sdb.delete(schema.techShifts).where(eqCo(schema.techShifts.companyId));
    await sdb.delete(schema.payouts).where(eqCo(schema.payouts.companyId));
    await sdb.delete(schema.pushTokens).where(eqCo(schema.pushTokens.companyId));
    await sdb.delete(schema.riders).where(eqCo(schema.riders.companyId));
    await sdb.delete(schema.services).where(eqCo(schema.services.companyId));

    // properties — reference user (NO ACTION); scheduledTasks and
    // maintenancePlans (both of which reference properties) are already gone
    await sdb.delete(schema.properties).where(eqCo(schema.properties.companyId));

    // 5) everything else tenant-scoped, no ordering constraints left
    await sdb.delete(schema.entityTags).where(eqCo(schema.entityTags.companyId));
    await sdb.delete(schema.tags).where(eqCo(schema.tags.companyId));
    await sdb.delete(schema.customFieldValues).where(eqCo(schema.customFieldValues.companyId));
    await sdb.delete(schema.customFields).where(eqCo(schema.customFields.companyId));
    await sdb.delete(schema.attachments).where(eqCo(schema.attachments.companyId));
    await sdb.delete(schema.serviceZones).where(eqCo(schema.serviceZones.companyId));
    await sdb.delete(schema.formCategories).where(eqCo(schema.formCategories.companyId));
    await sdb.delete(schema.automationRules).where(eqCo(schema.automationRules.companyId));
    await sdb.delete(schema.integrations).where(eqCo(schema.integrations.companyId));
    await sdb.delete(schema.skillLibrary).where(eqCo(schema.skillLibrary.companyId));
    await sdb.delete(schema.notificationRules).where(eqCo(schema.notificationRules.companyId));
    await sdb.delete(schema.notificationChannels).where(eqCo(schema.notificationChannels.companyId));
    await sdb.delete(schema.emailTemplates).where(eqCo(schema.emailTemplates.companyId));
    await sdb.delete(schema.webhookEndpoints).where(eqCo(schema.webhookEndpoints.companyId));
    await sdb.delete(schema.notificationDeliveries).where(eqCo(schema.notificationDeliveries.companyId));
    await sdb.delete(schema.techInvites).where(eqCo(schema.techInvites.companyId));
    await sdb.delete(schema.apiKeys).where(eqCo(schema.apiKeys.companyId));
    await sdb.delete(schema.intakeForms).where(eqCo(schema.intakeForms.companyId));

    // 6) sending domains — also deregister from Resend, not just the DB row
    const domains = await sdb
      .select()
      .from(schema.tenantEmailDomains)
      .where(eqCo(schema.tenantEmailDomains.companyId));
    for (const d of domains) await removeDomain(d.id).catch(() => {});

    await sdb.delete(schema.auditLog).where(eqCo(schema.auditLog.companyId));
    await sdb.delete(schema.companySettings).where(eqCo(schema.companySettings.companyId));

    // 7) memberships at THIS company — a person can work for several
    //    companies at once (see lib/memberships.ts), so this only ends their
    //    relationship with the tenant being deleted, never their login.
    await sdb.delete(schema.memberships).where(eqCo(schema.memberships.companyId));

    // 8) users whose HOME company is the one being deleted. Mirrors
    //    detachMembership()'s own rule: never destroy a login that still
    //    works elsewhere. A user with a remaining active membership at
    //    another company gets their home company moved there instead of
    //    being deleted; only a user with no memberships left anywhere else
    //    is actually removed (which cascades their sessions/accounts via the
    //    FK's ON DELETE CASCADE).
    const homeUsers = await sdb
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eqCo(schema.user.companyId));
    for (const u of homeUsers) {
      const [remaining] = await sdb
        .select({ companyId: schema.memberships.companyId })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.userId, u.id),
            eq(schema.memberships.status, "active"),
            ne(schema.memberships.companyId, id),
          ),
        );
      if (remaining) {
        await sdb
          .update(schema.user)
          .set({ companyId: remaining.companyId })
          .where(eq(schema.user.id, u.id));
      } else {
        await sdb.delete(schema.user).where(eq(schema.user.id, u.id));
      }
    }

    // 9) the tenant row itself
    await db.delete(schema.companies).where(eq(schema.companies.id, id));

    invalidateCompanyCache();
    await audit({
      actorId: me?.id,
      actorName: me?.name,
      action: "delete",
      entityType: "company",
      entityId: id,
      summary: `Deleted tenant "${co.name}" (${id}) and all of its data`,
    });

    return c.json({ ok: true }, 200);
  })

  // ---- AI brand scout: scrape a website -> structured brand proposal ----
  // No DB writes. The admin reviews/edits the result, then submits it as the
  // `brand` payload on POST /companies (or PATCH for an existing tenant).
  .post("/brand-scout", requireSuperadmin, jsonBody(BrandScoutBody), async (c) => {
    const b = c.req.valid("json");
    const website = b.website;
    // companyId only used to namespace the hosted logo object; may not exist
    // as a tenant yet (we're onboarding). Fall back to a derived slug.
    const companyId = slugify(String(b.companyId ?? b.name ?? "") || website);
    try {
      const proposal = await scoutBrand(website, companyId || "pending");
      return c.json({ proposal }, 200);
    } catch (e: any) {
      return c.json(
        { message: `Brand scout failed: ${e?.message ?? "unknown error"}` },
        502,
      );
    }
  })

  // ---- apply a reviewed brand proposal to an EXISTING tenant ------------
  .patch("/companies/:id/brand", requireSuperadmin, async (c) => {
    const me = c.get("user") as SessionUser;
    const id = c.req.param("id");
    const [co] = await db
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.id, id));
    if (!co) return c.json({ message: "Not found" }, 404);
    const brand = (await parseBody(c, BrandPatchBody)).brand as Record<string, any>;
    const set: Record<string, any> = { updatedAt: new Date() };
    const map: [string, string][] = [
      ["primaryColor", "brandColor"],
      ["accentColor", "accentColor"],
      ["logoUrl", "logo"],
      ["workerNoun", "workerNoun"],
      ["workerNounPlural", "workerNounPlural"],
      ["customerNoun", "customerNoun"],
      ["customerNounPlural", "customerNounPlural"],
      ["jobNoun", "jobNoun"],
      ["jobNounPlural", "jobNounPlural"],
      ["tagline", "tagline"],
      ["description", "description"],
      ["hours", "hours"],
      ["address", "address"],
      ["email", "email"],
      ["phone", "phone"],
      ["website", "website"],
      ["serviceArea", "serviceArea"],
    ];
    for (const [src, col] of map) {
      const v = brand[src];
      if (typeof v === "string" && v.trim()) set[col] = v.trim();
    }
    if (brand.services != null)
      set.services =
        typeof brand.services === "string"
          ? brand.services
          : JSON.stringify(brand.services);
    if (brand.socials != null)
      set.socials =
        typeof brand.socials === "string"
          ? brand.socials
          : JSON.stringify(brand.socials);

    await tdb(id).update(schema.companySettings, set);
    await audit({
      actorId: me?.id,
      actorName: me?.name,
      action: "update",
      entityType: "company",
      entityId: id,
      summary: `Applied AI brand assets to "${co.name}"`,
      companyId: id,
    });
    const row = await tdb(id).selectOne(schema.companySettings);
    // re-sync the branded email/SMS identity from the freshly-applied brand
    if (row)
      await provisionNotificationBranding({
        companyId: id,
        name: row.name || co.name,
        logoUrl: row.logo,
        brandColor: row.brandColor,
        legalName: row.legalName || row.name || co.name,
        address: row.address,
        phone: row.phone,
        email: row.email,
        website: row.website,
      }).catch((e) =>
        console.error("[superadmin] brand re-provisioning failed", e),
      );
    return c.json({ settings: row }, 200);
  })

  // ---- provision a new tenant + its admin & manager users ---------------
  // Delegates to services/company-provisioning.ts's provisionCompany() — the
  // SAME pipeline the public self-serve onboarding flow calls (see
  // api/routes/onboarding.ts), so a superadmin-created tenant and a
  // client-signed-up tenant end up identically seeded.
  .post("/companies", requireSuperadmin, jsonBody(CompanyCreateBody), async (c) => {
    const me = c.get("user") as SessionUser;
    // Every field is validated up front, so a request with a bad admin email
    // AND a colliding slug now reports both problems instead of only the slug.
    const b = c.req.valid("json");
    const result = await provisionCompany(b, { id: me?.id, name: me?.name }, { source: "superadmin" });
    return c.json(result, 201);
  })

  // ---- re-scan ONE tenant's website (item G) -----------------------------
  // Fill-empty by default; `overwrite: true` replaces non-empty fields too.
  .post("/companies/:id/rescan", requireSuperadmin, async (c) => {
    const me = c.get("user") as SessionUser;
    const id = c.req.param("id");
    const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
    if (!co) return c.json({ message: "Not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { website?: unknown; overwrite?: unknown };
    const website = typeof body.website === "string" && body.website.trim() ? body.website.trim().slice(0, 300) : undefined;
    const overwrite = body.overwrite === true;
    const r = await rescanWebsite(id, { website, overwrite, source: "superadmin" });
    await audit({
      actorId: me?.id,
      actorName: me?.name,
      action: "update",
      entityType: "company",
      entityId: id,
      summary: r.ok
        ? `Re-scanned ${r.website} for "${co.name}" — ${r.pageCount} pages, filled ${r.filled.length ? r.filled.join(", ") : "nothing new"}`
        : `Re-scan failed for "${co.name}": ${r.error ?? "unknown"}`,
      companyId: id,
    });
    return c.json({ result: r }, r.ok ? 200 : 502);
  })

  // ---- backfill: re-scan EVERY tenant that has a website (item G) --------
  // Fill-empty only, sequential (each scan is a real crawl + model call), so
  // this takes ~15-40s per tenant. Pass { onlyMissingCrawl: false } to
  // include tenants that already have a site_crawls row; default skips
  // them. Never overwrites admin-typed values.
  .post("/companies/rescan-all", requireSuperadmin, async (c) => {
    const me = c.get("user") as SessionUser;
    const body = (await c.req.json().catch(() => ({}))) as { onlyMissingCrawl?: unknown; ids?: unknown };
    const onlyMissingCrawl = body.onlyMissingCrawl !== false;
    const ids = Array.isArray(body.ids) ? body.ids.map((x) => String(x)) : null;
    const companies = await db.select().from(schema.companies);
    const crawled = new Set((await sdb.select({ companyId: schema.siteCrawls.companyId }).from(schema.siteCrawls)).map((r) => r.companyId));
    const results: { companyId: string; skipped?: string; result?: RescanResult }[] = [];
    for (const company of companies) {
      if (ids && !ids.includes(company.id)) continue;
      if (onlyMissingCrawl && crawled.has(company.id)) {
        results.push({ companyId: company.id, skipped: "already has a crawl" });
        continue;
      }
      try {
        const r = await rescanWebsite(company.id, { source: "backfill" });
        results.push({ companyId: company.id, result: r });
      } catch (e: any) {
        results.push({ companyId: company.id, skipped: `error: ${e?.message ?? "unknown"}` });
      }
    }
    const scanned = results.filter((r) => r.result?.ok).length;
    await audit({
      actorId: me?.id,
      actorName: me?.name,
      action: "update",
      entityType: "company",
      entityId: "rescan-all",
      summary: `Website re-scan backfill: ${scanned} scanned, ${results.length - scanned} skipped/failed`,
    });
    return c.json({ total: results.length, scanned, results }, 200);
  })

  // ---- backfill: ensure EVERY existing tenant has a unique secret key ----
  // Idempotent. Companies that already have an active secret key are skipped
  // (their key is unrecoverable, so no raw value is returned for those).
  .post("/companies/backfill-keys", requireSuperadmin, async (c) => {
    const me = c.get("user") as SessionUser;
    const companies = await db.select().from(schema.companies);
    const results: {
      companyId: string;
      created: boolean;
      prefix: string;
      secret?: string;
    }[] = [];
    for (const company of companies) {
      const r = await ensureDefaultTenantKey({
        companyId: company.id,
        createdBy: me?.id,
        createdByName: me?.name,
      });
      results.push({
        companyId: r.companyId,
        created: r.created,
        prefix: r.prefix,
        secret: r.raw,
      });
    }
    const createdCount = results.filter((r) => r.created).length;
    await audit({
      actorId: me?.id,
      actorName: me?.name,
      action: "create",
      entityType: "api_key",
      entityId: "backfill",
      summary: `Backfilled tenant API keys: ${createdCount} created, ${
        results.length - createdCount
      } already present`,
    });
    return c.json(
      {
        total: results.length,
        created: createdCount,
        // raw secrets ONLY for the ones we just created — save them now.
        results,
      },
      200,
    );
  })

  // ---- email sending domains (cross-tenant approval queue) ----
  // All submitted domains across every tenant, newest first.
  .get("/email-domains", requireSuperadmin, async (c) => {
    // Cross-tenant approval queue — every tenant's domains at once, so sdb.
    const rows = await sdb.select().from(schema.tenantEmailDomains);
    const companies = await db.select().from(schema.companies);
    const nameById = new Map(companies.map((co) => [co.id, co.name]));
    const domains = rows
      .map((r) => ({
        ...r,
        companyName: nameById.get(r.companyId) || r.companyId,
        records: safeParse(r.records),
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return c.json({ domains, resendAvailable: resendAvailable() }, 200);
  })

  // Approve: create the domain in Resend, store id + DNS records.
  .post("/email-domains/:id/approve", requireSuperadmin, async (c) => {
    const me = c.get("user") as SessionUser;
    const id = c.req.param("id");
    // Superadmin cross-tenant lookup by the domain row's own id (not a
    // companyId), same rationale as the GET list above — sdb.
    const [row] = await sdb
      .select()
      .from(schema.tenantEmailDomains)
      .where(eq(schema.tenantEmailDomains.id, id))
      .limit(1);
    if (!row) return c.json({ message: "not found" }, 404);
    if (!resendAvailable())
      return c.json({ message: "RESEND_API_KEY not configured" }, 503);
    try {
      const updated = await createDomainInResend(id);
      if (!updated) return c.json({ message: "not found" }, 404);
      await audit({
        actorId: me?.id,
        actorName: me?.name,
        action: "create",
        entityType: "email_domain",
        entityId: id,
        summary: `Approved email domain ${row.domain} for ${row.companyId}`,
      });
      return c.json({ domain: { ...updated, records: safeParse(updated.records) } }, 200);
    } catch (e: any) {
      return c.json({ message: plainError(e?.message, "approve failed") }, 502);
    }
  })

  // Force a verify re-check from the superadmin console.
  .post("/email-domains/:id/verify", requireSuperadmin, async (c) => {
    const id = c.req.param("id");
    // Superadmin cross-tenant lookup by the domain row's own id (not a
    // companyId), same rationale as the GET list above — sdb.
    const [row] = await sdb
      .select()
      .from(schema.tenantEmailDomains)
      .where(eq(schema.tenantEmailDomains.id, id))
      .limit(1);
    if (!row) return c.json({ message: "not found" }, 404);
    if (!row.resendDomainId)
      return c.json({ message: "Not approved yet" }, 409);
    const updated = await triggerVerify(id);
    if (!updated) return c.json({ message: "not found" }, 404);
    return c.json({ domain: { ...updated, records: safeParse(updated.records) } }, 200);
  })

  // Reject / remove a domain (also deletes it in Resend).
  .delete("/email-domains/:id", requireSuperadmin, async (c) => {
    const me = c.get("user") as SessionUser;
    const id = c.req.param("id");
    // Superadmin cross-tenant lookup by the domain row's own id (not a
    // companyId), same rationale as the GET list above — sdb.
    const [row] = await sdb
      .select()
      .from(schema.tenantEmailDomains)
      .where(eq(schema.tenantEmailDomains.id, id))
      .limit(1);
    if (!row) return c.json({ message: "not found" }, 404);
    await removeDomain(id);
    await audit({
      actorId: me?.id,
      actorName: me?.name,
      action: "delete",
      entityType: "email_domain",
      entityId: id,
      summary: `Removed email domain ${row.domain} for ${row.companyId}`,
    });
    return c.json({ ok: true }, 200);
  });

function safeParse(s: string | null | undefined) {
  try {
    return JSON.parse(s || "[]");
  } catch {
    return [];
  }
}
