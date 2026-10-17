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
import { eq } from "drizzle-orm";
import { sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { log } from "../api/lib/logger";
import { sendEmail } from "./email";
import {
  ensureProperties,
  HubSpotError,
  hubspotEnabled,
  hubspotFindByProperty,
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

export type HubspotOutcome = { status: "synced"; contactId: string; existing: boolean } | { status: "skipped" } | { status: "failed"; error: string };
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
  const digits = v.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? { phone: v.replace(/\s+/g, " ") } : null;
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
    if (req.email) existing = await hubspotFindByProperty("contacts", "email", req.email);
    else if (req.phone) existing = await hubspotFindByProperty("contacts", "phone", req.phone);

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
      req.phone ? `Phone: ${htmlEsc(req.phone)}` : "",
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
    ...(req.phone ? ([["Phone", req.phone]] as [string, string][]) : []),
    ["Company", req.company || "—"],
    ["Asked", whenText(at)],
    ["From", `arriveping.com ${req.source ?? "homepage"}`],
  ];
  let hubspotLine = "";
  let hubspotHtml = "";
  if (hubspot?.status === "synced") {
    const url = hubspotContactUrl(hubspot.contactId);
    const what = hubspot.existing ? "Already in HubSpot — a note was added to the existing contact" : "Added to HubSpot as a new lead";
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

/** HubSpot first (so the email can link to the record), then the email, then record both on the row. */
export async function processContactRequest(id: string | null, req: ContactRequestInput, at = new Date()) {
  const hubspot = await pushContactRequestToHubspot(req, at);
  const email = await emailContactRequest(req, hubspot, at);
  if (id) {
    await sdb
      .update(schema.contactRequests)
      .set({
        hubspotStatus: hubspot.status,
        hubspotContactId: hubspot.status === "synced" ? hubspot.contactId : null,
        hubspotError: hubspot.status === "failed" ? hubspot.error : "",
        emailStatus: email,
      })
      .where(eq(schema.contactRequests.id, id))
      .catch((e) => log.error("contact-request: status update failed", { id, err: (e as Error).message }));
  }
  log.info("contact-request: processed", { id, hubspot: hubspot.status, email });
  return { hubspot, email };
}

/**
 * Save, then hand off. `delivered` tells the route whether the visitor's
 * request is safe somewhere; `done` resolves when HubSpot and email finish
 * (the route doesn't wait for it; tests do).
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
  const delivered = result.email === "sent" || result.hubspot.status === "synced";
  return { delivered, id: null, done: Promise.resolve(result) };
}
