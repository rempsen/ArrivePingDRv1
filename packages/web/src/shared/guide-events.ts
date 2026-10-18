/**
 * Guide events the browser reports (POST /api/me/guide-events), so PostHog
 * can show where people drop out of a tour and how Ask is used. Plain types,
 * shared by the web app and the server; the server validates with
 * ./guide-events-schema.ts. Only ids, counts and fixed labels: never names,
 * emails, questions or answers.
 *
 * Server-side events already cover the rest: welcome completed, chapter
 * completed / skipped, sample day added / cleared, practice job created,
 * checklist steps done, activated, tip email sent.
 */
export type ChapterSource = "welcome" | "panel" | "checklist" | "article" | "ask" | "deeplink";

export type GuideEvent =
  | { name: "guide.chapter_started"; chapter: string; source: ChapterSource }
  | { name: "guide.step_viewed"; chapter: string; step: string; index: number }
  | { name: "guide.step_missing"; chapter: string; step: string }
  | { name: "guide.ask_question"; answered: boolean; actions: number }
  | { name: "guide.ask_action"; type: "tour" | "page" | "article" };
