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
 *   technician declined / released, or the job was reassigned
 *                            → the old PO is deleted the same way and, on
 *                              reassignment, a new one goes to the new vendor
 *
 * At assignment nothing has been paid yet, so the PO is priced from what the
 * job already knows (per-unit line items, flat pay); the bill at completion
 * carries the pay actually accrued. A job that cannot be priced yet gets an
 * issue and its PO when it completes.
 *
 * Every write is a durable scheduled task keyed per job and kind (a partial
 * unique index keeps it to one pending task however many instances enqueue),
 * so a status change never waits on QuickBooks and never creates the same
 * paperwork twice. Before creating, the sync looks for what already exists
 * (our link, then the document number in QuickBooks), so a lost response or
 * a bookkeeper who got there first is adopted, not duplicated; if two
 * instances still create at once, the one that loses the link removes its
 * copy. Retryable failures back off 1m / 5m / 30m / 2h and then raise an
 * issue; Intuit's validation faults raise an issue at once.
 */
import { and, eq, gte, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { sdb } from "../../api/database";
import * as schema from "../../api/database/schema";
import { jobTechPay } from "../../shared/tech-pay";
import { isFeatureOn } from "../features";
import { logJobEvent } from "../job-events";
import { registerTaskHandler, scheduleTask } from "../scheduler";
import { loadConnection, q, qboFetch, qboQuery, QboError } from "./client";
import type { Bill, PurchaseOrder } from "./entities";
import { buildBill, buildPurchaseOrder, fingerprint, linesFromBooking, type PoInput } from "./mapping";
import { claimMapping, getLink, raiseIssue, resolveCustomer, resolveIssues, resolveItem, resolveVendor, settings, type QboSettings } from "./resolve";

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

/**
 * Jobs from before the tenant connected QuickBooks are the bookkeeper's
 * history, never ours. Days are the tenant's calendar days. Cleanup of a
 * purchase order that already exists (po.cancel) is never held back.
 */
async function withinSyncWindow(companyId: string, b: Booking, cfg: Pick<QboSettings, "syncSince">, kind: SyncKind): Promise<boolean> {
  if (kind === "po.cancel" || !cfg.syncSince) return true;
  return tenantDate(b.scheduledAt, await companyTimezone(companyId)) >= cfg.syncSince;
}

/** One pending task per job and kind: the partial unique index on scheduled_tasks decides, not a read. */
async function enqueueTask(companyId: string, bookingId: string, kind: SyncKind, delayMs: number): Promise<boolean> {
  const inserted = await sdb
    .insert(schema.scheduledTasks)
    .values({ companyId, kind: TASK_KIND[kind], runAt: new Date(Date.now() + delayMs), bookingId, payload: JSON.stringify({ attempt: 0 }) })
    .onConflictDoNothing()
    .returning({ id: schema.scheduledTasks.id });
  return inserted.length > 0;
}

/** Queue one write for a job. Harmless to call more than once. */
export async function enqueueQboSync(companyId: string, bookingId: string, kind: SyncKind): Promise<void> {
  try {
    if (!(await isQboActive(companyId))) return;
    const b = await loadBooking(companyId, bookingId);
    if (!syncable(b)) return;
    if (kind !== "po.cancel" && !b.riderId) return;
    if (!(await withinSyncWindow(companyId, b, await settings(companyId), kind))) return;
    await enqueueTask(companyId, bookingId, kind, COALESCE_MS);
  } catch (e) {
    console.error("[qbo] enqueue failed", kind, bookingId, e);
  }
}

/** Called from dispatch.fireEvent for every lifecycle event. Never throws. */
export async function onJobEvent(event: string, b: Pick<Booking, "id" | "companyId">): Promise<void> {
  const kind: SyncKind | null =
    event === "assigned" || event === "accepted"
      ? "po.create"
      : event === "completed"
        ? "bill.create"
        : event === "cancelled" || event === "declined" || event === "released"
          ? "po.cancel"
          : null;
  if (!kind) return;
  await enqueueQboSync(b.companyId, b.id, kind);
}

/**
 * The tenant (re)connected QuickBooks. A different company (realm) than
 * before means every saved link points into the wrong books: they are
 * dropped (records are matched or created again by name) and a person is
 * told. Then the jobs that waited are queued.
 */
export async function afterQuickbooksConnect(companyId: string, previousRealmId: string, realmId: string): Promise<void> {
  // The first connection fixes the day the sync starts from; a reconnect keeps it.
  if (!(await settings(companyId)).syncSince) {
    const { patchConfig } = await import("./sweep");
    await patchConfig(companyId, { syncSince: tenantDate(new Date(), await companyTimezone(companyId)) });
  }
  if (previousRealmId && realmId && previousRealmId !== realmId) {
    const dropped = await sdb.delete(schema.qboLinks).where(eq(schema.qboLinks.companyId, companyId)).returning({ id: schema.qboLinks.id });
    // An open PO lived in the old books: the job starts over in the new ones.
    // What was billed or paid there is history and stays as it reads.
    const reset = await sdb
      .update(schema.bookings)
      .set({ vendorBillStatus: "none" })
      .where(and(eq(schema.bookings.companyId, companyId), inArray(schema.bookings.vendorBillStatus, ["po_open", "error"])))
      .returning({ id: schema.bookings.id });
    await raiseIssue(companyId, "realm_changed", `QuickBooks is now connected to a different company (${realmId}, was ${previousRealmId}). ${dropped.length} saved vendor, customer, item and document links were cleared and ${reset.length} job(s) with an open purchase order will get a new one; jobs already billed or paid keep their status. Check Mappings before going live.`, { detail: { previousRealmId, realmId, dropped: dropped.length, reset: reset.length } });
  }
  await requeueAfterReconnect(companyId);
}

/**
 * After a reconnect: queue the jobs that waited while QuickBooks was out of
 * reach — never synced or failed (PO), and completed with only a PO when
 * ArrivePing writes the bill. Recent jobs only; older ones are the
 * bookkeeper's by now. Returns how many were queued.
 */
export async function requeueAfterReconnect(companyId: string, windowDays = 90): Promise<number> {
  if (!(await isQboActive(companyId))) return 0;
  const cfg = await settings(companyId);
  const since = new Date(Date.now() - windowDays * 86400_000);
  const tz = await companyTimezone(companyId);
  const rows = await sdb
    .select({ id: schema.bookings.id, status: schema.bookings.status, vendorBillStatus: schema.bookings.vendorBillStatus, scheduledAt: schema.bookings.scheduledAt })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.companyId, companyId),
        isNotNull(schema.bookings.riderId),
        isNull(schema.bookings.deletedAt),
        eq(schema.bookings.isSample, false),
        ne(schema.bookings.status, "cancelled"),
        gte(schema.bookings.scheduledAt, since),
        or(
          inArray(schema.bookings.vendorBillStatus, ["none", "error"]),
          cfg.billMode === "arriveping" ? and(eq(schema.bookings.status, "completed"), eq(schema.bookings.vendorBillStatus, "po_open")) : undefined,
        ),
      ),
    );
  let n = 0;
  for (const r of rows) {
    if (cfg.syncSince && tenantDate(r.scheduledAt, tz) < cfg.syncSince) continue;
    const kind: SyncKind = r.status === "completed" ? "bill.create" : "po.create";
    if (await enqueueTask(companyId, r.id, kind, COALESCE_MS)) n++;
  }
  return n;
}

