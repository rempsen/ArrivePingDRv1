/**
 * HubSpot CRM mirror for tenants.
 *
 * Every self-serve tenant exists in NVC360's HubSpot as one Company, one
 * Contact per staff member, and one Deal in the Sales Pipeline (the "lead").
 * The Deal is created at signup at the "Contract / Trial" stage and follows
 * the subscription: Closed Won when the first invoice is paid, Closed Lost
 * when the trial is cancelled or the account closed.
 *
 * Afterwards everything the tenant tells us — company settings, the
 * onboarding chat's answers, staff added or removed, billing changes — is
 * pushed again. Two mechanisms keep that honest without hooking every write
 * path by hand:
 *
 *   1. `queueCompanySync(companyId)` is called after any successful mutating
 *      request for a tenant (api/index.ts middleware) and directly from
 *      signup/billing. It coalesces bursts (8 s) and never runs more than once
 *      a minute per tenant.
 *   2. A sweep every 30 min re-checks every eligible tenant.
 *
 * Both are cheap because the payload is fingerprinted: when nothing HubSpot
 * cares about has changed, no API call is made.
 *
 * Which tenants: any company that already has a HubSpot id, or any company
 * on self-serve billing (billingCustomerId). Hand-made demo tenants are
 * left alone unless pushed explicitly (superadmin "Sync to HubSpot").
 *
 * Config: HUBSPOT_ACCESS_TOKEN (a Private App token with crm.objects.
 * companies/contacts/deals read+write and crm.schemas.* write), optional
 * HUBSPOT_OWNER_ID (owner stamped on new records), HUBSPOT_SYNC_ALL=1 to
 * include every tenant. Missing token = feature off, silently.
 */
import { eq, isNotNull, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, sdb } from "../api/database";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { log } from "../api/lib/logger";
import { monthlyPrice } from "../web/site/config";
import { industryLabel } from "./industry-presets";

export const HUBSPOT_API = "https://api.hubapi.com";
const APP_URL = (process.env.APP_URL ?? "https://arriveping.com").replace(/\/$/, "");
const PROPERTY_GROUP = "arriveping";

/* ---------------------------------------------------------------- config */

export function hubspotEnabled(): boolean {
  return Boolean(process.env.HUBSPOT_ACCESS_TOKEN?.trim());
}

function ownerId(): string | undefined {
  const v = process.env.HUBSPOT_OWNER_ID?.trim();
  return v || undefined;
}

/* ------------------------------------------------------------- transport */

type Fetch = typeof fetch;
let fetchImpl: Fetch = fetch;
/** Tests swap the transport. */
export function _setHubspotFetch(f: Fetch | null): void {
  fetchImpl = f ?? fetch;
}

export class HubSpotError extends Error {
  constructor(
    public status: number,
    public body: string,
    public path: string,
  ) {
    super(`HubSpot ${status} on ${path}: ${body.slice(0, 300)}`);
  }
}

