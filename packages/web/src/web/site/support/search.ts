import { articles, type Article } from "./articles";
import { liveVideos, type HelpVideo } from "./videos";

/**
 * Tiny ranked search over Help Center titles, summaries, keywords and body
 * text. Shared by the public Help Center (/support), the in-app Guide panel
 * and "Ask ArrivePing" (which hands the top results to the model), so all
 * three find the same articles for the same words.
 *
 * People type questions, not keywords ("How do I export my jobs to Excel?"),
 * so the query is split on anything that isn't a letter or digit, filler
 * words are dropped, and plurals / -ing / -ed are trimmed so "exporting"
 * finds "Exports" and "techs" finds "technician".
 */
const STOP = new Set(
  (
    "a an and are as at be but by can could did do does doing for from get got had has have how i i'm if in into is it its " +
    "me my of on or our out so than that the their them then there these they this to too us was we were what when where " +
    "which who why will with would you your yours isn't don't can't won't doesn't didn't aren't"
  ).split(" "),
);

/** Same word, different spelling. Kept short: each one fixes a question we expect. */
const ALIASES: Record<string, string> = {
  tech: "technician",
  techs: "technician",
  sms: "text",
  texts: "text",
  spreadsheet: "csv",
  xlsx: "excel",
  dispatcher: "dispatch",
  login: "sign in",
};

function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es") && /(sh|ch|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Query → search terms (exported for tests). */
export function searchTerms(q: string): string[] {
  const out = new Set<string>();
  for (const raw of q.toLowerCase().split(/[^a-z0-9']+/)) {
    // "where's" → "where", "they're" → "they"; "isn't" stays and is a stop word.
    const w = raw.replace(/^'+|'+$/g, "").replace(/'(s|re|ll|ve|m|d)$/, "");
    if (w.length < 2 || STOP.has(w)) continue;
    out.add(ALIASES[w] ?? stem(w));
  }
  return [...out];
}

const index = articles.map((a) => ({
  a,
  title: a.title.toLowerCase(),
  summary: a.summary.toLowerCase(),
  kw: (a.keywords ?? []).join(" ").toLowerCase(),
  body: a.blocks
    .map((b) => ("text" in b ? b.text : "items" in b ? b.items.join(" ") : ""))
    .join(" ")
    .toLowerCase(),
}));

export function searchArticles(q: string, limit = 7): Article[] {
  const terms = searchTerms(q);
  if (!terms.length) return [];
  const scored = index
    .map(({ a, title, summary, kw, body }) => {
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

/**
 * Videos for the same query. Stricter than articles (titles and summaries
 * only, and most of the words must match) so a video only shows up when it
 * is clearly about what was asked.
 */
export function searchVideos(q: string): HelpVideo[] {
  const terms = searchTerms(q);
  if (!terms.length) return [];
  return liveVideos
    .map((v) => {
      const title = v.title.toLowerCase();
      const text = `${title} ${v.summary.toLowerCase()}`;
      const matched = terms.filter((t) => text.includes(t)).length;
      const inTitle = terms.filter((t) => title.includes(t)).length;
      return { v, ok: inTitle > 0 && matched >= Math.ceil(terms.length / 2), score: matched * 2 + inTitle };
    })
    .filter((x) => x.ok)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.v);
}
