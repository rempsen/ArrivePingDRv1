/**
 * "Would you like to be contacted by an NVC360 associate?" — leads from the
 * homepage sign-up card.
 *
 * Each request is saved to `contact_requests`, pushed to HubSpot as a Contact
 * (lead status NEW, owner HUBSPOT_OWNER_ID) with a timeline note, and emailed
 * to the sales inbox so someone can pick it up and assign it.
 *
 *   CONTACT_REQUEST_TO  — sales inbox (default contact@nvc360.com)
 *   HUBSPOT_PORTAL_ID   — optional; adds a "View in HubSpot" link to the email
 *   HUBSPOT_ACCESS_TOKEN / HUBSPOT_OWNER_ID — shared with hubspot-sync.ts
 *
 * The visitor gets their answer as soon as the row is saved; HubSpot and the
 * email run after, and their outcome is written back to the row. If the save
 * itself fails, the email is sent first so the lead is never lost.
 */
import { and, eq, gt, inArray, lt, or } from "drizzle-orm";
import { sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { log } from "../api/lib/logger";
import { sendEmail } from "./email";
import {
  ensureProperties,
  HubSpotError,
  hubspotEnabled,
  hubspotNonEmpty,
  hubspotOwnerId,
  hubspotRequest,
  type HubspotObject,
} from "./hubspot-sync";

export interface ContactRequestInput {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  source?: string;
}

export type HubspotOutcome = { status: "synced"; contactId: string; existing?: boolean } | { status: "skipped" } | { status: "failed"; error: string };
export type EmailOutcome = "sent" | "skipped" | "failed";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The form has one "Email or phone" box. Anything with an @ must be a valid
 * email; otherwise it's a phone number with 10–15 digits (an optional leading
 * +, spaces, dashes, dots and brackets allowed). Returns null when it's neither.
 */
export function parseContact(raw: string): { email: string } | { phone: string } | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.includes("@")) return EMAIL_RE.test(v) && v.length <= 254 ? { email: v.toLowerCase() } : null;
  if (!/^\+?[\d\s().-]+$/.test(v)) return null;
  const phone = normalizePhone(v);
  return phone ? { phone } : null;
}

/**
 * One stable form for every phone number, so the same person typed two ways is
 * one HubSpot contact: E.164. Ten digits are a North American number (+1);
 * eleven starting with 1 likewise; anything else keeps its digits behind a +.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/**
 * HubSpot stores phone numbers as people typed them and its search is exact,
 * so look an E.164 number up under the common ways it gets written.
 */
export function phoneVariants(e164: string): string[] {
  const d = e164.replace(/\D/g, "");
  const out = new Set([e164, d]);
  if (d.length === 11 && d.startsWith("1")) {
    const n = d.slice(1);
    const [a, b, c] = [n.slice(0, 3), n.slice(3, 6), n.slice(6)];
    for (const v of [n, `(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`, `${a} ${b} ${c}`, `(${a})${b}-${c}`, `+1 ${a} ${b} ${c}`, `+1 (${a}) ${b}-${c}`, `+1-${a}-${b}-${c}`, `1-${a}-${b}-${c}`, `1 ${a} ${b} ${c}`])
      out.add(v);
  }
  return [...out];
}

/** "+12045550199" → "(204) 555-0199" for people to read; other numbers stay E.164. */
export function displayPhone(e164: string): string {
  const d = e164.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : e164;
}

export function splitName(name: string): { firstname: string; lastname: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstname: parts[0] ?? "", lastname: "" };
  return { firstname: parts.slice(0, -1).join(" "), lastname: parts[parts.length - 1]! };
}

function htmlEsc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

function whenText(d: Date): string {
  return d.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Winnipeg" }) + " Central";
}

export const LEAD_SOURCE = "Website contact request";

/* --------------------------------------------------------------- HubSpot */

async function findContact(property: "email" | "phone", values: string[]): Promise<HubspotObject | null> {
  const r = await hubspotRequest<{ results: HubspotObject[] }>("POST", "/crm/v3/objects/contacts/search", {
    filterGroups: [{ filters: [values.length === 1 ? { propertyName: property, operator: "EQ", value: values[0] } : { propertyName: property, operator: "IN", values }] }],
    properties: [],
    limit: 1,
  });
  return r.results?.[0] ?? null;
}

