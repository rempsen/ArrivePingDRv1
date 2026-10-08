/**
 * Today's date on the business's own calendar, as YYYY-MM-DD.
 *
 * Every build-time date decision (which scheduled blog posts are live, the
 * sitemap <lastmod> ceiling) must use the same clock, or a post that is
 * "today" by one rule and "tomorrow" by another aborts the build during the
 * six hours between midnight UTC and midnight in Winnipeg.
 */
export const SITE_TIME_ZONE = "America/Winnipeg";

export function todayInSiteZone(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SITE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
