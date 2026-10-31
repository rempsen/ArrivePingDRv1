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

/** The period's totals, counted by the server over every question (not just the listed ones). */
export interface HelpCounts {
  asked: number;
  gaps: number;
  handedOff: number;
  thumbsDown: number;
  thumbsUp: number;
  failed: number;
}

/** Share of questions answered without support, a thumbs down or a failure. */
export function selfServed(c: HelpCounts): number | null {
  return c.asked ? (c.asked - c.gaps) / c.asked : null;
}

/** One unanswered question, as the server sends every one in the period for the grouping. */
export type GapQuestion = Pick<HelpQuestion, "question" | "matched">;

/** "office-web.setup.billing" → its screen title; "article:slug" → the article's title. */
export function matchLabel(id: string): string {
  if (id.startsWith("article:")) {
    const slug = id.slice("article:".length);
    return articles.find((a) => a.slug === slug)?.title ?? slug;
  }
  return kbById[id]?.title ?? id;
}

export function matchedIds(q: Pick<HelpQuestion, "matched">): string[] {
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
 * Unanswered questions grouped by the screen the search ranked first: where the help
 * material most needs work. Questions that matched nothing are their own
 * group ("Nothing matched"), the clearest sign of a missing topic.
 */
export function gapTopics(gaps: GapQuestion[], limit = 8): GapTopic[] {
  const by = new Map<string, GapTopic>();
  for (const q of gaps) {
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
