/**
 * Social content batches: the reviewed hand-off between the drafter and the
 * scheduler that loads posts into Buffer.
 *
 * A batch lives in packages/web/content/social/batches/<id>.json, together
 * with its images under public/social/<id>/. Merging the batch PR is the
 * approval. Once arriveping.com is published, the images are served from the
 * site and the scheduler creates one Buffer post per entry at `dueAt`.
 * Buffer's own queue is the record of what has been scheduled: the scheduler
 * skips any entry that already has a matching post there. That makes reruns
 * safe without writing state back to the repo.
 */

export type Platform = "linkedin" | "facebook" | "instagram" | "x";

export interface BatchPost {
  /** Unique within the batch, e.g. "b1-03-ig": batch, beat, platform. */
  key: string;
  platform: Platform;
  /** ISO 8601 with an explicit offset, e.g. 2026-11-24T08:15:00-06:00. */
  dueAt: string;
  text: string;
  /** Path under public/, e.g. /social/2026-11-b1/beat-03.png (served from arriveping.com). */
  image?: string;
  /** The arriveping.com page this post sends people to. */
  link?: string;
  /** The theme this post belongs to (shared across platforms). */
  beat?: string;
}

export interface ContentBatch {
  id: string;
  /** Inclusive local (Winnipeg) dates the posts must fall within. */
  window: { start: string; end: string };
  /** Slugs of the blog posts this batch adds or links to. */
  blogPosts: string[];
  posts: BatchPost[];
}

export const PLATFORMS: Platform[] = ["linkedin", "facebook", "instagram", "x"];

/** Character limits per platform (X counts every URL as 23). */
export const LIMITS: Record<Platform, number> = { linkedin: 3000, facebook: 5000, instagram: 2200, x: 280 };

const URL_RE = /https?:\/\/\S+/g;

/**
 * twitter-text v3 weighting: code points in these ranges count 1, everything
 * else (CJK, most symbols) counts 2, and each emoji grapheme counts 2.
 * https://github.com/twitter/twitter-text/blob/master/config/v3.json
 */
const X_LIGHT_RANGES: [number, number][] = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
/** Pictographs, flags and keycap sequences (e.g. "1\u20E3") all count as one 2-weight emoji. */
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Length of a post as X counts it: each URL is 23, emoji and CJK are 2. */
export function xLength(text: string): number {
  let n = (text.match(URL_RE)?.length ?? 0) * 23;
  for (const { segment } of graphemes.segment(text.replace(URL_RE, ""))) {
    if (EMOJI_RE.test(segment)) {
      n += 2;
      continue;
    }
    for (const ch of segment) {
      const cp = ch.codePointAt(0) ?? 0;
      n += X_LIGHT_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi) ? 1 : 2;
    }
  }
  return n;
}

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Winnipeg",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Winnipeg calendar date (YYYY-MM-DD) of an instant. */
export function localDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export interface ValidateOptions {
  imageExists: (publicPath: string) => boolean;
  blogSlugs: Set<string>;
  holidays: string[];
}

/** Every problem with a batch, as human-readable strings. Empty means valid. */
export function validateBatch(b: ContentBatch, o: ValidateOptions): string[] {
  const errs: string[] = [];
  const keys = new Set<string>();
  const days = new Set<string>();
  const holidays = new Set(o.holidays);

  for (const slug of b.blogPosts) {
    if (!o.blogSlugs.has(slug)) errs.push(`blog post "${slug}" does not exist in src/web/site/blog/posts`);
  }

  for (const p of b.posts) {
    const at = `${p.key}:`;
    if (keys.has(p.key)) errs.push(`${at} duplicate key`);
    keys.add(p.key);
    if (!PLATFORMS.includes(p.platform)) errs.push(`${at} unknown platform "${p.platform}"`);

    if (!/(Z|[+-]\d\d:\d\d)$/.test(p.dueAt) || Number.isNaN(Date.parse(p.dueAt))) {
      errs.push(`${at} dueAt must be ISO 8601 with a UTC offset`);
    } else {
      const day = localDate(p.dueAt);
      if (day < b.window.start || day > b.window.end) errs.push(`${at} ${day} is outside the batch window`);
      if (holidays.has(day)) errs.push(`${at} ${day} is a holiday`);
      const slot = `${p.platform}|${day}`;
      if (days.has(slot)) errs.push(`${at} two ${p.platform} posts on the same day (${day})`);
      days.add(slot);
    }

    const len = p.platform === "x" ? xLength(p.text) : [...p.text].length;
    if (!p.text.trim()) errs.push(`${at} empty text`);
    if (len > LIMITS[p.platform]) errs.push(`${at} text too long for ${p.platform} (${len} > ${LIMITS[p.platform]})`);

    if (p.image) {
      if (!p.image.startsWith("/social/")) errs.push(`${at} image must live under public/social/`);
      else if (!o.imageExists(p.image)) errs.push(`${at} image not found: public${p.image}`);
    } else if (p.platform === "instagram") {
      errs.push(`${at} Instagram post needs an image`);
    }

    for (const url of [p.link, ...(p.text.match(URL_RE) ?? [])]) {
      if (url && !/^https:\/\/arriveping\.com(\/|$)/.test(url)) errs.push(`${at} links must point to https://arriveping.com (${url})`);
    }
  }
  return errs;
}
