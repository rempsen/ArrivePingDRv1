import { Hono } from "hono";
import { tdb } from "../database/tenant";
import * as schema from "../database/schema";
import {
  eq, and, or, like, gte, lte, isNull, isNotNull, inArray, desc, asc, sql,
} from "drizzle-orm";
import { requireAuth, tenantId, tx } from "../middleware/auth";
import { isAdminRole } from "../lib/permissions";
import { toCsv, toPdf, buildJobPdf, fileResponse, tenantFilePrefix, type JobUnitLine, type JobPhoto } from "./export";
import { companyTimeZone } from "../../services/company-tz";
import { ensureSnappedRoute } from "../../services/route-snap";
import { log } from "../lib/logger";
import { fmtInZone } from "../../shared/tz";
import type { AppEnv } from "../env";

type SessionUser = { id: string; role?: string; email: string; name: string };

const isStaff = (u: SessionUser) => isAdminRole(u?.role) || u?.role === "dispatcher";

/* -------------------------------------------------------------------------- */
/*  Column catalog — every field a dispatcher can export, summary + detail.   */
/* -------------------------------------------------------------------------- */
export type ExpCol = { key: string; label: string; kind?: "money" | "num" | "pct" | "date"; group: "summary" | "detail" };

export const JOB_COLUMNS: ExpCol[] = [
  // summary
  { key: "jobNumber", label: "Job #", group: "summary" },
  { key: "title", label: "Title", group: "summary" },
  { key: "status", label: "Status", group: "summary" },
  { key: "priority", label: "Priority", group: "summary" },
  { key: "service", label: "Service", group: "summary" },
  { key: "customerName", label: "Customer", group: "summary" },
  { key: "customerPhone", label: "Phone", group: "summary" },
  { key: "customerEmail", label: "Email", group: "summary" },
  { key: "address", label: "Address", group: "summary" },
  { key: "region", label: "Region", group: "summary" },
  { key: "technician", label: "Technician", group: "summary" },
  { key: "scheduledAt", label: "Scheduled", kind: "date", group: "summary" },
  { key: "completedAt", label: "Completed", kind: "date", group: "summary" },
  { key: "total", label: "Total", kind: "money", group: "summary" },
  { key: "paymentStatus", label: "Payment", group: "summary" },
  // detail
  { key: "id", label: "Job ID", group: "detail" },
  { key: "createdAt", label: "Created", kind: "date", group: "detail" },
  { key: "startedAt", label: "Started", kind: "date", group: "detail" },
  { key: "assignStatus", label: "Assign status", group: "detail" },
  { key: "subtotal", label: "Subtotal", kind: "money", group: "detail" },
  { key: "taxAmount", label: "Tax", kind: "money", group: "detail" },
  { key: "taxLabel", label: "Tax label", group: "detail" },
  { key: "lineItemsCost", label: "Line items cost", kind: "money", group: "detail" },
  { key: "lineItemsPrice", label: "Line items price", kind: "money", group: "detail" },
  { key: "onSiteMinutes", label: "On-site min", kind: "num", group: "detail" },
  { key: "transitMinutes", label: "Transit min", kind: "num", group: "detail" },
  { key: "mileageKm", label: "Mileage km", kind: "num", group: "detail" },
  { key: "techPay", label: "Tech pay", kind: "money", group: "detail" },
  { key: "notes", label: "Notes", group: "detail" },
  { key: "lineItemsText", label: "Line items", group: "detail" },
];

const COL_BY_KEY = Object.fromEntries(JOB_COLUMNS.map((c) => [c.key, c]));

/* -------------------------------------------------------------------------- */
/*  Filter parsing → drizzle where clause                                     */
/* -------------------------------------------------------------------------- */
type Filters = {
  q?: string;            // free text: customer / address / title / job#
  status?: string[];     // multi
  priority?: string[];
  serviceId?: string;
  riderId?: string;      // technician
  paymentStatus?: string[];
  region?: string;
  tagId?: string;        // client tag
  notes?: string;        // free-text in notes
  schedFrom?: number; schedTo?: number;
  doneFrom?: number; doneTo?: number;
  priceMin?: number; priceMax?: number;
  jobId?: string;        // exact id or job-number prefix
  includeDeleted?: boolean;
};

