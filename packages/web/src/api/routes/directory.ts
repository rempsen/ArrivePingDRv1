/**
 * Directory API: people organised by property, resident and property manager.
 *
 *   GET    /directory                 query the people (sort, group, filter, page;
 *                                     withIds=1 adds every matching id)
 *   POST   /directory/assign          put customers at a property (or take them off)
 *   GET    /directory/properties      the named properties, plus the staff who can manage one
 *   POST   /directory/properties      create one
 *   PATCH  /directory/properties/:id  rename, move, change manager or notes
 *   DELETE /directory/properties/:id  remove (residents become unassigned)
 *   GET    /directory/ask             { available }: is the AI reading on?
 *   POST   /directory/ask             a question → filter + answer, or a filter
 *                                     sent back to re-sort / page that answer
 *
 * Office access (lib/office-access.ts): reading is clients:view, assigning is
 * clients:edit, properties follow the clients module. Rules live in
 * services/directory.ts and shared/directory-query.ts.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireAdmin, tenantId } from "../middleware/auth";
import { audit } from "../lib/audit";
import { jsonBody, shortText, id, idList } from "../lib/validate";
import {
  applyDirectoryQuery,
  DIRECTORY_GROUPS,
  DIRECTORY_KINDS,
  DIRECTORY_SORTS,
  type DirectoryQuery,
} from "../../shared/directory-query";
import {
  assignToProperty,
  createProperty,
  deleteProperty,
  DirectoryError,
  loadDirectory,
  updateProperty,
} from "../../services/directory";
import type { AppEnv } from "../env";
import { ASK_LIMITS, DirectoryFilter } from "../../shared/directory-ask";
import { askDirectory, chipsForFilter, companyNouns, directoryAskAvailable, runDirectoryFilter } from "../../services/directory-ask";

type SessionUser = { id: string; name?: string };

const PropertyCreate = z.object({
  name: shortText("Name", 120),
  address: z.string().trim().max(300, "Address is too long").optional(),
  notes: z.string().trim().max(2000, "Notes are too long").optional(),
  managerId: id("Manager").nullable().optional(),
});
const PropertyPatch = PropertyCreate.partial().refine((b) => Object.keys(b).length > 0, { error: "Nothing to update" });
const AskBody = z
  .object({
    question: z.string().trim().min(1).max(ASK_LIMITS.question).optional(),
    filter: DirectoryFilter.optional(),
    page: z.number().int().min(1).max(100_000).optional(),
    pageSize: z.number().int().min(1).max(500).optional(),
    withIds: z.boolean().optional(),
  })
  .refine((b) => !!b.question !== !!b.filter, { error: "Send a question or a filter" });
const AssignBody = z.object({
  userIds: idList("People", 5000),
  propertyId: id("Property").nullable(),
  unit: z.string().trim().max(40, "Unit is too long").optional(),
});

/** Query-string -> DirectoryQuery, ignoring anything unknown. */
export function parseDirectoryQuery(q: Record<string, string | undefined>): DirectoryQuery {
  const pick = <T extends string>(v: string | undefined, allowed: readonly T[]) => (v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);
  return {
    kind: pick(q.kind, DIRECTORY_KINDS),
    q: (q.q ?? "").slice(0, 200),
    propertyId: q.propertyId?.slice(0, 128) || undefined,
    managerId: q.managerId?.slice(0, 128) || undefined,
    sort: pick(q.sort, DIRECTORY_SORTS),
    dir: q.dir === "desc" ? "desc" : "asc",
    groupBy: pick(q.groupBy, DIRECTORY_GROUPS),
    page: q.page ? Number(q.page) : undefined,
    pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    withIds: q.withIds === "1",
  };
}

function fail(c: Context<AppEnv>, e: unknown) {
  if (e instanceof DirectoryError) return c.json({ message: e.message }, e.status);
  throw e;
}

