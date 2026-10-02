/**
 * Alphabetical-index helpers shared by the Companies page and the tenant
 * switcher. Both have the same problem once a platform has hundreds of
 * tenants: a flat list is unusable without search + an A–Z jump bar.
 */

export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
/** Bucket for names that don't start with A–Z (digits, symbols, emoji). */
export const OTHER_BUCKET = "#";

/** Lists shorter than this are rendered flat — an index would be noise. */
export const INDEX_THRESHOLD = 12;

/** Strip accents so "Électricité" buckets under E and matches "elec". */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** First A–Z letter of a name, or "#" for anything else. */
export function bucketLetter(name: string): string {
  const ch = fold(name).charAt(0).toUpperCase();
  return ch >= "A" && ch <= "Z" ? ch : OTHER_BUCKET;
}

export type AlphaGroup<T> = { letter: string; items: T[] };

/**
 * Group items by first letter, A–Z then "#". Items are sorted by name within
 * each group using locale-aware comparison so "Ålesund" sits next to "Alesund".
 */
export function groupAlpha<T>(items: T[], getName: (t: T) => string): AlphaGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const l = bucketLetter(getName(it));
    const arr = map.get(l);
    if (arr) arr.push(it);
    else map.set(l, [it]);
  }
  const order = [...LETTERS, OTHER_BUCKET];
  const out: AlphaGroup<T>[] = [];
  for (const l of order) {
    const arr = map.get(l);
    if (!arr) continue;
    arr.sort((a, b) => getName(a).localeCompare(getName(b), undefined, { sensitivity: "base" }));
    out.push({ letter: l, items: arr });
  }
  return out;
}

/**
 * Loose multi-field match: every whitespace-separated token in the query must
 * appear in at least one of the haystack fields. "bolt plumb" matches
 * "Bolt Plumbing"; "ops@" matches on the contact email.
 */
export function matchesQuery(query: string, fields: Array<string | null | undefined>): boolean {
  const q = fold(query);
  if (!q) return true;
  const hay = fields.filter(Boolean).map((f) => fold(f as string));
  return q.split(/\s+/).every((tok) => hay.some((h) => h.includes(tok)));
}
