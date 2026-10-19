import * as schema from "../api/database/schema";
import { eq } from "drizzle-orm";
import { tdb } from "../api/database/tenant";
import { parseRateModel, computeSubtotal, EMPTY_RATE_MODEL, mileageFor, type RateModel } from "../shared/pricing";
import { parseDistanceUnit } from "../shared/units";
import { lookupTax, regionFromAddress } from "../shared/tax";
import { parseLineItems, sumLineItems, round2 } from "../shared/catalog";
import { jobTechPay, type TechPayResult } from "../shared/tech-pay";

/**
 * Tenancy: every function takes the resolved `companyId` and routes all
 * tenant-table access through `tdb(companyId)`, which auto-scopes reads/writes
 * to the company and fails closed when the id doesn't belong to the tenant.
 * The booking is always re-fetched scoped, so a booking from another tenant is
 * invisible here (returns null) rather than silently billed.
 */

/** Resolve the effective rate model for a booking: booking snapshot > template > service > legacy basePrice. */
export async function resolveRateModel(companyId: string, b: typeof schema.bookings.$inferSelect): Promise<RateModel> {
  const t = tdb(companyId);
  const fromBooking = parseRateModel(b.rateModel);
  if (fromBooking) return fromBooking;
  // Job forms v2: the prices of the template version the job was booked
  // with, so editing a template later never reprices jobs already booked.
  if (b.templateVersionId) {
    const ver = await t.selectOne(schema.templateVersions, eq(schema.templateVersions.id, b.templateVersionId));
    const fromVer = parseRateModel(ver?.rateModel);
    if (ver) return fromVer ?? (await serviceOrLegacy(t, b));
  }
  if (b.templateId) {
    const tpl = await t.selectOne(schema.taskTemplates, eq(schema.taskTemplates.id, b.templateId));
    const fromTpl = parseRateModel(tpl?.rateModel);
    if (fromTpl) return fromTpl;
  }
  return serviceOrLegacy(t, b);
}

async function serviceOrLegacy(t: ReturnType<typeof tdb>, b: typeof schema.bookings.$inferSelect): Promise<RateModel> {
  const svc = await t.selectOne(schema.services, eq(schema.services.id, b.serviceId));
  const fromSvc = parseRateModel(svc?.rateModel);
  if (fromSvc) return fromSvc;
  // legacy: treat basePrice/price as a pure flat rate
  return { ...EMPTY_RATE_MODEL, flatRate: b.price || svc?.basePrice || 0 };
}

/** Determine tax region for a booking (explicit > address > company default). */
export async function resolveRegion(companyId: string, b: typeof schema.bookings.$inferSelect): Promise<string> {
  if (b.region) return b.region;
  const fromAddr = regionFromAddress(b.address);
  if (fromAddr) return fromAddr;
  // company default — keyed by THIS tenant's settings row, not the legacy
  // `id="default"` singleton (which returned MB/0 tax for every non-default company).
  const co = await tdb(companyId).selectOne(schema.companySettings);
  return co?.defaultRegion || "MB";
}

export interface BillingResult {
  region: string;
  subtotal: number;
  taxRatePct: number;
  taxLabel: string;
  taxAmount: number;
  total: number;
  lineItemsCost?: number;
  lineItemsPrice?: number;
  items: { label: string; qty: number; unit: string; rate: number; amount: number }[];
}

/** Recompute a booking's client charge from its rate model + actuals, persist, return breakdown. */
export async function recomputeBooking(
  companyId: string,
  bookingId: string,
  opts: { actualMinutes?: number; actualKm?: number; persist?: boolean } = {}
): Promise<BillingResult | null> {
  const t = tdb(companyId);
  const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, bookingId));
  if (!b) return null;
  const rm = await resolveRateModel(companyId, b);
  const region = await resolveRegion(companyId, b);

  const actualMinutes = opts.actualMinutes ?? b.onSiteMinutes ?? 0;
  // Mileage is always tracked in full; the rate model picks which distance is billed.
  const actualKm = opts.actualKm ?? mileageFor(rm.kmBasis, b.mileageKm ?? 0, b.mileageToJobKm ?? 0);
  const settings = await t.selectOne(schema.companySettings);
  const unit = parseDistanceUnit(settings?.distanceUnit);

  const { subtotal: rateSubtotal, items: rateItems } = computeSubtotal(rm, actualMinutes, actualKm, unit);

  // ---- catalog line items ----
  const lineItems = parseLineItems(b.lineItems);
  const li = sumLineItems(lineItems);
  // append line items to the breakdown so client records show them explicitly.
  // pay-only per-unit lines (kind "unit" with no customer charge) are hidden from the invoice.
  const invoiceLines = lineItems.filter((x) => !(x.kind === "unit" && (x.price || 0) <= 0));
  const items = [
    ...rateItems,
    ...invoiceLines.map((x) => ({
      label: x.kind === "assembly" ? `${x.name} (assembly)` : x.name,
      qty: x.qty,
      unit: x.unit,
      rate: x.unitPrice,
      amount: x.price,
    })),
  ];

  const subtotal = round2(rateSubtotal + li.price);

  // tax: rate-model portion is fully taxable; line items respect their per-item taxable flag
  const tax = lookupTax(region);
  const taxRatePct = tax?.rate ?? 0;
  const taxLabel = tax?.label ?? "";
  const taxableBase = round2(rateSubtotal + li.taxablePrice);
  const taxAmount = round2((taxableBase * taxRatePct) / 100);
  const total = round2(subtotal + taxAmount);

  const result: BillingResult = { region, subtotal, taxRatePct, taxLabel, taxAmount, total, items, lineItemsCost: li.cost, lineItemsPrice: li.price };

  if (opts.persist !== false) {
    await t.update(schema.bookings, {
      region,
      subtotal,
      taxRatePct,
      taxLabel,
      taxAmount,
      total,
      price: total,
      lineItemsCost: li.cost,
      lineItemsPrice: li.price,
      priceBreakdown: JSON.stringify(items),
      rateModel: JSON.stringify(rm),
    }, eq(schema.bookings.id, bookingId));
  }
  return result;
}

