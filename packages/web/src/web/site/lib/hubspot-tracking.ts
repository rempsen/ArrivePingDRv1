/**
 * HubSpot tracking code for the arriveping.com marketing pages: page views,
 * traffic source and the `hubspotutk` cookie that ties a visitor's browsing to
 * their HubSpot contact once they sign up or ask to be contacted.
 *
 * Loaded ONLY after the visitor accepts analytics cookies (the privacy policy
 * promises consent), only on marketing pages (never inside the product, the
 * customer tracking links or tenant booking forms), and never when the browser
 * sends Global Privacy Control.
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

/** The visitor's saved choice; GPC counts as "denied" without asking. */
export function getConsent(): Consent | null {
  if (typeof window === "undefined") return null;
  if (navigator.globalPrivacyControl) return "denied";
  try {
    const v = storage()?.getItem(KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

export function setConsent(c: Consent): void {
  try {
    storage()?.setItem(KEY, c);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  if (c === "granted") loadHubspotTracking();
  window.dispatchEvent(new CustomEvent("ap-consent", { detail: c }));
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
  s.src = `https://js.hs-scripts.com/${HUBSPOT_PORTAL_ID}.js`;
  document.head.appendChild(s);
}

/**
 * Tie this browser's visit history to a person in HubSpot (after signup or a
 * "contact me" request). A no-op without consent.
 */
export function hubspotIdentify(email: string, props: Record<string, string> = {}): void {
  if (typeof window === "undefined" || getConsent() !== "granted" || !email) return;
  loadHubspotTracking();
  const q = (window._hsq = window._hsq || []);
  q.push(["identify", { email: email.trim().toLowerCase(), ...props }]);
  // identify is sent with the next tracked event
  q.push(["trackPageView"]);
}
