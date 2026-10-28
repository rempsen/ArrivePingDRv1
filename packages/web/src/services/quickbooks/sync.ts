/**
 * Outbound QuickBooks Sync.
 *
 *   job assigned / accepted  → a Purchase Order to the technician's vendor
 *   job completed            → a Bill linked to that PO (tenant bill mode
 *                              "arriveping"); nothing when the subtrade
 *                              invoices and the bookkeeper enters the bill
 *   job cancelled            → the PO is deleted if nothing was billed on it,
 *                              otherwise a person decides
 *
 * Every write is a durable scheduled task keyed per job and kind, so a status
 * change never waits on QuickBooks and never creates the same paperwork
 * twice. Before creating, the sync looks for what already exists (our link,
 * then the document number in QuickBooks), so a lost response or a
 * bookkeeper who got there first is adopted, not duplicated. Retryable
 * failures back off 1m / 5m / 30m / 2h and then raise an issue; Intuit's
 * validation faults raise an issue at once.
 */
import { and, eq, inArray } from "drizzle-orm";
import { sdb } from "../../api/database";
import * as schema from "../../api/database/schema";
import { isFeatureOn } from "../features";
import { logJobEvent } from "../job-events";
import { registerTaskHandler, scheduleTask } from "../scheduler";
import { loadConnection, q, qboFetch, qboQuery, QboError } from "./client";
import type { Bill, PurchaseOrder } from "./entities";
import { buildBill, buildPurchaseOrder, fingerprint, linesFromBooking, type PoInput } from "./mapping";
import { getLink, raiseIssue, resolveCustomer, resolveItem, resolveVendor, setMapping, settings, type QboSettings } from "./resolve";

export type SyncKind = "po.create" | "bill.create" | "po.cancel";
const TASK_KIND: Record<SyncKind, string> = { "po.create": "qbo.po.create", "bill.create": "qbo.bill.create", "po.cancel": "qbo.po.cancel" };
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000];
/** Rapid status flips (assigned → accepted) coalesce into one write. */
const COALESCE_MS = 20_000;

type Booking = typeof schema.bookings.$inferSelect;

export function docNumberFor(bookingId: string): string {
  return "AP-" + bookingId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** The feature is on for the tenant and QuickBooks is connected. */
export async function isQboActive(companyId: string): Promise<boolean> {
  if (!(await isFeatureOn(companyId, "integrations.quickbooks"))) return false;
  const conn = await loadConnection(companyId);
  return !!conn && conn.status === "connected";
}

async function loadBooking(companyId: string, bookingId: string): Promise<Booking | null> {
  const [b] = await sdb.select().from(schema.bookings).where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.companyId, companyId)));
  return b ?? null;
}

function syncable(b: Booking | null): b is Booking {
  return !!b && !b.isSample && !b.deletedAt;
}

/** Queue one write for a job. Harmless to call more than once. */
export async function enqueueQboSync(companyId: string, bookingId: string, kind: SyncKind): Promise<void> {
  try {
    if (!(await isQboActive(companyId))) return;
    const b = await loadBooking(companyId, bookingId);
    if (!syncable(b)) return;
    if (kind !== "po.cancel" && !b.riderId) return;
    const pending = await sdb
      .select({ id: schema.scheduledTasks.id })
      .from(schema.scheduledTasks)
      .where(and(eq(schema.scheduledTasks.bookingId, bookingId), eq(schema.scheduledTasks.kind, TASK_KIND[kind]), eq(schema.scheduledTasks.status, "pending")));
    if (pending.length) return;
    await scheduleTask({ companyId, kind: TASK_KIND[kind], runAt: Date.now() + COALESCE_MS, bookingId, payload: { attempt: 0 } });
  } catch (e) {
    console.error("[qbo] enqueue failed", kind, bookingId, e);
  }
}

/** Called from dispatch.fireEvent for every lifecycle event. Never throws. */
export async function onJobEvent(event: string, b: Pick<Booking, "id" | "companyId">): Promise<void> {
  const kind: SyncKind | null =
    event === "assigned" || event === "accepted" ? "po.create" : event === "completed" ? "bill.create" : event === "cancelled" ? "po.cancel" : null;
  if (!kind) return;
  await enqueueQboSync(b.companyId, b.id, kind);
}

/* ------------------------------------------------------------------ build */