/** Quote without persisting (live preview / estimates). */
export async function quoteBooking(companyId: string, bookingId: string, actualMinutes?: number, actualKm?: number) {
  return recomputeBooking(companyId, bookingId, { actualMinutes, actualKm, persist: false });
}

export type { TechPayResult } from "../shared/tech-pay";

/** Compute & persist tech pay for a completed job.
 *  = hourly pay + mileage pay + flat pay + per-unit line pay, at the workflow's
 *  rates or the technician's own (see `jobTechPay`).
 *  The arithmetic lives in `shared/tech-pay.ts` so job completion, payout
 *  generation and the Earnings screens can never drift apart. */
export async function accrueTechPay(companyId: string, bookingId: string): Promise<TechPayResult | null> {
  const t = tdb(companyId);
  const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, bookingId));
  if (!b || !b.riderId) return null;
  const r = await t.selectOne(schema.riders, eq(schema.riders.id, b.riderId));
  if (!r) return null;
  const pay = jobTechPay(b, r);
  const breakdown = {
    onSiteMinutes: b.onSiteMinutes || 0,
    hours: pay.hours,
    payRatePerHour: pay.payRatePerHour,
    hourlyPay: pay.hourlyPay,
    unitPay: pay.unitPay,
    mileageKm: b.mileageKm || 0,
    mileageToJobKm: b.mileageToJobKm || 0,
    mileageBasis: pay.mileageBasis,
    paidKm: pay.paidKm,
    payRatePerKm: pay.payRatePerKm,
    mileagePay: pay.mileagePay,
    flatPay: pay.flatPay,
    techPay: pay.techPay,
    unrated: pay.unrated,
  };
  await t.update(schema.bookings, {
    techPay: pay.techPay,
    techPayBreakdown: JSON.stringify(breakdown),
  }, eq(schema.bookings.id, bookingId));
  return pay;
}

/**
 * Make the booking's invoice match what the job actually costs, right before a
 * payment is taken. Invoices are created when a work order is booked, from the
 * estimate; the job is re-priced on completion (actual time, mileage, parts),
 * and nothing carried that final total onto the invoice — so a card charge used
 * the stale estimate. Creates the invoice if the job never had one. A paid (or
 * refunded) invoice is never touched.
 */
export async function syncInvoiceToBooking(companyId: string, bookingId: string) {
  const t = tdb(companyId);
  const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, bookingId));
  if (!b) return null;
  const subtotal = round2(Number(b.subtotal) || 0);
  const tax = round2(Number(b.taxAmount) || 0);
  const total = round2(Number(b.total) || Number(b.price) || subtotal + tax);
  const inv = await t.selectOne(schema.invoices, eq(schema.invoices.bookingId, bookingId));
  if (!inv) {
    const [created] = await t.insert(schema.invoices, {
      bookingId,
      customerId: b.customerId,
      number: `INV-${Date.now().toString().slice(-6)}`,
      amount: subtotal || total,
      tax,
      total,
    });
    return created ?? null;
  }
  if (inv.status === "paid" || inv.status === "refunded") return inv;
  if (inv.amount === subtotal && inv.tax === tax && inv.total === total) return inv;
  const [updated] = await t.update(
    schema.invoices,
    { amount: subtotal || total, tax, total },
    eq(schema.invoices.id, inv.id),
  );
  return updated ?? { ...inv, amount: subtotal || total, tax, total };
}
