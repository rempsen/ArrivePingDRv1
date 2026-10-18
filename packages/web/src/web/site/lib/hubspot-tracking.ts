/**
 * HubSpot tracking code for the arriveping.com marketing pages: page views,
 * traffic source and the `hubspotutk` cookie that ties a visitor's browsing to
 * their HubSpot contact once they sign up or ask to be contacted.
 *
 * Loaded only after the visitor accepts the cookie notice
 * (components/CookieConsent.tsx; the privacy policy promises consent), and
 * never when the browser sends Global Privacy Control. The footer's "Cookie
 * preferences" reopens the notice to change the choice.
 *
 * Only on the marketing pages (isTrackedPath): never inside the product, on
 * sign-in, the customer tracking links, or tenant booking and intake forms. If
 * someone moves from a marketing page into one of those within the app, the
 * page reloads so the tracker isn't carried along (see trackRoute).
 */

export const HUBSPOT_PORTAL_ID = "342390247";
const KEY = "ap_cookie_consent";
export type Consent = "granted" | "denied";

declare global {
  interface Window {
    _hsq?: unknown[][];
    globalPrivacyControl?: boolean;
  }
  interface Navigator {
    globalPrivacyControl?: boolean;
  }
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// The choice made on this page, for when the browser won't store it (private
// mode, storage blocked): it then lasts until the visitor leaves the page.
let chosen: Consent | null = null;

/** The visitor's saved choice (null until they make one); GPC counts as "denied" without asking. */
export function getConsent(): Consent | null {
  if (typeof window === "undefined") return null;
  if (navigator.globalPrivacyControl) return "denied";
  // A choice made on this page wins, even if the browser couldn't store it
  // over an older one.
  if (chosen) return chosen;
  try {
    const v = storage()?.getItem(KEY);
    if (v === "granted" || v === "denied") return v;
  } catch {
    /* nothing stored */
  }
  return null;
}

/** Reopen the cookie notice (the footer's "Cookie preferences"). */
export function openConsent(): void {
  window.dispatchEvent(new Event("ap-open-consent"));
}

const HUBSPOT_COOKIES = ["hubspotutk", "__hstc", "__hssc", "__hssrc", "messagesUtk"];

/** Delete HubSpot's cookies on this host and its parent domain. */
function clearHubspotCookies(): void {
  const host = location.hostname;
  const domains = ["", host, `.${host.split(".").slice(-2).join(".")}`];
  for (const name of HUBSPOT_COOKIES)
    for (const d of domains) document.cookie = `${name}=; Max-Age=0; path=/${d ? `; domain=${d}` : ""}`;
}

export function setConsent(c: Consent): void {
  const was = getConsent();
  chosen = c;
  let saved = true;
  try {
    storage()?.setItem(KEY, c);
  } catch {
    // Storage full or read-only: at least drop an older choice, so the next
    // page asks again rather than going back to it.
    try {
      storage()?.removeItem(KEY);
    } catch {
      saved = false;
    }
  }
  if (c === "granted") loadHubspotTracking();
  window.dispatchEvent(new CustomEvent("ap-consent", { detail: c }));
  if (c === "denied" && (was === "granted" || loaded)) {
    // Withdrawn: tell HubSpot, drop its cookies, and reload so the tracker is gone from this page too.
    const w = window as unknown as { _hsp?: unknown[][] };
    (w._hsp = w._hsp || []).push(["revokeCookieConsent"]);
    clearHubspotCookies();
    // Reloading drops the tracker, unless an older "granted" we couldn't
    // clear would bring it straight back; HubSpot has been told either way.
    if (loaded && saved) location.reload();
  }
}

let loaded = false;
/** Injects js.hs-scripts.com once, and only with consent. Safe to call repeatedly. */
export function loadHubspotTracking(): void {
  if (loaded || typeof document === "undefined" || getConsent() !== "granted") return;
  loaded = true;
  window._hsq = window._hsq || [];
  const s = document.createElement("script");
  s.id = "hs-script-loader";
  s.async = true;
  s.defer = true;
  s.src = `https://js-na3.hs-scripts.com/${HUBSPOT_PORTAL_ID}.js`;
  document.head.appendChild(s);
  lastPath = location.pathname;
}

/** Marketing pages: the homepage, landing pages, blog, pricing, support and legal pages, and signup. */
const UNTRACKED = /^\/(admin|app|rider|t|s|p|f|join|join-company|sign-in|sign-up|forgot-password|reset-password)(\/|$)/;
export function isTrackedPath(path: string): boolean {
  return !UNTRACKED.test(path);
}

let lastPath = "";
/**
 * Call on every route change. On a marketing page: load the tracker, or count
 * the page view when the visitor arrived by an in-app link. Anywhere else, if
 * the tracker came along from a marketing page, reload so it's gone.
 */
export function trackRoute(path: string): void {
  if (typeof window === "undefined") return;
  if (!isTrackedPath(path)) {
    if (loaded) location.reload();
    return;
  }
  if (!loaded) return loadHubspotTracking();
  if (path === lastPath) return;
  lastPath = path;
  const q = (window._hsq = window._hsq || []);
  q.push(["setPath", path + location.search]);
  q.push(["trackPageView"]);
}

/**
 * Tie this browser's visit history to a person in HubSpot (after signup or a
 * "contact me" request). Email only: a public form never changes a contact's
 * other details. A no-op without consent.
 */
export function hubspotIdentify(email: string): void {
  if (typeof window === "undefined" || getConsent() !== "granted" || !email) return;
  loadHubspotTracking();
  const q = (window._hsq = window._hsq || []);
  q.push(["identify", { email: email.trim().toLowerCase() }]);
  // identify is sent with the next tracked event
  q.push(["trackPageView"]);
}