/* ------------------------------------------------------------------ build */

type Rider = typeof schema.riders.$inferSelect;

/**
 * What the PO is priced from. Once the job has accrued pay (completion) that
 * is the truth; before that, the same tech-pay rules estimate it from the
 * job's line items, flat pay and the rider's rates (no time on site yet).
 */
function priced(b: Booking, rider: Rider): Pick<Booking, "techPay" | "techPayBreakdown" | "lineItems" | "onSiteMinutes"> {
  if (Number(b.techPay) > 0 || b.techPayBreakdown) return b;
  const est = jobTechPay(b, rider);
  if (!(est.techPay > 0)) return b;
  const breakdown = { hourlyPay: est.hourlyPay, unitPay: est.unitPay, mileagePay: est.mileagePay, flatPay: est.flatPay, techPay: est.techPay, onSiteMinutes: Number(b.onSiteMinutes) || 0, paidKm: est.paidKm };
  return { techPay: est.techPay, techPayBreakdown: JSON.stringify(breakdown), lineItems: b.lineItems, onSiteMinutes: b.onSiteMinutes };
}

async function poInput(companyId: string, b: Booking, cfg: QboSettings): Promise<PoInput | { issue: string }> {
  const [rider] = await sdb.select().from(schema.riders).where(eq(schema.riders.id, b.riderId!));
  if (!rider) return { issue: "no_technician" };
  const [techUser] = await sdb.select({ name: schema.user.name, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, rider.userId));
  const vendor = await resolveVendor(companyId, { id: rider.id, userId: rider.userId, name: techUser?.name ?? "", email: techUser?.email ?? "" }, { shadow: cfg.shadow });
  if ("issue" in vendor) return vendor;

  let customerId: string | null = null;
  if (b.customerId) {
    const [cust] = await sdb.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, b.customerId));
    const customer = await resolveCustomer(companyId, { customerId: b.customerId, customerName: cust?.name ?? "", address: b.address ?? "" }, { shadow: cfg.shadow });
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

  const lines = linesFromBooking(priced(b, rider), { itemId: item.qboId, itemByCatalogId: (id) => byCatalog.get(id) });
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