/**
 * Create the HubSpot contact, or find the existing one, and add a note to its
 * timeline. An existing contact is never edited: the form is public, so a
 * stranger typing someone else's email must not be able to change that
 * person's name, phone or company in the CRM. The note records what was typed.
 */
export async function pushContactRequestToHubspot(req: ContactRequestInput, at = new Date()): Promise<HubspotOutcome> {
  if (!hubspotEnabled()) return { status: "skipped" };
  try {
    await ensureProperties();
    let existing: HubspotObject | null = null;
    if (req.email) existing = await findContact("email", [req.email]);
    else if (req.phone) existing = await findContact("phone", phoneVariants(req.phone));

    let contactId = existing?.id ?? null;
    let wasExisting = !!existing;
    if (!contactId) {
      const props: Record<string, string> = {
        ...splitName(req.name),
        email: req.email ?? "",
        phone: req.phone ?? "",
        company: req.company ?? "",
        lifecyclestage: "lead",
        hs_lead_status: "NEW",
        arriveping_lead_source: LEAD_SOURCE,
      };
      const owner = hubspotOwnerId();
      if (owner) props.hubspot_owner_id = owner;
      try {
        contactId = (await hubspotRequest<HubspotObject>("POST", "/crm/v3/objects/contacts", { properties: hubspotNonEmpty(props) })).id;
      } catch (e) {
        // 409 = that email already exists (created between our search and now).
        const m = e instanceof HubSpotError && e.status === 409 ? /Existing ID:\s*(\d+)/.exec(e.body) : null;
        if (!m) throw e;
        contactId = m[1]!;
        wasExisting = true;
      }
    }

    // Timeline note so whoever opens the record sees the request. Best effort:
    // a missing notes scope must not turn a created lead into a "failed" one.
    const lines = [
      `<strong>Asked to be contacted by an NVC360 associate</strong> (arriveping.com ${htmlEsc(req.source ?? "homepage")}, ${htmlEsc(whenText(at))})`,
      `Name: ${htmlEsc(req.name)}`,
      req.email ? `Email: ${htmlEsc(req.email)}` : "",
      req.phone ? `Phone: ${htmlEsc(displayPhone(req.phone))}` : "",
      req.company ? `Company: ${htmlEsc(req.company)}` : "",
    ].filter(Boolean);
    await hubspotRequest("POST", "/crm/v3/objects/notes", {
      properties: { hs_timestamp: at.toISOString(), hs_note_body: lines.join("<br>") },
      associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] }],
    }).catch((e) => log.warn("contact-request: HubSpot note failed", { err: (e as Error).message.slice(0, 200) }));

    return { status: "synced", contactId, existing: wasExisting };
  } catch (e) {
    const error = (e as Error).message.slice(0, 500);
    log.error("contact-request: HubSpot push failed", { err: error });
    return { status: "failed", error };
  }
}

/* ----------------------------------------------------------------- email */

export function hubspotContactUrl(contactId: string): string | null {
  const portal = process.env.HUBSPOT_PORTAL_ID?.trim();
  return portal ? `https://app.hubspot.com/contacts/${encodeURIComponent(portal)}/record/0-1/${encodeURIComponent(contactId)}` : null;
}

