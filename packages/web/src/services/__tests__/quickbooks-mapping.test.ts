/**
 * How a job becomes a QuickBooks purchase order and bill: one line per part of
 * the technician's pay, every line job-costed and tax-coded, and the lines add
 * up to the job's tech pay to the cent. Pure functions, no database.
 */
import { describe, expect, it } from "bun:test";
import { buildBill, buildPurchaseOrder, fingerprint, linesFromBooking, type PoInput } from "../quickbooks/mapping";

const lineItems = (xs: Partial<{ itemId: string; kind: string; name: string; qty: number; unitCost: number; cost: number }>[]) =>
  JSON.stringify(xs.map((x) => ({ itemId: "cat-1", kind: "unit", name: "Carpet tile install", sku: "", unit: "sq ft", qty: 1, unitCost: 0, unitPrice: 0, taxable: false, cost: 0, price: 0, ...x })));

const defaults = { itemId: "154", itemByCatalogId: (id: string) => (id === "cat-tile" ? "155" : undefined) };

describe("linesFromBooking", () => {
  it("turns a per-unit flooring job into one line per unit item, using the catalog's item when mapped", () => {
    const lines = linesFromBooking(
      {
        techPay: 1050,
        techPayBreakdown: JSON.stringify({ hourlyPay: 0, unitPay: 1050, mileagePay: 0, flatPay: 0, techPay: 1050, onSiteMinutes: 0 }),
        lineItems: lineItems([
          { itemId: "cat-tile", name: "Floor tile install", qty: 300, unitCost: 2.5, cost: 750 },
          { itemId: "cat-base", name: "Rubber base", qty: 100, unitCost: 3, cost: 300 },
        ]),
        onSiteMinutes: 0,
      },
      defaults,
    );
    expect(lines).toEqual([
      { description: "Floor tile install", qty: 300, unitCost: 2.5, itemId: "155" },
      { description: "Rubber base", qty: 100, unitCost: 3, itemId: undefined },
    ]);
  });

  it("turns an hourly repair into one labour line", () => {
    const lines = linesFromBooking(
      {
        techPay: 137.5,
        techPayBreakdown: JSON.stringify({ hourlyPay: 137.5, unitPay: 0, mileagePay: 0, flatPay: 0, techPay: 137.5, onSiteMinutes: 165 }),
        lineItems: "[]",
        onSiteMinutes: 165,
      },
      defaults,
    );
    expect(lines).toEqual([{ description: "On-site labour 2h 45m", qty: 1, unitCost: 137.5 }]);
  });

  it("adds mileage and flat pay as their own lines and makes the total match tech pay", () => {
    const lines = linesFromBooking(
      {
        techPay: 233.34,
        techPayBreakdown: JSON.stringify({ hourlyPay: 66.67, unitPay: 100.01, mileagePay: 16.66, flatPay: 50, techPay: 233.34, onSiteMinutes: 80, paidKm: 27.77 }),
        lineItems: lineItems([{ itemId: "cat-x", name: "Thing", qty: 3, unitCost: 33.337, cost: 100.01 }]),
        onSiteMinutes: 80,
      },
      defaults,
    );
    expect(lines.map((l) => l.description)).toEqual(["Thing", "On-site labour 1h 20m", "Mileage 27.77 km", "Flat job pay"]);
    const total = lines.reduce((s, l) => s + Math.round(l.qty * l.unitCost * 100) / 100, 0);
    expect(Math.round(total * 100) / 100).toBe(233.34);
  });

  it("falls back to one line for the whole tech pay when there is no breakdown", () => {
    const lines = linesFromBooking({ techPay: 80, techPayBreakdown: "", lineItems: "", onSiteMinutes: 0 }, defaults);
    expect(lines).toEqual([{ description: "Job pay", qty: 1, unitCost: 80 }]);
  });
});

const po: PoInput = {
  docNumber: "AP-9EB51D43",
  vendorId: "227",
  customerId: "364",
  itemId: "154",
  taxCodeId: "4",
  privateNote: "ArrivePing job 9eb51d43-aaaa-bbbb-cccc-000000000000",
  lines: [
    { description: "Floor tile install", qty: 300, unitCost: 2.5, itemId: "155" },
    { description: "On-site labour 1h 0m", qty: 1, unitCost: 60 },
  ],
};

describe("buildPurchaseOrder", () => {
  it("addresses the vendor, costs every line to the customer with the tax code, and carries our job id", () => {
    const out = buildPurchaseOrder(po);
    expect(out.VendorRef).toEqual({ value: "227" });
    expect(out.DocNumber).toBe("AP-9EB51D43");
    expect(out.PrivateNote).toBe(po.privateNote);
    expect(out.GlobalTaxCalculation).toBe("TaxExcluded");
    expect(out.Line.length).toBe(2);
    expect(out.Line[0]).toEqual({
      Description: "Floor tile install",
      Amount: 750,
      DetailType: "ItemBasedExpenseLineDetail",
      ItemBasedExpenseLineDetail: { ItemRef: { value: "155" }, CustomerRef: { value: "364" }, TaxCodeRef: { value: "4" }, Qty: 300, UnitPrice: 2.5, BillableStatus: "NotBillable" },
    });
    expect(out.Line[1]!.ItemBasedExpenseLineDetail.ItemRef).toEqual({ value: "154" });
  });

  it("leaves the customer and tax code off when the tenant has none", () => {
    const out = buildPurchaseOrder({ ...po, customerId: null, taxCodeId: "" });
    expect(out.Line[0]!.ItemBasedExpenseLineDetail.CustomerRef).toBeUndefined();
    expect(out.Line[0]!.ItemBasedExpenseLineDetail.TaxCodeRef).toBeUndefined();
  });
});

describe("buildBill", () => {
  it("links the bill to its purchase order and dates it from the job", () => {
    const out = buildBill({ ...po, poId: "801", txnDate: "2026-10-28", dueDate: "2026-11-27" });
    expect(out.LinkedTxn).toEqual([{ TxnId: "801", TxnType: "PurchaseOrder" }]);
    expect(out.TxnDate).toBe("2026-10-28");
    expect(out.DueDate).toBe("2026-11-27");
    expect(out.DocNumber).toBe("AP-9EB51D43");
    expect(out.Line[0]!.LinkedTxn).toEqual([{ TxnId: "801", TxnType: "PurchaseOrder", TxnLineId: "1" }]);
    expect(out.Line[1]!.LinkedTxn).toEqual([{ TxnId: "801", TxnType: "PurchaseOrder", TxnLineId: "2" }]);
  });
});

describe("fingerprint", () => {
  it("is stable across key order and changes with the content", () => {
    expect(fingerprint({ a: 1, b: [1, 2] })).toBe(fingerprint({ b: [1, 2], a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});
