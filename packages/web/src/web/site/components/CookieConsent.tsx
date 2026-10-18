import { useEffect, useState } from "react";
import { getConsent, setConsent, type Consent } from "../lib/hubspot-tracking";
import "../site.css";

/**
 * The cookie notice on the marketing pages and signup, mounted once for the
 * whole app on those routes (app.tsx). Shown until the visitor chooses;
 * "Accept" turns on HubSpot's analytics cookies (loaded at once), "Decline"
 * keeps them off. The footer's "Cookie preferences" brings it back. Renders
 * nothing during prerender, and nothing when the browser sends Global Privacy
 * Control (that already counts as declining).
 */
export function CookieConsent() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<Consent | null>(null);

  useEffect(() => {
    const c = getConsent();
    setCurrent(c);
    setOpen(c === null);
    const reopen = () => {
      setCurrent(getConsent());
      setOpen(true);
    };
    window.addEventListener("ap-open-consent", reopen);
    return () => window.removeEventListener("ap-open-consent", reopen);
  }, []);

  if (!open) return null;
  const gpc = typeof navigator !== "undefined" && !!navigator.globalPrivacyControl;
  const choose = (c: Consent) => {
    setConsent(c);
    setCurrent(c);
    setOpen(false);
  };
  // Its own .site scope, so it's styled on pages outside the marketing shell too.
  return (
    <div className="site consent-host">
    <section className="consent" aria-label="Cookie notice">
      <p className="consent__title">Cookies</p>
      <p className="consent__text">
        {gpc
          ? "Your browser asks sites not to track you (Global Privacy Control), so analytics cookies stay off."
          : "We use analytics cookies to see how people find and use ArrivePing. Essential cookies are always on."}
        {!gpc && current && ` Right now they're ${current === "granted" ? "on" : "off"}.`}{" "}
        <a href="/privacy#cookies-and-tracking-technologies" className="consent__link">
          Privacy policy
        </a>
      </p>
      <div className="consent__actions">
        {gpc ? (
          <button type="button" className="btn btn--sm btn--secondary" onClick={() => setOpen(false)}>
            Close
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--sm btn--secondary" onClick={() => choose("denied")}>
              Decline
            </button>
            <button type="button" className="btn btn--sm btn--primary" onClick={() => choose("granted")}>
              Accept
            </button>
          </>
        )}
      </div>
    </section>
    </div>
  );
}
