/**
 * Meta (Facebook/Instagram) pixel for the arriveping.com marketing pages.
 * Builds the audiences the later Meta campaigns will use; no ads run from it.
 *
 * Same rules as the HubSpot tracker (hubspot-tracking.ts): loaded only after
 * the visitor accepts the cookie notice, never with Global Privacy Control,
 * only on the marketing pages, and gone again once consent is withdrawn
 * (setConsent("denied") reloads the page, which drops the script).
 *
 * The dataset lives in the ArrivePing business portfolio in Meta Business
 * Manager ("ArrivePing site").
 */
import { getConsent, isTrackedPath } from "./hubspot-tracking";

export const META_PIXEL_ID = "2074568893189246";

type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[][]; loaded?: boolean; version?: string; callMethod?: unknown };

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

let loaded = false;
let lastPath = "";

/** The standard fbevents bootstrap: a queueing `fbq` until the script arrives. */
function loadPixel(): void {
  if (loaded || typeof document === "undefined" || getConsent() !== "granted") return;
  loaded = true;
  const w = window;
  if (!w.fbq) {
    const fbq: Fbq = (...args: unknown[]) => {
      if (fbq.callMethod) (fbq.callMethod as (...a: unknown[]) => void).apply(fbq, args);
      else (fbq.queue = fbq.queue || []).push(args);
    };
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = "2.0";
    w.fbq = fbq;
    w._fbq = fbq;
  }
  const s = document.createElement("script");
  s.id = "meta-pixel-loader";
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(s);
  w.fbq("init", META_PIXEL_ID);
}

/**
 * Call on every route change, after the HubSpot tracker's trackRoute. Loads
 * the pixel on the first consented marketing page and counts each new path
 * as a PageView; a no-op without consent or off the marketing pages.
 */
export function trackPixelRoute(path: string): void {
  if (typeof window === "undefined") return;
  if (!isTrackedPath(path) || getConsent() !== "granted") return;
  if (!loaded) loadPixel();
  if (!loaded || path === lastPath) return;
  lastPath = path;
  window.fbq?.("track", "PageView");
}

/** Test support: the calls queued so far (the script never loads under test). */
export function _calls(): unknown[][] {
  return (typeof window !== "undefined" && window.fbq?.queue) || [];
}
/** Test support: forget the loaded state between tests. */
export function _reset(): void {
  loaded = false;
  lastPath = "";
}