async function poInput(companyId: string, b: Booking, cfg: QboSettings): Promise<PoInput | { issue: string }> {
  const [rider] = await sdb.select().from(schema.riders).where(eq(schema.riders.id, b.riderId!));
  if (!rider) return { issue: "no_technician" };
  const [techUser] = await sdb.select({ name: schema.user.name, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, rider.userId));
  const vendor = await resolveVendor(companyId, { id: rider.id, userId: rider.userId, name: techUser?.name ?? "", email: techUser?.email ?? "" });
  if ("issue" in vendor) return vendor;

  let customerId: string | null = null;
  if (b.customerId) {
    const [cust] = await sdb.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, b.customerId));
    const customer = await resolveCustomer(companyId, { customerId: b.customerId, customerName: cust?.name ?? "", address: b.address ?? "" });
    if ("issue" in customer) return customer;
    customerId = customer.qboId;
  }

  const item = await resolveItem(companyId, b.templateId ?? null);
  if ("issue" in item) return item;

  const itemLinks = await sdb
    .select({ localId: schema.qboLinks.localId, qboId: schema.qboLinks.qboId })
    .from(schema.qboLinks)
    .where(and(eq(schema.qboLinks.companyId, companyId), eq(schema.qboLinks.kind, "item")));
  const byCatalog = new Map(itemLinks.filter((l) => l.localId.startsWith("catalog:")).map((l) => [l.localId.slice(8), l.qboId]));

  const lines = linesFromBooking(b, { itemId: item.qboId, itemByCatalogId: (id) => byCatalog.get(id) });
  if (!lines.length) return { issue: "no_pay" };
  return {
    docNumber: docNumberFor(b.id),
    vendorId: vendor.qboId,
    customerId,
    itemId: item.qboId,
    taxCodeId: cfg.taxCodeId,
    privateNote: `ArrivePing job ${b.id}`,
    lines,
  };
}

async function setBillStatus(bookingId: string, status: string, extra: Partial<Booking> = {}) {
  await sdb.update(schema.bookings).set({ vendorBillStatus: status, ...extra }).where(eq(schema.bookings.id, bookingId));
}

async function timeline(companyId: string, bookingId: string, label: string, meta: Record<string, unknown> = {}) {
  await logJobEvent({ companyId, bookingId, kind: "accounting", actorRole: "system", label, meta });
}

/** The job's PO: ours, or one already in QuickBooks with our document number. Null in shadow mode. */
async function ensurePurchaseOrder(companyId: string, b: Booking, cfg: QboSettings, input: PoInput): Promise<PurchaseOrder | null> {
  const linked = await getLink(companyId, "purchase_order", b.id);
  if (linked) return { Id: linked.qboId, SyncToken: linked.syncToken, VendorRef: { value: input.vendorId }, Line: [] };

  const existing = await qboQuery<PurchaseOrder>(companyId, `SELECT * FROM PurchaseOrder WHERE DocNumber = ${q(input.docNumber)}`);
  let po = existing[0] ?? null;
  if (!po) {
    const payload = buildPurchaseOrder(input);
    if (cfg.shadow) {
      await raiseIssue(companyId, "shadow", `Shadow mode: would create purchase order ${input.docNumber}.`, { bookingId: b.id, detail: { payload }, resolved: true });
      return null;
    }
    const created = await qboFetch<{ PurchaseOrder: PurchaseOrder }>(companyId, "/purchaseorder", { method: "POST", body: payload });
    po = created.PurchaseOrder;
  }
  await setMapping(companyId, "purchase_order", b.id, po.Id!, { syncToken: po.SyncToken ?? "", fingerprint: fingerprint(input) });
  if (b.vendorBillStatus === "none" || b.vendorBillStatus === "error") await setBillStatus(b.id, "po_open");
  await timeline(companyId, b.id, `Purchase order ${input.docNumber} in QuickBooks`, { qboId: po.Id, docNumber: input.docNumber });
  return po;
}

