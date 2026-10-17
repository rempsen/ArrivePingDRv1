import type { AppEnv } from "../env";
import { Hono } from "hono";
import { z } from "zod";
import { rateLimit, keyByIp, envLimit } from "../lib/rate-limit";
import { parseBody, email as emailField, optText } from "../lib/validate";
import { deliverSupportMessage } from "../../services/support-message";

/**
 * PUBLIC "Send us a message" form in the Help Center (arriveping.com/support).
 *
 * Unauthenticated by design: visitors are often not signed in and usually not
 * in our Slack workspace. Writes nothing to the database — the message goes to
 * the customer-support Slack channel with an email copy to the support inbox.
 * Protected by a per-IP limiter and a honeypot field (`website`).
 */

const SupportMessageBody = z.object({
  name: z.string({ message: "Name is required" }).trim().min(1, "Name is required").max(200, "Must be 200 characters or fewer"),
  email: emailField("Email"),
  company: optText(200),
  topic: optText(60),
  message: z
    .string({ message: "Message is required" })
    .trim()
    .min(1, "Message is required")
    .max(4_000, "Must be 4,000 characters or fewer"),
  page: optText(300),
  /** honeypot — hidden from humans; any value means a bot */
  website: optText(500),
});

const supportLimiter = rateLimit({
  name: "public-support-message",
  // envLimit falls back to 5 on a missing or malformed value, so a typo can never disable the limit.
  limit: () => envLimit("RL_SUPPORT_MESSAGE_LIMIT", 5),
  windowMs: 10 * 60_000,
  keyFn: keyByIp,
});

export const supportMessageRoutes = new Hono<AppEnv>().post("/", supportLimiter, async (c) => {
  const b = await parseBody(c, SupportMessageBody);

  // Honeypot tripped: pretend success so the bot learns nothing.
  if (b.website && b.website.length > 0) {
    console.log(`[support-message] honeypot tripped from ${c.req.header("x-forwarded-for") ?? "unknown"}`);
    return c.json({ ok: true });
  }

  // Only keep a site-relative path; never echo an arbitrary URL into Slack.
  const page = b.page && /^\/[\w\-./#?=&%]*$/.test(b.page) ? b.page : undefined;

  const result = await deliverSupportMessage({
    name: b.name,
    email: b.email,
    company: b.company || undefined,
    topic: b.topic || undefined,
    message: b.message,
    page,
  });

  if (!result.delivered) {
    return c.json(
      { ok: false, error: { code: "delivery_failed", message: "We couldn't send your message. Please email support@nvc360.com." } },
      502,
    );
  }
  return c.json({ ok: true });
});
