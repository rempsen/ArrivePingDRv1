import { articles, type Article } from "./articles";

/**
 * Tiny ranked search over Help Center titles, summaries, keywords and body
 * text. Shared by the public Help Center (/support) and the in-app Guide
 * panel, so both find the same articles for the same words.
 */
export function searchArticles(q: string, limit = 7): Article[] {
  const terms = q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
  if (!terms.length) return [];
  const scored = articles
    .map((a) => {
      const title = a.title.toLowerCase();
      const summary = a.summary.toLowerCase();
      const kw = (a.keywords ?? []).join(" ").toLowerCase();
      const body = a.blocks
        .map((b) => ("text" in b ? b.text : "items" in b ? b.items.join(" ") : ""))
        .join(" ")
        .toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += 6;
        if (kw.includes(t)) score += 4;
        if (summary.includes(t)) score += 3;
        if (body.includes(t)) score += 1;
      }
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score);
  return scored.slice(0, limit).map((x) => x.a);
}
