/**
 * Regression test for the Stripe webhook idempotency-vs-failure bug.
 *
 * The idempotency key was written to `idempotency_keys` BEFORE the event was
 * processed. If the handler then threw (DB hiccup, bad payload, etc.) and
 * returned 500, Stripe's automatic retry of the SAME event id would hit the
 * replay guard and get swallowed as `{ duplicate: true }` — the update would
 * never actually apply, permanently, even though Stripe considers the retry
 * delivered successfully. The fix deletes the idempotency row on failure so
 * the next delivery of that event id actually reprocesses it.
 *
 * `services/stripe` is mocked rather than toggled via STRIPE_SECRET_KEY: this
 * suite's process is shared with sibling test files (Bun caches modules
 * process-wide), and another file may already have imported the real module
 * with `stripeEnabled=false` baked in before this file runs. `mock.module`
 * replaces the module for every importer regardless of load order.
 *
 * Deliberately forces the first delivery to throw with a malformed payload
 * (`data: {}`, so `pi.id` reads off `undefined`) rather than a missing table —
 * this suite's DB is Bun's shared single-process ":memory:" store, so table
 * existence can't be relied on to differ between the first and second call.
 */
import { describe, it, expect, beforeAll, mock } from "bun:test";
import { eq } from "drizzle-orm";
import { getTableConfig, type PgColumn } from "drizzle-orm/pg-core";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

mock.module("../../../services/stripe", () => ({
  stripeEnabled: true,
  STRIPE_WEBHOOK_SECRET: "", // exercises the documented dev fallback (parse-only, no sig check)
  // Called unconditionally by the route before it even checks whether a
  // webhook secret is configured, so it must return something rather than
  // throw. `webhooks.constructEvent` itself is never reached in this suite
  // because STRIPE_WEBHOOK_SECRET is "" (the documented parse-only fallback).
  getStripe: () => ({
    webhooks: {
      constructEvent: () => {
        throw new Error("not used — no signing secret configured in this test");
      },
    },
  }),
  fromMinor: (minor: number) => Math.round(minor) / 100,
  toMinor: (amount: number) => Math.round(amount * 100),
}));

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { paymentsWebhookRoutes } = await import("../payments-webhook");

function ddlFor(table: any): string {
  const cfg = getTableConfig(table);
  const cols = cfg.columns.map((col: PgColumn) => {
    const parts = [`"${col.name}"`, col.getSQLType()];
    if (col.primary) parts.push("PRIMARY KEY");
    const dflt = (col as any).default;
    let lit: string | null = null;
    if (dflt !== undefined) {
      lit =
        typeof dflt === "string" ? `'${dflt.replace(/'/g, "''")}'`
        : typeof dflt === "boolean" ? (dflt ? "TRUE" : "FALSE")
        : typeof dflt === "number" ? String(dflt)
        : null;
    }
    if (col.notNull && (lit !== null || col.primary)) parts.push("NOT NULL");
    if (lit !== null) parts.push(`DEFAULT ${lit}`);
    return parts.join(" ");
  });
  return `CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cols.join(", ")})`;
}

beforeAll(async () => {
  const sql = (db as any).$client;
  // IF NOT EXISTS — harmless if a sibling test file already created these in
  // this shared in-memory store.
  await sql.execute(ddlFor(schema.idempotencyKeys));
  await sql.execute(ddlFor(schema.invoices));
  await sql.execute(ddlFor(schema.bookings));
  await sql.execute(ddlFor(schema.paymentLedger));
});

function send(body: unknown) {
  return paymentsWebhookRoutes.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const EVENT_ID = "evt-webhook-retry-1";
const PI_ID = "pi-webhook-retry-1";

/** Malformed on purpose: `data.object` is `{}`, so `pi.id` reads off `undefined`. */
const brokenEvent = { id: EVENT_ID, type: "payment_intent.succeeded", data: {} };

/** The well-formed redelivery of the SAME event id. */
const fixedEvent = {
  id: EVENT_ID,
  type: "payment_intent.succeeded",
  data: {
    object: { id: PI_ID, status: "succeeded", latest_charge: null, last_payment_error: null },
  },
};

async function keyRow() {
  return db.select().from(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.key, EVENT_ID));
}

describe("stripe webhook — a failed delivery must not be permanently swallowed", () => {
  it("first delivery: handler throws -> 500, and the replay marker is NOT left behind", async () => {
    const res = await send(brokenEvent);
    expect(res.status).toBe(500);
    expect(await keyRow()).toHaveLength(0);
  });

  it("Stripe's retry of the SAME (still broken) event id fails again with a real 500 — not a silent duplicate no-op", async () => {
    const res = await send(brokenEvent);
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.duplicate).toBeUndefined();
    expect(await keyRow()).toHaveLength(0);
  });

  it("once redelivered well-formed, the SAME event id actually reprocesses instead of being swallowed", async () => {
    const res = await send(fixedEvent);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.received).toBe(true);
    expect(body.duplicate).toBeUndefined(); // must be a real processed delivery, not a no-op replay
    expect(await keyRow()).toHaveLength(1);
  });

  it("a genuinely repeated delivery of that now-successful event IS recognised as a duplicate", async () => {
    const res = await send(fixedEvent);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ received: true, duplicate: true });
  });
});
