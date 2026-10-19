/**
 * Pure edits on a form's item list, used by the builder (and its tests).
 * Sections move with the questions under them.
 */
import { blankItem, newItemId, type FormDef, type FormItem, type ItemType } from "../../../../shared/forms/form-model";

export type Items = FormItem[];

/** Index range [start, end) of a section and everything up to the next section. */
export function blockRange(items: Items, index: number): [number, number] {
  if (items[index]?.type !== "section") return [index, index + 1];
  let end = index + 1;
  while (end < items.length && items[end]!.type !== "section") end++;
  return [index, end];
}

/** Insert a fresh item of `type` after `afterId` (or at the end / at `index`). */
export function insertItem(items: Items, type: ItemType, at: { afterId?: string | null; index?: number }): { items: Items; item: FormItem } {
  const item = blankItem(type);
  const next = items.slice();
  let idx = next.length;
  if (at.index !== undefined) idx = Math.max(0, Math.min(next.length, at.index));
  else if (at.afterId) {
    const i = next.findIndex((x) => x.id === at.afterId);
    if (i >= 0) idx = next[i]!.type === "section" ? i + 1 : i + 1;
  }
  next.splice(idx, 0, item);
  return { items: next, item };
}

export function updateItem(items: Items, id: string, patch: Partial<FormItem>): Items {
  return items.map((x) => {
    if (x.id !== id) return x;
    const merged = { ...x, ...patch } as FormItem;
    for (const k of Object.keys(patch) as (keyof FormItem)[]) if (patch[k] === undefined) delete merged[k];
    return merged;
  });
}

/** Remove an item; rules in later questions that pointed at it are dropped too. */
export function removeItem(items: Items, id: string): Items {
  return items
    .filter((x) => x.id !== id)
    .map((x) => (x.showIf?.itemId === id ? (({ showIf: _drop, ...rest }) => rest as FormItem)(x) : x));
}

/** Copy an item (a section copies with its questions) right after itself, with new ids. */
export function duplicateItem(items: Items, id: string): { items: Items; copyId: string | null } {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return { items, copyId: null };
  const [s, e] = blockRange(items, i);
  const idMap = new Map<string, string>();
  const block = items.slice(s, e).map((x) => {
    const nid = newItemId();
    idMap.set(x.id, nid);
    return { ...x, id: nid, label: x.id === id ? `${x.label} (copy)` : x.label, options: x.options ? [...x.options] : undefined };
  });
  // Logic inside the copied block points at the copies.
  for (const b of block) if (b.showIf && idMap.has(b.showIf.itemId)) b.showIf = { ...b.showIf, itemId: idMap.get(b.showIf.itemId)! };
  for (const b of block) if (!b.options) delete b.options;
  const next = items.slice();
  next.splice(e, 0, ...block);
  return { items: next, copyId: block[0]!.id };
}

/**
 * Move `fromId` to where `toId` is (drag-and-drop). A section carries its
 * questions. Moving down onto a section lands after that section's block.
 */
export function moveItem(items: Items, fromId: string, toId: string): Items {
  if (fromId === toId) return items;
  const from = items.findIndex((x) => x.id === fromId);
  const to = items.findIndex((x) => x.id === toId);
  if (from < 0 || to < 0) return items;
  const [s, e] = blockRange(items, from);
  if (to >= s && to < e) return items; // into itself
  const block = items.slice(s, e);
  const rest = [...items.slice(0, s), ...items.slice(e)];
  const t = rest.findIndex((x) => x.id === toId);
  if (block[0]!.type === "section") {
    // Sections move between sections, never into the middle of one.
    let start = t;
    while (start >= 0 && rest[start]!.type !== "section") start--;
    let insertAt: number;
    if (to > from) insertAt = start < 0 ? rest.findIndex((x) => x.type === "section") : blockRange(rest, start)[1];
    else insertAt = start < 0 ? 0 : start;
    if (insertAt < 0) insertAt = rest.length;
    rest.splice(insertAt, 0, ...block);
    return fixLogic(rest);
  }
  let insertAt: number;
  if (to > from) {
    insertAt = t + 1;
  } else {
    insertAt = t;
  }
  rest.splice(insertAt, 0, ...block);
  return fixLogic(rest);
}

/** Move one step up or down (keyboard). */
export function nudgeItem(items: Items, id: string, dir: -1 | 1): Items {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return items;
  const [s, e] = blockRange(items, i);
  if (dir === -1) {
    if (s === 0) return items;
    if (items[i]!.type !== "section") return moveItem(items, id, items[s - 1]!.id);
    // A section jumps above the whole section before it.
    let p = s - 1;
    while (p > 0 && items[p]!.type !== "section") p--;
    return moveItem(items, id, items[p]!.id);
  }
  if (e >= items.length) return items;
  return moveItem(items, id, items[e]!.id);
}

/** Drop "show only if" rules that now point forward (after a move). */
export function fixLogic(items: Items): Items {
  const seen = new Set<string>();
  return items.map((x) => {
    let out = x;
    if (x.showIf && !seen.has(x.showIf.itemId)) {
      const { showIf: _d, ...rest } = x;
      out = rest as FormItem;
    }
    seen.add(x.id);
    return out;
  });
}

/** Questions a "show only if" rule on `id` may point at (answerable, earlier). */
export function logicTargets(items: Items, id: string): FormItem[] {
  const i = items.findIndex((x) => x.id === id);
  return items.slice(0, Math.max(0, i)).filter((x) => x.type !== "section" && x.type !== "instructions");
}

/** Which section each item sits in (null for items before the first section). */
export function sectionIndex(items: Items): (string | null)[] {
  let cur: string | null = null;
  return items.map((x) => {
    if (x.type === "section") {
      cur = x.id;
      return null;
    }
    return cur;
  });
}

export function sameForm(a: FormDef, b: FormDef): boolean {
  return JSON.stringify(a.items) === JSON.stringify(b.items);
}

/** Change a question's type, keeping what still makes sense. */
export function retype(item: FormItem, type: ItemType): FormItem {
  const fresh = blankItem(type);
  const keepOptions = ["single_choice", "multi_choice", "checklist"].includes(type);
  const out: FormItem = {
    ...fresh,
    id: item.id,
    label: item.label,
    help: item.help,
    required: type === "section" || type === "instructions" ? undefined : item.required,
    internal: item.internal,
    showIf: item.showIf,
    options: keepOptions ? (item.options?.length ? item.options : fresh.options) : undefined,
  };
  for (const k of Object.keys(out) as (keyof FormItem)[]) if (out[k] === undefined) delete out[k];
  return out;
}
