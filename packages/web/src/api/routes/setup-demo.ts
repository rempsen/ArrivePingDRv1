import type { AppEnv } from "../env";
import { Hono } from "hono";
import { z } from "zod";
import { rateLimit, keyByIp, envLimit } from "../lib/rate-limit";
import { parseBody, email as emailField, optText } from "../lib/validate";
import { pushSetupDemoLead } from "../../services/hubspot-leads";

/**
 * PUBLIC: the "Try it on your website" form under the homepage setup film.
 * The visitor types their website and work email and is sent on to signup;
 * this records them as a HubSpot lead (source "ArrivePing setup demo") so a
 * signup they don't finish still reaches marketing. Writes nothing to our
 * database. Per-IP limiter + honeypot (`nickname`, hidden from people).
 */

/** "https://www.Example.ca/about" → "example.ca"; null unless it looks like a real domain. */
export function cleanDomain(raw: string): string | null {
  const d = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "");
  return /^(?=.{4,200}$)([a-z0-9-]+\.)+[a-z]{2,24}$/.test(d) && !d.split(".").some((p) => p.startsWith("-") || p.endsWith("-")) ? d : null;
}

const SetupDemoBody = z.object({
  email: emailField("Work email"),
  website: z.string({ message: "Website is required" }).trim().min(1, "Website is required").max(300, "Must be 300 characters or fewer"),
  /** honeypot — hidden from humans; any value means a bot */
  nickname: optText(200),
});

const setupDemoLimiter = rateLimit({
  name: "public-setup-demo",
  limit: () => envLimit("RL_SETUP_DEMO_LIMIT", 10),
  windowMs: 10 * 60_000,
  keyFn: keyByIp,
});

export const setupDemoRoutes = new Hono<AppEnv>().post("/", setupDemoLimiter, async (c) => {
  const b = await parseBody(c, SetupDemoBody);

  if (b.nickname && b.nickname.length > 0) {
    console.log(`[setup-demo] honeypot tripped from ${c.req.header("x-forwarded-for") ?? "unknown"}`);
    return c.json({ ok: true, website: cleanDomain(b.website) });
  }

  const website = cleanDomain(b.website);
  if (!website) {
    return c.json({ ok: false, error: { code: "validation_error", message: "Check the website address", fields: { website: "Enter a website like yourcompany.com" } } }, 400);
  }

  // Don't keep the visitor waiting on HubSpot; they're on their way to signup.
  void pushSetupDemoLead({ email: b.email, website });
  return c.json({ ok: true, website });
});
