/**
 * HubSpot pushes for people who reach us from the website before (or without)
 * having an ArrivePing account: the homepage "contact me" choice, the Help
 * Center message form, and a signup that stopped at the card step.
 *
 * Rule shared by all of them: these forms are public, so an existing HubSpot
 * contact is NEVER edited from here — a stranger typing someone else's email
 * must not be able to change that person's name, phone or company. New people
 * are created as leads; existing ones only get a timeline note or a ticket.
 *
 * Tenant staff (people with an account) are mirrored by hubspot-sync.ts.
 */
import { log } from "../api/lib/logger";
import {
  ensureProperties,
  HubSpotError,
  hubspotEnabled,
  hubspotNonEmpty,
  hubspotOwnerId,
  hubspotRequest,
  type HubspotObject,
} from "./hubspot-sync";

/* ---------------------------------------------------------------- phones */

/**
 * One stable form for every phone number, so the same person typed two ways is
 * one HubSpot contact: E.164. Ten digits are a North American number (+1);
 * eleven starting with 1 likewise; anything else keeps its digits behind a +.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  if (digits.length === 10) return `+1${digits}`;
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

export function htmlEsc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

/* --------------------------------------------------------------- contacts */

export interface LeadInput {
  name: string;
  email?: string;
  /** E.164 (see normalizePhone) */
  phone?: string;
  company?: string;
  /** Written to the custom "ArrivePing lead source" property on a NEW contact. */
  source: string;
}

async function findContact(property: "email" | "phone", values: string[]): Promise<HubspotObject | null> {
  const r = await hubspotRequest<{ results: HubspotObject[] }>("POST", "/crm/v3/objects/contacts/search", {
    filterGroups: [{ filters: [values.length === 1 ? { propertyName: property, operator: "EQ", value: values[0] } : { propertyName: property, operator: "IN", values }] }],
    properties: [],
    limit: 1,
  });
  return r.results?.[0] ?? null;
}

/**
 * The HubSpot contact for this person: the existing one (found by email, or
 * by phone under its common spellings), untouched, or a new lead. Throws on
 * HubSpot errors; callers decide whether that's fatal.
 */
export async function findOrCreateLeadContact(lead: LeadInput): Promise<{ contactId: string; existing: boolean }> {
  await ensureProperties();
  let existing: HubspotObject | null = null;
  if (lead.email) existing = await findContact("email", [lead.email.toLowerCase()]);
  else if (lead.phone) existing = await findContact("phone", phoneVariants(lead.phone));
  if (existing) return { contactId: existing.id, existing: true };

  const props: Record<string, string> = {
    ...splitName(lead.name),
    email: lead.email?.toLowerCase() ?? "",
    phone: lead.phone ?? "",
    company: lead.company ?? "",
    lifecyclestage: "lead",
    hs_lead_status: "NEW",
    arriveping_lead_source: lead.source,
  };
  const owner = hubspotOwnerId();
  if (owner) props.hubspot_owner_id = owner;
  try {
    const id = (await hubspotRequest<HubspotObject>("POST", "/crm/v3/objects/contacts", { properties: hubspotNonEmpty(props) })).id;
    return { contactId: id, existing: false };
  } catch (e) {
    // 409 = that email already exists (created between our search and now).
    const m = e instanceof HubSpotError && e.status === 409 ? /Existing ID:\s*(\d+)/.exec(e.body) : null;
    if (!m) throw e;
    return { contactId: m[1]!, existing: true };
  }
}

/** Timeline note on a contact. Best effort: a missing notes scope never fails the caller. */
export async function addContactNote(contactId: string, html: string, at = new Date(), tag = "hubspot-leads"): Promise<boolean> {
  try {
    await hubspotRequest("POST", "/crm/v3/objects/notes", {
      properties: { hs_timestamp: at.toISOString(), hs_note_body: html },
      associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] }],
    });
    return true;
  } catch (e) {
    log.warn(`${tag}: HubSpot note failed`, { err: (e as Error).message.slice(0, 200) });
    return false;
  }
}

/* ---------------------------------------------------------------- tickets */

export interface TicketInput {
  subject: string;
  content: string;
  contactId: string;
  /** HubSpot ticket priority: LOW | MEDIUM | HIGH */
  priority?: "LOW" | "MEDIUM" | "HIGH";
}

/** Support Pipeline / New. Override for a different pipeline with HUBSPOT_TICKET_PIPELINE / _STAGE. */
const TICKET_PIPELINE = () => process.env.HUBSPOT_TICKET_PIPELINE?.trim() || "0";
const TICKET_STAGE = () => process.env.HUBSPOT_TICKET_STAGE?.trim() || "1";

/** A ticket in the support pipeline, associated with the contact (type 16 = ticket → contact). */
export async function createSupportTicket(t: TicketInput): Promise<string> {
  const owner = hubspotOwnerId();
  const r = await hubspotRequest<HubspotObject>("POST", "/crm/v3/objects/tickets", {
    properties: hubspotNonEmpty({
      subject: t.subject.slice(0, 250),
      content: t.content.slice(0, 60_000),
      hs_pipeline: TICKET_PIPELINE(),
      hs_pipeline_stage: TICKET_STAGE(),
      hs_ticket_priority: t.priority ?? "",
      source_type: "FORM",
      hubspot_owner_id: owner ?? "",
    }),
    associations: [{ to: { id: t.contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 16 }] }],
  });
  return r.id;
}

export { hubspotEnabled };

/* ------------------------------------------------------- signup started */

export const SIGNUP_LEAD_SOURCE = "ArrivePing signup (started)";

/**
 * Someone reached the card step of self-serve signup (we have their name,
 * email, company and phone) — make them a HubSpot lead now, so a signup that
 * stops here is still visible to sales. A completed signup is then picked up
 * by the full tenant sync, which updates the same contact by email.
 */
export async function pushSignupStarted(i: { email: string; name: string; companyName?: string; phone?: string }, at = new Date()): Promise<"synced" | "skipped" | "failed"> {
  if (!hubspotEnabled()) return "skipped";
  try {
    const phone = i.phone ? (normalizePhone(i.phone) ?? undefined) : undefined;
    const { contactId } = await findOrCreateLeadContact({ name: i.name, email: i.email, phone, company: i.companyName, source: SIGNUP_LEAD_SOURCE });
    const lines = [
      `<strong>Started an ArrivePing signup</strong> and reached the card step (${htmlEsc(at.toISOString().slice(0, 16).replace("T", " "))} UTC).`,
      i.companyName ? `Company: ${htmlEsc(i.companyName)}` : "",
      phone ? `Phone: ${htmlEsc(displayPhone(phone))}` : "",
      "If no ArrivePing company appears for them, the signup was not finished.",
    ].filter(Boolean);
    await addContactNote(contactId, lines.join("<br>"), at, "signup-started");
    return "synced";
  } catch (e) {
    log.error("signup-started: HubSpot push failed", { err: (e as Error).message.slice(0, 300) });
    return "failed";
  }
}