async function deletePurchaseOrder(companyId: string, po: { Id?: string; SyncToken?: string }): Promise<void> {
  await qboFetch(companyId, "/purchaseorder", { method: "POST", query: { operation: "delete" }, body: { Id: po.Id, SyncToken: po.SyncToken ?? "0" } });
}

/** The job's bills in QuickBooks: linked, or any bill that references the PO. */
async function billsFor(companyId: string, b: Booking, po: PurchaseOrder | null): Promise<Bill[]> {
  const linked = await getLink(companyId, "bill", b.id);
  if (linked) return [{ Id: linked.qboId, SyncToken: linked.syncToken, VendorRef: { value: "" }, Line: [] }];
  const fromPo = (po?.LinkedTxn ?? []).filter((l) => l.TxnType === "Bill");
  const bills: Bill[] = [];
  for (const l of fromPo) {
    try {
      bills.push((await qboFetch<{ Bill: Bill }>(companyId, `/bill/${l.TxnId}`)).Bill);
    } catch (e) {
      if (!(e instanceof QboError && e.code === "610")) throw e;
    }
  }
  if (bills.length) return bills;
  return qboQuery<Bill>(companyId, `SELECT * FROM Bill WHERE DocNumber = ${q(docNumberFor(b.id))}`);
}

/**
 * The job's PO: ours, or one already in QuickBooks with our document number.
 * A PO to a technician who no longer has the job is removed first (reassignment).
 * Null in shadow mode, or when a person has to decide.
 */
