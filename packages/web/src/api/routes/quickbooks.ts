/**
 * QuickBooks Sync routes.
 *
 * `quickbooksWebhookRoutes` is Intuit's webhook. It is mounted BEFORE auth and
 * JSON parsing in api/index.ts (like Stripe's) so it can verify the signature
 * over the raw bytes; Intuit authenticates with the signature, nobody logs
 * in. Each delivery is deduplicated through idempotency_keys and answered at
 * once; the work happens in a scheduled task.
 */
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { log } from "../lib/logger";
import type { AppEnv } from "../env";
import type { WebhookPayload } from "../../services/quickbooks/entities";
import { handleWebhook, verifyIntuitSignature } from "../../services/quickbooks/pull";

export const quickbooksWebhookRoutes = new Hono<AppEnv>().post("/", async (c) => {
  const verifier = process.env.QUICKBOOKS_WEBHOOK_VERIFIER ?? "";
  const raw = new Uint8Array(await c.req.arrayBuffer());
  if (!verifyIntuitSignature(raw, c.req.header("intuit-signature"), verifier)) {
    log.warn("quickbooks webhook rejected: bad signature", { hasVerifier: !!verifier });
    return c.json({ error: "invalid signature" }, 401);
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw)) as WebhookPayload;
  } catch {
    return c.json({ error: "bad json" }, 400);
  }

  // One key per delivery: the realm + every entity's id and change time.
  const fingerprint = (payload.eventNotifications ?? [])
    .flatMap((n) => (n.dataChangeEvent?.entities ?? []).map((e) => `${n.realmId}:${e.name}:${e.id}:${e.lastUpdated}:${e.operation}`))
    .sort()
    .join("|");
  const key = "qbo:" + createHash("sha256").update(fingerprint).digest("hex");
  const seen = await db.select({ key: schema.idempotencyKeys.key }).from(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.key, key));
  if (seen.length) return c.json({ received: true, duplicate: true }, 200);
  await db.insert(schema.idempotencyKeys).values({ key, scope: "quickbooks_webhook", responseStatus: 200 }).onConflictDoNothing();

  try {
    await handleWebhook(payload);
  } catch (e) {
    // Queueing failed; Intuit will retry the delivery, and the dedupe key is
    // in place, so drop it so the retry isn't ignored.
    await db.delete(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.key, key)).catch(() => {});
    log.error("quickbooks webhook queue failed", { error: e instanceof Error ? e.message : String(e) });
    return c.json({ error: "queue failed" }, 500);
  }
  return c.json({ received: true }, 200);
});
