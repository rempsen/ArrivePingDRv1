/**
 * Settings → Billing: the tenant manages its own ArrivePing subscription.
 * See services/billing-subscription.ts for the money model.
 */
import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin, tenantId } from "../middleware/auth";
import { jsonBody } from "../lib/validate";
import { capture } from "../lib/analytics";
import { STRIPE_PUBLISHABLE_KEY } from "../../services/stripe";
import {
  billingSummary,
  setSeats,
  cancelAtPeriodEnd,
  startPaymentMethodChange,
  confirmPaymentMethodChange,
  closeAccount,
} from "../../services/billing-subscription";
import { AccessError, downsize, seatCandidates } from "../../services/user-access";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../env";

export const billingRoutes = new Hono<AppEnv>()
  .get("/summary", requireAdmin, async (c) => c.json(await billingSummary(tenantId(c)), 200))

  .post("/seats", requireAdmin, jsonBody(z.object({ seats: z.number().int().min(1).max(10_000) })), async (c) => {
    const { seats } = c.req.valid("json");
    const r = await setSeats(tenantId(c), seats);
    capture("billing.seats_changed", tenantId(c), { seats: r.seats, by: (c.get("user") as { id: string }).id });
    return c.json({ ok: true, ...r }, 200);
  })

  // Lowering seats below the active driver count: pick who comes off. One
  // request reassigns their open jobs, deactivates them and sets the seats.
  .get("/seat-candidates", requireAdmin, async (c) => c.json({ candidates: await seatCandidates(tenantId(c)) }, 200))
  .post(
    "/downsize",
    requireAdmin,
    jsonBody(
      z.object({
        seats: z.number().int().min(1).max(10_000),
        deactivate: z.array(z.string().min(1).max(80)).min(1).max(500),
        reassign: z.record(z.string().min(1).max(80), z.union([z.string().min(1).max(80), z.null()])).default({}),
      }),
    ),
    async (c) => {
      const cid = tenantId(c);
      const me = c.get("user") as { id: string; role?: string; name?: string };
      try {
        const r = await downsize(cid, me, c.req.valid("json"));
        capture("billing.downsized", cid, { seats: r.seats, deactivated: r.deactivated.length, by: me.id });
        return c.json({ ok: true, ...r }, 200);
      } catch (e) {
        if (e instanceof AccessError) return c.json({ code: e.code, message: e.message, meta: e.meta ?? null }, e.status);
        throw e;
      }
    },
  )

  .post("/cancel", requireAdmin, async (c) => {
    await cancelAtPeriodEnd(tenantId(c), true);
    capture("billing.cancel_scheduled", tenantId(c), { by: (c.get("user") as { id: string }).id });
    return c.json(await billingSummary(tenantId(c)), 200);
  })
  .post("/resume", requireAdmin, async (c) => {
    await cancelAtPeriodEnd(tenantId(c), false);
    capture("billing.cancel_reverted", tenantId(c), { by: (c.get("user") as { id: string }).id });
    return c.json(await billingSummary(tenantId(c)), 200);
  })

  .post("/payment-method", requireAdmin, async (c) => {
    const r = await startPaymentMethodChange(tenantId(c));
    if (!r) return c.json({ message: "Billing is not set up for this account." }, 400);
    return c.json({ ...r, publishableKey: STRIPE_PUBLISHABLE_KEY }, 200);
  })
  .post("/payment-method/confirm", requireAdmin, jsonBody(z.object({ setupIntentId: z.string().max(80) })), async (c) => {
    const r = await confirmPaymentMethodChange(tenantId(c), c.req.valid("json").setupIntentId);
    if (!r.ok) return c.json({ message: r.message }, 400);
    capture("billing.card_changed", tenantId(c), { by: (c.get("user") as { id: string }).id });
    return c.json(await billingSummary(tenantId(c)), 200);
  })

  // Closing is final from the tenant's side: the admin must type the company
  // name. Data stays; a superadmin can reopen.
  .post("/close", requireAdmin, jsonBody(z.object({ confirmName: z.string().max(200) })), async (c) => {
    const cid = tenantId(c);
    const [co] = await db.select({ name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, cid));
    const typed = c.req.valid("json").confirmName.trim().toLowerCase();
    if (!co || typed !== co.name.trim().toLowerCase()) {
      return c.json({ message: "Type your company name exactly as shown to close the account." }, 400);
    }
    await closeAccount(cid);
    capture("billing.account_closed", cid, { by: (c.get("user") as { id: string }).id });
    return c.json({ ok: true }, 200);
  });
