import { brand } from "../config";
import { AppStoreBadge } from "./AppStoreBadge";

/**
 * Google's official "Get it on Google Play" badge, linking to the live
 * ArrivePing Android app. The artwork is Google's unmodified PNG
 * (public/img/google-play-badge.png, from play.google.com/intl/en_us/badges).
 * The PNG carries its own transparent clear space: 41px of its 646×250 on
 * every side. `height` is the VISIBLE badge height, and a negative margin
 * absorbs that clear space so the badge lines up with, and matches the size of,
 * the App Store badge beside it, without cropping Google's artwork.
 */
export function GooglePlayBadge({ height = 44, className = "" }: { height?: number; className?: string }) {
  const h = Math.max(40, height);
  const scale = h / 168;
  const w = Math.round(646 * scale);
  const ih = Math.round(250 * scale);
  return (
    <a
      href={brand.urls.googlePlay}
      target="_blank"
      rel="noopener"
      className={`google-play-badge ${className}`.trim()}
      aria-label="Get ArrivePing on Google Play"
      style={{ display: "inline-block", lineHeight: 0, margin: -Math.round(41 * scale) }}
    >
      <img src="/img/google-play-badge.png" alt="Get it on Google Play" width={w} height={ih} style={{ display: "block", width: w, height: ih, maxWidth: "none" }} />
    </a>
  );
}

/** Both store badges side by side, the order Apple and Google both accept. */
export function StoreBadges({ height = 44 }: { height?: number }) {
  return (
    <span className="store-badges">
      <AppStoreBadge height={height} />
      <GooglePlayBadge height={height} />
    </span>
  );
}
