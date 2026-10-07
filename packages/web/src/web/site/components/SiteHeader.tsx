import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { brand, nav } from "../config";
import { usePlayback } from "../motion/playback";
import { scrollToAnchor } from "../motion/use-scrollspy";

type Props = {
  /** Where a signed-in visitor's dashboard lives; undefined when signed out. */
  dashboardHref?: string;
};

export function useAnchorNav() {
  const { reduced } = usePlayback();
  return useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      // Section links are written as "/#pricing" so they also work without
      // JavaScript (and for crawlers) from any page. "#pricing" still works.
      const hash = href.startsWith("/#") ? href.slice(1) : href;
      if (!hash.startsWith("#")) return;
      const id = hash.slice(1);
      if (!document.getElementById(id)) {
        // Section anchors only exist on the landing page; from other pages the
        // browser follows "/#id" on its own. Bare "#id" links need a nudge home.
        if (window.location.pathname !== "/" && href.startsWith("#")) {
          e.preventDefault();
          window.location.assign(`/${href}`);
        }
        return;
      }
      e.preventDefault();
      scrollToAnchor(id, reduced);
      history.replaceState(null, "", hash);
    },
    [reduced],
  );
}

export const SiteHeader = forwardRef<HTMLElement, Props>(function SiteHeader({ dashboardHref }, ref) {
  const [open, setOpen] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const firstLink = useRef<HTMLAnchorElement>(null);
  const go = useAnchorNav();

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => menuBtn.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => firstLink.current?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  return (
    <header ref={ref} className="header">
      <div className="container header__inner">
        <a href="/" className="header__logo" aria-label={`${brand.product} home`}>
          <img src={brand.icon} alt="" width={36} height={36} className="header__mark" aria-hidden="true" />
          <img src={brand.logoLight} alt={brand.lockup} width={220} height={40} />
        </a>
        <nav className="nav" aria-label="Primary">
          {nav.map((n) => (
            <a key={n.href} href={n.href} onClick={(e) => go(e, n.href)}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="header__actions">
          {dashboardHref ? (
            <Link to={dashboardHref} className="btn btn--secondary btn--sm header__signin">
              Dashboard
            </Link>
          ) : (
            <Link to={brand.urls.signIn} className="btn btn--ghost btn--sm header__signin">
              Sign in
            </Link>
          )}
          <a href={brand.urls.demo} className="btn btn--primary btn--sm" onClick={(e) => go(e, brand.urls.demo)}>
            Book a demo
          </a>
          <button
            ref={menuBtn}
            type="button"
            className="btn btn--ghost btn--sm header__menu"
            aria-expanded={open}
            aria-controls="site-drawer"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        // Backdrop click is a pointer convenience only; keyboard users close with Escape (see the keydown handler) or the Close button.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events
        <div className="drawer" onClick={close} role="presentation">
          {/* The click handler only stops propagation so clicks inside the panel don't hit the backdrop. */}
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/prefer-tag-over-role -- <dialog> would need showModal() and changes the existing drawer animation/styling */}
          <div id="site-drawer" className="drawer__panel" role="dialog" aria-modal="true" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
            <div className="drawer__top">
              <div className="drawer__brand">
                <img src={brand.icon} alt="" width={28} height={28} className="header__mark" aria-hidden="true" />
                <img src={brand.logoLight} alt={brand.lockup} height={24} style={{ height: 24, width: "auto" }} />
              </div>
              <button type="button" className="btn btn--ghost btn--sm" onClick={close} aria-label="Close menu">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {nav.map((n, i) => (
              <a
                key={n.href}
                ref={i === 0 ? firstLink : undefined}
                href={n.href}
                className="drawer__link"
                onClick={(e) => {
                  go(e, n.href);
                  setOpen(false);
                }}
              >
                {n.label}
              </a>
            ))}
            <div className="drawer__actions">
              <a
                href={brand.urls.demo}
                className="btn btn--primary"
                onClick={(e) => {
                  go(e, brand.urls.demo);
                  setOpen(false);
                }}
              >
                Book a demo
              </a>
              {dashboardHref ? (
                <Link to={dashboardHref} className="btn btn--secondary">
                  Dashboard
                </Link>
              ) : (
                <Link to={brand.urls.signIn} className="btn btn--secondary">
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
});
