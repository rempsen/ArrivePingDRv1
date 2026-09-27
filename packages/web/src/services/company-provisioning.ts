/**
 * Company Provisioning — the single pipeline that turns "a name + a website +
 * an admin login" into a fully-seeded tenant: branded, industry-templated,
 * catalog-stocked, ready to sign into.
 *
 * Extracted out of the superadmin `/companies` route so it has exactly ONE
 * implementation, callable from two different front doors:
 *   - the superadmin "New Company" panel (internal, admin-driven)
 *   - the public self-serve onboarding flow (external, the client drives it
 *     themselves — see api/routes/onboarding.ts)
 * Both front doors validate against the SAME zod schemas below and call the
 * SAME `provisionCompany()`, so a client who signs themselves up gets exactly
 * the same tenant a superadmin would have built for them by hand — same
 * catalog, same starter forms/templates, same branding pipeline.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../api/database";
import * as schema from "../api/database/schema";
import { auth } from "../api/auth";
import { invalidateCompanyCache } from "../api/middleware/auth";
import { audit } from "../api/lib/audit";
import { attachMembership } from "../api/lib/memberships";
import {
  issueDefaultTenantKey,
  ensureDefaultPublicKey,
} from "../api/lib/tenant-keys";
import { Err } from "../api/lib/errors";
import {
  jsonBody as _jsonBody, // re-exported nowhere — keeps the import graph honest if this file grows route helpers later
  shortText,
  longText,
  optText,
  hexColor,
  outboundUrl,
  imageRef,
  email as emailField,
  phone,
} from "../api/lib/validate";
import { scoutStarterForms } from "./form-scout";
import { scoutStarterTemplates } from "./template-scout";
import { scoutStarterServices } from "./service-scout";
import { provisionNotificationBranding, seedNotificationRules } from "./dispatch";
import { scoutNotificationCopy } from "./notification-copy-scout";
import { getIndustryPreset } from "./industry-presets";
import { CATALOG_PRESETS } from "./catalog-presets";
import { OPTION_CATALOG_PRESETS } from "./option-catalog-presets";

void _jsonBody; // (import kept intentionally unused-safe; see note above)

/* -------------------------------------------------------------------------- */
/*  Shared schemas                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A user-typed website ("acme.com" or "https://acme.com") normalized to a
 * fetchable https URL, then run through `outboundUrl()` — which blocks
 * `javascript:`, loopback, link-local and RFC1918 space, since this URL is
 * fetched BY THE SERVER (brand-scout). Shared by every entry point that
 * accepts a website to scrape: the superadmin panel and the public
 * onboarding flow.
 */
export const websiteUrlSchema = z.preprocess(
  (v) =>
    typeof v === "string" && v.trim() && !/^[a-z][a-z0-9+.-]*:/i.test(v.trim())
      ? `https://${v.trim()}`
      : v,
  outboundUrl("Website"),
);

/** Terminology + footer details the AI scout proposes, all optional. */
export const BrandProposal = z
  .object({
    primaryColor: hexColor("Primary colour").nullable(),
    accentColor: hexColor("Accent colour").nullable(),
    // Rendered in an <img src> in-app AND in email headers.
    logoUrl: imageRef("Logo URL").nullable(),
    logoSourceUrl: imageRef("Logo source URL").nullable(),
    workerNoun: shortText("Worker noun", 40).nullable(),
    workerNounPlural: shortText("Worker noun (plural)", 40).nullable(),
    customerNoun: shortText("Customer noun", 40).nullable(),
    customerNounPlural: shortText("Customer noun (plural)", 40).nullable(),
    jobNoun: shortText("Job noun", 40).nullable(),
    jobNounPlural: shortText("Job noun (plural)", 40).nullable(),
    tagline: longText(300).nullable(),
    hours: longText(300).nullable(),
    address: longText(300).nullable(),
    // Freeform description of where this tenant actually does work — "Winnipeg
    // and the Capital Region, up to ~50km out" — read off the scraped site (a
    // service-area page, a "areas we serve" list, city names in the footer) or
    // filled in during the onboarding conversation. Stored as-is; the Service
    // Zones feature (polygon/radius drawing) stays a separate, precise, manual
    // step for tenants who want geofenced auto-arrive — this is just the
    // starting context so the tenant isn't staring at a blank zones page.
    serviceArea: longText(300).nullable(),
    email: emailField("Contact email").nullable(),
    phone: phone.nullable(),
    website: longText(300).nullable(),
    services: z.union([z.string().max(20_000), z.array(z.unknown()).max(200), z.record(z.string(), z.unknown())]).nullable(),
    socials: z.union([z.string().max(5_000), z.record(z.string(), z.unknown())]).nullable(),
  })
  .partial()
  // brand-scout returns explicit nulls for anything it couldn't read off the
  // site, and callers submit that proposal object as-is. Nulls must be
  // accepted (and are ignored downstream) or the whole onboarding flow 400s.
  .transform((b) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(b)) if (v !== null && v !== undefined) out[k] = v;
    return out as typeof b;
  });

