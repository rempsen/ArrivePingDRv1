import { Hono } from "hono";
import { and, eq, gt } from "drizzle-orm";
import * as schema from "../database/schema";
import { db } from "../database";
import { tdb } from "../database/tenant";
import { resolveApiKey, scopeAllows, requireAuth, tx, tenantId } from "../middleware/auth";
import { attachMembership } from "../lib/memberships";
import { auth } from "../auth";
import { putObject } from "../lib/storage";
import { audit } from "../lib/audit";
import { jsonBody, shortText, optText, longText } from "../lib/validate";
import { z } from "zod";
import type { AppEnv } from "../env";

/**
 * "BMD Punch List" (Lovable) <-> ArrivePing integration.
 *
 * Two very different audiences hit this file:
 *  - PARTNER routes (`/ping`, `/assign`, `/changes`) are called server-to-server
 *    from a Lovable Edge Function, authenticated with an `nvc_...` secret API
 *    key scoped `punchlist:write` / `punchlist:read` — see resolveApiKey/
 *    scopeAllows in middleware/auth.ts, the same pattern routes/mcp.ts uses.
 *  - STAFF routes (`/bookings/:id/deficiencies`, `/deficiencies/:id`, photo
 *    upload) are called from the ArrivePing web/mobile app by a logged-in
 *    dispatcher or technician, authenticated with the normal session
 *    (`requireAuth` + `tx(c)` tenant scoping).
 *
 * Design doc for the full push/pull contract + literal Lovable Edge Function
 * code lives in the deliverable written alongside this integration.
 *
 * Sync-back has TWO paths, deliberately overlapping — Lovable can use either
 * or both:
 *   1. POLL  `GET /changes?since=` — the reliable source of truth. A few
 *      minutes' delay is fine per spec; this always eventually catches up.
 *   2. PUSH  best-effort near-real-time: reuses the existing per-tenant
 *      outbound webhook system (Settings > Notifications > Webhooks, table
 *      `webhookEndpoints`) that already backs booking-lifecycle events. Point
 *      one at the Lovable Edge Function URL with event `punchlist.deficiency_updated`
 *      and it fires the moment a technician updates a deficiency, no waiting
 *      on a poll cycle. If it fails or nothing is configured, the poll still
 *      picks the change up on its next pass.
 */

const PUNCHLIST_WEBHOOK_EVENT = "punchlist.deficiency_updated";

/** Best-effort push to any webhook endpoint subscribed to the punch-list
 *  event (or "*"). Never throws — the poll endpoint is the source of truth. */
async function pushDeficiencyWebhook(
  companyId: string,
  deficiency: typeof schema.deficiencies.$inferSelect,
  projectExternalId: string,
) {
  try {
    const eps = await db
      .select()
      .from(schema.webhookEndpoints)
      .where(and(eq(schema.webhookEndpoints.active, true), eq(schema.webhookEndpoints.companyId, companyId)));
    const targets = eps.filter(
      (e) => e.events === "*" || e.events.split(",").map((s) => s.trim()).includes(PUNCHLIST_WEBHOOK_EVENT),
    );
    if (!targets.length) return;
    const payload = {
      event: PUNCHLIST_WEBHOOK_EVENT,
      externalId: deficiency.externalId,
      projectExternalId,
      status: deficiency.status,
      technicianNotes: deficiency.technicianNotes,
      photosAfter: JSON.parse(deficiency.photosAfter || "[]"),
      completedAt: deficiency.completedAt ? deficiency.completedAt.toISOString() : null,
      signOffName: deficiency.signOffName,
      signOffAt: deficiency.signOffAt ? deficiency.signOffAt.toISOString() : null,
      updatedAt: deficiency.updatedAt.toISOString(),
      at: new Date().toISOString(),
    };
    for (const ep of targets) {
      const res = await fetch(ep.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(ep.secret ? { "X-Webhook-Secret": ep.secret } : {}) },
        body: JSON.stringify(payload),
      }).catch((e) => {
        throw e;
      });
      await db.insert(schema.notificationDeliveries).values({
        companyId,
        event: PUNCHLIST_WEBHOOK_EVENT,
        bookingId: deficiency.bookingId,
        recipient: "office",
        channel: "webhook",
        target: ep.url,
        status: res.ok ? "sent" : "failed",
        detail: `HTTP ${res.status}`,
      }).catch(() => {});
    }
  } catch (e) {
    console.error("[punchlist] webhook push failed", e);
  }
}

