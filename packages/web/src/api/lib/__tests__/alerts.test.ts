/**
 * Per-tenant error alerting — detector behavior.
 *
 * We set the alert env BEFORE importing the module (config is read at load),
 * force the in-memory path (no REDIS_URL), and stub the webhook channel with a
 * local fetch spy so no network call leaves the test. Asserts:
 *   - alerts fire only at/after the threshold
 *   - cooldown debounces repeat bursts for the same tenant
 *   - tenants are counted independently (one tenant's burst never alerts another)
 */
import { describe, it, expect, beforeEach, afterAll } from "bun:test";

// --- configure BEFORE import ---
process.env.REDIS_URL = ""; // force in-memory counter + cooldown
process.env.ALERT_WEBHOOK_URL = "https://example.test/hook";
process.env.ALERT_EMAIL = ""; // webhook-only so we don't touch Resend
process.env.ALERT_ERROR_THRESHOLD = "3";
process.env.ALERT_WINDOW_MS = "60000";
process.env.ALERT_COOLDOWN_MS = "100000";

const { recordError, alertsEnabled, _resetAlerts } = await import("../alerts");

// capture webhook deliveries
let hits: Array<{ tenant: string; count: number }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
  try {
    const b = JSON.parse(String(init?.body ?? "{}"));
    hits.push({ tenant: b.tenant, count: b.count });
  } catch {
    /* ignore */
  }
  return new Response("ok", { status: 200 });
}) as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
});

// recordError is fire-and-forget; give the microtask queue a beat to flush.
const flush = () => new Promise((r) => setTimeout(r, 20));

function err(companyId: string) {
  recordError({ companyId, route: "/api/x", method: "POST", status: 500, message: "boom" });
}

describe("per-tenant error alerting", () => {
  beforeEach(() => {
    hits = [];
    _resetAlerts();
  });

  it("is enabled when a channel is configured", () => {
    expect(alertsEnabled()).toBe(true);
  });

  it("does not alert below threshold", async () => {
    err("acme");
    err("acme"); // 2 < threshold(3)
    await flush();
    expect(hits.length).toBe(0);
  });

  it("alerts once at threshold and debounces the rest (cooldown)", async () => {
    err("acme");
    err("acme");
    err("acme"); // hits threshold -> 1 alert
    err("acme");
    err("acme"); // still within cooldown -> suppressed
    await flush();
    expect(hits.length).toBe(1);
    expect(hits[0]?.tenant).toBe("acme");
    expect(hits[0]?.count).toBeGreaterThanOrEqual(3);
  });

  it("counts tenants independently", async () => {
    // acme trips, bolt only has 2 — bolt must stay silent.
    err("acme");
    err("acme");
    err("acme");
    err("bolt");
    err("bolt");
    await flush();
    expect(hits.length).toBe(1);
    expect(hits[0]?.tenant).toBe("acme");
  });
});
