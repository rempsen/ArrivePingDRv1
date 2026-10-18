/**
 * "Send us a message" from the Help Center — posts to the customer-support
 * Slack channel and emails a copy to the support inbox.
 *
 *   SLACK_SUPPORT_WEBHOOK_URL  — Slack incoming webhook for the support channel
 *   SUPPORT_MESSAGE_TO         — backup inbox (default support@nvc360.com)
 *
 * Customers are not members of our Slack workspace, so replies go by email:
 * the Slack post links the sender's address and the email copy sets Reply-To.
 *
 * It also becomes a HubSpot ticket (Support Pipeline / New) on the sender's
 * contact — created as a lead when they're new, never edited when they exist —
 * so every conversation sits on the customer's CRM record.
 *
 * All channels are attempted; the visitor only sees an error when none of
 * them took the message.
 */
import { sendEmail } from "./email";
import { log } from "../api/lib/logger";
import { createSupportTicket, findOrCreateLeadContact, hubspotEnabled } from "./hubspot-leads";

export interface SupportMessage {
  name: string;
  email: string;
  company?: string;
  topic?: string;
  message: string;
  /** Path of the help page the visitor sent it from, e.g. /support/billing */
  page?: string;
  /** Website it came from (default arriveping.com; nvc360.com for the company site's support form). */
  site?: string;
  /** "ArrivePing lead source" for a sender who is new to HubSpot (default SUPPORT_LEAD_SOURCE). */
  source?: string;
}

const siteOf = (m: SupportMessage) => m.site || "arriveping.com";

/** Slack caps a text object at 3,000 characters. */
const SLACK_TEXT_MAX = 2_900;

/** Escape the three characters Slack treats as control syntax in mrkdwn. */
export function slackEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function htmlEsc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

function oneLine(s: string, max = 150): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function supportRows(m: SupportMessage): [string, string][] {
  return [
    ["Name", m.name],
    ["Email", m.email],
    ["Company", m.company || "—"],
    ["About", m.topic || "—"],
    ["Sent from", siteOf(m) === "arriveping.com" ? m.page || "Help Center" : `${siteOf(m)}${m.page || ""}`],
  ];
}

export function slackPayload(m: SupportMessage) {
  const body = m.message.length > SLACK_TEXT_MAX ? `${m.message.slice(0, SLACK_TEXT_MAX)}…` : m.message;
  const fields = supportRows(m).map(([k, v]) => ({
    type: "mrkdwn",
    text: k === "Email" ? `*${k}*\n<mailto:${slackEsc(v)}|${slackEsc(v)}>` : `*${k}*\n${slackEsc(v)}`,
  }));
  return {
    // Fallback for notifications and clients that don't render blocks. Slack parses
    // it as mrkdwn, so escape it: an unescaped <!channel> here would ping everyone.
    text: slackEsc(oneLine(`Support message from ${m.name}${m.company ? ` (${m.company})` : ""}: ${m.message}`)),
    blocks: [
      { type: "header", text: { type: "plain_text", text: oneLine(`💬 ${m.name}${m.company ? ` · ${m.company}` : ""}`) } },
      { type: "section", fields },
      // plain_text so nothing a visitor types can render as a link or mention.
      { type: "section", text: { type: "plain_text", text: body, emoji: false } },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Sent from ${slackEsc(siteOf(m))}. They aren't in our Slack: reply by email to <mailto:${slackEsc(m.email)}|${slackEsc(m.email)}> (a copy is in the support inbox).`,
          },
        ],
      },
    ],
  };
}

export async function postSupportToSlack(m: SupportMessage, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const url = process.env.SLACK_SUPPORT_WEBHOOK_URL?.trim();
  if (!url) {
    log.warn("support-message: SLACK_SUPPORT_WEBHOOK_URL not set; skipping Slack");
    return false;
  }
  try {
    const r = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slackPayload(m)),
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) {
      log.error("support-message: Slack webhook rejected", { status: r.status, body: (await r.text().catch(() => "")).slice(0, 200) });
      return false;
    }
    return true;
  } catch (e) {
    log.error("support-message: Slack webhook failed", { err: (e as Error).message });
    return false;
  }
}

