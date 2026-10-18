import type { AppEnv } from "../env";
import { Hono } from "hono";
import { z } from "zod";
import { rateLimit, keyByIp, envLimit } from "../lib/rate-limit";
import { parseBody, email as emailField, optText } from "../lib/validate";
import { deliverWebsiteInquiry } from "../../services/website-inquiry";

/**
 * PUBLIC contact and support forms on nvc360.com (a static site on another
 * domain, hence the permissive /api/public CORS). Writes nothing to our
 * database: the message goes to HubSpot and the team inboxes (support also
 * to Slack) — see services/website-inquiry.ts. Per-IP limiter + honeypot.
 */

const InquiryBody = z.object({
  kind: z.enum(["contact", "support"]).default("contact"),
  name: z.string({ message: "Name is required" }).trim().min(1, "Name is required").max(200, "Must be 200 characters or fewer"),
  email: emailField("Email"),
  company: optText(200),
  topic: optText(80),
  message: z
    .string({ message: "Message is required" })
    .trim()
    .min(1, "Message is required")
    .max(4_000, "Must be 4,000 characters or fewer"),
  page: optText(300),
  /** honeypot — hidden from humans; any value means a bot */
  website: optText(500),
});

const inquiryLimiter = rateLimit({
  name: "public-website-inquiry",
  limit: () => envLimit("RL_WEBSITE_INQUIRY_LIMIT", 5),
  windowMs: 10 * 60_000,
  keyFn: keyByIp,
});

export const websiteInquiryRoutes = new Hono<AppEnv>().post("/", inquiryLimiter, async (c) => {
  const b = await parseBody(c, InquiryBody);

  if (b.website && b.website.length > 0) {
    console.log(`[website-inquiry] honeypot tripped from ${c.req.header("x-forwarded-for") ?? "unknown"}`);
    return c.json({ ok: true });
  }

  // Only a site-relative path; never echo an arbitrary URL into email, Slack or HubSpot.
  const page = b.page && /^\/[\w\-./#?=&%]*$/.test(b.page) ? b.page : undefined;

  const r = await deliverWebsiteInquiry({
    kind: b.kind,
    name: b.name,
    email: b.email,
    company: b.company || undefined,
    topic: b.topic || undefined,
    message: b.message,
    page,
  });

  if (!r.delivered) {
    const inbox = b.kind === "support" ? "support@nvc360.com" : "contact@nvc360.com";
    return c.json({ ok: false, error: { code: "delivery_failed", message: `We couldn't send your message. Please email ${inbox}.` } }, 502);
  }
  return c.json({ ok: true });
});
