import { brand } from "../config";

/**
 * Apple's official "Download on the App Store" badge, linking to the live
 * ArrivePing iOS app. The artwork is Apple's unmodified SVG
 * (public/img/app-store-badge.svg); Apple's rules: don't recolour, crop or
 * animate it, keep clear space around it, and never show it smaller than
 * 40px tall on screen.
 */
export function AppStoreBadge({ height = 44, className = "" }: { height?: number; className?: string }) {
  const h = Math.max(40, height);
  return (
    <a
      href={brand.urls.appStore}
      target="_blank"
      rel="noopener"
      className={`app-store-badge ${className}`.trim()}
      aria-label="Download ArrivePing on the App Store"
    >
      <img src="/img/app-store-badge.svg" alt="Download on the App Store" height={h} width={Math.round((h * 119.66407) / 40)} />
    </a>
  );
}