export const directoryRoutes = new Hono<AppEnv>()
  .get("/", requireAdmin, async (c) => {
    const { rows, properties } = await loadDirectory(tenantId(c));
    const result = applyDirectoryQuery(rows, parseDirectoryQuery(c.req.query()));
    return c.json({ ...result, propertyCount: properties.length }, 200);
  })
  .post("/assign", requireAdmin, jsonBody(AssignBody), async (c) => {
    const cid = tenantId(c);
    const me = c.get("user") as SessionUser;
    const body = c.req.valid("json");
    try {
      const r = await assignToProperty(cid, body);
      await audit({
        companyId: cid,
        actorId: me.id,
        actorName: me.name,
        action: body.propertyId ? "directory.assign_property" : "directory.unassign_property",
        entityType: "property",
        entityId: body.propertyId ?? "",
        summary: body.propertyId ? `Moved ${r.updated} to a property` : `Took ${r.updated} off their property`,
        meta: { userIds: body.userIds.slice(0, 50), count: r.updated },
      });
      return c.json({ ok: true, ...r }, 200);
    } catch (e) {
      return fail(c, e);
    }
  })
  .get("/properties", requireAdmin, async (c) => {
    const { rows, properties } = await loadDirectory(tenantId(c));
    // Who can manage a property: anyone on the team, field or office.
    const staff = rows
      .filter((r) => r.kind !== "customer" && r.status !== "disabled")
      .map((r) => ({ id: r.id, name: r.name || r.email, role: r.role, kind: r.kind }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return c.json({ properties, staff }, 200);
  })
  .post("/properties", requireAdmin, jsonBody(PropertyCreate), async (c) => {
    const cid = tenantId(c);
    const me = c.get("user") as SessionUser;
    const body = c.req.valid("json");
    try {
      const r = await createProperty(cid, body);
      await audit({ companyId: cid, actorId: me.id, actorName: me.name, action: "property.create", entityType: "property", entityId: r.id, summary: `Added property ${body.name}` });
      return c.json({ ok: true, ...r }, 201);
    } catch (e) {
      return fail(c, e);
    }
  })
  .patch("/properties/:id", requireAdmin, jsonBody(PropertyPatch), async (c) => {
    const cid = tenantId(c);
    const me = c.get("user") as SessionUser;
    const pid = c.req.param("id");
    const body = c.req.valid("json");
    try {
      await updateProperty(cid, pid, body);
      await audit({ companyId: cid, actorId: me.id, actorName: me.name, action: "property.update", entityType: "property", entityId: pid, summary: "Updated property", meta: { fields: Object.keys(body) } });
      return c.json({ ok: true }, 200);
    } catch (e) {
      return fail(c, e);
    }
  })
  .get("/ask", requireAdmin, (c) => c.json({ available: directoryAskAvailable() }, 200))
  .post("/ask", requireAdmin, jsonBody(AskBody), async (c) => {
    const cid = tenantId(c);
    const me = c.get("user") as SessionUser;
    const body = c.req.valid("json");
    const nouns = await companyNouns(cid);
    if (body.question) {
      const out = await askDirectory(cid, body.question, { userId: me.id, nouns, page: body.page, pageSize: body.pageSize, abortSignal: c.req.raw.signal });
      return c.json(
        { ...out.result, ask: { question: body.question, filter: out.filter, chips: out.chips, summary: out.summary, notes: out.notes, usedAI: out.usedAI } },
        200,
      );
    }
    const filter = body.filter!;
    const result = await runDirectoryFilter(cid, filter, { page: body.page, pageSize: body.pageSize, withIds: body.withIds });
    const chips = await chipsForFilter(cid, filter, nouns);
    return c.json({ ...result, ask: { question: "", filter, chips, summary: "", notes: [] as string[], usedAI: false } }, 200);
  })
  .delete("/properties/:id", requireAdmin, async (c) => {
    const cid = tenantId(c);
    const me = c.get("user") as SessionUser;
    const pid = c.req.param("id");
    try {
      const r = await deleteProperty(cid, pid);
      await audit({ companyId: cid, actorId: me.id, actorName: me.name, action: "property.delete", entityType: "property", entityId: pid, summary: "Removed property", meta: r });
      return c.json({ ok: true, ...r }, 200);
    } catch (e) {
      return fail(c, e);
    }
  });