function tenantDate(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function companyTimezone(companyId: string): Promise<string> {
  const [row] = await sdb.select({ timezone: schema.companySettings.timezone }).from(schema.companySettings).where(eq(schema.companySettings.companyId, companyId));
  return row?.timezone || "America/Winnipeg";
}

async function ensureBill(companyId: string, b: Booking, cfg: QboSettings, input: PoInput, po: PurchaseOrder): Promise<void> {
  const linked = await getLink(companyId, "bill", b.id);
  if (linked) return;
  const existing = await qboQuery<Bill>(companyId, `SELECT * FROM Bill WHERE DocNumber = ${q(input.docNumber)}`);
  let bill = existing.find((x) => (x.LinkedTxn ?? []).some((l) => l.TxnType === "PurchaseOrder" && l.TxnId === po.Id)) ?? existing[0] ?? null;
  if (!bill) {
    const txnDate = tenantDate(b.finishedAt ?? new Date(), await companyTimezone(companyId));
    const payload = buildBill({ ...input, poId: po.Id!, txnDate, dueDate: addDays(txnDate, 30) });
    if (cfg.shadow) {
      await raiseIssue(companyId, "shadow", `Shadow mode: would create bill ${input.docNumber}.`, { bookingId: b.id, detail: { payload }, resolved: true });
      return;
    }
    const created = await qboFetch<{ Bill: Bill }>(companyId, "/bill", { method: "POST", body: payload });
    bill = created.Bill;
  }
  await setMapping(companyId, "bill", b.id, bill.Id!, { syncToken: bill.SyncToken ?? "", fingerprint: fingerprint(input) });
  await setBillStatus(b.id, bill.Balance === 0 && (bill.TotalAmt ?? 0) > 0 ? "paid" : "billed");
  await timeline(companyId, b.id, `Bill ${input.docNumber} in QuickBooks ($${(bill.TotalAmt ?? 0).toFixed(2)})`, { qboId: bill.Id, docNumber: input.docNumber });
}

async function cancelPurchaseOrder(companyId: string, b: Booking): Promise<void> {
  const po = await getLink(companyId, "purchase_order", b.id);
  if (!po) return;
  const bill = await getLink(companyId, "bill", b.id);
  const billed = bill ? [bill] : await qboQuery<Bill>(companyId, `SELECT * FROM Bill WHERE DocNumber = ${q(docNumberFor(b.id))}`);
  if (billed.length) {
    await raiseIssue(companyId, "po_cancel_review", `Job cancelled but its QuickBooks bill ${docNumberFor(b.id)} already exists. Decide in QuickBooks.`, { bookingId: b.id });
    return;
  }
  const current = await qboFetch<{ PurchaseOrder: PurchaseOrder }>(companyId, `/purchaseorder/${po.qboId}`);
  if (current.PurchaseOrder.POStatus === "Closed") {
    await raiseIssue(companyId, "po_cancel_review", `Job cancelled but its QuickBooks purchase order ${docNumberFor(b.id)} is already closed.`, { bookingId: b.id });
    return;
  }
  await qboFetch(companyId, "/purchaseorder", { method: "POST", query: { operation: "delete" }, body: { Id: po.qboId, SyncToken: current.PurchaseOrder.SyncToken } });
  await sdb.delete(schema.qboLinks).where(eq(schema.qboLinks.id, po.id));
  await setBillStatus(b.id, "none");
  await timeline(companyId, b.id, `Purchase order ${docNumberFor(b.id)} removed from QuickBooks`);
}

/* --------------------------------------------------------------- handlers */

async function run(companyId: string, bookingId: string, kind: SyncKind): Promise<void> {
  const b = await loadBooking(companyId, bookingId);
  if (!syncable(b)) return;
  const cfg = await settings(companyId);
  if (kind === "po.cancel") return cancelPurchaseOrder(companyId, b);
  if (!b.riderId) return;
  const input = await poInput(companyId, b, cfg);
  if ("issue" in input) {
    await setBillStatus(b.id, "error");
    return;
  }
  const po = await ensurePurchaseOrder(companyId, b, cfg, input);
  if (kind === "bill.create" && po && cfg.billMode === "arriveping") await ensureBill(companyId, b, cfg, input, po);
}

async function handle(task: { companyId: string; bookingId: string | null; payload: Record<string, unknown> }, kind: SyncKind): Promise<void> {
  const { companyId, bookingId } = task;
  if (!bookingId) return;
  if (!(await isQboActive(companyId))) return; // switched off or disconnected since it was queued
  try {
    await run(companyId, bookingId, kind);
  } catch (e) {
    const attempt = Number(task.payload.attempt ?? 0);
    const retryable = e instanceof QboError ? e.retryable : true;
    if (retryable && attempt < BACKOFF_MS.length) {
      await scheduleTask({ companyId, kind: TASK_KIND[kind], runAt: Date.now() + BACKOFF_MS[attempt]!, bookingId, payload: { attempt: attempt + 1 } });
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    await raiseIssue(companyId, "sync_failed", `QuickBooks ${kind} failed: ${msg}`, {
      bookingId,
      detail: e instanceof QboError ? { status: e.status, code: e.code, tid: e.tid, attempt } : { attempt },
    });
    await setBillStatus(bookingId, "error");
  }
}

registerTaskHandler(TASK_KIND["po.create"], (t) => handle(t, "po.create"));
registerTaskHandler(TASK_KIND["bill.create"], (t) => handle(t, "bill.create"));
registerTaskHandler(TASK_KIND["po.cancel"], (t) => handle(t, "po.cancel"));

/** "Sync now" from the admin page: run the right step for the job's state, inline. */
export async function syncBookingNow(companyId: string, bookingId: string): Promise<{ po?: string; bill?: string; issues: string[] }> {
  const b = await loadBooking(companyId, bookingId);
  if (!syncable(b)) return { issues: ["not_syncable"] };
  if (!(await isQboActive(companyId))) return { issues: ["inactive"] };
  const kind: SyncKind = b.status === "cancelled" ? "po.cancel" : b.status === "completed" ? "bill.create" : "po.create";
  await run(companyId, bookingId, kind);
  const [po, bill] = await Promise.all([getLink(companyId, "purchase_order", bookingId), getLink(companyId, "bill", bookingId)]);
  const open = await sdb
    .select({ kind: schema.qboIssues.kind })
    .from(schema.qboIssues)
    .where(and(eq(schema.qboIssues.companyId, companyId), eq(schema.qboIssues.bookingId, bookingId), inArray(schema.qboIssues.status, ["open"])));
  return { po: po?.qboId, bill: bill?.qboId, issues: open.map((i) => i.kind) };
}