export type EmailOutcome = "sent" | "skipped" | "failed";

export async function emailSupport(m: SupportMessage): Promise<EmailOutcome> {
  const to = process.env.SUPPORT_MESSAGE_TO?.trim() || "support@nvc360.com";
  const rows = supportRows(m);
  const from = siteOf(m) === "arriveping.com" ? "the ArrivePing Help Center" : siteOf(m);
  const text = [`Support message from ${from}`, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", m.message, "", `Reply to this email to answer ${m.name}.`].join("\n");
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#202226;line-height:1.5">
  <h2 style="margin:0 0 16px;font-size:18px">Support message from ${htmlEsc(m.name)}</h2>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    ${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 16px 6px 0;color:#626773;font-size:14px;vertical-align:top;white-space:nowrap">${htmlEsc(k)}</td><td style="padding:6px 0;font-size:14px">${htmlEsc(v)}</td></tr>`,
      )
      .join("")}
  </table>
  <div style="margin:18px 0 0;padding:14px 16px;border-radius:8px;background:#f4f5f7;font-size:15px;white-space:pre-wrap">${htmlEsc(m.message)}</div>
  <p style="margin:20px 0 0;color:#626773;font-size:13px">Reply to this email to answer ${htmlEsc(m.name)}.</p>
</body></html>`;
  const r = await sendEmail({
    to,
    subject: `Support message — ${oneLine(m.company || m.name, 80)}${m.topic ? ` · ${m.topic}` : ""}`,
    html,
    text,
    replyTo: m.email,
  });
  if (r.ok) return "sent";
  if ("skipped" in r && r.skipped) return "skipped";
  log.error("support-message: email failed", { to });
  return "failed";
}

/**
 * Deliver to Slack and the inbox in parallel. `delivered` is false only when
 * neither channel took it and at least one actually tried and failed — an
 * environment with nothing configured (local dev) logs and reports success,
 * the same way the demo-request form behaves.
 */
export const SUPPORT_LEAD_SOURCE = "Help Center message";

/** Ticket subject: the topic plus the start of the message, on one line. */
export function ticketSubject(m: SupportMessage): string {
  const first = m.message.replace(/\s+/g, " ").trim();
  const head = first.length > 80 ? `${first.slice(0, 79)}…` : first;
  return `${m.topic || "Help Center"}: ${head}`;
}

export function ticketContent(m: SupportMessage): string {
  return [
    m.message,
    "",
    "—",
    `From: ${m.name} <${m.email}>`,
    m.company ? `Company: ${m.company}` : "",
    m.topic ? `About: ${m.topic}` : "",
    `Sent from: ${siteOf(m)}${m.page || "/support"}`,
  ]
    .filter((l, i) => l !== "" || i === 1)
    .join("\n");
}

/** "synced" | "skipped" (HubSpot not configured) | "failed" */
export async function postSupportToHubspot(m: SupportMessage): Promise<"synced" | "skipped" | "failed"> {
  if (!hubspotEnabled()) return "skipped";
  try {
    const { contactId } = await findOrCreateLeadContact({ name: m.name, email: m.email, company: m.company, source: m.source || SUPPORT_LEAD_SOURCE });
    await createSupportTicket({ subject: ticketSubject(m), content: ticketContent(m), contactId });
    return "synced";
  } catch (e) {
    log.error("support-message: HubSpot ticket failed", { err: (e as Error).message.slice(0, 300) });
    return "failed";
  }
}

export async function deliverSupportMessage(m: SupportMessage, fetchImpl: typeof fetch = fetch) {
  const [slack, email, hubspot] = await Promise.all([postSupportToSlack(m, fetchImpl), emailSupport(m), postSupportToHubspot(m)]);
  const slackConfigured = !!process.env.SLACK_SUPPORT_WEBHOOK_URL?.trim();
  const delivered = slack || email === "sent" || hubspot === "synced" || (!slackConfigured && email === "skipped" && hubspot === "skipped");
  log.info("support-message: done", { slack, email, hubspot, delivered });
  return { slack, email, hubspot, delivered };
}
