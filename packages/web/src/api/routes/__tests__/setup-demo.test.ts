/**
 * POST /api/public/setup-demo: the homepage "try it on your website" form.
 *
 *  - A real website and email → 200 with the cleaned domain; the HubSpot
 *    lead is pushed in the background (skipped here: no token).
 *  - Something that isn't a website → 400 with a field error.
 *  - A filled honeypot → pretend success, nothing pushed.
 */
import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
delete process.env.HUBSPOT_ACCESS_TOKEN;

const { setupDemoRoutes, cleanDomain } = await import("../setup-demo");

const app = new Hono<AppEnv>()
  .route("/setup-demo", setupDemoRoutes)
  .onError((err, c) => c.json({ message: err.message }, ((err as { status?: number }).status ?? 500) as 400));

const post = (body: unknown) =>
  app.request("/setup-demo", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify(body) });

describe("cleanDomain", () => {
  it("keeps just the domain", () => {
    expect(cleanDomain("https://www.BluestemPlumbing.ca/about?x=1")).toBe("bluestemplumbing.ca");
    expect(cleanDomain("  shop.example.co.uk:443/ ")).toBe("shop.example.co.uk");
    expect(cleanDomain("bluestem-plumbing.com")).toBe("bluestem-plumbing.com");
  });
  it("rejects things that aren't websites", () => {
    for (const bad of ["", "plumber", "localhost", "http://", "a b.com", "-x.com", "x-.com", "ann@example.com", "1.2.3.4"]) expect(cleanDomain(bad)).toBeNull();
  });
});

describe("POST /setup-demo", () => {
  it("accepts a website and work email", async () => {
    const r = await post({ email: "ann@bluestemplumbing.ca", website: "https://bluestemplumbing.ca/" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, website: "bluestemplumbing.ca" });
  });

  it("asks for a real website", async () => {
    const r = await post({ email: "ann@bluestemplumbing.ca", website: "my plumbing company" });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { fields: Record<string, string> } }).error.fields.website).toBeTruthy();
  });

  it("rejects a bad email", async () => {
    const r = await post({ email: "not-an-email", website: "bluestemplumbing.ca" });
    expect(r.status).toBe(400);
  });

  it("pretends success for bots", async () => {
    const r = await post({ email: "bot@spam.test", website: "spam.test", nickname: "x" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { ok: boolean }).ok).toBe(true);
  });
});