async function ensurePurchaseOrder(companyId: string, b: Booking, cfg: QboSettings, input: PoInput): Promise<PurchaseOrder | null> {
  const linked = await getLink(companyId, "purchase_order", b.id);
  if (linked) {
    if (cfg.shadow) return { Id: linked.qboId, SyncToken: linked.syncToken, VendorRef: { value: input.vendorId }, Line: [] };
    const current = (await qboFetch<{ PurchaseOrder: PurchaseOrder }>(companyId, `/purchaseorder/${linked.qboId}`)).PurchaseOrder;
    if (current.VendorRef.value === input.vendorId) return current;
    // reassigned: the PO belongs to the previous technician
    const billed = await billsFor(companyId, b, current);
    if (billed.length || current.POStatus === "Closed") {
      await raiseIssue(companyId, "po_reassign_review", `Job reassigned but its QuickBooks purchase order ${input.docNumber} is already billed or closed. Decide in QuickBooks.`, { bookingId: b.id });
      return null;
    }
    await deletePurchaseOrder(companyId, current);
    await sdb.delete(schema.qboLinks).where(eq(schema.qboLinks.id, linked.id));
    await timeline(companyId, b.id, `Purchase order ${input.docNumber} removed from QuickBooks (job reassigned)`);
  }

  const existing = await qboQuery<PurchaseOrder>(companyId, `SELECT * FROM PurchaseOrder WHERE DocNumber = ${q(input.docNumber)}`);
  let po = existing[0] ?? null;
  let created = false;
  if (!po) {
    const payload = buildPurchaseOrder(input);
    if (cfg.shadow) {
      await raiseIssue(companyId, "shadow", `Shadow mode: would create purchase order ${input.docNumber}.`, { bookingId: b.id, detail: { payload }, resolved: true });
      return null;
    }
    po = (await qboFetch<{ PurchaseOrder: PurchaseOrder }>(companyId, "/purchaseorder", { method: "POST", body: payload })).PurchaseOrder;
    created = true;
  }
  const claim = await claimMapping(companyId, "purchase_order", b.id, po.Id!, { syncToken: po.SyncToken ?? "", fingerprint: fingerprint(input) });
  if (!claim.won) {
    // another instance linked this job's PO between our lookup and our create
    if (created) await deletePurchaseOrder(companyId, po);
    return (await qboFetch<{ PurchaseOrder: PurchaseOrder }>(companyId, `/purchaseorder/${claim.qboId}`)).PurchaseOrder;
  }
  if (b.vendorBillStatus === "none" || b.vendorBillStatus === "error") await setBillStatus(b.id, "po_open");
  await resolveIssues(companyId, b.id, "no_pay");
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
  // the bookkeeper may have billed the PO under her own number: the PO knows
  const existing = await billsFor(companyId, b, po);
  let bill = existing.find((x) => (x.LinkedTxn ?? []).some((l) => l.TxnType === "PurchaseOrder" && l.TxnId === po.Id)) ?? existing[0] ?? null;
  let created = false;
  if (!bill) {
    const txnDate = tenantDate(b.finishedAt ?? new Date(), await companyTimezone(companyId));
    const payload = buildBill({ ...input, poId: po.Id!, poLineIds: (po.Line ?? []).map((l) => l.Id).filter((x): x is string => !!x), txnDate, dueDate: addDays(txnDate, 30) });
    if (cfg.shadow) {
      await raiseIssue(companyId, "shadow", `Shadow mode: would create bill ${input.docNumber}.`, { bookingId: b.id, detail: { payload }, resolved: true });
      return;
    }
    bill = (await qboFetch<{ Bill: Bill }>(companyId, "/bill", { method: "POST", body: payload })).Bill;
    created = true;
  }
  const claim = await claimMapping(companyId, "bill", b.id, bill.Id!, { syncToken: bill.SyncToken ?? "", fingerprint: fingerprint(input) });
  if (!claim.won) {
    if (created) await qboFetch(companyId, "/bill", { method: "POST", query: { operation: "delete" }, body: { Id: bill.Id, SyncToken: bill.SyncToken ?? "0" } });
    return;
  }
  await setBillStatus(b.id, bill.Balance === 0 && (bill.TotalAmt ?? 0) > 0 ? "paid" : "billed");
  await timeline(companyId, b.id, `Bill ${bill.DocNumber ?? input.docNumber} in QuickBooks ($${(bill.TotalAmt ?? 0).toFixed(2)})`, { qboId: bill.Id, docNumber: bill.DocNumber ?? input.docNumber });
  if (created) await closePurchaseOrder(companyId, po.Id!);
}

