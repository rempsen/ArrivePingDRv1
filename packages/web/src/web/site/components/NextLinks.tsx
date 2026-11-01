import { CONTENT_UPDATED, type NextLink } from "../content/landing";
import { formatDate } from "../blog/meta";

/**
 * A visible freshness date for the product, pricing and comparison pages.
 * Uses CONTENT_UPDATED (bumped when page copy changes; also the sitemap lastmod).
 */
export function LastUpdated({ date = CONTENT_UPDATED }: { date?: string }) {
  return (
    <p className="lp-updated">
      Last updated <time dateTime={date}>{formatDate(date)}</time>
    </p>
  );
}

/**
 * "Learn more" under an answer passage: 3-6 descriptive links up and across
 * the hub-and-spoke map (pillars, /pricing, /features, the matching compare
 * or industry page). Same look as the Sources list on the comparison pages.
 */
export function NextLinks({ links }: { links?: readonly NextLink[] }) {
  if (!links?.length) return null;
  return (
    <nav className="lp-next" aria-label="Learn more">
      <span className="lp-next__label">Learn more:</span>
      <ul className="lp-sources">
        {links.map((l) => (
          <li key={l.href}>
            <a href={l.href}>{l.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