function parseFilters(c: any): Filters {
  const q = (k: string) => { const v = c.req.query(k); return v && v.trim() ? v.trim() : undefined; };
  const arr = (k: string) => { const v = q(k); return v ? v.split(",").map((s: string) => s.trim()).filter(Boolean) : undefined; };
  const num = (k: string) => { const v = q(k); return v != null && v !== "" && !isNaN(Number(v)) ? Number(v) : undefined; };
  return {
    q: q("q"),
    status: arr("status"),
    priority: arr("priority"),
    serviceId: q("serviceId"),
    riderId: q("riderId"),
    paymentStatus: arr("paymentStatus"),
    region: q("region"),
    tagId: q("tagId"),
    notes: q("notes"),
    schedFrom: num("schedFrom"), schedTo: num("schedTo"),
    doneFrom: num("doneFrom"), doneTo: num("doneTo"),
    priceMin: num("priceMin"), priceMax: num("priceMax"),
    jobId: q("jobId"),
    includeDeleted: q("includeDeleted") === "1",
  };
}

// job number = first 8 chars of id, uppercased (display helper)
const jobNumber = (id: string) => id.replace(/-/g, "").slice(0, 8).toUpperCase();

async function buildWhere(f: Filters, cid: string): Promise<any[]> {
  const b = schema.bookings;
  const t = tdb(cid);
  const conds: any[] = [];
  // tenant boundary: every job-search query is constrained to the caller's company
  conds.push(eq(b.companyId, cid));
  if (!f.includeDeleted) conds.push(isNull(b.deletedAt));

  if (f.status?.length) conds.push(inArray(b.status, f.status));
  if (f.priority?.length) conds.push(inArray(b.priority, f.priority));
  if (f.paymentStatus?.length) conds.push(inArray(b.paymentStatus, f.paymentStatus));
  if (f.serviceId) conds.push(eq(b.serviceId, f.serviceId));
  if (f.riderId) {
    if (f.riderId === "__unassigned__") conds.push(isNull(b.riderId));
    else conds.push(eq(b.riderId, f.riderId));
  }
  if (f.region) conds.push(eq(b.region, f.region));
  if (f.notes) conds.push(like(b.notes, `%${f.notes}%`));
  if (f.schedFrom != null) conds.push(gte(b.scheduledAt, new Date(f.schedFrom)));
  if (f.schedTo != null) conds.push(lte(b.scheduledAt, new Date(f.schedTo)));
  if (f.doneFrom != null) { conds.push(isNotNull(b.finishedAt)); conds.push(gte(b.finishedAt, new Date(f.doneFrom))); }
  if (f.doneTo != null) { conds.push(isNotNull(b.finishedAt)); conds.push(lte(b.finishedAt, new Date(f.doneTo))); }
  if (f.priceMin != null) conds.push(gte(b.total, f.priceMin));
  if (f.priceMax != null) conds.push(lte(b.total, f.priceMax));

  // job id / number: exact id, or id-prefix match on normalized id
  if (f.jobId) {
    const raw = f.jobId.trim();
    conds.push(or(eq(b.id, raw), like(b.id, `${raw.toLowerCase()}%`)) as any);
  }

  // free text across customer name/phone/email + address + title
  if (f.q) {
    const pat = `%${f.q}%`;
    const matchingCustomers = await t.select(
      schema.user,
      or(like(schema.user.name, pat), like(schema.user.email, pat), like(schema.user.phone, pat)) as any,
    );
    const custIds = matchingCustomers.map((r) => r.id);
    const ors: any[] = [like(b.address, pat), like(b.title, pat), like(b.customerPhone, pat)];
    if (custIds.length) ors.push(inArray(b.customerId, custIds));
    conds.push(or(...ors) as any);
  }

  // client tag filter → customers carrying that tag
  if (f.tagId) {
    const tagged = await t.select(
      schema.entityTags,
      and(eq(schema.entityTags.tagId, f.tagId), eq(schema.entityTags.entityType, "client")) as any,
    );
    const ids = tagged.map((r) => r.entityId);
    conds.push(ids.length ? inArray(b.customerId, ids) : sql`1 = 0`);
  }

  return conds;
}