/** A PO with estimate lines the final bill did not cover stays open in Intuit's eyes; the job is done, so close it. */
async function closePurchaseOrder(companyId: string, poId: string): Promise<void> {
  const current = (await qboFetch<{ PurchaseOrder: PurchaseOrder }>(companyId, `/purchaseorder/${poId}`)).PurchaseOrder;
  if (current.POStatus !== "Open") return;
  await qboFetch(companyId, "/purchaseorder", { method: "POST", body: { Id: poId, SyncToken: current.SyncToken, POStatus: "Closed", sparse: true } });
}

/** Cancelled, declined or released: the PO goes unless something was billed on it. */
async function cancelPurchaseOrder(companyId: string, b: Booking): Promise<void> {
  const po = await getLink(companyId, "purchase_order", b.id);
  if (!po) return;
  const why = b.status === "cancelled" ? "Job cancelled" : "Technician changed";
  const current = (await qboFetch<{ PurchaseOrder: PurchaseOrder }>(companyId, `/purchaseorder/${po.qboId}`)).PurchaseOrder;
  if (b.status !== "cancelled" && b.riderId) {
    // the job went straight to another (or the same) technician: po.create handles a vendor change
    const vendor = await getLink(companyId, "vendor", b.riderId);
    if (vendor && vendor.qboId === current.VendorRef.value) return;
  }
  const billed = await billsFor(companyId, b, current);
  if (billed.length) {
    await raiseIssue(companyId, "po_cancel_review", `${why} but QuickBooks bill ${billed[0]!.DocNumber ?? billed[0]!.Id} already exists for its purchase order ${docNumberFor(b.id)}. Decide in QuickBooks.`, { bookingId: b.id });
    return;
  }
  if (current.POStatus === "Closed") {
    await raiseIssue(companyId, "po_cancel_review", `${why} but its QuickBooks purchase order ${docNumberFor(b.id)} is already closed.`, { bookingId: b.id });
    return;
  }
  await deletePurchaseOrder(companyId, current);
  await sdb.delete(schema.qboLinks).where(eq(schema.qboLinks.id, po.id));
  await setBillStatus(b.id, "none");
  await timeline(companyId, b.id, `Purchase order ${docNumberFor(b.id)} removed from QuickBooks`);
}

/* --------------------------------------------------------------- handlers */

const ISSUE_TEXT: Record<string, string> = {
  no_technician: "The job's technician no longer exists.",
  vendor_unnamed: "The technician has no name to look up or create a vendor under.",
  customer_unnamed: "The job's customer has no name to look up or create a customer under.",
  vendor_ambiguous: "More than one QuickBooks vendor matches the technician's name. Pick one under Mappings.",
  customer_ambiguous: "More than one QuickBooks customer matches the job's customer. Pick one under Mappings.",
  item_unmapped: "No QuickBooks item is mapped for the job's template and no default item is set.",
};

async function run(companyId: string, bookingId: string, kind: SyncKind): Promise<void> {
  const b = await loadBooking(companyId, bookingId);
  if (!syncable(b)) return;
  const cfg = await settings(companyId);
  if (!(await withinSyncWindow(companyId, b, cfg, kind))) return;
  if (kind === "po.cancel") return cancelPurchaseOrder(companyId, b);
  if (!b.riderId || b.status === "cancelled") return;
  const input = await poInput(companyId, b, cfg);
  if ("issue" in input) {
    if (input.issue === "no_pay") {
      // nothing to put on a PO yet (hourly tech, no line items): priced at completion
      await raiseIssue(companyId, "no_pay", `No technician pay to put on purchase order ${docNumberFor(b.id)} yet; it will be created when the job completes.`, { bookingId: b.id });
      return;
    }
    await raiseIssue(companyId, input.issue, ISSUE_TEXT[input.issue] ?? `QuickBooks sync stopped: ${input.issue}.`, { bookingId: b.id });
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