export const CompanyCreateBody = z.object({
  name: shortText("Company name", 200),
  slug: optText(80),
  contactEmail: z.union([emailField("Contact email"), z.literal("")]).optional(),
  phone: phone.optional(),
  plan: z.enum(["starter", "pro", "enterprise"], { error: "Unknown plan" }).optional(),
  industry: optText(80),
  industryOther: optText(200),
  // The tenant's own marketing site. Stored and displayed, never fetched by
  // this route — brand-scout is the one that fetches, and it uses the
  // stricter `websiteUrlSchema` above.
  website: longText(300).optional(),
  adminName: optText(200),
  adminEmail: emailField("Admin email"),
  // better-auth's own minimum. Enforced here so provisioning fails loudly at
  // the edge instead of half-way through creating a tenant.
  adminPassword: z.string().min(8, "Admin password must be at least 8 characters").max(200),
  managerName: optText(200),
  managerEmail: z.union([emailField("Manager email"), z.literal("")]).optional(),
  managerPassword: z.union([z.string().min(8, "Manager password must be at least 8 characters").max(200), z.literal("")]).optional(),
  brand: BrandProposal.optional(),
});
export type CompanyCreateInput = z.infer<typeof CompanyCreateBody>;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

/** normalize a free-text name into a url-safe slug */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Load curated deep-research knowledge for an ICP (icpKnowledgeBase), if any
 * exists. Returns null for industries not yet researched — callers must
 * degrade gracefully (template-scout/form-scout already do).
 */
