/**
 * "Is our HubSpot key right?" — a read-only health check of HUBSPOT_ACCESS_TOKEN
 * for the superadmin (GET /api/superadmin/hubspot-check). It never returns the
 * token and never writes to HubSpot.
 *
 *   1. Token info: which portal (hub) the key belongs to, and its scopes.
 *      Catches the classic mistake of a key from another HubSpot account.
 *   2. One read per object we write (contacts, companies, deals, tickets,
 *      notes): a 403 there means the private app lacks that scope.
 *   3. Settings we rely on: HUBSPOT_OWNER_ID is a real owner, the ticket
 *      pipeline/stage exist, and our custom properties have been created.
 */
import { HubSpotError, hubspotEnabled, hubspotRequest } from "./hubspot-sync";

/** NVC360's portal. HUBSPOT_PORTAL_ID overrides it. */
export const EXPECTED_PORTAL = "342390247";

/**
 * Scopes the integration uses. Writes to custom properties need the schema
 * scopes; reads are implied by the matching write scope in HubSpot's picker
 * but listed separately on the token.
 */
export const REQUIRED_SCOPES: { scope: string; why: string }[] = [
  { scope: "crm.objects.contacts.read", why: "find existing people before creating a lead" },
  { scope: "crm.objects.contacts.write", why: "create leads and mirror tenant staff" },
  { scope: "crm.objects.companies.read", why: "find tenant companies" },
  { scope: "crm.objects.companies.write", why: "mirror tenants as companies" },
  { scope: "crm.objects.deals.read", why: "find each tenant's deal" },
  { scope: "crm.objects.deals.write", why: "keep the subscription deal current" },
  { scope: "tickets", why: "support messages become tickets" },
  { scope: "crm.schemas.contacts.write", why: "create the ArrivePing contact properties" },
  { scope: "crm.schemas.companies.write", why: "create the ArrivePing company properties" },
  { scope: "crm.schemas.deals.write", why: "create the ArrivePing deal properties" },
];

export type CheckStatus = "pass" | "warn" | "fail";
export interface CheckItem {
  name: string;
  status: CheckStatus;
  detail: string;
}
export interface HubspotCheck {
  configured: boolean;
  ok: boolean;
  portal?: { tokenHubId: string | null; expected: string; matches: boolean | null };
  scopes?: { granted: string[]; missing: string[] };
  checks: CheckItem[];
  /** What to do, in plain words. Empty when everything passed. */
  nextSteps: string[];
}

function why(e: unknown): string {
  if (e instanceof HubSpotError) {
    let msg = e.body;
    try {
      msg = (JSON.parse(e.body) as { message?: string }).message ?? e.body;
    } catch {
      /* not JSON */
    }
    return `HTTP ${e.status}: ${msg.slice(0, 200)}`;
  }
  return (e as Error).message.slice(0, 200);
}

const statusOf = (e: unknown) => (e instanceof HubSpotError ? e.status : 0);

