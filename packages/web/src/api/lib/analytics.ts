/**
 * Server-side product analytics (PostHog), OPTIONAL and env-gated.
 *
 * With no POSTHOG_KEY this is a complete no-op — every call returns instantly,
 * nothing is imported, nothing is sent. Set POSTHOG_KEY (and optionally
 * POSTHOG_HOST, default https://us.i.posthog.com) to start capturing.
 *
 * We capture *business* events server-side (booking created, invoice paid,
 * dispatch assigned) rather than relying on the browser, because:
 *   - money/dispatch events must be counted even if the client never pings back
 *   - server events can't be blocked by ad-blockers
 *   - we control the property allow-list, so no PII leaks by accident
 *
 * Property hygiene: we only ever send the explicit fields a caller passes. Pass
 * ids and amounts, NOT names/emails/addresses. `distinctId` should be a stable
 * opaque id (companyId is a good multi-tenant default).
 */
import { log } from "./logger";

const KEY = process.env.POSTHOG_KEY;
const HOST = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

export function analyticsEnabled(): boolean {
  return Boolean(KEY);
}

// Lazily-loaded client so the dep is only touched when configured.
let client: any = null;
let ready = false;
async function ensureClient() {
  if (ready) return client;
  ready = true;
  if (!KEY) return null;
  try {
    const { PostHog } = await import("posthog-node").catch(() => ({ PostHog: null }) as any);
    if (PostHog) {
      client = new PostHog(KEY, { host: HOST, flushAt: 20, flushInterval: 10_000 });
      log.info("analytics: PostHog enabled", { host: HOST });
    }
  } catch {
    /* dep not installed — stay a no-op */
  }
  return client;
}
// warm at boot (no-op without key)
void ensureClient();

export type AnalyticsEvent =
  | "booking.created"
  | "booking.completed"
  | "invoice.paid"
  | "dispatch.assigned"
  | "user.signed_in"
  | "stripe.connect_started"
  | "stripe.use_platform_toggled";

/**
 * Capture a business event. Fire-and-forget: never throws, never blocks the
 * request. `distinctId` should be stable + opaque (e.g. companyId or userId).
 */
export function capture(
  event: AnalyticsEvent,
  distinctId: string,
  properties?: Record<string, unknown>,
): void {
  if (!KEY) return;
  void (async () => {
    try {
      const c = await ensureClient();
      c?.capture({ distinctId: distinctId || "anonymous", event, properties: properties ?? {} });
    } catch {
      /* swallow — analytics must never affect request handling */
    }
  })();
}

/** Best-effort flush before shutdown (resolves immediately when disabled). */
export async function flushAnalytics(): Promise<void> {
  try {
    if (client?.shutdown) await client.shutdown();
    else if (client?.flush) await client.flush();
  } catch {
    /* shutting down anyway */
  }
}
