/**
 * How a job becomes QuickBooks paperwork. Pure: no database, no network.
 *
 * One line per part of the technician's pay (shared/tech-pay.ts):
 *   per-unit line items  → one line each (qty × unit cost), on the catalog
 *                          item's mapped QuickBooks item when there is one
 *   on-site hourly pay   → "On-site labour 2h 45m"
 *   mileage pay          → "Mileage 27.77 km"
 *   flat pay             → "Flat job pay"
 * The lines add up to `techPay` to the cent; the last line absorbs rounding.
 * Every line is job-costed to the QuickBooks customer and carries the tenant's
 * purchase tax code (BMD: GST only). Tax is on top of the amounts.
 */
import { createHash } from "node:crypto";
import { parseLineItems } from "../../shared/catalog";
import type { Bill, ItemBasedExpenseLine, PurchaseOrder } from "./entities";

export interface PoLine {
  description: string;
  qty: number;
  unitCost: number;
  /** QuickBooks item for this line; the job's item when absent. */
  itemId?: string;
}

export interface PoInput {
  docNumber: string;
  vendorId: string;
  customerId: string | null;
  itemId: string;
  taxCodeId: string;
  privateNote: string;
  lines: PoLine[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

interface Breakdown {
  hourlyPay?: number;
  unitPay?: number;
  mileagePay?: number;
  flatPay?: number;
  techPay?: number;
  onSiteMinutes?: number;
  paidKm?: number;
}

function parseBreakdown(raw: string | null | undefined): Breakdown | null {
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as Breakdown;
    return b && typeof b === "object" ? b : null;
  } catch {
    return null;
  }
}

function hoursLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function linesFromBooking(
  b: { techPay: number | null; techPayBreakdown: string | null; lineItems: string | null; onSiteMinutes: number | null },
  defaults: { itemId: string; itemByCatalogId: (catalogItemId: string) => string | undefined },
): PoLine[] {
  const techPay = r2(Number(b.techPay) || 0);
  const bd = parseBreakdown(b.techPayBreakdown);
  if (!bd) return techPay > 0 ? [{ description: "Job pay", qty: 1, unitCost: techPay }] : [];

  const lines: PoLine[] = [];
  const unitPay = r2(Number(bd.unitPay) || 0);
  if (unitPay > 0) {
    for (const li of parseLineItems(b.lineItems ?? "[]")) {
      if (li.kind !== "unit" || !(li.cost > 0)) continue;
      lines.push({ description: li.name, qty: li.qty, unitCost: li.unitCost, itemId: defaults.itemByCatalogId(li.itemId) });
    }
    if (!lines.length) lines.push({ description: "Per-unit work", qty: 1, unitCost: unitPay });
  }
  const hourly = r2(Number(bd.hourlyPay) || 0);
  if (hourly > 0) lines.push({ description: `On-site labour ${hoursLabel(bd.onSiteMinutes ?? b.onSiteMinutes ?? 0)}`, qty: 1, unitCost: hourly });
  const mileage = r2(Number(bd.mileagePay) || 0);
  if (mileage > 0) lines.push({ description: `Mileage ${r2(Number(bd.paidKm) || 0)} km`, qty: 1, unitCost: mileage });
  const flat = r2(Number(bd.flatPay) || 0);
  if (flat > 0) lines.push({ description: "Flat job pay", qty: 1, unitCost: flat });

  if (!lines.length) return techPay > 0 ? [{ description: "Job pay", qty: 1, unitCost: techPay }] : [];

  // The lines must total techPay to the cent. Unit lines are qty × a rate that
  // may carry more than two decimals; the last line takes the difference.
  const sum = r2(lines.reduce((s, l) => s + r2(l.qty * l.unitCost), 0));
  const diff = r2(techPay - sum);
  if (diff !== 0 && techPay > 0) {
    const last = lines[lines.length - 1]!;
    if (last.qty === 1) last.unitCost = r2(last.unitCost + diff);
    else lines.push({ description: "Rounding", qty: 1, unitCost: diff });
  }
  return lines;
}

function expenseLine(i: PoInput, l: PoLine): ItemBasedExpenseLine {
  const detail: ItemBasedExpenseLine["ItemBasedExpenseLineDetail"] = {
    ItemRef: { value: l.itemId ?? i.itemId },
    ...(i.customerId ? { CustomerRef: { value: i.customerId } } : {}),
    ...(i.taxCodeId ? { TaxCodeRef: { value: i.taxCodeId } } : {}),
    Qty: l.qty,
    UnitPrice: l.unitCost,
    BillableStatus: "NotBillable",
  };
  return { Description: l.description, Amount: r2(l.qty * l.unitCost), DetailType: "ItemBasedExpenseLineDetail", ItemBasedExpenseLineDetail: detail };
}

export function buildPurchaseOrder(i: PoInput): PurchaseOrder {
  return {
    DocNumber: i.docNumber,
    PrivateNote: i.privateNote,
    VendorRef: { value: i.vendorId },
    GlobalTaxCalculation: "TaxExcluded",
    Line: i.lines.map((l) => expenseLine(i, l)),
  };
}

/**
 * The bill for a job, linked to its purchase order. Intuit only honours the
 * link line by line (verified in the sandbox: a header-only link leaves the
 * PO open), so bill line n is linked to the PO's own line id n for as many
 * lines as the two share; a bill with more lines than the PO carries the rest
 * unlinked, and a PO with more lines than the bill is closed afterwards by
 * sync.ts. Amounts may differ: the PO was an estimate at assignment.
 */
export function buildBill(i: PoInput & { poId: string; poLineIds?: string[]; txnDate: string; dueDate: string }): Bill {
  return {
    DocNumber: i.docNumber,
    PrivateNote: i.privateNote,
    TxnDate: i.txnDate,
    DueDate: i.dueDate,
    VendorRef: { value: i.vendorId },
    GlobalTaxCalculation: "TaxExcluded",
    LinkedTxn: [{ TxnId: i.poId, TxnType: "PurchaseOrder" }],
    Line: i.lines.map((l, idx) => {
      const lineId = i.poLineIds?.[idx];
      return lineId ? { ...expenseLine(i, l), LinkedTxn: [{ TxnId: i.poId, TxnType: "PurchaseOrder", TxnLineId: lineId }] } : expenseLine(i, l);
    }),
  };
}

/** Stable hash of what we would send, so an unchanged job costs no API call. */
export function fingerprint(x: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v;
  return createHash("sha256").update(JSON.stringify(stable(x))).digest("hex");
}
