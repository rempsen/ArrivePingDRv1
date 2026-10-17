/**
 * The tenant's shared category list (Settings → Company → Categories), used
 * by the Form Builder and the Product Catalog.
 *
 * It used to be seeded only on first read, from the industry preset, with a
 * generic fallback (General / Residential / Commercial / Service). A tenant
 * whose industry has no preset ("Other", e.g. an AI consultancy) therefore got
 * the generic four even though its catalog and templates already carried
 * real categories from the scrape and the onboarding chat. Now the list is
 * built from what the tenant actually has, and anything that later lands
 * in the catalog or a template with a new category is added to it.
 */
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { getIndustryPreset } from "./industry-presets";

export const GENERIC_CATEGORIES = ["General", "Residential", "Commercial", "Service"];

function clean(name: unknown): string {
  return String(name ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
}

/** Append any of `names` the tenant doesn't have yet (case-insensitive). Returns how many were added. */
export async function ensureFormCategories(companyId: string, names: Iterable<unknown>): Promise<number> {
  const t = tdb(companyId);
  const existing = await t.select(schema.formCategories);
  const have = new Set(existing.map((r) => r.name.toLowerCase()));
  let order = existing.reduce((m, r) => Math.max(m, r.sortOrder), -1);
  const add: { name: string; sortOrder: number }[] = [];
  for (const raw of names) {
    const name = clean(raw);
    if (!name || have.has(name.toLowerCase())) continue;
    have.add(name.toLowerCase());
    add.push({ name, sortOrder: ++order });
  }
  if (add.length) await t.insert(schema.formCategories, add);
  return add.length;
}

/**
 * The category list a tenant should have, in a sensible order: the industry
 * preset's categories first, then every category its catalog items and
 * work-order templates already use. Only when all of that is empty does the
 * generic set apply.
 */
export async function derivedCategories(companyId: string, industry: string | null | undefined): Promise<string[]> {
  const t = tdb(companyId);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    const name = clean(raw);
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    out.push(name);
  };
  for (const c of getIndustryPreset(industry)?.categories ?? []) push(c);
  const [items, templates] = await Promise.all([t.select(schema.catalogItems), t.select(schema.taskTemplates)]);
  // Most-used first so the list reads in the tenant's own order of importance.
  const counts = new Map<string, number>();
  for (const r of [...items, ...templates]) {
    const name = clean(r.category);
    if (name && name.toLowerCase() !== "general") counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const [name] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) push(name);
  if (out.length === 0) for (const g of GENERIC_CATEGORIES) push(g);
  return out;
}

/**
 * Seed the list from what the tenant has (idempotent: adds only what's
 * missing). Called at the end of provisioning and on first read.
 */
export async function seedFormCategories(companyId: string, industry: string | null | undefined): Promise<number> {
  return ensureFormCategories(companyId, await derivedCategories(companyId, industry));
}
