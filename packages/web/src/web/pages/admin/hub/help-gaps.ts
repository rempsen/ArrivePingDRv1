/**
 * Control Hub → Help questions: the numbers and groupings behind the page,
 * kept apart from React so they're tested (web/__tests__/help-gaps.test.ts).
 * Rows come from GET /api/hub/help-questions (api/routes/help-ask.ts).
 */
import { kbById } from "../../../../shared/help-kb";
import { articles } from "../../../site/support/articles";

export interface HelpQuestion {
  id: string;
  source: "public" | "office" | "technician" | string;
  platform: string;
  question: string;
  matched: string;
  answerChars: number;
  handedOff: boolean;
  failed: boolean;
  rating: number;
  createdAt: string;
}

/** A question the help material didn't answer: handed to support, thumbs down, or the answer failed. */
export const isGap = (q: HelpQuestion) => q.handedOff || q.rating < 0 || q.failed;

export const SOURCE_LABEL: Record<string, string> = { public: "Help Center", office: "Office app", technician: "Technician app" };
export const PLATFORM_LABEL: Record<string, string> = { web: "Web", ios: "iPhone/iPad", android: "Android" };

export interface HelpStats {
  asked: number;
  gaps: number;
  handedOff: number;
  thumbsDown: number;
  thumbsUp: number;
  failed: number;
  /** Share of questions answered without support, a thumbs down or a failure. */
  selfServed: number | null;
}

export function helpStats(rows: HelpQuestion[]): HelpStats {
  const gaps = rows.filter(isGap).length;
  return {
    asked: rows.length,
    gaps,
    handedOff: rows.filter((r) => r.handedOff).length,
    thumbsDown: rows.filter((r) => r.rating < 0).length,
    thumbsUp: rows.filter((r) => r.rating > 0).length,
    failed: rows.filter((r) => r.failed).length,
    selfServed: rows.length ? (rows.length - gaps) / rows.length : null,
  };
}

/** "office-web.setup.billing" → its screen title; "article:slug" → the article's title. */
export function matchLabel(id: string): string {
  if (id.startsWith("article:")) {
    const slug = id.slice("article:".length);
    return articles.find((a) => a.slug === slug)?.title ?? slug;
  }
  return kbById[id]?.title ?? id;
}

export function matchedIds(q: HelpQuestion): string[] {
  return q.matched
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface GapTopic {
  /** The screen (or article) the search ranked first for these questions. */
  id: string;
  label: string;
  count: number;
  examples: string[];
}

/**
 * Gaps grouped by the screen the search ranked first: where the help
 * material most needs work. Questions that matched nothing are their own
 * group ("Nothing matched"), the clearest sign of a missing topic.
 */
export function gapTopics(rows: HelpQuestion[], limit = 8): GapTopic[] {
  const by = new Map<string, GapTopic>();
  for (const q of rows.filter(isGap)) {
    const first = matchedIds(q).find((id) => !id.startsWith("article:")) ?? matchedIds(q)[0] ?? "";
    const key = first || "(none)";
    const t = by.get(key) ?? { id: key, label: first ? matchLabel(first) : "Nothing matched", count: 0, examples: [] };
    t.count++;
    if (t.examples.length < 3) t.examples.push(q.question);
    by.set(key, t);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit);
}

export function filterQuestions(rows: HelpQuestion[], f: { onlyGaps: boolean; source: string; search: string }): HelpQuestion[] {
  const s = f.search.trim().toLowerCase();
  return rows.filter((r) => (!f.onlyGaps || isGap(r)) && (!f.source || r.source === f.source) && (!s || r.question.toLowerCase().includes(s)));
}