/* -------------------------------------------------------------------------- */
/*  Enrichment for export rows                                                */
/* -------------------------------------------------------------------------- */
async function enrichRows(rows: (typeof schema.bookings.$inferSelect)[]) {
  // every row here already came from a query scoped to one company (see
  // buildWhere), so it's safe to re-derive that companyId for the follow-up
  // lookups below instead of threading a separate cid parameter through.
  const cid = rows[0]?.companyId;
  if (!cid) return [];
  const t = tdb(cid);

  const svcIds = [...new Set(rows.map((r) => r.serviceId).filter((id): id is string => !!id))];
  const riderIds = [...new Set(rows.map((r) => r.riderId).filter(Boolean) as string[])];
  const custIds = [...new Set(rows.map((r) => r.customerId).filter((id): id is string => !!id))];

  const { svcMap, riderMap, custMap } = await t.transaction(async (tx) => {
    const svcMap = new Map<string, any>();
    if (svcIds.length) {
      const svcRows = await tx.select().from(schema.services).where(t.scope(schema.services, inArray(schema.services.id, svcIds)) as any);
      svcRows.forEach((s: any) => svcMap.set(s.id, s));
    }
    const riderMap = new Map<string, any>();
    if (riderIds.length) {
      const rs = await tx.select().from(schema.riders).where(t.scope(schema.riders, inArray(schema.riders.id, riderIds)) as any);
      const userIds = rs.map((r: any) => r.userId);
      const um = new Map<string, any>();
      if (userIds.length) {
        const us = await tx.select().from(schema.user).where(t.scope(schema.user, inArray(schema.user.id, userIds)) as any);
        us.forEach((u: any) => um.set(u.id, u));
      }
      rs.forEach((r: any) => riderMap.set(r.id, { ...r, name: um.get(r.userId)?.name, phone: um.get(r.userId)?.phone }));
    }
    const custMap = new Map<string, any>();
    if (custIds.length) {
      const us = await tx.select().from(schema.user).where(t.scope(schema.user, inArray(schema.user.id, custIds)) as any);
      us.forEach((u: any) => custMap.set(u.id, u));
    }
    return { svcMap, riderMap, custMap };
  });

  return rows.map((b) => {
    const svc = svcMap.get(b.serviceId as any);
    const rider = b.riderId ? riderMap.get(b.riderId) : null;
    const cust = custMap.get(b.customerId as any);
    let lineItemsText = "";
    try {
      const li = JSON.parse(b.lineItems || "[]");
      lineItemsText = Array.isArray(li) ? li.map((x: any) => `${x.qty ?? 1}× ${x.name}`).join("; ") : "";
    } catch { /* ignore */ }
    return {
      id: b.id,
      jobNumber: jobNumber(b.id),
      title: b.title,
      status: b.status,
      priority: b.priority,
      service: svc?.name ?? "",
      serviceId: b.serviceId,
      // The work-order-modal's edit path resolves the customer picker and
      // email prefill off this id — without it, editing a job from this
      // list (the normal path, via Jobs → pencil icon) always showed the
      // Customer field blank, no matter who the job was actually booked
      // for. customerName/Phone/Email below are separate derived display
      // columns for the table itself; this is the real FK the edit form needs.
      customerId: b.customerId,
      customerName: cust?.name ?? "",
      customerPhone: b.customerPhone || cust?.phone || "",
      customerEmail: cust?.email ?? "",
      address: b.address,
      region: b.region,
      lat: b.lat ?? null,
      lng: b.lng ?? null,
      technician: rider?.name ?? (b.riderId ? "—" : "Unassigned"),
      riderId: b.riderId,
      autoAssignedRuleId: b.autoAssignedRuleId ?? "",
      scheduledAt: b.scheduledAt,
      completedAt: b.finishedAt,
      startedAt: b.startedAt,
      createdAt: b.createdAt,
      assignStatus: b.assignStatus,
      subtotal: b.subtotal,
      taxAmount: b.taxAmount,
      taxLabel: b.taxLabel,
      lineItemsCost: b.lineItemsCost,
      lineItemsPrice: b.lineItemsPrice,
      onSiteMinutes: b.onSiteMinutes,
      transitMinutes: b.transitMinutes,
      mileageKm: b.mileageKm,
      techPay: b.techPay,
      total: b.total || b.price,
      paymentStatus: b.paymentStatus,
      notes: b.notes,
      lineItemsText,
      deletedAt: b.deletedAt,
    };
  });
}

