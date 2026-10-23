/**
 * Work-order line items, the shape `shared/catalog.ts` stores on a booking
 * (`lineItems` is a JSON string on the row). Only what the mobile editor
 * touches: quantity, unit price, add a custom line, remove one. Assemblies
 * keep their child breakdown untouched.
 */
export type LineKind = "service" | "part" | "material" | "labor" | "assembly" | "fee" | "unit" | "custom" | string;

export interface LineItem {
  itemId: string;
  kind: LineKind;
  name: string;
  sku: string;
  unit: string;
  qty: number;
  /** Per-unit cost (tech pay for "unit" lines). */
  unitCost: number;
  /** Per-unit customer price. */
  unitPrice: number;
  taxable: boolean;
  /** unitCost × qty */
  cost: number;
  /** unitPrice × qty */
  price: number;
  [extra: string]: unknown;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Whatever the row holds (a JSON string, an array, nothing) as line items. */
export function parseLineItems(raw: unknown): LineItem[] {
  let v: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return [];
    try {
      v = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x && typeof x === "object").map((x) => withTotals({ qty: 1, unitCost: 0, unitPrice: 0, taxable: true, itemId: "", kind: "custom", name: "", sku: "", unit: "", ...(x as object) } as LineItem));
}

/** The line with `cost` and `price` recomputed from quantity and unit amounts. */
export function withTotals(li: LineItem): LineItem {
  const qty = Number.isFinite(li.qty) ? li.qty : 0;
  return { ...li, qty, cost: round2((Number(li.unitCost) || 0) * qty), price: round2((Number(li.unitPrice) || 0) * qty) };
}

export function sumLineItems(items: readonly LineItem[]): { cost: number; price: number; taxablePrice: number; margin: number } {
  let cost = 0;
  let price = 0;
  let taxablePrice = 0;
  for (const li of items) {
    cost += li.cost || 0;
    price += li.price || 0;
    if (li.taxable !== false) taxablePrice += li.price || 0;
  }
  cost = round2(cost);
  price = round2(price);
  return { cost, price, taxablePrice: round2(taxablePrice), margin: round2(price - cost) };
}

/** A free-text line the office adds on the spot. */
export function customLine(name: string, qty: number, unitPrice: number): LineItem {
  return withTotals({ itemId: "", kind: "custom", name: name.trim(), sku: "", unit: "ea", qty, unitCost: 0, unitPrice, taxable: true, cost: 0, price: 0 });
}
