/**
 * Settings → Billing: the tenant manages its own ArrivePing subscription.
 * See services/billing-subscription.ts for the money model.
 */
import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin, sessionUser, tenantId } from "../middleware/auth";
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
  billableSeatCounts,
  officeRemovable,
  activationBlock,
  trialBlock,
  startActivation,
  completeActivation,
} from "../../services/billing-subscription";
import { AccessError, downsize, keepOnPlan, seatCandidates } from "../../services/user-access";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { convertDemo } from "../../services/demo-factory";
import { log } from "../lib/logger";
import type { AppEnv } from "../env";

/** Body of every "the card form saved a card, finish the job" call (activate, trial, change card). */
const SetupIntentBody = z.object({ setupIntentId: z.string().max(80) });
type SetupIntentBody = z.infer<typeof SetupIntentBody>;

const ACTIVATION_BLOCKED: Record<string, string> = {
  stripe_off: "Card payments aren't switched on yet. Contact contact@nvc360.com.",
  own_account: "ArrivePing's own account isn't billed.",
  already_billed: "This account already has a plan. Manage it below.",
  not_found: "Company not found.",
  demo: "This is a demo account. Start the free trial instead.",
  not_demo: "A free trial can only be started from a demo account.",
};

export const billingRoutes = new Hono<AppEnv>()
  .get("/summary", requireAdmin, async (c) => c.json(await billingSummary(tenantId(c)), 200))

  .post("/seats", requireAdmin, jsonBody(z.object({ seats: z.number().int().min(1).max(10_000) })), async (c) => {
    const { seats } = c.req.valid("json");
    const r = await setSeats(tenantId(c), seats);
    capture("billing.seats_changed", tenantId(c), { seats: r.seats, by: sessionUser(c).id });
    return c.json({ ok: true, ...r }, 200);
  })

  // Lowering seats below the billable count (field staff + extra office
  // users): pick who comes off. One request reassigns their open jobs,
  // deactivates them and sets the seats. officeRemovable caps how many office
  // users can be picked, so the included dispatcher license stays in use.
  .get("/seat-candidates", requireAdmin, async (c) => {
    const cid = tenantId(c);
    const me = sessionUser(c);
    const candidates = await seatCandidates(cid, me);
    const { office } = await billableSeatCounts(cid);
    return c.json({ candidates, officeRemovable: officeRemovable(office) }, 200);
  })
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
      const me = sessionUser(c);
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

  // Undo a removal before the paid period ends: they stay on the plan.
  .post("/keep", requireAdmin, jsonBody(z.object({ userId: z.string().min(1).max(80) })), async (c) => {
    const cid = tenantId(c);
    const me = sessionUser(c);
    try {
      await keepOnPlan(cid, me, c.req.valid("json").userId);
      return c.json(await billingSummary(cid), 200);
    } catch (e) {
      if (e instanceof AccessError) return c.json({ code: e.code, message: e.message, meta: e.meta ?? null }, e.status);
      throw e;
    }
  })

  .post("/cancel", requireAdmin, async (c) => {
    await cancelAtPeriodEnd(tenantId(c), true);
    capture("billing.cancel_scheduled", tenantId(c), { by: sessionUser(c).id });
    return c.json(await billingSummary(tenantId(c)), 200);
  })
  .post("/resume", requireAdmin, async (c) => {
    await cancelAtPeriodEnd(tenantId(c), false);
    capture("billing.cancel_reverted", tenantId(c), { by: sessionUser(c).id });
    return c.json(await billingSummary(tenantId(c)), 200);
  })

  // Start a paid plan on a company our team set up before self-serve signup
  // (no subscription yet). Card on Stripe's form, first month charged now.
  .post("/activate", requireAdmin, async (c) => {
    const cid = tenantId(c);
    const block = await activationBlock(cid);
    if (block) return c.json({ message: ACTIVATION_BLOCKED[block] }, 400);
    const me = sessionUser(c);
    const r = await startActivation(cid, { email: me.email, name: me.name });
    return c.json({ ...r, publishableKey: STRIPE_PUBLISHABLE_KEY }, 200);
  })
  .post("/activate/confirm", requireAdmin, jsonBody(SetupIntentBody), async (c) => {
    const cid = tenantId(c);
    const block = await activationBlock(cid);
    if (block) return c.json({ message: ACTIVATION_BLOCKED[block] }, 400);
    const { setupIntentId }: SetupIntentBody = c.req.valid("json");
    const r = await completeActivation(cid, setupIntentId);
    if (!r.ok) return c.json({ message: r.message }, 402);
    capture("billing.plan_activated", cid, { by: sessionUser(c).id, seats: r.seats });
    return c.json(await billingSummary(cid), 200);
  })

  // A demo becomes a real customer by starting the 30-day free trial: card saved
  // (nothing charged), trial subscription, then the demo is converted in place.
  .post("/trial", requireAdmin, async (c) => {
    const cid = tenantId(c);
    const block = await trialBlock(cid);
    if (block) return c.json({ message: ACTIVATION_BLOCKED[block] }, 400);
    const me = sessionUser(c);
    const r = await startActivation(cid, { email: me.email, name: me.name });
    return c.json({ ...r, publishableKey: STRIPE_PUBLISHABLE_KEY }, 200);
  })
  .post("/trial/confirm", requireAdmin, jsonBody(SetupIntentBody), async (c) => {
    const cid = tenantId(c);
    const me = sessionUser(c);
    const block = await trialBlock(cid);
    // Already subscribed (a second tab, a retry): nothing more to start; finish the conversion if it was missed.
    if (block && block !== "already_billed") return c.json({ message: ACTIVATION_BLOCKED[block] }, 400);
    if (!block) {
      const { setupIntentId }: SetupIntentBody = c.req.valid("json");
      const r = await completeActivation(cid, setupIntentId, { trial: true });
      if (!r.ok) return c.json({ message: r.message }, 402);
      capture("billing.trial_started", cid, { by: me.id, seats: r.seats });
    }
    const [co] = await db.select({ kind: schema.companies.kind }).from(schema.companies).where(eq(schema.companies.id, cid));
    if (co?.kind === "demo") {
      // The trial exists either way; if this fails, the next confirm or a staff Convert finishes it.
      await convertDemo(cid, { keepSample: false }, { id: me.id, name: me.name ?? "Demo user" }).catch((e) =>
        log.error("billing trial: demo conversion failed after the trial started", { companyId: cid, err: (e as Error).message.slice(0, 200) }),
      );
    }
    return c.json(await billingSummary(cid), 200);
  })

  .post("/payment-method", requireAdmin, async (c) => {
    const r = await startPaymentMethodChange(tenantId(c));
    if (!r) return c.json({ message: "Billing is not set up for this account." }, 400);
    return c.json({ ...r, publishableKey: STRIPE_PUBLISHABLE_KEY }, 200);
  })
  .post("/payment-method/confirm", requireAdmin, jsonBody(SetupIntentBody), async (c) => {
    const r = await confirmPaymentMethodChange(tenantId(c), c.req.valid("json").setupIntentId);
    if (!r.ok) return c.json({ message: r.message }, 400);
    capture("billing.card_changed", tenantId(c), { by: sessionUser(c).id });
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
    capture("billing.account_closed", cid, { by: sessionUser(c).id });
    return c.json({ ok: true }, 200);
  });
