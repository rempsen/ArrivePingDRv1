import type { AppEnv } from "../env";
import { Hono } from "hono";
import { z } from "zod";
import { rateLimit, keyByIp } from "../lib/rate-limit";
import { parseBody, email as emailField, optText } from "../lib/validate";
import { sendEmail } from "../../services/email";

/**
 * PUBLIC "Book a demo" form on the marketing site (arriveping.com/#book-a-demo).
 *
 * Unauthenticated by design. Writes nothing to the database — it emails the
 * request to the sales inbox with Reply-To set to the requester, so the team
 * can answer straight from their mail client. Protected by a per-IP limiter
 * and a honeypot field (`website`) that real visitors never see or fill.
 */

const DEMO_INBOX = process.env.DEMO_REQUEST_TO || "contact@nvc360.com";

const DemoRequest = z.object({
  name: z.string({ message: "Name is required" }).trim().min(1, "Name is required").max(200, "Must be 200 characters or fewer"),
  email: emailField("Work email"),
  company: z.string({ message: "Company is required" }).trim().min(1, "Company is required").max(200, "Must be 200 characters or fewer"),
  teamSize: optText(40),
  message: optText(2_000),
  /** honeypot — hidden from humans; any value means a bot */
  website: optText(500),
});

const demoLimiter = rateLimit({
  name: "public-demo",
  limit: Number(process.env.RL_DEMO_REQUEST_LIMIT ?? 5),
  windowMs: 10 * 60_000,
  keyFn: keyByIp,
});

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

export const demoRequestRoutes = new Hono<AppEnv>().post("/", demoLimiter, async (c) => {
  const b = await parseBody(c, DemoRequest);

  // Honeypot tripped: pretend success so the bot learns nothing.
  if (b.website && b.website.length > 0) {
    console.log(`[demo-request] honeypot tripped from ${c.req.header("x-forwarded-for") ?? "unknown"}`);
    return c.json({ ok: true });
  }

  const rows: [string, string][] = [
    ["Name", b.name],
    ["Work email", b.email],
    ["Company", b.company],
    ["Field team size", b.teamSize || "—"],
  ];
  if (b.message) rows.push(["Message", b.message]);
  const referer = c.req.header("referer");
  if (referer) rows.push(["Submitted from", referer]);

  const text = [`New demo request from the ArrivePing website`, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", `Reply to this email to respond to ${b.name}.`].join("\n");
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Inter,sans-serif;color:#202226;line-height:1.5">
  <h2 style="margin:0 0 16px;font-size:18px">New demo request from the ArrivePing website</h2>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    ${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 16px 6px 0;color:#626773;font-size:14px;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;font-size:14px;white-space:pre-wrap">${esc(v)}</td></tr>`,
      )
      .join("")}
  </table>
  <p style="margin:20px 0 0;color:#626773;font-size:13px">Reply to this email to respond to ${esc(b.name)}.</p>
</body></html>`;

  const result = await sendEmail({
    to: DEMO_INBOX,
    subject: `Demo request — ${b.company} (${b.name})`,
    html,
    text,
    replyTo: b.email,
  });

  if (!result.ok) {
    if ("skipped" in result && result.skipped) {
      // No RESEND_API_KEY in this environment: log loudly, but don't fail the
      // visitor — the request is still visible in server logs.
      console.warn(`[demo-request] email skipped (no RESEND_API_KEY) — ${b.name} <${b.email}> @ ${b.company}`);
      return c.json({ ok: true });
    }
    console.error(`[demo-request] email failed for ${b.email}`, result);
    return c.json({ ok: false, error: { code: "email_failed", message: "We couldn't send your request. Please email contact@nvc360.com." } }, 502);
  }

  return c.json({ ok: true });
});