export async function emailContactRequest(req: ContactRequestInput, hubspot: HubspotOutcome | null, at = new Date()): Promise<EmailOutcome> {
  const to = process.env.CONTACT_REQUEST_TO?.trim() || "contact@nvc360.com";
  const rows: [string, string][] = [
    ["Name", req.name],
    ...(req.email ? ([["Email", req.email]] as [string, string][]) : []),
    ...(req.phone ? ([["Phone", displayPhone(req.phone)]] as [string, string][]) : []),
    ["Company", req.company || "—"],
    ["Asked", whenText(at)],
    ["From", `arriveping.com ${req.source ?? "homepage"}`],
  ];
  let hubspotLine = "";
  let hubspotHtml = "";
  if (hubspot?.status === "synced") {
    const url = hubspotContactUrl(hubspot.contactId);
    const what =
      hubspot.existing === undefined
        ? "In HubSpot"
        : hubspot.existing
          ? "Already in HubSpot — a note was added to the existing contact"
          : "Added to HubSpot as a new lead";
    hubspotLine = url ? `${what}: ${url}` : `${what} (contact id ${hubspot.contactId}).`;
    hubspotHtml = url ? `${htmlEsc(what)}: <a href="${htmlEsc(url)}">open in HubSpot</a>.` : `${htmlEsc(what)} (contact id ${htmlEsc(hubspot.contactId)}).`;
  } else if (hubspot?.status === "failed") {
    hubspotLine = "Could not be added to HubSpot automatically — please add it by hand.";
    hubspotHtml = htmlEsc(hubspotLine);
  }
  const how = req.email ? "Reply to this email to reach them, or" : "Call or text them, then";
  const text = [
    `${req.name} asked to be contacted by an NVC360 associate.`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    hubspotLine,
    `${how} assign the lead in HubSpot.`,
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#202226;line-height:1.5">
  <h2 style="margin:0 0 16px;font-size:18px">${htmlEsc(req.name)} asked to be contacted</h2>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    ${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 16px 6px 0;color:#626773;font-size:14px;vertical-align:top;white-space:nowrap">${htmlEsc(k)}</td><td style="padding:6px 0;font-size:14px">${htmlEsc(v)}</td></tr>`,
      )
      .join("")}
  </table>
  ${hubspotHtml ? `<p style="margin:18px 0 0;font-size:14px">${hubspotHtml}</p>` : ""}
  <p style="margin:12px 0 0;color:#626773;font-size:13px">${htmlEsc(how)} assign the lead in HubSpot.</p>
</body></html>`;
  const r = await sendEmail({
    to,
    subject: `Contact request — ${req.name}${req.company ? ` (${req.company})` : ""}`,
    html,
    text,
    ...(req.email ? { replyTo: req.email } : {}),
  });
  if (r.ok) return "sent";
  if ("skipped" in r && r.skipped) return "skipped";
  log.error("contact-request: email failed", { to });
  return "failed";
}

/* ------------------------------------------------------------- the flow */

type Row = typeof schema.contactRequests.$inferSelect;
const OPEN = ["pending", "failed"];

/**
 * Deliver what's still owed: HubSpot first (so the email can link to the
 * record), then the email; only the channels named in `todo` run, and only
 * their outcome is written back. `known` is the HubSpot state already on the
 * row when this is a retry that only owes the email.
 */
export async function processContactRequest(
  id: string | null,
  req: ContactRequestInput,
  at = new Date(),
  todo: { hubspot: boolean; email: boolean } = { hubspot: true, email: true },
  known: HubspotOutcome | null = null,
) {
  const hubspot = todo.hubspot ? await pushContactRequestToHubspot(req, at) : known;
  const email = todo.email ? await emailContactRequest(req, hubspot, at) : null;
  if (id) {
    const set: Partial<Row> = {};
    if (todo.hubspot && hubspot) {
      set.hubspotStatus = hubspot.status;
      set.hubspotContactId = hubspot.status === "synced" ? hubspot.contactId : null;
      set.hubspotError = hubspot.status === "failed" ? hubspot.error : "";
    }
    if (email) set.emailStatus = email;
    await sdb
      .update(schema.contactRequests)
      .set(set)
      .where(eq(schema.contactRequests.id, id))
      .catch((e) => log.error("contact-request: status update failed", { id, err: (e as Error).message }));
  }
  log.info("contact-request: processed", { id, hubspot: hubspot?.status ?? "unchanged", email: email ?? "unchanged" });
  return { hubspot, email };
}

/**
 * Save, then hand off. `delivered` tells the route whether the visitor's
 * request is safe somewhere; `done` resolves when HubSpot and email finish
 * (the route doesn't wait for it; tests do). Anything that doesn't finish —
 * a restart mid-call, both services down — is picked up by
 * retryContactRequests().
 */
export async function submitContactRequest(req: ContactRequestInput): Promise<{ delivered: boolean; id: string | null; done: Promise<unknown> }> {
  const at = new Date();
  let id: string | null = null;
  try {
    const [row] = await sdb
      .insert(schema.contactRequests)
      .values({ name: req.name, email: req.email ?? "", phone: req.phone ?? "", company: req.company ?? "", source: req.source ?? "homepage" })
      .returning({ id: schema.contactRequests.id });
    id = row?.id ?? null;
  } catch (e) {
    log.error("contact-request: save failed", { err: (e as Error).message });
  }

  if (id) {
    const done = processContactRequest(id, req, at).catch((e) => log.error("contact-request: processing crashed", { id, err: (e as Error).message }));
    return { delivered: true, id, done };
  }

  // Not saved: don't answer the visitor until we know the email reached sales.
  const result = await processContactRequest(null, req, at);
  const delivered = result.email === "sent" || result.hubspot?.status === "synced";
  return { delivered, id: null, done: Promise.resolve(result) };
}

/* ------------------------------------------------------------- retries */

/** Attempts in total (the first is at submit time); with the backoff below that's about 6 hours of trying. */
export const MAX_ATTEMPTS = 8;
const RETRY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** Wait after attempt n before trying again: 10 min, 20 min, 30 min, ... */
export function retryDelayMs(attempts: number): number {
  return attempts * 10 * 60 * 1000;
}

/**
 * Sweep for leads whose HubSpot push or email didn't go through — a restart
 * during processing leaves them "pending", an outage leaves them "failed" —
 * and try the missing channel again. Each row is claimed by bumping
 * `attempts` from the value we read, so two instances never retry the same
 * lead at once. Runs every few minutes from server.ts.
 */
export async function retryContactRequests(now = new Date()): Promise<{ checked: number; retried: number; gaveUp: number }> {
  const rows = await sdb
    .select()
    .from(schema.contactRequests)
    .where(
      and(
        or(inArray(schema.contactRequests.emailStatus, OPEN), inArray(schema.contactRequests.hubspotStatus, OPEN)),
        lt(schema.contactRequests.attempts, MAX_ATTEMPTS),
        gt(schema.contactRequests.createdAt, new Date(now.getTime() - RETRY_WINDOW_MS)),
      ),
    )
    .limit(50);

  let retried = 0;
  let gaveUp = 0;
  for (const r of rows) {
    if (now.getTime() - r.lastAttemptAt.getTime() < retryDelayMs(r.attempts)) continue;
    const claimed = await sdb
      .update(schema.contactRequests)
      .set({ attempts: r.attempts + 1, lastAttemptAt: now })
      .where(and(eq(schema.contactRequests.id, r.id), eq(schema.contactRequests.attempts, r.attempts)))
      .returning({ id: schema.contactRequests.id });
    if (!claimed.length) continue; // another instance took it

    const todo = { hubspot: OPEN.includes(r.hubspotStatus), email: OPEN.includes(r.emailStatus) };
    const known: HubspotOutcome | null =
      r.hubspotStatus === "synced" && r.hubspotContactId
        ? { status: "synced", contactId: r.hubspotContactId }
        : r.hubspotStatus === "failed"
          ? { status: "failed", error: r.hubspotError }
          : null;
    const req: ContactRequestInput = { name: r.name, email: r.email || undefined, phone: r.phone || undefined, company: r.company || undefined, source: r.source };
    const out = await processContactRequest(r.id, req, r.createdAt, todo, known);
    retried++;

    const stillOpen = (todo.hubspot && out.hubspot?.status === "failed") || (todo.email && out.email === "failed");
    if (stillOpen && r.attempts + 1 >= MAX_ATTEMPTS) {
      gaveUp++;
      log.error("contact-request: giving up after retries — follow up by hand", {
        id: r.id,
        hubspot: out.hubspot?.status ?? r.hubspotStatus,
        email: out.email ?? r.emailStatus,
      });
    }
  }
  if (rows.length) log.info("contact-request: retry sweep", { checked: rows.length, retried, gaveUp });
  return { checked: rows.length, retried, gaveUp };
}
