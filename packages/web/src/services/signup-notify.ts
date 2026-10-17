/**
 * "Someone just signed up" — a post to Slack #onboarding and an email to the
 * team inbox, fired after a self-serve tenant is provisioned.
 *
 *   SLACK_ONBOARDING_WEBHOOK_URL  — Slack incoming webhook for #onboarding
 *   SIGNUP_NOTIFY_TO              — inbox (default contact@nvc360.com)
 *
 * Best effort by design: a Slack outage must never fail a signup, so every
 * failure is logged and swallowed. Both channels get the same facts.
 */
import { sendEmail } from "./email";
import { log } from "../api/lib/logger";
import { INDUSTRY_LABELS } from "./industry-presets";
import { TRIAL_DAYS } from "./billing-subscription";

export interface SignupNotice {
  companyId: string;
  companyName: string;
  website: string;
  industry: string;
  adminName: string;
  adminEmail: string;
  adminPhone: string;
  trialEndsAt: Date | null;
}

const APP_URL = (process.env.APP_URL ?? "https://arriveping.com").replace(/\/$/, "");

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

function industryName(id: string): string {
  if (!id) return "not set";
  return INDUSTRY_LABELS.find((i) => i.id === id)?.label ?? id;
}

function fmtDate(d: Date | null): string {
  if (!d) return "no card on file";
  return d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "America/Winnipeg" });
}

export function signupRows(n: SignupNotice): [string, string][] {
  const rows: [string, string][] = [
    ["Company", n.companyName],
    ["Website", n.website || "none given"],
    ["Industry", industryName(n.industry)],
    ["Contact", n.adminName || "—"],
    ["Email", n.adminEmail],
    ["Phone", n.adminPhone || "—"],
    [`Trial ends (${TRIAL_DAYS} days)`, fmtDate(n.trialEndsAt)],
    ["Admin", `${APP_URL}/admin/companies`],
  ];
  return rows;
}

export async function postSlack(n: SignupNotice, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const url = process.env.SLACK_ONBOARDING_WEBHOOK_URL?.trim();
  if (!url) {
    log.warn("signup-notify: SLACK_ONBOARDING_WEBHOOK_URL not set; skipping Slack");
    return false;
  }
  const rows = signupRows(n);
  const text = `New ArrivePing signup: ${n.companyName} (${n.adminName || n.adminEmail})`;
  const body = {
    text,
    blocks: [
      { type: "header", text: { type: "plain_text", text: `🎉 New signup: ${n.companyName}`.slice(0, 150) } },
      {
        type: "section",
        fields: rows.slice(0, 7).map(([k, v]) => ({ type: "mrkdwn", text: `*${k}*\n${v}` })),
      },
      {
        type: "actions",
        elements: [
          { type: "button", text: { type: "plain_text", text: "Open in superadmin" }, url: rows[7]![1] },
          ...(n.website ? [{ type: "button", text: { type: "plain_text", text: "Their website" }, url: /^https?:\/\//.test(n.website) ? n.website : `https://${n.website}` }] : []),
        ],
      },
    ],
  };
  try {
    const r = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) {
      log.error("signup-notify: Slack webhook rejected", { status: r.status, body: (await r.text().catch(() => "")).slice(0, 200) });
      return false;
    }
    return true;
  } catch (e) {
    log.error("signup-notify: Slack webhook failed", { err: (e as Error).message });
    return false;
  }
}

export async function emailTeam(n: SignupNotice): Promise<boolean> {
  const to = process.env.SIGNUP_NOTIFY_TO?.trim() || "contact@nvc360.com";
  const rows = signupRows(n);
  const text = [`New ArrivePing signup`, "", ...rows.map(([k, v]) => `${k}: ${v}`)].join("\n");
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#202226;line-height:1.5">
  <h2 style="margin:0 0 16px;font-size:18px">New ArrivePing signup: ${esc(n.companyName)}</h2>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    ${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 16px 6px 0;color:#626773;font-size:14px;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;font-size:14px">${/^https?:\/\//.test(v) ? `<a href="${esc(v)}">${esc(v)}</a>` : esc(v)}</td></tr>`,
      )
      .join("")}
  </table>
  <p style="margin:20px 0 0;color:#626773;font-size:13px">They started a ${TRIAL_DAYS}-day free trial. Reply to this email to reach ${esc(n.adminName || "them")}.</p>
</body></html>`;
  const r = await sendEmail({ to, subject: `New signup — ${n.companyName} (${n.adminName || n.adminEmail})`, html, text, replyTo: n.adminEmail });
  if (!r.ok) log.error("signup-notify: email failed or skipped", { to, skipped: "skipped" in r && r.skipped });
  return r.ok;
}

export async function notifySelfServeSignup(n: SignupNotice): Promise<{ slack: boolean; email: boolean }> {
  const [slack, email] = await Promise.all([postSlack(n), emailTeam(n)]);
  log.info("signup-notify: done", { companyId: n.companyId, slack, email });
  return { slack, email };
}