async function logExport(cid: string, actor: SessionUser, format: string, count: number, filters: Filters, columns: string[]) {
  try {
    await tdb(cid).insert(schema.auditLog, {
      actorId: actor.id,
      actorName: actor.name || actor.email,
      action: "export",
      entityType: "job_search",
      entityId: "",
      summary: `Exported ${count} job${count === 1 ? "" : "s"} as ${format.toUpperCase()}`,
      meta: JSON.stringify({ format, count, columns, filters }),
    });
  } catch { /* non-fatal */ }
}

/* -------------------------------------------------------------------------- */
/*  Routes                                                                    */
/* -------------------------------------------------------------------------- */
export const jobSearchRoutes = new Hono<AppEnv>()
  // facet options for the filter UI (services, technicians, statuses, regions, tags)
  .get("/facets", requireAuth, async (c) => {
    const u = c.get("user") as SessionUser;
    if (!isStaff(u)) return c.json({ message: "Forbidden" }, 403);
    const t = tx(c);
    const { services, technicians, tags, regions } = await t.transaction(async (txn) => {
      const svcRows = await txn.select().from(schema.services).where(t.scope(schema.services) as any);
      const riderRows = await txn.select().from(schema.riders).where(t.scope(schema.riders) as any);
      const userIds = riderRows.map((r: any) => r.userId);
      const um = new Map<string, any>();
      if (userIds.length) {
        const us = await txn.select().from(schema.user).where(t.scope(schema.user, inArray(schema.user.id, userIds)) as any);
        us.forEach((x: any) => um.set(x.id, x));
      }
      const tagRows = await txn
        .select()
        .from(schema.tags)
        .where(t.scope(schema.tags, or(eq(schema.tags.scope, "client"), eq(schema.tags.scope, "both")) as any) as any);
      const regionRows = await txn
        .selectDistinct({ region: schema.bookings.region })
        .from(schema.bookings)
        .where(t.scope(schema.bookings) as any);
      return {
        services: svcRows.map((s: any) => ({ id: s.id, name: s.name })),
        technicians: riderRows.map((r: any) => ({ id: r.id, name: um.get(r.userId)?.name ?? "Tech" })),
        tags: tagRows.map((tg: any) => ({ id: tg.id, label: tg.label, color: tg.color })),
        regions: regionRows.map((r: any) => r.region).filter(Boolean).sort(),
      };
    });
    return c.json({
      services,
      technicians,
      tags,
      regions,
      statuses: ["pending", "confirmed", "assigned", "enroute", "arrived", "in_progress", "completed", "cancelled"],
      priorities: ["low", "normal", "high", "urgent"],
      paymentStatuses: ["unpaid", "paid", "refunded"],
      columns: JOB_COLUMNS,
    }, 200);
  })

  // paginated, filtered search
  .get("/search", requireAuth, async (c) => {
    const u = c.get("user") as SessionUser;
    if (!isStaff(u)) return c.json({ message: "Forbidden" }, 403);
    const f = parseFilters(c);
    const page = Math.max(1, Number(c.req.query("page")) || 1);
    const pageSize = Math.min(200, Math.max(5, Number(c.req.query("pageSize")) || 25));
    const sortKey = c.req.query("sort") || "scheduledAt";
    const dir = c.req.query("dir") === "asc" ? asc : desc;
    const sortMap: Record<string, any> = {
      scheduledAt: schema.bookings.scheduledAt,
      createdAt: schema.bookings.createdAt,
      completedAt: schema.bookings.finishedAt,
      total: schema.bookings.total,
      status: schema.bookings.status,
      priority: schema.bookings.priority,
    };
    const orderCol = sortMap[sortKey] ?? schema.bookings.scheduledAt;

    const cid = tenantId(c);
    const t = tx(c);
    const conds = await buildWhere(f, cid);
    const whereExpr = conds.length ? and(...conds) : undefined;

    const { count, rows } = await t.transaction(async (txn) => {
      const [countRow] = await txn
        .select({ count: sql<number>`count(*)` })
        .from(schema.bookings)
        .where(whereExpr as any);

      const rows = await txn
        .select()
        .from(schema.bookings)
        .where(whereExpr as any)
        .orderBy(dir(orderCol))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return { count: countRow?.count ?? 0, rows };
    });

    const enriched = await enrichRows(rows);
    return c.json({ jobs: enriched, total: Number(count), page, pageSize, pages: Math.ceil(Number(count) / pageSize) }, 200);
  })

  // export filtered results: ?format=csv|json|pdf&columns=a,b,c (omit columns = summary set)
  .get("/export", requireAuth, async (c) => {
    const u = c.get("user") as SessionUser;
    if (!isStaff(u)) return c.json({ message: "Forbidden" }, 403);
    const f = parseFilters(c);
    const format = (c.req.query("format") || "csv").toLowerCase();
    const colsParam = c.req.query("columns");
    const pickedKeys = colsParam ? colsParam.split(",").map((s) => s.trim()).filter((k) => COL_BY_KEY[k]) : JOB_COLUMNS.filter((c) => c.group === "summary").map((c) => c.key);
    const cols = pickedKeys.flatMap((k) => { const col = COL_BY_KEY[k]; return col ? [col] : []; });

    const cid = tenantId(c);
    const t = tx(c);
    const conds = await buildWhere(f, cid);
    const whereExpr = conds.length ? and(...conds) : undefined;
    const rows = await t.transaction((txn) =>
      txn.select().from(schema.bookings).where(whereExpr as any).orderBy(desc(schema.bookings.scheduledAt)).limit(10000),
    );
    const enriched = await enrichRows(rows);

    await logExport(cid, u, format, enriched.length, f, pickedKeys);
    const stamp = Date.now();
    // filenames carry the tenant name, not the product name — see tenantFilePrefix
    const pre = await tenantFilePrefix(cid);
    const title = "Work Orders";
    // Dates in an export belong on the TENANT's clock, not the server's (UTC):
    // an evening job otherwise prints on the next calendar day.
    const tz = await companyTimeZone(cid);
    const fmtDate = (v: any) =>
      fmtInZone(v, tz, { dateStyle: "medium", timeStyle: "short" }, "en-CA", "");
    const subtitle = `${enriched.length} jobs · exported ${fmtDate(Date.now())}`;

    if (format === "json") {
      const slim = enriched.map((r: any) => Object.fromEntries(pickedKeys.map((k) => [k, r[k]])));
      return fileResponse(JSON.stringify(slim, null, 2), `${pre}-jobs-${stamp}.json`, "application/json");
    }
    if (format === "pdf") {
      const fmtRows = enriched.map((r: any) => {
        const o: any = {};
        for (const col of cols) {
          let v = r[col.key];
          if (col.kind === "date" && v) v = fmtDate(v);
          o[col.key] = v;
        }
        return o;
      });
      const buf = await toPdf(fmtRows, cols, title, subtitle);
      return fileResponse(buf, `${pre}-jobs-${stamp}.pdf`, "application/pdf");
    }
    // csv (default)
    const csvRows = enriched.map((r: any) => {
      const o: any = {};
      for (const col of cols) {
        let v = r[col.key];
        if (col.kind === "date" && v) v = new Date(v).toISOString();
        o[col.label] = v ?? "";
      }
      return o;
    });
    const csv = toCsv(csvRows, cols.map((c) => c.label));
    return fileResponse(csv, `${pre}-jobs-${stamp}.csv`, "text/csv; charset=utf-8");
  })

  // single-job full detail export (all fields) — for the per-job detail option
  .get("/:id/export", requireAuth, async (c) => {
    const u = c.get("user") as SessionUser;
    if (!isStaff(u)) return c.json({ message: "Forbidden" }, 403);
    const id = c.req.param("id");
    const format = (c.req.query("format") || "pdf").toLowerCase();
    const cid = tenantId(c);
    const t = tx(c);
    const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!b) return c.json({ message: "Not found" }, 404);
    const [enriched] = await enrichRows([b]);
    if (!enriched) return c.json({ message: "Not found" }, 404);
    await logExport(cid, u, format, 1, { jobId: id }, JOB_COLUMNS.map((c) => c.key));
    const stamp = Date.now();
    const pre = await tenantFilePrefix(cid);
    const detailTz = await companyTimeZone(cid);
    const fmtDetailDate = (v: any) =>
      fmtInZone(v, detailTz, { dateStyle: "medium", timeStyle: "short" }, "en-CA", "");

    if (format === "json") {
      return fileResponse(JSON.stringify({ ...enriched, raw: b }, null, 2), `${pre}-job-${jobNumber(b.id)}-${stamp}.json`, "application/json");
    }
    // PDF: vertical label/value sheet (one column = label, one = value),
    // grouped into named sections (group carried from JOB_COLUMNS) so the
    // report reads as a structured document instead of one 29-row dump.
    const rows = JOB_COLUMNS.map((col) => {
      let v: any = (enriched as any)[col.key];
      if (col.kind === "date" && v) v = fmtDetailDate(v);
      if (col.kind === "money" && v != null) v = `$${Number(v).toFixed(2)}`;
      return { field: col.label, value: v ?? "", group: col.group };
    });
    // parse ad-hoc per-unit line items (kind === "unit") for the internal pay breakdown
    let unitLines: JobUnitLine[] = [];
    try {
      const li = JSON.parse(b.lineItems || "[]");
      if (Array.isArray(li)) {
        unitLines = li
          .filter((x: any) => x && x.kind === "unit")
          .map((x: any) => ({
            name: String(x.name ?? "Item"),
            unit: String(x.unit ?? ""),
            qty: Number(x.qty ?? 0),
            unitPrice: Number(x.unitPrice ?? 0),
            unitCost: Number(x.unitCost ?? 0),
            price: Number(x.price ?? 0),
            cost: Number(x.cost ?? 0),
          }));
      }
    } catch { /* ignore malformed lineItems */ }

    // Fetch job photos for the PDF
    let jobPhotos: JobPhoto[] = [];
    try {
      const photoRows = await t.select(schema.jobPhotos, eq(schema.jobPhotos.bookingId, id));
      jobPhotos = photoRows.map((p: any) => ({ url: p.url, caption: p.caption ?? "" }));
    } catch { /* skip photos if query fails */ }

    // Tenant branding (logo + name + color) for the PDF header, and the raw
    // GPS route for a simple graphical route diagram.
    const brandRow = await t.selectOne(schema.companySettings).catch(() => undefined);
    const brand = brandRow ? { name: brandRow.name, logo: brandRow.logo, brandColor: brandRow.brandColor } : null;
    let route: { lat: number; lng: number; phase: string }[] = [];
    try {
      const pingRows = await t.select(schema.trackingPings, eq(schema.trackingPings.bookingId, id));
      pingRows.sort((x: any, y: any) => Number(x.createdAt) - Number(y.createdAt));
      route = pingRows.map((p: any) => ({ lat: p.lat, lng: p.lng, phase: p.phase }));
    } catch { /* skip route if query fails */ }

    const baseUrl = new URL(c.req.url).origin;
    const buf = await buildJobPdf(rows, unitLines, `Job ${jobNumber(b.id)} — ${enriched.customerName}`, enriched.address, jobPhotos, brand, route, baseUrl);
    return fileResponse(buf, `${pre}-job-${jobNumber(b.id)}-${stamp}.pdf`, "application/pdf");
  })

  // Consolidated read-only report for the completed-job report page: every
  // field the report needs in one call (times, mileage, route breadcrumbs,
  // photos, line-item + tech-pay breakdown) instead of the report page
  // stitching together several separate requests.
  .get("/:id/report", requireAuth, async (c) => {
    const u = c.get("user") as SessionUser;
    if (!isStaff(u)) return c.json({ message: "Forbidden" }, 403);
    const id = c.req.param("id");
    const t = tx(c);
    const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, id));
    if (!b) return c.json({ message: "Not found" }, 404);

    // Every lookup below depends only on the booking row, so run them side by
    // side. Each tenant-db call is its own short transaction (BEGIN +
    // set_config + query + COMMIT), so done one after another this endpoint
    // cost ~3.7 s from a far-away client; in parallel it's one round of
    // latency. The Jobs-list detail view opens on every row tap, so it matters.
    const [svc, cust, rp, photoRows, pingRows] = await Promise.all([
      b.serviceId ? t.selectOne(schema.services, eq(schema.services.id, b.serviceId)) : Promise.resolve(undefined),
      b.customerId ? t.selectOne(schema.user, eq(schema.user.id, b.customerId)) : Promise.resolve(undefined),
      b.riderId ? t.selectOne(schema.riders, eq(schema.riders.id, b.riderId)) : Promise.resolve(undefined),
      t.select(schema.jobPhotos, eq(schema.jobPhotos.bookingId, id)),
      t.select(schema.trackingPings, eq(schema.trackingPings.bookingId, id)),
    ]);
    let rider: any = null;
    if (rp) {
      const ru = await t.selectOne(schema.user, eq(schema.user.id, rp.userId));
      rider = { id: rp.id, name: ru?.name, phone: ru?.phone, photoUrl: rp.photoUrl, vehicle: rp.vehicle };
    }

    photoRows.sort((x: any, y: any) => Number(x.createdAt) - Number(y.createdAt));
    pingRows.sort((x: any, y: any) => Number(x.createdAt) - Number(y.createdAt));

    // Road-matched trail: raw 8-second fixes joined by straight lines cut
    // corners and jump across rivers after a signal gap. Computed once the
    // trip has settled and stored on the booking; null while still live or
    // if no matcher is reachable (the page then draws the raw trail and says so).
    const snapped = await ensureSnappedRoute(t, b, pingRows).catch((e) => {
      log.warn("route-snap: failed", { bookingId: id, err: String(e) });
      return null;
    });

    let lineItems: any[] = [];
    try {
      const li = JSON.parse(b.lineItems || "[]");
      if (Array.isArray(li)) lineItems = li;
    } catch { /* ignore malformed lineItems */ }

    return c.json(
      {
        id: b.id,
        jobNumber: jobNumber(b.id),
        title: b.title,
        status: b.status,
        priority: b.priority,
        service: svc?.name ?? "",
        address: b.address,
        region: b.region,
        lat: b.lat ?? null,
        lng: b.lng ?? null,
        notes: b.notes,
        customer: cust ? { id: cust.id, name: cust.name, phone: b.customerPhone || cust.phone, email: cust.email } : null,
        technician: rider,
        autoAssignedRuleId: b.autoAssignedRuleId ?? "",
        timeline: {
          scheduledAt: b.scheduledAt,
          assignedAt: b.assignedAt,
          acceptedAt: b.acceptedAt,
          enrouteAt: b.enrouteAt,
          startedAt: b.startedAt,
          finishedAt: b.finishedAt,
          createdAt: b.createdAt,
        },
        transitMinutes: b.transitMinutes,
        onSiteMinutes: b.onSiteMinutes,
        mileageKm: b.mileageKm,
        route: pingRows.map((p: any) => ({ lat: p.lat, lng: p.lng, phase: p.phase, createdAt: p.createdAt })),
        routeSnapped: snapped
          ? { provider: snapped.provider, distanceKm: snapped.distanceKm, points: snapped.points }
          : null,
        photos: photoRows.map((p: any) => ({ id: p.id, url: p.url, caption: p.caption, createdAt: p.createdAt })),
        pricing: {
          lineItems,
          subtotal: b.subtotal,
          taxAmount: b.taxAmount,
          taxLabel: b.taxLabel,
          total: b.total || b.price,
          paymentStatus: b.paymentStatus,
          lineItemsCost: b.lineItemsCost,
          lineItemsPrice: b.lineItemsPrice,
        },
        techPay: {
          total: b.techPay,
          breakdown: (() => {
            try { return JSON.parse(b.techPayBreakdown || "null"); } catch { return null; }
          })(),
        },
      },
      200,
    );
  })

  // soft-delete (archive) a job — never lose data
  .delete("/:id", requireAuth, async (c) => {
    const u = c.get("user") as SessionUser;
    if (!isStaff(u)) return c.json({ message: "Forbidden" }, 403);
    const id = c.req.param("id");
    const t = tx(c);
    await t.update(schema.bookings, { deletedAt: new Date() }, eq(schema.bookings.id, id));
    await t.insert(schema.auditLog, {
      actorId: u.id, actorName: u.name || u.email, action: "delete",
      entityType: "booking", entityId: id, summary: "Archived (soft-deleted) work order", meta: "{}",
    });
    return c.json({ ok: true }, 200);
  })

  // restore a soft-deleted job
  .post("/:id/restore", requireAuth, async (c) => {
    const u = c.get("user") as SessionUser;
    if (!isStaff(u)) return c.json({ message: "Forbidden" }, 403);
    const id = c.req.param("id");
    const t = tx(c);
    await t.update(schema.bookings, { deletedAt: null }, eq(schema.bookings.id, id));
    await t.insert(schema.auditLog, {
      actorId: u.id, actorName: u.name || u.email, action: "update",
      entityType: "booking", entityId: id, summary: "Restored archived work order", meta: "{}",
    });
    return c.json({ ok: true }, 200);
  });
