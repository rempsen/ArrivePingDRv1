import type { AppEnv } from "../env";
import { Hono } from "hono";
import { z } from "zod";
import { rateLimit, keyByIp, envLimit } from "../lib/rate-limit";
import { parseBody, optText, ValidationError } from "../lib/validate";
import { parseContact, submitContactRequest } from "../../services/contact-request";

/**
 * PUBLIC "Would you like to be contacted by an NVC360 associate?" — the Yes
 * branch of the homepage sign-up card. Unauthenticated by design. Saves the
 * lead, pushes it to HubSpot and emails the sales inbox
 * (services/contact-request.ts). Per-IP rate limit + honeypot.
 */

const ContactRequestBody = z.object({
  name: z.string({ message: "Name is required" }).trim().min(1, "Name is required").max(200, "Must be 200 characters or fewer"),
  /** One box: an email address or a phone number. */
  contact: z.string({ message: "Add an email or phone number" }).trim().min(1, "Add an email or phone number").max(254, "Too long"),
  company: optText(200),
  /** honeypot — hidden from humans; any value means a bot */
  website: optText(500),
});

const contactLimiter = rateLimit({
  name: "public-contact-request",
  // envLimit falls back on a missing or malformed value, so a typo can't disable the limit.
  limit: () => envLimit("RL_CONTACT_REQUEST_LIMIT", 5),
  windowMs: 10 * 60_000,
  keyFn: keyByIp,
});

export const contactRequestRoutes = new Hono<AppEnv>().post("/", contactLimiter, async (c) => {
  const b = await parseBody(c, ContactRequestBody);

  // Honeypot tripped: pretend success so the bot learns nothing.
  if (b.website && b.website.length > 0) {
    console.log(`[contact-request] honeypot tripped from ${c.req.header("x-forwarded-for") ?? "unknown"}`);
    return c.json({ ok: true });
  }

  const contact = parseContact(b.contact);
  if (!contact) {
    const msg = "Enter a valid email address or a phone number with area code";
    throw new ValidationError({ contact: msg }, msg);
  }

  const result = await submitContactRequest({
    name: b.name,
    ...contact,
    company: b.company || undefined,
    source: "homepage",
  });

  if (!result.delivered) {
    return c.json(
      { ok: false, error: { code: "delivery_failed", message: "We couldn't send your request. Please email contact@nvc360.com." } },
      502,
    );
  }
  return c.json({ ok: true });
});