/** slug: lowercase, ascii, dashes — used as the fallback idempotency key for a
 *  trade when Lovable doesn't send us its own subcontractor id. */
function slugify(s: string): string {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "trade";
}

/** Globally-unique placeholder login for an auto-provisioned identity that
 *  nobody actually signs into yet (admin can properly invite the real person
 *  later — this just gives the FK-required `user` row something to point at). */
function placeholderEmail(kind: "trade" | "project", slug: string): string {
  return `${kind}-${slug}-${crypto.randomUUID().slice(0, 8)}@punchlist.nvc360.internal`;
}

function randomPassword(): string {
  return crypto.randomUUID() + crypto.randomUUID();
}

/** Find or create the shared "Punch List" service every auto-created project
 *  job books against — same one across every hotel project for this tenant. */
async function findOrCreatePunchlistService(companyId: string): Promise<string> {
  const t = tdb(companyId);
  const existing = await t.selectOne(schema.services, eq(schema.services.name, "Punch List / Deficiency Repair"));
  if (existing) return existing.id;
  const [row] = await t.insert(schema.services, {
    name: "Punch List / Deficiency Repair",
    category: "punchlist",
    description: "Deficiency remediation work sourced from the BMD Punch List integration.",
    icon: "clipboard-list",
    basePrice: 0,
    durationMins: 60,
  });
  return row.id;
}

