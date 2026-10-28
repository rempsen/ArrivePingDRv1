/**
 * Intuit's webhook: accepted only with a valid signature over the raw bytes,
 * each event queued once, and answered fast (the work happens in a task).
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.QUICKBOOKS_WEBHOOK_VERIFIER = "verifier-secret";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { ensureTables } = await import("../../../test-support/tables");
const { quickbooksWebhookRoutes } = await import("../quickbooks");
const { verifyIntuitSignature } = await import("../../../services/quickbooks/pull");

const app = new Hono<AppEnv>().route("/api/integrations/quickbooks/webhook", quickbooksWebhookRoutes);
const CO = "qw-co";

const payload = {
  eventNotifications: [
    {
      realmId: "4620816365",
      dataChangeEvent: {
        entities: [
          { name: "Bill", id: "145", operation: "Update", lastUpdated: "2026-10-28T20:00:00.000Z" },
          { name: "BillPayment", id: "146", operation: "Create", lastUpdated: "2026-10-28T20:00:01.000Z" },
        ],
      },
    },
  ],
};
const raw = JSON.stringify(payload);
const sign = (body: string, secret = "verifier-secret") => createHmac("sha256", secret).update(body).digest("base64");
const post = (body: string, sig?: string) =>
  app.request("/api/integrations/quickbooks/webhook", { method: "POST", body, headers: { "content-type": "application/json", ...(sig ? { "intuit-signature": sig } : {}) } });

beforeAll(async () => {
  await ensureTables(schema.companies, schema.integrations, schema.scheduledTasks, schema.idempotencyKeys);
  await db.insert(schema.companies).values({ id: CO, name: "Webhook Co", kind: "test" } as never);
  await db.insert(schema.integrations).values({ companyId: CO, provider: "quickbooks", status: "connected", externalAccountId: "4620816365", accessToken: "a", refreshToken: "r" } as never);
});

describe("verifyIntuitSignature", () => {
  it("accepts the HMAC-SHA256 of the exact bytes and rejects anything else", () => {
    const bytes = new TextEncoder().encode(raw);
    expect(verifyIntuitSignature(bytes, sign(raw), "verifier-secret")).toBe(true);
    expect(verifyIntuitSignature(bytes, sign(raw + " "), "verifier-secret")).toBe(false);
    expect(verifyIntuitSignature(bytes, sign(raw, "other"), "verifier-secret")).toBe(false);
    expect(verifyIntuitSignature(bytes, undefined, "verifier-secret")).toBe(false);
  });
});

describe("POST /api/integrations/quickbooks/webhook", () => {
  it("rejects a bad signature", async () => {
    expect((await post(raw, sign(raw, "wrong"))).status).toBe(401);
    expect((await post(raw)).status).toBe(401);
  });

  it("queues one pull per event for the right tenant and answers 200", async () => {
    const r = await post(raw, sign(raw));
    expect(r.status).toBe(200);
    const tasks = await db.select().from(schema.scheduledTasks).where(eq(schema.scheduledTasks.companyId, CO));
    expect(tasks.map((t) => t.kind)).toEqual(["qbo.pull"]);
    const entities = JSON.parse(tasks[0]!.payload).entities;
    expect(entities).toEqual([
      { name: "Bill", id: "145", operation: "Update" },
      { name: "BillPayment", id: "146", operation: "Create" },
    ]);
  });

  it("ignores the same events delivered again", async () => {
    const r = await post(raw, sign(raw));
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).duplicate).toBe(true);
    const tasks = await db.select().from(schema.scheduledTasks).where(eq(schema.scheduledTasks.companyId, CO));
    expect(tasks.length).toBe(1);
  });

  it("answers 200 for a company we don't know, without queueing anything", async () => {
    const body = JSON.stringify({ eventNotifications: [{ realmId: "999", dataChangeEvent: { entities: [{ name: "Bill", id: "1", operation: "Create", lastUpdated: "2026-10-28T21:00:00Z" }] } }] });
    expect((await post(body, sign(body))).status).toBe(200);
    const tasks = await db.select().from(schema.scheduledTasks).where(eq(schema.scheduledTasks.companyId, CO));
    expect(tasks.length).toBe(1);
  });
});