export async function loadIcpKnowledge(industry: string) {
  if (!industry || industry === "other") return null;
  const [row] = await db
    .select()
    .from(schema.icpKnowledgeBase)
    .where(eq(schema.icpKnowledgeBase.industry, industry));
  if (!row) return null;
  const parseArr = (s: string) => {
    try {
      const a = JSON.parse(s || "[]");
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  };
  return {
    summary: row.summary || null,
    bestPractices: parseArr(row.bestPractices) as string[],
    workflowNotes: row.workflowNotes || null,
    terminologyNotes: row.terminologyNotes || null,
    toneRefinement: row.toneRefinement || null,
    notificationRefinement: row.notificationRefinement || null,
    complianceNotes: row.complianceNotes || null,
  };
}

/**
 * Seed the CATALOG (schema.catalogItems) for a company from its industry preset.
 * Inserts every non-assembly first, maps each preset `key` → real row id, then
 * inserts assemblies with `components` resolved to [{ itemId, qty }]. Idempotent
 * is the caller's responsibility (only call when the catalog is empty). Returns
 * the number of rows inserted.
 */
export async function seedCatalogForCompany(
  companyId: string,
  industryId: string,
): Promise<number> {
  const items = CATALOG_PRESETS[industryId];
  if (!items || items.length === 0) return 0;

  const keyToId: Record<string, string> = {};
  let inserted = 0;

  // Pass 1 — non-assemblies (so their ids exist for component resolution).
  for (const it of items) {
    if (it.kind === "assembly") continue;
    const [row] = await db
      .insert(schema.catalogItems)
      .values({
        companyId,
        kind: it.kind,
        name: it.name,
        sku: it.sku,
        category: it.category,
        description: it.description,
        image: it.image,
        unit: it.unit,
        unitCost: it.unitCost,
        markupPct: it.markupPct,
        priceMode: "auto",
        unitPrice: 0,
        taxable: it.taxable,
        components: "[]",
        active: true,
      })
      .returning({ id: schema.catalogItems.id });
    if (row) {
      keyToId[it.key] = row.id;
      inserted++;
    }
  }

  // Pass 2 — assemblies, resolving component keys to the ids inserted above.
  for (const it of items) {
    if (it.kind !== "assembly") continue;
    const components = (it.components ?? [])
      .map((c) => {
        const itemId = keyToId[c.key];
        return itemId ? { itemId, qty: c.qty } : null;
      })
      .filter((c): c is { itemId: string; qty: number } => c !== null);
    const [row] = await db
      .insert(schema.catalogItems)
      .values({
        companyId,
        kind: "assembly",
        name: it.name,
        sku: it.sku,
        category: it.category,
        description: it.description,
        image: it.image,
        unit: it.unit,
        unitCost: 0,
        markupPct: 0,
        priceMode: "auto",
        unitPrice: 0,
        taxable: it.taxable,
        components: JSON.stringify(components),
        active: true,
      })
      .returning({ id: schema.catalogItems.id });
    if (row) {
      keyToId[it.key] = row.id;
      inserted++;
    }
  }

  return inserted;
}

/**
 * Seed the OPTIONS/TIER CATALOG (schema.optionCategories + optionCategoryItems)
 * for a company from its industry preset — the generalized options/tier quote
 * engine. Idempotent is the caller's responsibility (only call when empty).
 * Returns the number of category rows inserted.
 */
export async function seedOptionCatalogForCompany(
  companyId: string,
  industryId: string,
): Promise<number> {
  const categories = OPTION_CATALOG_PRESETS[industryId];
  if (!categories || categories.length === 0) return 0;

  let inserted = 0;
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const [catRow] = await db
      .insert(schema.optionCategories)
      .values({
        companyId,
        name: cat.name,
        description: cat.description,
        sortOrder: i,
        active: true,
      })
      .returning({ id: schema.optionCategories.id });
    if (!catRow) continue;
    inserted++;
    for (let j = 0; j < cat.tiers.length; j++) {
      const tier = cat.tiers[j];
      await db.insert(schema.optionCategoryItems).values({
        companyId,
        categoryId: catRow.id,
        tierLabel: tier.tierLabel,
        name: tier.name,
        description: tier.description,
        priceDelta: tier.priceDelta,
        unitCost: 0,
        isDefault: tier.isDefault,
        sortOrder: j,
        active: true,
      });
    }
  }

  return inserted;
}

/**
 * Create (or upgrade) a user with a given role + tenant. Returns the user id.
 * Mirrors the create-superadmin / team provisioning pattern: sign up via
 * better-auth (which may default the role), then stamp role + companyId.
 */
export async function ensureUser(opts: {
  name: string;
  email: string;
  password: string;
  role: string;
  companyId: string;
}): Promise<{ id: string; reused: boolean }> {
  const [existing] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, opts.email));
  if (existing) {
    await db
      .update(schema.user)
      .set({ role: opts.role, companyId: opts.companyId, name: opts.name })
      .where(eq(schema.user.id, existing.id));
    await attachMembership({
      userId: existing.id,
      companyId: opts.companyId,
      role: opts.role,
      status: "active",
    });
    return { id: existing.id, reused: true };
  }
  await auth.api.signUpEmail({
    body: {
      name: opts.name,
      email: opts.email,
      password: opts.password,
      role: opts.role,
    } as any,
  });
  const [u] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, opts.email));
  if (!u) throw new Error(`could not find user after signup: ${opts.email}`);
  await db
    .update(schema.user)
    .set({ role: opts.role, companyId: opts.companyId })
    .where(eq(schema.user.id, u.id));
  await attachMembership({
    userId: u.id,
    companyId: opts.companyId,
    role: opts.role,
    status: "active",
  });
  return { id: u.id, reused: false };
}

/* -------------------------------------------------------------------------- */
/*  The pipeline                                                              */
/* -------------------------------------------------------------------------- */

export interface ProvisionActor {
  /** Superadmin user id when a superadmin is doing this by hand; undefined
   *  for self-serve signups (no internal user acted). */
  id?: string;
  name?: string;
}

