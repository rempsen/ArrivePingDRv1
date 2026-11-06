/**
 * House rules for the blog schedule.
 *
 * Dan, 2026-11-05: the blog publishes at most one post per day.
 * Batch 2026-11-b0b put three posts on 2026-11-01; they were re-dated to
 * Nov 1, 3 and 5. Scheduled (future-dated) posts count too, so a batch can't
 * queue several posts for the same day. Drafts are exempt until they get a date
 * for real.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const POSTS = join(import.meta.dir, "../site/blog/posts");

function datedPosts(): { slug: string; date: string }[] {
  return readdirSync(POSTS)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ slug: f.replace(/\.md$/, ""), raw: readFileSync(join(POSTS, f), "utf8") }))
    .filter(({ raw }) => !/\ndraft: true\n/.test(raw))
    .map(({ slug, raw }) => ({ slug, date: JSON.parse(raw.match(/\ndate: (.+)\n/)?.[1] ?? '""') as string }));
}

describe("blog schedule", () => {
  it("has at most one post per day", () => {
    const byDate = new Map<string, string[]>();
    for (const p of datedPosts()) byDate.set(p.date, [...(byDate.get(p.date) ?? []), p.slug]);
    const clashes = [...byDate].filter(([, slugs]) => slugs.length > 1).map(([d, slugs]) => `${d}: ${slugs.sort().join(", ")}`);
    expect(clashes).toEqual([]);
  });

  it("reads a date from every post", () => {
    for (const p of datedPosts()) expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /**
   * House rule (Dan, 2026-11-06): at least two posts a week, from the week of
   * 2026-11-09 on. Weeks run Monday to Sunday. The week of the latest dated
   * post is left out, because the next batch may still add to it; every week
   * before it must already have two.
   */
  it("has at least two posts in every week up to the latest scheduled one", () => {
    const DAY = 86_400_000;
    const monday = (d: string) => {
      const t = Date.parse(`${d}T00:00:00Z`);
      return t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
    };
    const RULE_START = monday("2026-11-09");
    const perWeek = new Map<number, number>();
    for (const p of datedPosts()) perWeek.set(monday(p.date), (perWeek.get(monday(p.date)) ?? 0) + 1);
    const lastWeek = Math.max(...perWeek.keys());
    const thin: string[] = [];
    for (let w = RULE_START; w < lastWeek; w += 7 * DAY) {
      const n = perWeek.get(w) ?? 0;
      if (n < 2) thin.push(`week of ${new Date(w).toISOString().slice(0, 10)}: ${n}`);
    }
    expect(thin).toEqual([]);
  });
});
