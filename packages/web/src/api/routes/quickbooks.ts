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
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database";
import * as schema from "../database/schema";
import { log } from "../lib/logger";
import { officeCan, requireAuth, tx } from "../middleware/auth";
import { jsonBody } from "../lib/validate";
import type { AppEnv } from "../env";
import type { Customer, Item, TaxCode, Vendor, WebhookPayload } from "../../services/quickbooks/entities";
import { handleWebhook, verifyIntuitSignature } from "../../services/quickbooks/pull";
import { loadConnection, qboQuery } from "../../services/quickbooks/client";
import { settings, setMapping, type QboSettings } from "../../services/quickbooks/resolve";
import { patchConfig } from "../../services/quickbooks/sweep";
import { syncBookingNow } from "../../services/quickbooks/sync";

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

/* ----------------------------------------------------------- tenant routes */

const SettingsBody = z
  .object({
    billMode: z.enum(["arriveping", "subtrade"]).optional(),
    shadow: z.boolean().optional(),
    taxCodeId: z.string().trim().max(40).optional(),
    defaultItemId: z.string().trim().max(40).optional(),
    parentCustomerId: z.string().trim().max(40).optional(),
    syncSince: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-29").optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { error: "Nothing to update" });

const MappingBody = z.object({
  kind: z.enum(["vendor", "item", "customer"]),
  localId: z.string().trim().min(1).max(80),
  qboId: z.string().trim().min(1).max(40),
});

const canEdit = async (c: { get: (k: "user") => unknown }) => officeCan(c.get("user") as never, "integrations.edit");
const canView = async (c: { get: (k: "user") => unknown }) => officeCan(c.get("user") as never, "integrations.view");

/** Tenant-facing QuickBooks Sync API (feature-gated by integrations.quickbooks). */
export const quickbooksRoutes = new Hono<AppEnv>()
  .use("*", requireAuth)

  .get("/status", async (c) => {
    if (!(await canView(c))) return c.json({ message: "Forbidden" }, 403);
    const companyId = c.get("companyId") as string;
    const conn = await loadConnection(companyId);
    const cfg = await settings(companyId);
    const [row] = await tx(c).select(schema.integrations, eq(schema.integrations.provider, "quickbooks"));
    const openIssues = (await tx(c).select(schema.qboIssues, eq(schema.qboIssues.status, "open"))).length;
    return c.json({
      connected: !!conn && conn.status === "connected",
      status: conn?.status ?? "disconnected",
      companyName: row?.accountLabel ?? "",
      realmId: conn?.realmId ?? "",
      lastSyncAt: row?.lastSyncAt ?? null,
      openIssues,
      ...cfg,
    });
  })

  .put("/settings", jsonBody(SettingsBody), async (c) => {
    if (!(await canEdit(c))) return c.json({ message: "Forbidden" }, 403);
    const companyId = c.get("companyId") as string;
    const body = c.req.valid("json") as Partial<QboSettings>;
    await patchConfig(companyId, body);
    return c.json({ ok: true, ...(await settings(companyId)) });
  })

  // Live from QuickBooks, for the selects on the Integrations page.
  .get("/options", async (c) => {
    if (!(await canView(c))) return c.json({ message: "Forbidden" }, 403);
    const companyId = c.get("companyId") as string;
    const conn = await loadConnection(companyId);
    if (!conn || conn.status !== "connected") return c.json({ taxCodes: [], items: [], customers: [], vendors: [], connected: false });
    const [taxCodes, items, customers, vendors] = await Promise.all([
      qboQuery<TaxCode>(companyId, "SELECT * FROM TaxCode WHERE Active = true MAXRESULTS 200"),
      qboQuery<Item>(companyId, "SELECT * FROM Item WHERE Active = true ORDERBY Name MAXRESULTS 1000"),
      qboQuery<Customer>(companyId, "SELECT * FROM Customer WHERE Active = true AND Job = false ORDERBY DisplayName MAXRESULTS 1000"),
      qboQuery<Vendor>(companyId, "SELECT * FROM Vendor WHERE Active = true ORDERBY DisplayName MAXRESULTS 1000"),
    ]);
    return c.json({
      connected: true,
      taxCodes: taxCodes.map((t) => ({ id: t.Id, name: t.Name })),
      items: items.filter((i) => i.Type !== "Category").map((i) => ({ id: i.Id, name: i.FullyQualifiedName ?? i.Name })),
      customers: customers.map((x) => ({ id: x.Id, name: x.DisplayName })),
      vendors: vendors.map((v) => ({ id: v.Id, name: v.DisplayName })),
    });
  })

  .get("/mappings", async (c) => {
    if (!(await canView(c))) return c.json({ message: "Forbidden" }, 403);
    const companyId = c.get("companyId") as string;
    const t = tx(c);
    const [riders, templates, links] = await Promise.all([
      t.select(schema.riders),
      t.select(schema.taskTemplates),
      t.select(schema.qboLinks, inArray(schema.qboLinks.kind, ["vendor", "item"])),
    ]);
    const userIds = riders.map((r) => r.userId);
    const users = userIds.length ? await t.select(schema.user, inArray(schema.user.id, userIds)) : [];
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    const byLocal = new Map(links.map((l) => [`${l.kind}:${l.localId}`, l.qboId]));
    // Names for the linked QuickBooks records, when QuickBooks answers.
    const conn = await loadConnection(companyId);
    let vendorNames = new Map<string, string>();
    let itemNames = new Map<string, string>();
    if (conn && conn.status === "connected" && links.length) {
      try {
        const [vs, is] = await Promise.all([
          qboQuery<Vendor>(companyId, "SELECT Id, DisplayName FROM Vendor WHERE Active = true MAXRESULTS 1000"),
          qboQuery<Item>(companyId, "SELECT Id, Name, FullyQualifiedName FROM Item WHERE Active = true MAXRESULTS 1000"),
        ]);
        vendorNames = new Map(vs.map((v) => [v.Id, v.DisplayName]));
        itemNames = new Map(is.map((i) => [i.Id, i.FullyQualifiedName ?? i.Name]));
      } catch (e) {
        log.warn("quickbooks mappings: names unavailable", { error: e instanceof Error ? e.message : String(e) });
      }
    }
    return c.json({
      technicians: riders.map((r) => {
        const qboId = byLocal.get(`vendor:${r.id}`) ?? "";
        return { riderId: r.id, name: nameOf.get(r.userId) ?? "", qboId, qboName: qboId ? (vendorNames.get(qboId) ?? "") : "" };
      }),
      templates: templates.map((tp) => {
        const qboId = byLocal.get(`item:${tp.id}`) ?? "";
        return { templateId: tp.id, name: tp.name, qboId, qboName: qboId ? (itemNames.get(qboId) ?? "") : "" };
      }),
    });
  })

  .put("/mappings", jsonBody(MappingBody), async (c) => {
    if (!(await canEdit(c))) return c.json({ message: "Forbidden" }, 403);
    const { kind, localId, qboId } = c.req.valid("json");
    await setMapping(c.get("companyId") as string, kind, localId, qboId);
    return c.json({ ok: true });
  })

  .get("/issues", async (c) => {
    if (!(await canView(c))) return c.json({ message: "Forbidden" }, 403);
    const companyId = c.get("companyId") as string;
    // tenant transaction: qbo_issues has forced RLS, so the raw client would see nothing
    // Open issues need a person. Notes the sync left already resolved
    // (shadow-mode payloads, renamed records, reactivated customers — raised
    // and resolved in the same instant) are listed after them for a week;
    // issues a person resolved are not shown again.
    const weekAgo = new Date(Date.now() - 7 * 86400_000);
    const rows = await tx(c).transaction((t) =>
      t
        .select()
        .from(schema.qboIssues)
        .where(
          and(
            eq(schema.qboIssues.companyId, companyId),
            or(eq(schema.qboIssues.status, "open"), and(gte(schema.qboIssues.resolvedAt, weekAgo), sql`${schema.qboIssues.resolvedAt} <= ${schema.qboIssues.createdAt} + interval '2 seconds'`)),
          ),
        )
        .orderBy(desc(schema.qboIssues.createdAt))
        .limit(300),
    );
    const shape = (r: (typeof rows)[number]) => {
      let detail: unknown = {};
      try {
        detail = JSON.parse(r.detail);
      } catch {
        /* raw */
      }
      return { id: r.id, bookingId: r.bookingId, kind: r.kind, message: r.message, detail, createdAt: r.createdAt, resolved: r.status !== "open", resolvedAt: r.resolvedAt };
    };
    return c.json({ issues: [...rows.filter((r) => r.status === "open"), ...rows.filter((r) => r.status !== "open").slice(0, 100)].map(shape) });
  })

  .post("/issues/:id/resolve", async (c) => {
    if (!(await canEdit(c))) return c.json({ message: "Forbidden" }, 403);
    await tx(c).update(schema.qboIssues, { status: "resolved", resolvedAt: new Date() }, eq(schema.qboIssues.id, c.req.param("id")));
    return c.json({ ok: true });
  })

  .post("/jobs/:id/sync", async (c) => {
    if (!(await canEdit(c))) return c.json({ message: "Forbidden" }, 403);
    const out = await syncBookingNow(c.get("companyId") as string, c.req.param("id"));
    return c.json(out);
  });