export interface ProvisionResult {
  company: typeof schema.companies.$inferSelect;
  admin: { id: string; email: string };
  manager: { id: string; email: string } | null;
  /** Raw secret API key — returned ONCE, caller must show/store it now. */
  apiKey: { prefix: string; secret: string };
  /** What actually got seeded, so a UI can show "we set up N catalog items…" */
  seeded: {
    forms: number;
    templates: number;
    services: number;
    catalogItems: number;
    optionCategories: number;
    notificationCopyBranded: number;
  };
}

/**
 * Provision a brand-new tenant end-to-end: the company row, branded settings,
 * notification identity, starter forms/templates/services, the priced catalog
 * + options engine, and the admin (+ optional manager) login. Every AI
 * generation step is best-effort and non-blocking — provisioning succeeds even
 * if brand-scout's cousins (template/form/service scout) fail, degrading to
 * the static IndustryPreset defaults.
 *
 * Throws `AppError` (via `Err.*`) for validation-shaped failures (slug/email
 * collisions, missing credentials) — safe to let bubble to the global error
 * handler from any route that calls this.
 */
export async function provisionCompany(
  b: CompanyCreateInput,
  actor: ProvisionActor,
  opts?: { source?: "superadmin" | "self_serve" },
): Promise<ProvisionResult> {
  const source = opts?.source ?? "superadmin";
  const name = b.name;

  // slug = tenant id, stamped everywhere. derive from name unless supplied.
  const slug = slugify(String(b.slug ?? "") || name);
  if (!slug) throw Err.badRequest("Could not derive a valid slug");

  // reject collision with an existing tenant
  const [dupe] = await db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.id, slug));
  if (dupe) throw Err.conflict(`A company with slug "${slug}" already exists`);

  const adminEmail = String(b.adminEmail ?? "").trim().toLowerCase();
  const adminPassword = String(b.adminPassword ?? "");
  const adminName = String(b.adminName ?? "").trim() || `${name} Admin`;
  if (!adminEmail || !adminPassword)
    throw Err.badRequest("Admin email and password are required");

  const managerEmail = String(b.managerEmail ?? "").trim().toLowerCase();
  const managerPassword = String(b.managerPassword ?? "");
  const managerName = String(b.managerName ?? "").trim() || `${name} Manager`;
  const wantManager = Boolean(managerEmail && managerPassword);

  // guard: emails not already in use
  for (const email of [adminEmail, ...(wantManager ? [managerEmail] : [])]) {
    const [u] = await db.select().from(schema.user).where(eq(schema.user.email, email));
    if (u) throw Err.conflict(`Email already in use: ${email}`);
  }

  // Primary Industry (ICP) — drives templates + service library presets.
  // "other" is a valid sentinel (no preset fits) paired with a free-text
  // description in industryOther, so future/unknown client types aren't
  // forced into an ill-fitting bucket.
  const industryRaw = String(b.industry ?? "").trim();
  const preset = getIndustryPreset(industryRaw);
  const industryOther = String(b.industryOther ?? "").trim();
  const resolvedIndustry = preset?.id ?? (industryRaw === "other" ? "other" : "");
  // Deep per-ICP research (trade publications, standards bodies) — only a
  // handful of pilot industries have this curated yet; null is expected and
  // handled gracefully for the rest.
  const icpKnowledge = await loadIcpKnowledge(resolvedIndustry).catch(() => null);

  // 1) insert the tenant row (id = slug = companyId)
  await db.insert(schema.companies).values({
    id: slug,
    name,
    contactEmail: String(b.contactEmail ?? "").trim(),
    phone: String(b.phone ?? "").trim(),
    plan: b.plan ?? "starter",
    industry: resolvedIndustry,
    industryOther: resolvedIndustry === "other" ? industryOther : "",
    status: "active",
    createdBy: actor.id ?? "",
  });

  // 2) seed the tenant's company_settings row (PK = slug to avoid collision).
  //    Fold in any reviewed AI brand data (from "Grab Brand Assets" / the
  //    self-serve website scan) so the tenant starts fully branded — colors,
  //    logo, terminology, service area, footer details. Terminology fallback
  //    chain: what the AI actually read off their site first, then the ICP
  //    preset's fitting default (e.g. "Plumber" not a generic "Technician"),
  //    then a neutral platform default last.
  const brand = (b.brand ?? {}) as Record<string, any>;
  const str = (v: any, fb = "") => (typeof v === "string" && v.trim() ? v.trim() : fb);
  const jsonStr = (v: any) => {
    if (v == null) return "";
    try {
      return typeof v === "string" ? v : JSON.stringify(v);
    } catch {
      return "";
    }
  };
  await db.insert(schema.companySettings).values({
    id: slug,
    companyId: slug,
    name,
    email: str(brand.email, String(b.contactEmail ?? "").trim()),
    phone: str(brand.phone, String(b.phone ?? "").trim()),
    website: str(b.website),
    address: str(brand.address, undefined as any) || undefined,
    logo: str(brand.logoUrl),
    brandColor: str(brand.primaryColor, "#06B6D4"),
    accentColor: str(brand.accentColor),
    workerNoun: str(brand.workerNoun, preset?.workerNoun ?? "Technician"),
    workerNounPlural: str(brand.workerNounPlural, preset?.workerNounPlural ?? "Technicians"),
    customerNoun: str(brand.customerNoun, preset?.customerNoun ?? "Customer"),
    customerNounPlural: str(brand.customerNounPlural, preset?.customerNounPlural ?? "Customers"),
    jobNoun: str(brand.jobNoun, preset?.jobNoun ?? "Job"),
    jobNounPlural: str(brand.jobNounPlural, preset?.jobNounPlural ?? "Jobs"),
    tagline: str(brand.tagline),
    serviceArea: str(brand.serviceArea),
    services: jsonStr(brand.services),
    hours: str(brand.hours),
    socials: jsonStr(brand.socials),
  });

  // 2b) auto-provision branded notifications/email/SMS identity so every
  //     message this tenant sends carries their logo, color & contact footer.
  await provisionNotificationBranding({
    companyId: slug,
    name,
    logoUrl: str(brand.logoUrl),
    brandColor: str(brand.primaryColor, "#06B6D4"),
    legalName: name,
    address: str(brand.address),
    phone: str(brand.phone, String(b.phone ?? "").trim()),
    email: str(brand.email, String(b.contactEmail ?? "").trim()),
    website: str(b.website),
  }).catch((e) => console.error("[provisioning] brand provisioning failed", e));

  // 2b-2) generate BRANDED, industry-tuned SMS/email copy for this tenant
  //     (grounded in the ICP research + the tenant's own scraped site) and
  //     seed the rule matrix with it immediately, so this tenant never sees
  //     the generic platform copy even before an admin opens Notification
  //     Settings. Best-effort/non-blocking: on any failure seedNotificationRules
  //     still runs with no overrides, which is exactly today's generic behavior.
  let notificationCopyBranded = 0;
  try {
    const copyMap = await scoutNotificationCopy({
      name,
      industry: resolvedIndustry || null,
      industryOther: resolvedIndustry === "other" ? industryOther : null,
      website: str(b.website) || null,
      description: str(brand.description) || str(brand.tagline) || null,
      services: Array.isArray(brand.services)
        ? brand.services
        : typeof brand.services === "string" && brand.services.trim()
          ? brand.services.split(/[\n,;|]/).map((s: string) => s.trim()).filter(Boolean)
          : [],
      workerNoun: str(brand.workerNoun, preset?.workerNoun ?? "Technician"),
      workerNounPlural: str(brand.workerNounPlural, preset?.workerNounPlural ?? "Technicians"),
      customerNoun: str(brand.customerNoun, preset?.customerNoun ?? "Customer"),
      jobNoun: str(brand.jobNoun, preset?.jobNoun ?? "Job"),
      brandColor: str(brand.primaryColor, "#06B6D4"),
      knowledge: icpKnowledge,
    });
    notificationCopyBranded = Object.keys(copyMap).length;
    await seedNotificationRules(slug, copyMap as any);
    console.log(`[provisioning] seeded notification rules for "${slug}" — ${notificationCopyBranded} branded (${source})`);
  } catch (e) {
    console.error("[provisioning] notification-copy seeding failed", e);
    await seedNotificationRules(slug).catch((e2) => console.error("[provisioning] fallback notification seeding also failed", e2));
  }

  const servicesArr: string[] = Array.isArray(brand.services)
    ? brand.services
    : typeof brand.services === "string" && brand.services.trim()
      ? brand.services.split(/[\n,;|]/).map((s: string) => s.trim()).filter(Boolean)
      : [];

  // 2c) auto-seed 2-3 industry-appropriate starter intake forms based on the
  //     company's services/website so the tenant's Form Creator isn't empty.
  //     AI-generated; falls back to generic forms on any failure. Best-effort
  //     and non-blocking — provisioning must still succeed if this fails.
  let formsSeeded = 0;
  try {
    const starters = await scoutStarterForms({
      name,
      industry: resolvedIndustry || null,
      industryOther: resolvedIndustry === "other" ? industryOther : null,
      services: servicesArr,
      description: str(brand.description) || str(brand.tagline) || null,
      website: str(b.website) || null,
      workerNoun: str(brand.workerNoun, preset?.workerNoun ?? "Technician"),
      customerNoun: str(brand.customerNoun, preset?.customerNoun ?? "Customer"),
      knowledge: icpKnowledge,
    });
    const brandColor = str(brand.primaryColor, "#06B6D4");
    const logoUrl = str(brand.logoUrl);
    // auto-issue + bind a public (form-submit) key so the seeded forms are
    // immediately publishable — no manual "bind a key" step needed.
    let publicKeyId = "";
    try {
      const pub = await ensureDefaultPublicKey({
        companyId: slug,
        createdBy: actor.id,
        createdByName: actor.name,
      });
      publicKeyId = pub.id;
    } catch (e) {
      console.error("[provisioning] public key provisioning failed", e);
    }
    const usedSlugs = new Set<string>();
    for (const f of starters) {
      let s = f.slug;
      let i = 2;
      while (usedSlugs.has(s)) s = `${f.slug}-${i++}`;
      usedSlugs.add(s);
      await db.insert(schema.intakeForms).values({
        companyId: slug,
        slug: s,
        title: f.title,
        intro: f.intro,
        fields: JSON.stringify(f.fields),
        publicKeyId,
        brandColor,
        logoUrl,
        successMessage: f.successMessage,
        active: true,
        createdBy: actor.id ?? "",
        updatedAt: new Date(),
      });
    }
    formsSeeded = starters.length;
    console.log(`[provisioning] seeded ${formsSeeded} starter forms for "${slug}" (${source})`);
  } catch (e) {
    console.error("[provisioning] starter-form seeding failed", e);
  }

  // 2d) auto-seed 2-3 industry-appropriate WORK-ORDER templates (the Form
  //     Builder / task_templates) so the tenant's builder isn't empty —
  //     residential / commercial / service workflows tailored to their trade.
  //     AI-generated, best-effort, non-blocking; falls back to generics.
  let templatesSeeded = 0;
  try {
    const tpls = await scoutStarterTemplates({
      name,
      industry: resolvedIndustry || null,
      industryOther: resolvedIndustry === "other" ? industryOther : null,
      services: servicesArr,
      description: str(brand.description) || str(brand.tagline) || null,
      website: str(b.website) || null,
      workerNoun: str(brand.workerNoun, preset?.workerNoun ?? "Technician"),
      customerNoun: str(brand.customerNoun, preset?.customerNoun ?? "Customer"),
      brandColor: str(brand.primaryColor, "#06B6D4"),
      knowledge: icpKnowledge,
    });
    for (const t of tpls) {
      await db.insert(schema.taskTemplates).values({
        companyId: slug,
        name: t.name,
        category: t.category,
        icon: t.icon,
        color: t.color,
        description: t.description,
        fields: JSON.stringify(t.fields),
        checklist: JSON.stringify(t.checklist),
        estimatedMins: t.estimatedMins,
        rateModel: JSON.stringify(t.rateModel),
        active: true,
      });
    }
    templatesSeeded = tpls.length;
    console.log(`[provisioning] seeded ${templatesSeeded} work-order templates for "${slug}" (${source})`);
  } catch (e) {
    console.error("[provisioning] starter-template seeding failed", e);
  }

  // 2e) auto-seed the SERVICE LIBRARY (schema.services), tailored to the
  //     tenant's OWN scraped website services where available (falls back to
  //     the plain ICP preset list when there's no scrape data or the model
  //     call fails). Best-effort, non-blocking.
  let servicesSeeded = 0;
  if (preset || servicesArr.length) {
    try {
      const tailored = await scoutStarterServices({
        name,
        industry: resolvedIndustry || null,
        industryOther: resolvedIndustry === "other" ? industryOther : null,
        services: servicesArr,
        description: str(brand.description) || str(brand.tagline) || null,
        website: str(b.website) || null,
        knowledge: icpKnowledge,
      });
      for (const s of tailored) {
        await db.insert(schema.services).values({
          companyId: slug,
          name: s.name,
          category: s.category,
          durationMins: s.durationMins,
          active: true,
        });
      }
      servicesSeeded = tailored.length;
      console.log(
        `[provisioning] seeded ${servicesSeeded} services (${preset?.id ?? "scraped, no preset"}) for "${slug}" (${source})`,
      );
    } catch (e) {
      console.error("[provisioning] service-library seeding failed", e);
    }
  }

  // 2f) auto-seed the CATALOG (schema.catalogItems) from the industry preset so
  //     the tenant opens the Catalog with ≥12 priced products/services/assemblies.
  //     Best-effort, non-blocking.
  let catalogSeeded = 0;
  if (preset?.id) {
    try {
      catalogSeeded = await seedCatalogForCompany(slug, preset.id);
      if (catalogSeeded > 0)
        console.log(`[provisioning] seeded ${catalogSeeded} catalog items (${preset.id}) for "${slug}" (${source})`);
    } catch (e) {
      console.error("[provisioning] catalog seeding failed", e);
    }
  }

  // 2g) auto-seed the OPTIONS/TIER CATALOG (schema.optionCategories) from the
  //     industry preset — the generalized options/tier quote engine wedge.
  //     Best-effort, non-blocking.
  let optionCategoriesSeeded = 0;
  if (preset?.id) {
    try {
      optionCategoriesSeeded = await seedOptionCatalogForCompany(slug, preset.id);
      if (optionCategoriesSeeded > 0)
        console.log(`[provisioning] seeded ${optionCategoriesSeeded} option categories (${preset.id}) for "${slug}" (${source})`);
    } catch (e) {
      console.error("[provisioning] option-catalog seeding failed", e);
    }
  }

  // 3) provision the admin + (optional) manager accounts
  const admin = await ensureUser({
    name: adminName,
    email: adminEmail,
    password: adminPassword,
    role: "admin",
    companyId: slug,
  });
  let manager: { id: string } | null = null;
  if (wantManager) {
    manager = await ensureUser({
      name: managerName,
      email: managerEmail,
      password: managerPassword,
      role: "manager",
      companyId: slug,
    });
  }

  // 4) auto-issue this tenant's unique, full-scope secret API key. Locked to
  //    this companyId — every read/write through it can only ever touch this
  //    one tenant. Raw key shown ONCE (caller must display/store it now).
  const tenantKey = await issueDefaultTenantKey({
    companyId: slug,
    createdBy: actor.id,
    createdByName: actor.name,
  });

  // role->permission catalog is global; nothing to seed per-tenant.
  // refresh the allow-list cache so the new tenant is switchable now.
  invalidateCompanyCache();

  await audit({
    actorId: actor.id,
    actorName: actor.name ?? (source === "self_serve" ? "Self-serve signup" : undefined),
    action: "create",
    entityType: "company",
    entityId: slug,
    summary: `Provisioned tenant "${name}" (${source === "self_serve" ? "self-serve signup" : "superadmin"}; admin ${adminEmail}${
      wantManager ? `, manager ${managerEmail}` : ""
    })`,
    companyId: slug,
  });

  const [row] = await db.select().from(schema.companies).where(eq(schema.companies.id, slug));
  if (!row) throw Err.internal("Company vanished immediately after insert");

  return {
    company: row,
    admin: { id: admin.id, email: adminEmail },
    manager: manager ? { id: manager.id, email: managerEmail } : null,
    apiKey: { prefix: tenantKey.prefix, secret: tenantKey.raw },
    seeded: {
      forms: formsSeeded,
      templates: templatesSeeded,
      services: servicesSeeded,
      catalogItems: catalogSeeded,
      optionCategories: optionCategoriesSeeded,
      notificationCopyBranded,
    },
  };
}