async function hs<T = any>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN not set");
  const res = await fetchImpl(`${HUBSPOT_API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 429 && attempt < 2) {
    const wait = Number(res.headers.get("retry-after") ?? 2) * 1000;
    await new Promise((r) => setTimeout(r, Math.min(wait, 10_000)));
    return hs(method, path, body, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new HubSpotError(res.status, text, path);
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Archive (HubSpot's soft delete) a contact — used when a person deletes
 * their ArrivePing account. No-op when HubSpot isn't configured.
 */
export async function archiveHubspotContact(contactId: string): Promise<void> {
  if (!hubspotEnabled() || !contactId) return;
  try {
    await hs("DELETE", `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`);
  } catch (e) {
    if (e instanceof HubSpotError && e.status === 404) return;
    throw e;
  }
}

/* ------------------------------------------------- custom property setup */

type PropDef = { name: string; label: string; type: "string" | "number" | "date" | "bool" | "enumeration"; fieldType: string; options?: { label: string; value: string }[] };

const yesNo = { type: "bool" as const, fieldType: "booleancheckbox", options: [{ label: "Yes", value: "true" }, { label: "No", value: "false" }] };

export const CUSTOM_PROPERTIES: Record<"companies" | "contacts" | "deals", PropDef[]> = {
  companies: [
    { name: "arriveping_company_id", label: "ArrivePing tenant id", type: "string", fieldType: "text" },
    { name: "arriveping_dashboard_url", label: "ArrivePing dashboard", type: "string", fieldType: "text" },
    { name: "arriveping_industry", label: "ArrivePing industry", type: "string", fieldType: "text" },
    { name: "arriveping_status", label: "ArrivePing account status", type: "string", fieldType: "text" },
    { name: "arriveping_billing_status", label: "ArrivePing billing status", type: "string", fieldType: "text" },
    { name: "arriveping_billing_seats", label: "ArrivePing paid users", type: "number", fieldType: "number" },
    { name: "arriveping_monthly_amount", label: "ArrivePing monthly amount (USD)", type: "number", fieldType: "number" },
    { name: "arriveping_trial_ends", label: "ArrivePing trial ends", type: "date", fieldType: "date" },
    { name: "arriveping_signed_up", label: "ArrivePing signed up", type: "date", fieldType: "date" },
    { name: "arriveping_onboarding_done", label: "ArrivePing onboarding finished", ...yesNo },
    { name: "arriveping_staff_count", label: "ArrivePing office users", type: "number", fieldType: "number" },
    { name: "arriveping_driver_count", label: "ArrivePing drivers/technicians", type: "number", fieldType: "number" },
    { name: "arriveping_terminology", label: "ArrivePing terminology", type: "string", fieldType: "text" },
    { name: "arriveping_services", label: "ArrivePing services", type: "string", fieldType: "textarea" },
    { name: "arriveping_service_area", label: "ArrivePing service area", type: "string", fieldType: "text" },
    { name: "arriveping_hours", label: "ArrivePing hours", type: "string", fieldType: "textarea" },
  ],
  contacts: [
    { name: "arriveping_company_id", label: "ArrivePing tenant id", type: "string", fieldType: "text" },
    { name: "arriveping_user_id", label: "ArrivePing user id", type: "string", fieldType: "text" },
    { name: "arriveping_role", label: "ArrivePing role", type: "string", fieldType: "text" },
    { name: "arriveping_member_status", label: "ArrivePing membership status", type: "string", fieldType: "text" },
    // Set on contacts created from the website's "contact me" choice (services/contact-request.ts).
    { name: "arriveping_lead_source", label: "ArrivePing lead source", type: "string", fieldType: "text" },
  ],
  deals: [{ name: "arriveping_company_id", label: "ArrivePing tenant id", type: "string", fieldType: "text" }],
};

let propertiesReady: Promise<void> | null = null;
/** Create the `arriveping` property group + custom properties once per process (409 = already there). */
export function ensureProperties(): Promise<void> {
  if (!propertiesReady) {
    propertiesReady = (async () => {
      for (const objectType of Object.keys(CUSTOM_PROPERTIES) as (keyof typeof CUSTOM_PROPERTIES)[]) {
        await hs("POST", `/crm/v3/properties/${objectType}/groups`, { name: PROPERTY_GROUP, label: "ArrivePing" }).catch((e) => {
          if (!(e instanceof HubSpotError && e.status === 409)) throw e;
        });
        const existing = await hs<{ results: { name: string }[] }>("GET", `/crm/v3/properties/${objectType}?archived=false`);
        const have = new Set(existing.results.map((p) => p.name));
        for (const p of CUSTOM_PROPERTIES[objectType]) {
          if (have.has(p.name)) continue;
          await hs("POST", `/crm/v3/properties/${objectType}`, { ...p, groupName: PROPERTY_GROUP }).catch((e) => {
            if (!(e instanceof HubSpotError && e.status === 409)) throw e;
          });
        }
      }
    })().catch((e) => {
      propertiesReady = null; // try again next time
      throw e;
    });
  }
  return propertiesReady;
}
export function _resetHubspotForTests(): void {
  propertiesReady = null;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  lastRun.clear();
}

/* ---------------------------------------------------------- the payload */

type Props = Record<string, string>;

export interface SyncPlan {
  company: Props;
  companyOnCreate: Props;
  contacts: { membershipId: string; userId: string; email: string; props: Props; onCreate: Props; hubspotContactId: string | null }[];
  deal: { props: Props; onCreate: Props; stage: string };
}

const STAGE_BY_BILLING: Record<string, string> = {
  none: "qualifiedtobuy",
  trialing: "contractsent",
  active: "closedwon",
  past_due: "closedwon",
  unpaid: "closedlost",
  canceled: "closedlost",
};
const CLOSED_STAGES = new Set(["closedwon", "closedlost"]);

function domainOf(url: string): string {
  const s = url.trim();
  if (!s) return "";
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
function dateProp(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}
function jsonList(s: string): string {
  try {
    const v = JSON.parse(s || "[]");
    if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : x?.name ?? "")).filter(Boolean).join(", ");
    if (v && typeof v === "object") return Object.values(v).map(String).join(", ");
  } catch {}
  return String(s ?? "");
}
function hoursText(s: string): string {
  try {
    const v = JSON.parse(s || "");
    if (Array.isArray(v)) return v.map((d: any) => (d?.day ? `${d.day} ${d.open ?? ""}-${d.close ?? ""}` : "")).filter(Boolean).join("; ");
  } catch {}
  return String(s ?? "");
}
const ROLE_LABELS: Record<string, string> = {
  superadmin: "Owner",
  admin: "Administrator",
  manager: "Manager",
  dispatcher: "Dispatcher",
  project_manager: "Project manager",
};
function splitName(u: { name: string; firstName: string | null; lastName: string | null }): [string, string] {
  if (u.firstName || u.lastName) return [u.firstName ?? "", u.lastName ?? ""];
  const parts = (u.name ?? "").trim().split(/\s+/);
  return [parts[0] ?? "", parts.slice(1).join(" ")];
}

/** Everything HubSpot should know about a tenant, computed from the DB. */
export async function buildSyncPlan(companyId: string): Promise<SyncPlan | null> {
  const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
  if (!co) return null;
  const t = tdb(companyId);
  const settings = await t.selectOne(schema.companySettings).catch(() => null);
  const [members, users, riders] = await Promise.all([
    t.select(schema.memberships),
    t.select(schema.user),
    t.select(schema.riders).catch(() => [] as (typeof schema.riders.$inferSelect)[]),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const staff = members.filter((m) => m.role !== "customer" && m.status !== "removed");
  const drivers = riders.filter((r) => r.approval === "active").length;
  const office = staff.filter((m) => m.role !== "rider").length;
  const seats = Math.max(co.billingSeats, 0);
  const amount = monthlyPrice(Math.max(seats, 1)).total;
  const website = settings?.website || "";
  const industry = co.industry === "other" ? co.industryOther || "Other" : industryLabel(co.industry) || co.industry;
  const nouns = settings ? `${settings.workerNoun} / ${settings.customerNoun} / ${settings.jobNoun}` : "";

  const company: Props = {
    name: co.name,
    domain: domainOf(website),
    website,
    phone: settings?.phone || co.phone || "",
    address: settings?.address || co.officeAddress || "",
    timezone: settings?.timezone || "",
    description: [settings?.tagline, settings?.description].filter(Boolean).join(" — ").slice(0, 2000),
    numberofemployees: String(office + drivers),
    arriveping_company_id: co.id,
    arriveping_dashboard_url: `${APP_URL}/admin?company=${encodeURIComponent(co.id)}`,
    arriveping_industry: industry,
    arriveping_status: co.status,
    arriveping_billing_status: co.billingStatus,
    arriveping_billing_seats: String(seats),
    arriveping_monthly_amount: String(amount),
    arriveping_trial_ends: dateProp(co.billingTrialEndsAt),
    arriveping_signed_up: dateProp(co.createdAt),
    arriveping_onboarding_done: co.onboardingCompletedAt ? "true" : "false",
    arriveping_staff_count: String(office),
    arriveping_driver_count: String(drivers),
    arriveping_terminology: nouns,
    arriveping_services: jsonList(settings?.services ?? "").slice(0, 2000),
    arriveping_service_area: settings?.serviceArea || "",
    arriveping_hours: hoursText(settings?.hours ?? "").slice(0, 1000),
  };
  const isCustomer = co.billingStatus === "active" || co.billingStatus === "past_due";
  if (isCustomer) company.lifecyclestage = "customer";
  const companyOnCreate: Props = { type: "PROSPECT", lifecyclestage: "lead", hs_lead_status: "NEW" };
  if (ownerId()) companyOnCreate.hubspot_owner_id = ownerId()!;

  const contacts: SyncPlan["contacts"] = [];
  for (const m of staff) {
    const u = userById.get(m.userId);
    if (!u?.email) continue;
    // Someone who deleted their account must not be re-created as a contact.
    if (u.role === "deleted" || u.email.endsWith("@anon.arriveping.com")) continue;
    const [firstname, lastname] = splitName(u);
    const role = m.role === "rider" ? settings?.workerNoun || "Technician" : (ROLE_LABELS[m.role] ?? m.role);
    const props: Props = {
      email: u.email.toLowerCase(),
      firstname,
      lastname,
      phone: u.phone || "",
      jobtitle: role,
      company: co.name,
      website,
      arriveping_company_id: co.id,
      arriveping_user_id: u.id,
      arriveping_role: m.role,
      arriveping_member_status: m.status,
    };
    if (isCustomer) props.lifecyclestage = "customer";
    const onCreate: Props = { lifecyclestage: "lead", hs_lead_status: "New" };
    if (ownerId()) onCreate.hubspot_owner_id = ownerId()!;
    contacts.push({ membershipId: m.id, userId: u.id, email: props.email, props, onCreate, hubspotContactId: m.hubspotContactId });
  }

  const stage = STAGE_BY_BILLING[co.billingStatus] ?? "qualifiedtobuy";
  const deal: SyncPlan["deal"] = {
    stage,
    props: {
      dealname: `${co.name} — ArrivePing`,
      amount: String(amount),
      closedate: co.billingTrialEndsAt ? co.billingTrialEndsAt.toISOString() : "",
      arriveping_company_id: co.id,
    },
    onCreate: { pipeline: "default", dealtype: "newbusiness", description: `Self-serve ArrivePing signup. ${industry}. ${website}`.trim() },
  };
  if (ownerId()) deal.onCreate.hubspot_owner_id = ownerId()!;
  return { company, companyOnCreate, contacts, deal };
}

export function planFingerprint(plan: SyncPlan): string {
  return createHash("sha1")
    .update(JSON.stringify({ c: plan.company, k: plan.contacts.map((x) => [x.membershipId, x.props]), d: plan.deal }))
    .digest("hex");
}

/* --------------------------------------------------------------- pushing */

type HsObject = { id: string; properties?: Record<string, string | null> };

async function findByProperty(objectType: string, property: string, value: string, properties: string[] = []): Promise<HsObject | null> {
  const r = await hs<{ results: HsObject[] }>("POST", `/crm/v3/objects/${objectType}/search`, {
    filterGroups: [{ filters: [{ propertyName: property, operator: "EQ", value }] }],
    properties,
    limit: 1,
  });
  return r.results?.[0] ?? null;
}

async function associate(from: string, fromId: string, to: string, toId: string): Promise<void> {
  await hs("PUT", `/crm/v4/objects/${from}/${fromId}/associations/default/${to}/${toId}`);
}

/** Drop empty strings so we never blank a value a salesperson typed by hand. */
function nonEmpty(p: Props): Props {
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== "" && v != null));
}

export interface SyncResult {
  ok: boolean;
  skipped?: "disabled" | "unchanged" | "not-found";
  companyId?: string;
  hubspotCompanyId?: string;
  hubspotDealId?: string;
  contacts?: number;
  error?: string;
}

/**
 * Push one tenant to HubSpot. `force` ignores the fingerprint (manual sync).
 * Never throws; failures are logged and reported in the result.
 */
export async function syncCompanyToHubspot(companyId: string, opts: { force?: boolean } = {}): Promise<SyncResult> {
  if (!hubspotEnabled()) return { ok: true, skipped: "disabled" };
  try {
    const plan = await buildSyncPlan(companyId);
    if (!plan) return { ok: false, skipped: "not-found", error: "company not found" };
    const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
    const fp = planFingerprint(plan);
    if (!opts.force && co?.hubspotHash === fp && co.hubspotCompanyId) return { ok: true, skipped: "unchanged", companyId };

    await ensureProperties();

    // --- company ---
    let hsCompanyId = co?.hubspotCompanyId ?? null;
    if (!hsCompanyId) {
      const found =
        (await findByProperty("companies", "arriveping_company_id", companyId)) ??
        (plan.company.domain ? await findByProperty("companies", "domain", plan.company.domain) : null);
      hsCompanyId = found?.id ?? null;
    }
    if (hsCompanyId) {
      await hs("PATCH", `/crm/v3/objects/companies/${hsCompanyId}`, { properties: nonEmpty(plan.company) });
    } else {
      const created = await hs<HsObject>("POST", "/crm/v3/objects/companies", { properties: nonEmpty({ ...plan.companyOnCreate, ...plan.company }) });
      hsCompanyId = created.id;
    }

    // --- contacts (one per staff membership) ---
    const contactIds: string[] = [];
    for (const ct of plan.contacts) {
      let id = ct.hubspotContactId;
      if (!id) id = (await findByProperty("contacts", "email", ct.email))?.id ?? null;
      if (id) {
        await hs("PATCH", `/crm/v3/objects/contacts/${id}`, { properties: nonEmpty(ct.props) }).catch(async (e) => {
          if (e instanceof HubSpotError && e.status === 404) {
            id = null;
          } else throw e;
        });
      }
      if (!id) {
        try {
          id = (await hs<HsObject>("POST", "/crm/v3/objects/contacts", { properties: nonEmpty({ ...ct.onCreate, ...ct.props }) })).id;
        } catch (e) {
          // 409 = email already exists; HubSpot puts the existing id in the message.
          const m = e instanceof HubSpotError && e.status === 409 ? /Existing ID:\s*(\d+)/.exec(e.body) : null;
          if (!m) throw e;
          id = m[1]!;
          await hs("PATCH", `/crm/v3/objects/contacts/${id}`, { properties: nonEmpty(ct.props) });
        }
      }
      await associate("contacts", id, "companies", hsCompanyId);
      if (id !== ct.hubspotContactId) {
        await sdb.update(schema.memberships).set({ hubspotContactId: id }).where(eq(schema.memberships.id, ct.membershipId));
      }
      contactIds.push(id);
    }

    // --- deal (the lead) ---
    let dealId = co?.hubspotDealId ?? null;
    if (!dealId) dealId = (await findByProperty("deals", "arriveping_company_id", companyId))?.id ?? null;
    if (dealId) {
      const current = await hs<HsObject>("GET", `/crm/v3/objects/deals/${dealId}?properties=dealstage`).catch((e) => {
        if (e instanceof HubSpotError && e.status === 404) return null;
        throw e;
      });
      if (!current) dealId = null;
      else {
        const cur = current.properties?.dealstage ?? "";
        // Sales may move the deal by hand; only override when billing says it's decided.
        const props: Props = { ...plan.deal.props };
        if (CLOSED_STAGES.has(plan.deal.stage) || !CLOSED_STAGES.has(cur)) props.dealstage = plan.deal.stage;
        await hs("PATCH", `/crm/v3/objects/deals/${dealId}`, { properties: nonEmpty(props) });
      }
    }
    if (!dealId) {
      const created = await hs<HsObject>("POST", "/crm/v3/objects/deals", {
        properties: nonEmpty({ ...plan.deal.onCreate, ...plan.deal.props, dealstage: plan.deal.stage }),
      });
      dealId = created.id;
    }
    await associate("deals", dealId, "companies", hsCompanyId);
    for (const cid of contactIds) await associate("deals", dealId, "contacts", cid);

    await sdb
      .update(schema.companies)
      .set({ hubspotCompanyId: hsCompanyId, hubspotDealId: dealId, hubspotHash: fp, hubspotSyncedAt: new Date() })
      .where(eq(schema.companies.id, companyId));
    log.info("hubspot: tenant synced", { companyId, hsCompanyId, dealId, contacts: contactIds.length });
    return { ok: true, companyId, hubspotCompanyId: hsCompanyId, hubspotDealId: dealId, contacts: contactIds.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("hubspot: sync failed", { companyId, error: msg });
    return { ok: false, companyId, error: msg };
  }
}

/* ------------------------------------------------------------ scheduling */

const DEBOUNCE_MS = 8_000;
const MIN_GAP_MS = 60_000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const lastRun = new Map<string, number>();

/** Is this tenant one we mirror automatically? */
export async function isSyncedCompany(companyId: string): Promise<boolean> {
  if (process.env.HUBSPOT_SYNC_ALL === "1") return true;
  const [co] = await db
    .select({ a: schema.companies.hubspotCompanyId, b: schema.companies.billingCustomerId })
    .from(schema.companies)
    .where(eq(schema.companies.id, companyId));
  return Boolean(co && (co.a || co.b));
}

/**
 * Ask for a sync "soon". Bursts of writes collapse into one push; a tenant is
 * pushed at most once a minute. Fire-and-forget; safe to call anywhere.
 */
export function queueCompanySync(companyId: string): void {
  if (!hubspotEnabled() || !companyId || companyId === "default") return;
  if (timers.has(companyId)) return;
  const since = Date.now() - (lastRun.get(companyId) ?? 0);
  const delay = Math.max(DEBOUNCE_MS, MIN_GAP_MS - since);
  const timer = setTimeout(() => {
    timers.delete(companyId);
    lastRun.set(companyId, Date.now());
    void (async () => {
      if (await isSyncedCompany(companyId)) await syncCompanyToHubspot(companyId);
    })().catch(() => {});
  }, delay);
  timer.unref?.();
  timers.set(companyId, timer);
}

/** Re-check every eligible tenant (fingerprint makes unchanged ones free). */
export async function sweepHubspotSync(): Promise<{ checked: number; pushed: number; failed: number }> {
  const out = { checked: 0, pushed: 0, failed: 0 };
  if (!hubspotEnabled()) return out;
  const rows = await db
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .where(
      process.env.HUBSPOT_SYNC_ALL === "1"
        ? undefined
        : or(isNotNull(schema.companies.hubspotCompanyId), isNotNull(schema.companies.billingCustomerId)),
    );
  for (const r of rows) {
    if (r.id === "default") continue;
    out.checked++;
    const res = await syncCompanyToHubspot(r.id);
    if (!res.ok) out.failed++;
    else if (!res.skipped) out.pushed++;
  }
  return out;
}

/* ------------------------------------------------- shared with other pushes */
// Low-level helpers reused by the marketing-site lead push (services/contact-request.ts),
// so every HubSpot call shares one token, transport, retry and test stub.
export { hs as hubspotRequest, nonEmpty as hubspotNonEmpty, ownerId as hubspotOwnerId };
export type { HsObject as HubspotObject };
