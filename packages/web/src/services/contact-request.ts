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
import { and, asc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { log } from "../api/lib/logger";
import { sendEmail } from "./email";
import { hubspotEnabled } from "./hubspot-sync";
import { addContactNote, displayPhone, findOrCreateLeadContact, htmlEsc, normalizePhone, phoneVariants, splitName } from "./hubspot-leads";

// Re-exported: these helpers used to live here and tests/import sites still use them from this module.
export { displayPhone, normalizePhone, phoneVariants, splitName };

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
    const { contactId, existing } = await findOrCreateLeadContact({ ...req, source: LEAD_SOURCE });
    // Timeline note so whoever opens the record sees the request.
    const lines = [
      `<strong>Asked to be contacted by an NVC360 associate</strong> (arriveping.com ${htmlEsc(req.source ?? "homepage")}, ${htmlEsc(whenText(at))})`,
      `Name: ${htmlEsc(req.name)}`,
      req.email ? `Email: ${htmlEsc(req.email)}` : "",
      req.phone ? `Phone: ${htmlEsc(displayPhone(req.phone))}` : "",
      req.company ? `Company: ${htmlEsc(req.company)}` : "",
    ].filter(Boolean);
    await addContactNote(contactId, lines.join("<br>"), at, "contact-request");
    return { status: "synced", contactId, existing };
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
/** `attempts` once the last attempt has finished; a row left at MAX_ATTEMPTS was interrupted. */
export const FINISHED = MAX_ATTEMPTS + 1;
/** How long the last attempt may stay claimed before it counts as interrupted and is run again. */
const STUCK_MS = 30 * 60 * 1000;
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
  const t = schema.contactRequests;
  const at = now.toISOString();
  const rows = await sdb
    .select()
    .from(t)
    .where(
      and(
        or(inArray(t.emailStatus, OPEN), inArray(t.hubspotStatus, OPEN)),
        gt(t.createdAt, new Date(now.getTime() - RETRY_WINDOW_MS)),
        or(
          // Due: the backoff since the last attempt has run out. Filtered here,
          // not in the loop, so a backlog of rows still waiting can't crowd
          // due ones out of the batch.
          and(lt(t.attempts, MAX_ATTEMPTS), sql`${t.lastAttemptAt} <= ${at}::timestamptz - (${t.attempts} * interval '10 minutes')`),
          // The last attempt was claimed but never finished (a restart mid-call).
          and(eq(t.attempts, MAX_ATTEMPTS), lt(t.lastAttemptAt, new Date(now.getTime() - STUCK_MS))),
        ),
      ),
    )
    .orderBy(asc(t.createdAt))
    .limit(50);

  let retried = 0;
  let gaveUp = 0;
  for (const r of rows) {
    // Claim the row so two sweeps can't both take it. A normal retry bumps the
    // counter. The final attempt stays at MAX_ATTEMPTS while it runs (resuming
    // an interrupted one just restamps lastAttemptAt) and becomes FINISHED only
    // after it completes, so a crash at any point leaves it resumable.
    const resuming = r.attempts >= MAX_ATTEMPTS;
    const next = resuming ? MAX_ATTEMPTS : r.attempts + 1;
    const claimed = await sdb
      .update(t)
      .set({ attempts: next, lastAttemptAt: now })
      .where(
        and(
          eq(t.id, r.id),
          resuming ? and(eq(t.attempts, MAX_ATTEMPTS), lt(t.lastAttemptAt, new Date(now.getTime() - STUCK_MS))) : eq(t.attempts, r.attempts),
        ),
      )
      .returning({ id: t.id });
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
    if (next === MAX_ATTEMPTS) await sdb.update(t).set({ attempts: FINISHED }).where(and(eq(t.id, r.id), eq(t.attempts, MAX_ATTEMPTS)));

    const stillOpen = (todo.hubspot && out.hubspot?.status === "failed") || (todo.email && out.email === "failed");
    if (stillOpen && next === MAX_ATTEMPTS) {
      gaveUp++;
      log.error("contact-request: giving up after retries — follow up by hand", {
        id: r.id,
        hubspot: out.hubspot?.status ?? r.hubspotStatus,
        email: out.email ?? r.emailStatus,
        ...(resuming && { resumed: true }),
      });
    }
  }
  if (rows.length) log.info("contact-request: retry sweep", { checked: rows.length, retried, gaveUp });
  return { checked: rows.length, retried, gaveUp };
}
