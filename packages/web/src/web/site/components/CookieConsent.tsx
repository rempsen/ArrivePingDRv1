import { useEffect, useState } from "react";
import { getConsent, loadHubspotTracking, setConsent } from "../lib/hubspot-tracking";

/**
 * Analytics-cookie choice for the marketing site (the banner the privacy policy
 * refers to). Renders nothing during prerender and nothing once the visitor has
 * chosen; "Accept" loads the HubSpot tracking code, "Decline" never does.
 */
export function CookieConsent() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const c = getConsent();
    if (c === "granted") loadHubspotTracking();
    setOpen(c === null);
  }, []);

  if (!open) return null;
  const choose = (c: "granted" | "denied") => {
    setConsent(c);
    setOpen(false);
  };
  return (
    <section className="consent" aria-label="Cookie preferences">
      <p className="consent__text">
        We use analytics cookies to understand how people find and use ArrivePing. Essential cookies are always on.{" "}
        <a href="/privacy#cookies-and-tracking-technologies" className="consent__link">
          Privacy policy
        </a>
      </p>
      <div className="consent__actions">
        <button type="button" className="btn btn--sm btn--secondary" onClick={() => choose("denied")}>
          Decline
        </button>
        <button type="button" className="btn btn--sm btn--primary" onClick={() => choose("granted")}>
          Accept
        </button>
      </div>
    </section>
  );
}
