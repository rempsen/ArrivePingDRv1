/**
 * Social content batches (content/social/batches/*.json) are the hand-off
 * between the drafter and the Buffer scheduler. Merging a batch PR is Dan's
 * approval, so anything merged must already be safe to schedule.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { localDate, validateBatch, xLength, type ContentBatch } from "../content-batch";

const WEB = join(import.meta.dir, "..", "..", "..");
const RULES = JSON.parse(readFileSync(join(WEB, "content/social/calendar-rules.json"), "utf8"));
const BLOG_SLUGS = new Set(readdirSync(join(WEB, "src/web/site/blog/posts")).map((f) => f.replace(/\.md$/, "")));
const opts = {
  imageExists: (p: string) => existsSync(join(WEB, "public", p)),
  blogSlugs: BLOG_SLUGS,
  holidays: RULES.holidays as string[],
};

function batch(over: Partial<ContentBatch> = {}): ContentBatch {
  return {
    id: "2026-11-t1",
    window: { start: "2026-11-02", end: "2026-11-20" },
    blogPosts: [],
    posts: [
      {
        key: "t1-a-x",
        platform: "x",
        dueAt: "2026-11-03T09:00:00-06:00",
        text: "Hello https://arriveping.com",
        image: "/social/2026-11-b0/seed-1.png",
        link: "https://arriveping.com",
      },
    ],
    ...over,
  };
}

describe("xLength", () => {
  it("counts every URL as 23 characters, like X does", () => {
    expect(xLength("abc https://arriveping.com/a-very-long-path-that-is-longer-than-twenty-three")).toBe(4 + 23);
  });

  it("weights emoji and CJK as 2, like twitter-text", () => {
    expect(xLength("ok 👍")).toBe(3 + 2);
    expect(xLength("👨‍👩‍👧")).toBe(2);
    expect(xLength("日本")).toBe(4);
    expect(xLength("1\u20e3")).toBe(2);
    expect(xLength("1\ufe0f\u20e3 go")).toBe(5);
    expect(xLength("café — “quotes”")).toBe(15);
  });
});

describe("localDate", () => {
  it("returns the Winnipeg calendar date, not the UTC one", () => {
    expect(localDate("2026-11-04T03:00:00Z")).toBe("2026-11-03");
  });
});

describe("validateBatch", () => {
  it("accepts a well-formed batch", () => {
    expect(validateBatch(batch(), opts)).toEqual([]);
  });

  it("rejects an X post over 280 characters", () => {
    const b = batch();
    b.posts[0].text = "x".repeat(281);
    expect(validateBatch(b, opts).join()).toContain("too long");
  });

  it("rejects two posts on the same platform on the same local day", () => {
    const b = batch();
    b.posts.push({ ...b.posts[0], key: "t1-b-x", dueAt: "2026-11-03T15:00:00-06:00" });
    expect(validateBatch(b, opts).join()).toContain("same day");
  });

  it("rejects duplicate keys", () => {
    const b = batch();
    b.posts.push({ ...b.posts[0], dueAt: "2026-11-04T09:00:00-06:00" });
    expect(validateBatch(b, opts).join()).toContain("duplicate key");
  });

  it("rejects a missing image file", () => {
    const b = batch();
    b.posts[0].image = "/social/nope/missing.png";
    expect(validateBatch(b, opts).join()).toContain("image not found");
  });

  it("rejects an Instagram post without an image", () => {
    const b = batch();
    b.posts[0] = { ...b.posts[0], platform: "instagram", image: undefined, text: "hi" };
    expect(validateBatch(b, opts).join()).toContain("needs an image");
  });

  it("rejects links that leave arriveping.com", () => {
    const b = batch();
    b.posts[0].link = "https://example.com";
    expect(validateBatch(b, opts).join()).toContain("arriveping.com");
  });

  it("rejects posts outside the batch window or on a holiday", () => {
    const outside = batch();
    outside.posts[0].dueAt = "2026-12-01T09:00:00-06:00";
    expect(validateBatch(outside, opts).join()).toContain("outside");
    const holiday = batch();
    holiday.posts[0].dueAt = "2026-11-11T09:00:00-06:00";
    expect(validateBatch(holiday, opts).join()).toContain("holiday");
  });

  it("rejects a time without a UTC offset", () => {
    const b = batch();
    b.posts[0].dueAt = "2026-11-03T09:00:00";
    expect(validateBatch(b, opts).join()).toContain("offset");
  });

  it("rejects a blog post the site does not have", () => {
    expect(validateBatch(batch({ blogPosts: ["no-such-post"] }), opts).join()).toContain("blog post");
  });
});

describe("committed batches", () => {
  const dir = join(WEB, "content/social/batches");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    it(`${f} is valid and named after its id`, () => {
      const b = JSON.parse(readFileSync(join(dir, f), "utf8")) as ContentBatch;
      expect(f).toBe(`${b.id}.json`);
      expect(validateBatch(b, opts)).toEqual([]);
    });
  }
});
