/**
 * Control Hub → Features → "Switch for many…": which companies a switch
 * reaches. Pure, so the picking rules are tested without the dialog.
 */
export type BulkWho = "customer" | "demo" | "test" | "all" | "pick";

export interface PickableCompany {
  id: string;
  name: string;
  kind: string;
  industry: string;
  status: string;
}

/** Closed companies and ArrivePing's own internal tenants are never switched in bulk. */
function pickable<T extends PickableCompany>(t: T): boolean {
  return t.status !== "closed" && t.kind !== "internal";
}

const byName = <T extends PickableCompany>(a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** The companies a bulk switch will change. `ids` are the ticked companies when `who` is "pick". */
export function pickCompanies<T extends PickableCompany>(tenants: T[], sel: { who: BulkWho; industry: string; ids: string[] }): T[] {
  const ticked = new Set(sel.ids);
  return tenants.filter((t) => pickable(t) && (sel.who === "all" || (sel.who === "pick" ? ticked.has(t.id) : t.kind === sel.who)) && (!sel.industry || t.industry === sel.industry));
}

/**
 * Companies matching what was typed: a first letter or any part of the name,
 * names that start with the text first, then the rest, each alphabetical.
 * Nothing typed lists every pickable company.
 */
export function searchCompanies<T extends PickableCompany>(tenants: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  const rows = tenants.filter(pickable).sort(byName);
  if (!q) return rows;
  const starts = rows.filter((t) => t.name.toLowerCase().startsWith(q));
  const within = rows.filter((t) => !t.name.toLowerCase().startsWith(q) && t.name.toLowerCase().includes(q));
  return [...starts, ...within];
}