/** Idempotent upsert of the hotel project -> ArrivePing Job (booking). */
async function upsertProject(
  companyId: string,
  input: { externalId: string; name: string; address?: string },
) {
  const t = tdb(companyId);
  const existing = await t.selectOne(
    schema.punchlistProjects,
    eq(schema.punchlistProjects.externalId, input.externalId),
  );
  if (existing) {
    // keep name/address fresh but never touch the booking's own working state
    await t.update(
      schema.punchlistProjects,
      { name: input.name || existing.name, address: input.address ?? existing.address, updatedAt: new Date() },
      eq(schema.punchlistProjects.id, existing.id),
    );
    if (input.name || input.address) {
      await t.update(
        schema.bookings,
        { title: input.name || undefined, address: input.address || undefined } as any,
        eq(schema.bookings.id, existing.bookingId),
      );
    }
    return { ...existing, name: input.name || existing.name, address: input.address ?? existing.address };
  }

  const slug = slugify(input.name || input.externalId);
  const email = placeholderEmail("project", slug);
  const [customer] = await db
    .insert(schema.user)
    .values({
      id: crypto.randomUUID(),
      companyId,
      name: input.name || "Hotel Project",
      email,
      role: "customer",
      emailVerified: false,
      address: input.address || "",
      notes: "Auto-created by the BMD Punch List integration — replace with the real property contact when known.",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any)
    .returning();
  await attachMembership({ userId: customer.id, companyId, role: "customer", status: "active" });

  const serviceId = await findOrCreatePunchlistService(companyId);
  const [booking] = await t.insert(schema.bookings, {
    customerId: customer.id,
    serviceId,
    title: input.name || "Hotel Punch List",
    priority: "normal",
    status: "confirmed",
    scheduledAt: new Date(),
    address: input.address || "",
    notes: `Punch list project synced from BMD Punch List. External project id: ${input.externalId}`,
  });

  const [project] = await t.insert(schema.punchlistProjects, {
    externalId: input.externalId,
    name: input.name || "",
    address: input.address || "",
    bookingId: booking.id,
    customerId: customer.id,
  });

  await audit({
    companyId,
    actorName: "BMD Punch List",
    action: "create",
    entityType: "punchlist_project",
    entityId: project.id,
    summary: `Synced hotel project "${input.name}" -> Job ${booking.id}`,
  });
  return project;
}

/** Idempotent upsert of a trade/subcontractor -> ArrivePing technician. */
async function upsertTrade(
  companyId: string,
  input: { externalId?: string; name: string; contactEmail?: string; contactPhone?: string },
) {
  const t = tdb(companyId);
  const key = input.externalId ? slugify(input.externalId) : slugify(input.name);
  const existing = await t.selectOne(
    schema.punchlistTrades,
    eq(schema.punchlistTrades.externalTradeKey, key),
  );
  if (existing) return existing;

  const slug = slugify(input.name);
  const email = input.contactEmail || placeholderEmail("trade", slug);
  let userId: string;
  const [byEmail] = await db.select().from(schema.user).where(eq(schema.user.email, email)).limit(1);
  if (byEmail) {
    userId = byEmail.id;
    await attachMembership({ userId, companyId, role: "rider", staffType: "technician", status: "invited" });
  } else {
    try {
      await auth.api.signUpEmail({
        body: { name: input.name, email, password: randomPassword(), role: "rider", phone: input.contactPhone || "" } as any,
      });
      const [created] = await db.select().from(schema.user).where(eq(schema.user.email, email)).limit(1);
      if (!created) throw new Error("failed to create technician login");
      userId = created.id;
      await db.update(schema.user).set({ role: "rider", phone: input.contactPhone || "", companyId }).where(eq(schema.user.id, userId));
      await attachMembership({ userId, companyId, role: "rider", staffType: "technician", status: "active" });
    } catch (e: any) {
      throw new Error(`could not auto-provision technician for trade "${input.name}": ${e?.message ?? e}`);
    }
  }

  const palette = ["#06b6d4", "#22c55e", "#f59e0b", "#a855f7", "#ef4444", "#3b82f6"];
  const [rider] = await t.insert(schema.riders, {
    userId,
    phone: input.contactPhone || "",
    skillClass: input.name || "General",
    vehicle: "N/A",
    color: palette[Math.floor(Math.random() * palette.length)],
    notes: "Auto-created by the BMD Punch List integration on first assignment.",
    status: "available",
  });

  const [trade] = await t.insert(schema.punchlistTrades, {
    externalTradeKey: key,
    tradeName: input.name,
    riderId: rider.id,
    contactEmail: input.contactEmail || "",
    contactPhone: input.contactPhone || "",
  });

  await audit({
    companyId,
    actorName: "BMD Punch List",
    action: "create",
    entityType: "punchlist_trade",
    entityId: trade.id,
    summary: `Auto-provisioned technician for trade "${input.name}"`,
  });
  return trade;
}

const AssignBody = z.object({
  project: z.object({
    externalId: shortText("Project external id", 200),
    name: shortText("Project name", 300).optional().default(""),
    address: optText(500),
  }),
  trade: z.object({
    externalId: optText(200),
    name: shortText("Trade name", 200),
    contactEmail: optText(200),
    contactPhone: optText(50),
  }),
  deficiency: z.object({
    externalId: shortText("Deficiency external id", 200),
    floor: optText(100),
    location: optText(200),
    area: optText(200),
    material: optText(200),
    issueType: optText(200),
    assessment: optText(50),
    description: longText(5_000),
    dueDate: optText(50),
    photos: z.array(z.string().url().max(2000)).max(50).optional(),
    updatedAt: optText(50),
  }),
});

export const punchlistRoutes = new Hono<AppEnv>()
  // -------------------------------------------------------------------------
  // PARTNER routes — secret API key, scoped punchlist:read / punchlist:write
  // -------------------------------------------------------------------------
  .get("/ping", async (c) => {
    const key = await resolveApiKey(c);
    if (!key) return c.json({ message: "Unauthorized: send 'Authorization: Bearer nvc_...'" }, 401);
    return c.json({ ok: true, companyId: key.companyId, scopes: key.scopes }, 200);
  })

  .post("/assign", jsonBody(AssignBody), async (c) => {
    const key = await resolveApiKey(c);
    if (!key) return c.json({ message: "Unauthorized: send 'Authorization: Bearer nvc_...'" }, 401);
    if (!scopeAllows(key.scopes, "punchlist:write"))
      return c.json({ message: "This key lacks the 'punchlist:write' scope." }, 403);

    const body = c.req.valid("json");
    const companyId = key.companyId;
    const t = tdb(companyId);

    const project = await upsertProject(companyId, body.project);
    const trade = await upsertTrade(companyId, body.trade);

    const sourceUpdatedAt = body.deficiency.updatedAt ? new Date(body.deficiency.updatedAt) : undefined;
    const existing = await t.selectOne(
      schema.deficiencies,
      eq(schema.deficiencies.externalId, body.deficiency.externalId),
    );

    // Never let a stale re-send clobber work ArrivePing already did.
    if (existing && sourceUpdatedAt && existing.sourceUpdatedAt && sourceUpdatedAt.getTime() <= existing.sourceUpdatedAt.getTime()) {
      return c.json({ project, trade, deficiency: existing, skipped: "stale source update" }, 200);
    }

    const descriptiveFields = {
      floor: body.deficiency.floor ?? "",
      location: body.deficiency.location ?? "",
      area: body.deficiency.area ?? "",
      material: body.deficiency.material ?? "",
      issueType: body.deficiency.issueType ?? "",
      assessment: body.deficiency.assessment ?? "",
      description: body.deficiency.description ?? "",
      tradeName: body.trade.name,
      riderId: trade.riderId,
      dueDate: body.deficiency.dueDate ? new Date(body.deficiency.dueDate) : null,
      photosBefore: JSON.stringify(body.deficiency.photos ?? []),
      sourceUpdatedAt: sourceUpdatedAt ?? new Date(),
    };

    let row: typeof schema.deficiencies.$inferSelect;
    if (existing) {
      const [updated] = await t.update(schema.deficiencies, descriptiveFields, eq(schema.deficiencies.id, existing.id));
      row = updated;
    } else {
      const [created] = await t.insert(schema.deficiencies, {
        projectId: project.id,
        bookingId: project.bookingId,
        externalId: body.deficiency.externalId,
        status: "open",
        ...descriptiveFields,
      });
      row = created;
    }

    // Reflect that the job now has an active trade assigned to it (informational
    // only — a single Job carries many trades across its deficiencies).
    await t.update(schema.bookings, { status: "assigned" }, and(eq(schema.bookings.id, project.bookingId), eq(schema.bookings.status, "confirmed")));

    await audit({
      companyId,
      actorName: `API key "${key.label}"`,
      action: existing ? "update" : "create",
      entityType: "deficiency",
      entityId: row.id,
      summary: `${existing ? "Updated" : "Created"} deficiency ${row.externalId} on "${project.name}", assigned to ${body.trade.name}`,
    });

    return c.json({ project, trade, deficiency: row }, existing ? 200 : 201);
  })

  .get("/changes", async (c) => {
    const key = await resolveApiKey(c);
    if (!key) return c.json({ message: "Unauthorized: send 'Authorization: Bearer nvc_...'" }, 401);
    if (!scopeAllows(key.scopes, "punchlist:read"))
      return c.json({ message: "This key lacks the 'punchlist:read' scope." }, 403);

    const sinceRaw = c.req.query("since");
    const since = sinceRaw ? new Date(sinceRaw) : new Date(Date.now() - 24 * 3600_000);
    const limit = Math.min(Number(c.req.query("limit") || 500) || 500, 1000);
    const serverTimeAtStart = new Date();

    const t = tdb(key.companyId);
    const rows = await t.select(
      schema.deficiencies,
      gt(schema.deficiencies.updatedAt, since),
    );
    rows.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
    const page = rows.slice(0, limit);

    // enrich with the project's external id so Lovable can route the update
    // back to the right hotel job without a second lookup.
    const projectIds = [...new Set(page.map((d) => d.projectId))];
    const projects = projectIds.length
      ? await Promise.all(projectIds.map((id) => t.selectOne(schema.punchlistProjects, eq(schema.punchlistProjects.id, id))))
      : [];
    const projectById = new Map(projects.filter(Boolean).map((p) => [p!.id, p!]));

    const changes = page.map((d) => ({
      externalId: d.externalId,
      projectExternalId: projectById.get(d.projectId)?.externalId ?? "",
      status: d.status,
      technicianNotes: d.technicianNotes,
      photosAfter: JSON.parse(d.photosAfter || "[]"),
      completedAt: d.completedAt ? d.completedAt.toISOString() : null,
      signOffName: d.signOffName,
      signOffAt: d.signOffAt ? d.signOffAt.toISOString() : null,
      updatedAt: d.updatedAt.toISOString(),
    }));

    return c.json(
      {
        changes,
        count: changes.length,
        // Lovable should store THIS as its next `since` cursor, not
        // `changes.at(-1).updatedAt` — avoids missing a row that commits
        // between the query running and the response landing.
        serverTime: serverTimeAtStart.toISOString(),
        hasMore: rows.length > page.length,
      },
      200,
    );
  })

  // -------------------------------------------------------------------------
  // STAFF routes — normal ArrivePing session (dispatcher / technician)
  // -------------------------------------------------------------------------
  .get("/bookings/:bookingId/deficiencies", requireAuth, async (c) => {
    const t = tx(c);
    const rows = await t.select(schema.deficiencies, eq(schema.deficiencies.bookingId, c.req.param("bookingId")));
    rows.sort((a, b) => (a.location || "").localeCompare(b.location || "") || (a.area || "").localeCompare(b.area || ""));
    return c.json({ deficiencies: rows }, 200);
  })

  .patch(
    "/deficiencies/:id",
    requireAuth,
    jsonBody(
      z.object({
        status: z.enum(["open", "in_progress", "done"]).optional(),
        technicianNotes: optText(5_000),
        signOffName: optText(200),
        markSignedOff: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const me = c.get("user") as { id: string; name?: string } | null;
      const b = c.req.valid("json");
      const t = tx(c);
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (b.status) {
        patch.status = b.status;
        if (b.status === "done") patch.completedAt = new Date();
      }
      if (b.technicianNotes !== undefined) patch.technicianNotes = b.technicianNotes;
      if (b.markSignedOff) {
        patch.signOffName = b.signOffName || me?.name || "";
        patch.signOffAt = new Date();
      }
      const [row] = await t.update(schema.deficiencies, patch, eq(schema.deficiencies.id, c.req.param("id")));
      if (!row) return c.json({ message: "not found" }, 404);
      await audit({
        companyId: tenantId(c),
        actorId: me?.id,
        actorName: me?.name,
        action: "update",
        entityType: "deficiency",
        entityId: row.id,
        summary: `Updated deficiency ${row.externalId} (${b.status ?? "notes/sign-off"})`,
      });
      const project = await t.selectOne(schema.punchlistProjects, eq(schema.punchlistProjects.id, row.projectId));
      pushDeficiencyWebhook(tenantId(c), row, project?.externalId ?? "").catch(() => {});
      return c.json({ deficiency: row }, 200);
    },
  )

  // upload an "after" photo for a deficiency (multipart: field "file")
  .post("/deficiencies/:id/photos", requireAuth, async (c) => {
    const t = tx(c);
    const existing = await t.selectOne(schema.deficiencies, eq(schema.deficiencies.id, c.req.param("id")));
    if (!existing) return c.json({ message: "not found" }, 404);
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ message: "No file" }, 400);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().slice(0, 8);
    const key = `punchlist/${existing.id}/${crypto.randomUUID()}.${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const stored = await putObject(key, buf, file.type || "image/jpeg");
    const photos: string[] = JSON.parse(existing.photosAfter || "[]");
    photos.push(stored.url);
    const [row] = await t.update(
      schema.deficiencies,
      { photosAfter: JSON.stringify(photos), updatedAt: new Date() },
      eq(schema.deficiencies.id, existing.id),
    );
    const project = await t.selectOne(schema.punchlistProjects, eq(schema.punchlistProjects.id, row.projectId));
    pushDeficiencyWebhook(tenantId(c), row, project?.externalId ?? "").catch(() => {});
    return c.json({ deficiency: row }, 201);
  });