export async function checkHubspot(): Promise<HubspotCheck> {
  if (!hubspotEnabled()) {
    return {
      configured: false,
      ok: false,
      checks: [{ name: "HUBSPOT_ACCESS_TOKEN", status: "fail", detail: "Not set, so nothing is sent to HubSpot." }],
      nextSteps: ["Add HUBSPOT_ACCESS_TOKEN (the private app's access token) to the server environment and redeploy."],
    };
  }
  const checks: CheckItem[] = [];
  const next: string[] = [];
  const expected = process.env.HUBSPOT_PORTAL_ID?.trim() || EXPECTED_PORTAL;
  const token = process.env.HUBSPOT_ACCESS_TOKEN!.trim();

  // 1. Token info (private-app tokens only).
  let hubId: string | null = null;
  let granted: string[] | null = null;
  try {
    const info = await hubspotRequest<{ hubId?: number; appId?: number; scopes?: string[] }>("POST", "/oauth/v2/private-apps/get/access-token-info", { tokenKey: token });
    hubId = info.hubId != null ? String(info.hubId) : null;
    granted = Array.isArray(info.scopes) ? [...info.scopes].sort() : null;
    checks.push({ name: "Token", status: "pass", detail: `Valid private-app token${info.appId ? ` (app ${info.appId})` : ""}.` });
  } catch (e) {
    const s = statusOf(e);
    checks.push({
      name: "Token",
      status: s === 401 ? "fail" : "warn",
      detail: s === 401 ? `HubSpot rejected the key (${why(e)}).` : `Couldn't read token details (${why(e)}). The object checks below still test it.`,
    });
    if (s === 401) next.push("The key is invalid or was rotated. In HubSpot: Settings → Integrations → Private Apps → your app → Auth → copy the access token into HUBSPOT_ACCESS_TOKEN.");
  }

  const matches = hubId == null ? null : hubId === expected;
  if (matches === false) {
    checks.push({ name: "Portal", status: "fail", detail: `The key belongs to HubSpot account ${hubId}, but ours is ${expected}.` });
    next.push(`Create the token in HubSpot account ${expected} (the NVC360 portal), not ${hubId}.`);
  } else if (matches) {
    checks.push({ name: "Portal", status: "pass", detail: `Key is for HubSpot account ${expected}.` });
  }

  let missing: string[] = [];
  if (granted) {
    missing = REQUIRED_SCOPES.filter((r) => !granted!.includes(r.scope)).map((r) => r.scope);
    checks.push({
      name: "Scopes",
      status: missing.length ? "fail" : "pass",
      detail: missing.length ? `Missing: ${missing.join(", ")}.` : `All ${REQUIRED_SCOPES.length} scopes the integration needs are granted.`,
    });
    if (missing.length) next.push(`In the private app's Scopes tab, tick ${missing.join(", ")}, then save (the token stays the same).`);
  }

  // 2. One read per object type we write.
  const objects: [string, string][] = [
    ["Contacts", "contacts"],
    ["Companies", "companies"],
    ["Deals", "deals"],
    ["Tickets", "tickets"],
    ["Notes", "notes"],
  ];
  const reads = await Promise.all(
    objects.map(async ([label, obj]) => {
      try {
        await hubspotRequest("GET", `/crm/v3/objects/${obj}?limit=1&properties=hs_object_id`);
        return { name: label, status: "pass" as const, detail: "Readable." };
      } catch (e) {
        return { name: label, status: "fail" as const, detail: statusOf(e) === 403 ? `No access (${why(e)}).` : why(e) };
      }
    }),
  );
  checks.push(...reads);
  if (reads.some((r) => r.status === "fail") && !missing.length) next.push("Some objects can't be read: check the private app's CRM scopes for the ones marked fail.");

  // 3. Settings we rely on.
  const owner = process.env.HUBSPOT_OWNER_ID?.trim();
  if (!owner) {
    checks.push({ name: "Owner", status: "warn", detail: "HUBSPOT_OWNER_ID not set, so new leads have no owner." });
  } else {
    try {
      const o = await hubspotRequest<{ email?: string; firstName?: string; lastName?: string; archived?: boolean }>("GET", `/crm/v3/owners/${encodeURIComponent(owner)}`);
      const who = [o.firstName, o.lastName].filter(Boolean).join(" ") || o.email || owner;
      checks.push({ name: "Owner", status: o.archived ? "warn" : "pass", detail: `New leads are assigned to ${who}${o.archived ? " (deactivated user)" : ""}.` });
    } catch (e) {
      const s = statusOf(e);
      checks.push({ name: "Owner", status: s === 404 ? "fail" : "warn", detail: s === 404 ? `Owner ${owner} doesn't exist in this account.` : `Couldn't check owner ${owner} (${why(e)}).` });
      if (s === 404) next.push("HUBSPOT_OWNER_ID doesn't match a HubSpot user: copy the right owner id from Settings → Users & Teams.");
    }
  }

  const pipeline = process.env.HUBSPOT_TICKET_PIPELINE?.trim() || "0";
  const stage = process.env.HUBSPOT_TICKET_STAGE?.trim() || "1";
  try {
    const p = await hubspotRequest<{ label?: string; stages?: { id: string; label: string }[] }>("GET", `/crm/v3/pipelines/tickets/${encodeURIComponent(pipeline)}`);
    const st = p.stages?.find((x) => x.id === stage);
    checks.push({
      name: "Ticket pipeline",
      status: st ? "pass" : "fail",
      detail: st ? `New tickets go to "${p.label ?? pipeline}" → "${st.label}".` : `Stage ${stage} isn't in pipeline "${p.label ?? pipeline}".`,
    });
    if (!st) next.push(`Set HUBSPOT_TICKET_STAGE to one of: ${(p.stages ?? []).map((x) => `${x.id} (${x.label})`).join(", ")}.`);
  } catch (e) {
    checks.push({ name: "Ticket pipeline", status: "fail", detail: statusOf(e) === 404 ? `Ticket pipeline ${pipeline} doesn't exist.` : why(e) });
  }

  try {
    await hubspotRequest("GET", "/crm/v3/properties/contacts/arriveping_lead_source");
    checks.push({ name: "Custom properties", status: "pass", detail: "ArrivePing properties exist." });
  } catch (e) {
    checks.push({
      name: "Custom properties",
      status: "warn",
      detail: statusOf(e) === 404 ? "Not created yet; the first sync or form submission creates them." : `Couldn't check (${why(e)}).`,
    });
  }

  // Without token details the account and scopes are unconfirmed, so the key
  // can't be called right even when the reads below work.
  if (matches == null && !next.some((n) => n.startsWith("The key is invalid"))) {
    next.push(`Couldn't confirm which HubSpot account the key belongs to. In HubSpot account ${expected}: Settings → Integrations → Private Apps → check the app is there and its token matches HUBSPOT_ACCESS_TOKEN.`);
  }
  const ok = matches === true && checks.every((c) => c.status !== "fail");
  return { configured: true, ok, portal: { tokenHubId: hubId, expected, matches }, scopes: granted ? { granted, missing } : undefined, checks, nextSteps: next };
}
