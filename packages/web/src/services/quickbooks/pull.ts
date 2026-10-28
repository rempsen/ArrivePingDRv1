/**
 * Inbound QuickBooks Sync: what QuickBooks tells us about our paperwork.
 *
 *   - a Bill linked to one of our purchase orders is adopted (the bookkeeper
 *     entered the subtrade's invoice, or our own create's reply was lost);
 *   - a Bill whose balance reaches zero marks the job "Subtrade paid", dated
 *     from the bill payment; a bill that reopens takes it back to "billed";
 *   - a deleted or voided Bill returns the job to "PO open" and raises an issue.
 *
 * Events arrive by webhook (handleWebhook → task "qbo.pull") and, because
 * delivery is best-effort, by the change-data-capture sweep (sweep.ts).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { sdb } from "../../api/database";
import * as schema from "../../api/database/schema";
import { logJobEvent } from "../job-events";
import { registerTaskHandler, scheduleTask } from "../scheduler";
import { qboFetch, QboError } from "./client";
import type { Bill, BillPayment, WebhookPayload } from "./entities";
import { findByQboId, getLink, raiseIssue, setMapping } from "./resolve";
import { isQboActive } from "./sync";

export const PULL_TASK = "qbo.pull";

/** Intuit signs the raw body with HMAC-SHA256 under the app's Verifier Token, base64. */
export function verifyIntuitSignature(rawBody: Uint8Array, header: string | undefined, verifier: string): boolean {
  if (!header || !verifier) return false;
  const expected = createHmac("sha256", verifier).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(header, "base64");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface PullEntity {
  name: string;
  id: string;
  operation: string;
}

/** Queue one pull task per realm we know. Unknown realms are ignored (we answer 200 regardless). */
export async function handleWebhook(payload: WebhookPayload): Promise<void> {
  for (const n of payload.eventNotifications ?? []) {
    const [integration] = await sdb
      .select({ companyId: schema.integrations.companyId })
      .from(schema.integrations)
      .where(and(eq(schema.integrations.provider, "quickbooks"), eq(schema.integrations.externalAccountId, n.realmId)));
    if (!integration) continue;
    const entities: PullEntity[] = (n.dataChangeEvent?.entities ?? [])
      .filter((e) => ["Bill", "BillPayment", "PurchaseOrder"].includes(e.name))
      .map((e) => ({ name: e.name, id: e.id, operation: e.operation }));
    if (!entities.length) continue;
    await scheduleTask({ companyId: integration.companyId, kind: PULL_TASK, runAt: Date.now(), payload: { entities } });
  }
}

type Booking = typeof schema.bookings.$inferSelect;

async function bookingForLink(companyId: string, kind: "purchase_order" | "bill", qboId: string): Promise<Booking | null> {
  const l = await findByQboId(companyId, kind, qboId);
  if (!l) return null;
  const [b] = await sdb.select().from(schema.bookings).where(and(eq(schema.bookings.id, l.localId), eq(schema.bookings.companyId, companyId)));
  return b ?? null;
}

function money(n: number | undefined): string {
  return `$${(n ?? 0).toFixed(2)}`;
}

/** A Bill that references one of our POs becomes the job's bill. */
export async function adoptBillForPo(companyId: string, bill: Bill): Promise<Booking | null> {
  if (!bill.Id) return null;
  const already = await bookingForLink(companyId, "bill", bill.Id);
  if (already) return already;
  const poIds = [...(bill.LinkedTxn ?? []), ...bill.Line.flatMap((l) => l.LinkedTxn ?? [])].filter((l) => l.TxnType === "PurchaseOrder").map((l) => l.TxnId);
  for (const poId of new Set(poIds)) {
    const b = await bookingForLink(companyId, "purchase_order", poId);
    if (!b) continue;
    const existing = await getLink(companyId, "bill", b.id);
    if (existing && existing.qboId !== bill.Id) continue; // the job already has a different bill
    await setMapping(companyId, "bill", b.id, bill.Id, { syncToken: bill.SyncToken ?? "" });
    if (b.vendorBillStatus !== "paid") await sdb.update(schema.bookings).set({ vendorBillStatus: "billed" }).where(eq(schema.bookings.id, b.id));
    await logJobEvent({ companyId, bookingId: b.id, kind: "accounting", label: `Bill ${bill.DocNumber ?? bill.Id} entered in QuickBooks (${money(bill.TotalAmt)})`, meta: { qboId: bill.Id } });
    return b;
  }
  return null;
}

async function paymentDate(companyId: string, bill: Bill): Promise<Date> {
  const payments = (bill.LinkedTxn ?? []).filter((l) => l.TxnType === "BillPayment");
  let latest: Date | null = null;
  for (const p of payments) {
    try {
      const r = await qboFetch<{ BillPayment: BillPayment }>(companyId, `/billpayment/${p.TxnId}`);
      const d = r.BillPayment.TxnDate ? new Date(`${r.BillPayment.TxnDate}T12:00:00Z`) : null;
      if (d && (!latest || d > latest)) latest = d;
    } catch {
      /* fall back to now */
    }
  }
  return latest ?? new Date();
}

/** Balance 0 → paid (once); balance back above 0 → billed. */
export async function applyBillBalance(companyId: string, bill: Bill): Promise<void> {
  if (!bill.Id) return;
  const b = await bookingForLink(companyId, "bill", bill.Id);
  if (!b) return;
  const paid = (bill.Balance ?? 0) === 0 && (bill.TotalAmt ?? 0) > 0;
  if (paid && b.vendorBillStatus !== "paid") {
    const at = await paymentDate(companyId, bill);
    await sdb.update(schema.bookings).set({ vendorBillStatus: "paid", subtradePaidAt: at }).where(eq(schema.bookings.id, b.id));
    await logJobEvent({ companyId, bookingId: b.id, kind: "accounting", label: `Subtrade paid in QuickBooks (${money(bill.TotalAmt)})`, meta: { qboId: bill.Id, paidAt: at.toISOString() } });
  } else if (!paid && b.vendorBillStatus === "paid") {
    await sdb.update(schema.bookings).set({ vendorBillStatus: "billed", subtradePaidAt: null }).where(eq(schema.bookings.id, b.id));
    await logJobEvent({ companyId, bookingId: b.id, kind: "accounting", label: `Bill reopened in QuickBooks (${money(bill.Balance)} owing)`, meta: { qboId: bill.Id } });
  }
}

async function billRemoved(companyId: string, qboBillId: string): Promise<void> {
  const b = await bookingForLink(companyId, "bill", qboBillId);
  if (!b) return;
  const l = await getLink(companyId, "bill", b.id);
  if (l) await sdb.delete(schema.qboLinks).where(eq(schema.qboLinks.id, l.id));
  const po = await getLink(companyId, "purchase_order", b.id);
  await sdb.update(schema.bookings).set({ vendorBillStatus: po ? "po_open" : "none", subtradePaidAt: null }).where(eq(schema.bookings.id, b.id));
  await raiseIssue(companyId, "bill_removed", "The subtrade's bill for this job was deleted or voided in QuickBooks.", { bookingId: b.id, detail: { qboId: qboBillId } });
  await logJobEvent({ companyId, bookingId: b.id, kind: "accounting", label: "Bill removed in QuickBooks", meta: { qboId: qboBillId } });
}

/** Fetch one changed record and apply what it says. */
export async function pullEntity(companyId: string, name: string, id: string, operation = "Update"): Promise<void> {
  if (name === "Bill") {
    if (operation === "Delete" || operation === "Void") return billRemoved(companyId, id);
    let bill: Bill;
    try {
      bill = (await qboFetch<{ Bill: Bill }>(companyId, `/bill/${id}`)).Bill;
    } catch (e) {
      if (e instanceof QboError && e.code === "610") return billRemoved(companyId, id);
      throw e;
    }
    await adoptBillForPo(companyId, bill);
    await applyBillBalance(companyId, bill);
    return;
  }
  if (name === "BillPayment") {
    if (operation === "Delete" || operation === "Void") return; // the Bill's own update follows
    const r = await qboFetch<{ BillPayment: BillPayment }>(companyId, `/billpayment/${id}`);
    const billIds = new Set((r.BillPayment.Line ?? []).flatMap((l) => l.LinkedTxn.filter((t) => t.TxnType === "Bill").map((t) => t.TxnId)));
    for (const billId of billIds) await pullEntity(companyId, "Bill", billId);
  }
  // PurchaseOrder changes carry nothing we act on yet (the bill drives status).
}

registerTaskHandler(PULL_TASK, async (task) => {
  if (!(await isQboActive(task.companyId))) return;
  const entities = (task.payload.entities ?? []) as PullEntity[];
  for (const e of entities) {
    try {
      await pullEntity(task.companyId, e.name, e.id, e.operation);
    } catch (err) {
      if (err instanceof QboError && !err.retryable) {
        console.warn(`[qbo] pull ${e.name}/${e.id} skipped: ${err.code}`);
        continue;
      }
      throw err; // the scheduler retries the whole task
    }
  }
});
