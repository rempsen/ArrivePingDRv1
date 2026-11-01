import { useState } from "react";
import { brand, footer } from "../config";
import { openConsent } from "../lib/hubspot-tracking";
import { useAnchorNav } from "./SiteHeader";
import { AppStoreBadge } from "./AppStoreBadge";
import { SocialIcon } from "./SocialIcon";

/**
 * One footer column. On desktop it is a plain heading + list. On phones
 * (<768px, see .footer__col in site.css) the heading becomes a tap-to-open
 * accordion, closed by default, so the footer doesn't run to three screens.
 *
 * The links are ALWAYS in the HTML — collapsing is CSS only — so crawlers see
 * every product / industry / comparison page exactly as before. Don't swap
 * this for conditional rendering.
 */
function FooterColumn({ heading, links }: { heading: string; links: { label: string; href: string }[] }) {
  const go = useAnchorNav();
  const [open, setOpen] = useState(false);
  const id = `footer-col-${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className={`footer__col${open ? " is-open" : ""}`}>
      <h4>
        <button
          type="button"
          className="footer__toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
        >
          {heading}
          <svg className="footer__chev" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h4>
      <ul id={id}>
        {links.map((l) => (
          <li key={l.label}>
            <a href={l.href} onClick={(e) => go(e, l.href)}>
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div className="footer__brand">
            <div className="footer__logo">
              <img src={brand.logoLight} alt={brand.lockup} width={220} height={40} />
            </div>
            <p>{footer.description}</p>
            <div className="footer__app">
              <span className="footer__app-label">Technician app for iPhone and iPad (Android: use the web browser)</span>
              <AppStoreBadge height={40} />
            </div>
            <ul className="footer__social" aria-label="ArrivePing on social media">
              {footer.social.map((s) => (
                <li key={s.network}>
                  <a href={s.href} target="_blank" rel="noopener" aria-label={s.label} title={s.label}>
                    <SocialIcon network={s.network} size={20} />
                  </a>
                </li>
              ))}
            </ul>
          </div>
          {footer.columns.map((col) => (
            <FooterColumn key={col.heading} heading={col.heading} links={col.links} />
          ))}
        </div>
        <div className="footer__bottom">
          <span className="footer__bottom-brand">
            <img src={brand.icon} alt="" width={16} height={16} className="footer__mini-mark" aria-hidden="true" />
            {footer.legal}
          </span>
          <span className="footer__bottom-links">
            <button type="button" className="footer__link-btn" onClick={openConsent}>
              Cookie preferences
            </button>
            <a href={footer.maker.href} target="_blank" rel="noopener">
              {footer.maker.label}
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
