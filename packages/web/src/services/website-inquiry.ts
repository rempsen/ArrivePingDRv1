/**
 * The forms on nvc360.com (the company site): the contact form on the home
 * page and /contact, and the support form on /support. That site is static,
 * so it posts here and this server does the CRM work with its HubSpot token.
 *
 *   contact → HubSpot contact (a NEW lead when they're new to HubSpot) with
 *             the message as a timeline note, plus an email to the sales
 *             inbox (CONTACT_REQUEST_TO, default contact@nvc360.com).
 *   support → the same path as the ArrivePing Help Center form: a HubSpot
 *             ticket on the sender's contact, the support Slack channel and
 *             an email to the support inbox, marked as sent from nvc360.com.
 *
 * As with every public form, an existing HubSpot contact is never edited:
 * someone typing another person's email can only add a note or a ticket.
 * Channels run in parallel; the visitor sees an error only if none took it.
 */
import { log } from "../api/lib/logger";
import { sendEmail } from "./email";
import { addContactNote, findOrCreateLeadContact, hubspotEnabled, htmlEsc } from "./hubspot-leads";
import { deliverSupportMessage } from "./support-message";

export type InquiryKind = "contact" | "support";

export interface WebsiteInquiry {
  kind: InquiryKind;
  name: string;
  email: string;
  company?: string;
  topic?: string;
  message: string;
  /** Path on nvc360.com the form was sent from, e.g. /contact */
  page?: string;
}

export const SITE = "nvc360.com";
/** "ArrivePing lead source" on contacts these forms create (the property is shared by all website leads). */
export const INQUIRY_SOURCES: Record<InquiryKind, string> = {
  contact: "nvc360.com contact form",
  support: "nvc360.com support form",
};

export interface InquiryResult {
  delivered: boolean;
  hubspot: "synced" | "skipped" | "failed";
  email: "sent" | "skipped" | "failed";
  slack?: boolean;
  contactId?: string;
}

function oneLine(s: string, max = 80): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const sentFrom = (i: WebsiteInquiry) => `${SITE}${i.page || "/contact"}`;

export function inquiryRows(i: WebsiteInquiry): [string, string][] {
  return [
    ["Name", i.name],
    ["Email", i.email],
    ["Company", i.company || "—"],
    ["About", i.topic || "—"],
    ["Sent from", sentFrom(i)],
  ];
}

/** The note on the contact's HubSpot timeline: what they asked, where from. */
export function inquiryNote(i: WebsiteInquiry): string {
  return [
    `<strong>Message from the ${htmlEsc(SITE)} contact form</strong>${i.topic ? ` · ${htmlEsc(i.topic)}` : ""}`,
    htmlEsc(i.message).replace(/\n/g, "<br>"),
    `—<br>From: ${htmlEsc(i.name)} &lt;${htmlEsc(i.email)}&gt;${i.company ? `<br>Company: ${htmlEsc(i.company)}` : ""}<br>Sent from: ${htmlEsc(sentFrom(i))}`,
  ].join("<br><br>");
}

function hubspotLink(contactId: string): string | null {
  const portal = process.env.HUBSPOT_PORTAL_ID?.trim();
  return portal ? `https://app.hubspot.com/contacts/${encodeURIComponent(portal)}/record/0-1/${encodeURIComponent(contactId)}` : null;
}

async function pushContactToHubspot(i: WebsiteInquiry, at: Date): Promise<{ status: "synced" | "skipped" | "failed"; contactId?: string }> {
  if (!hubspotEnabled()) return { status: "skipped" };
  try {
    const { contactId } = await findOrCreateLeadContact({ name: i.name, email: i.email, company: i.company, source: INQUIRY_SOURCES.contact });
    // The message itself lives only in the note: without it HubSpot has a
    // contact but not what they asked, so it doesn't count as delivered.
    const noted = await addContactNote(contactId, inquiryNote(i), at, "website-inquiry");
    return { status: noted ? "synced" : "failed", contactId };
  } catch (e) {
    log.error("website-inquiry: HubSpot push failed", { err: (e as Error).message.slice(0, 300) });
    return { status: "failed" };
  }
}

async function emailSales(i: WebsiteInquiry, contactId?: string): Promise<"sent" | "skipped" | "failed"> {
  const to = process.env.CONTACT_REQUEST_TO?.trim() || "contact@nvc360.com";
  const rows = inquiryRows(i);
  const link = contactId ? hubspotLink(contactId) : null;
  const text = [`New message from the ${SITE} contact form`, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", i.message, "", link ? `HubSpot: ${link}` : "", `Reply to this email to answer ${i.name}.`]
    .filter((l, n, a) => l !== "" || a[n - 1] !== "")
    .join("\n");
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#202226;line-height:1.5">
  <h2 style="margin:0 0 16px;font-size:18px">New message from ${htmlEsc(i.name)}</h2>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    ${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 16px 6px 0;color:#626773;font-size:14px;vertical-align:top;white-space:nowrap">${htmlEsc(k)}</td><td style="padding:6px 0;font-size:14px">${htmlEsc(v)}</td></tr>`,
      )
      .join("")}
  </table>
  <div style="margin:18px 0 0;padding:14px 16px;border-radius:8px;background:#f4f5f7;font-size:15px;white-space:pre-wrap">${htmlEsc(i.message)}</div>
  ${link ? `<p style="margin:18px 0 0;font-size:14px"><a href="${htmlEsc(link)}">View in HubSpot</a></p>` : ""}
  <p style="margin:20px 0 0;color:#626773;font-size:13px">Reply to this email to answer ${htmlEsc(i.name)}.</p>
</body></html>`;
  const r = await sendEmail({
    to,
    subject: `Website inquiry — ${oneLine(i.company || i.name)}${i.topic ? ` · ${i.topic}` : ""}`,
    html,
    text,
    replyTo: i.email,
  });
  if (r.ok) return "sent";
  if ("skipped" in r && r.skipped) return "skipped";
  log.error("website-inquiry: email failed", { to });
  return "failed";
}

export async function deliverWebsiteInquiry(i: WebsiteInquiry, at = new Date()): Promise<InquiryResult> {
  if (i.kind === "support") {
    const r = await deliverSupportMessage({ ...i, page: i.page || "/support", site: SITE, source: INQUIRY_SOURCES.support });
    return { delivered: r.delivered, hubspot: r.hubspot, email: r.email, slack: r.slack };
  }
  // HubSpot first so the email can link the record; the email is sent whatever HubSpot did.
  const hs = await pushContactToHubspot(i, at);
  const email = await emailSales(i, hs.contactId);
  const delivered = hs.status === "synced" || email === "sent" || (hs.status === "skipped" && email === "skipped");
  log.info("website-inquiry: done", { kind: i.kind, hubspot: hs.status, email, delivered });
  return { delivered, hubspot: hs.status, email, contactId: hs.contactId };
}
