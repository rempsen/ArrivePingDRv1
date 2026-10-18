import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { useAuth } from "../../hooks/use-auth";
import { PlaybackProvider, usePlayback } from "../motion/playback";
import { useHeaderOffset } from "../motion/use-scrollspy";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { rich } from "./LegalPage";
import { usePageMeta } from "../seo/head";
import type { ArticleBlock } from "../support/articles";
import { support } from "../support/articles";
import { SupportMessageForm } from "./SupportMessageForm";
import "../site.css";
import { homeFor } from "../../lib/home";

/**
 * Chrome shared by the Help Center hub and every help article: site header
 * and footer, dark canvas, page meta, and deep-link scrolling. Pages render
 * their own <main>.
 */
export function HelpShell({ path, children }: { path: string; children: ReactNode }) {
  return (
    <PlaybackProvider>
      <Body path={path}>{children}</Body>
    </PlaybackProvider>
  );
}

function Body({ path, children }: { path: string; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const { isAuthed, role } = useAuth();
  const { reduced } = usePlayback();
  useHeaderOffset(headerRef, rootRef);
  usePageMeta(path);

  const dashboardHref = isAuthed ? homeFor(role) : undefined;

  useEffect(() => {
    const prevBg = document.documentElement.style.backgroundColor;
    document.documentElement.style.backgroundColor = "#070b12";
    const id = window.location.hash.replace(/^#/, "");
    if (id) {
      requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
      });
    } else {
      window.scrollTo(0, 0);
    }
    return () => {
      document.documentElement.style.backgroundColor = prevBg;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return (
    <div className="site" ref={rootRef} data-reduced={reduced ? "true" : undefined}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteHeader ref={headerRef} dashboardHref={dashboardHref} />
      {children}
      <SiteFooter />
    </div>
  );
}

/** Renders one article block; shares the legal pages' inline link/bold syntax. */
export function ArticleBlocks({ blocks }: { blocks: ArticleBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        <Fragment key={i}>{block(b)}</Fragment>
      ))}
    </>
  );
}

function block(b: ArticleBlock): ReactNode {
  switch (b.type) {
    case "p":
      return <p>{rich(b.text)}</p>;
    case "h3":
      return <h3>{b.text}</h3>;
    case "ul":
      return (
        <ul>
          {b.items.map((it, i) => (
            <li key={i}>{rich(it)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="help-steps">
          {b.items.map((it, i) => (
            <li key={i}>{rich(it)}</li>
          ))}
        </ol>
      );
    case "note":
      return (
        <aside className="legal__note">
          <strong>{b.title}</strong> {rich(b.text)}
        </aside>
      );
  }
}

/** "Still need help?" card — the App Store-required contact path, shown on every help page. */
export function ContactCard({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={compact ? "help-contact help-contact--compact" : "help-contact"} aria-labelledby="help-contact-h">
      <span className="eyebrow">Talk to a person</span>
      <h2 id="help-contact-h">Still need help?</h2>
      <p>
        Email{" "}
        <a href={`mailto:${support.email}`} className="legal__link">
          {support.email}
        </a>
        . {support.response}
      </p>
      <SupportMessageForm />
      <dl className="help-contact__facts">
        <div>
          <dt>Hours</dt>
          <dd>{support.hours}</dd>
        </div>
        <div>
          <dt>Billing &amp; account changes</dt>
          <dd>
            <a href={`mailto:${support.email}`} className="legal__link">
              {support.email}
            </a>{" "}
            — include your company name
          </dd>
        </div>
        <div>
          <dt>Privacy &amp; security</dt>
          <dd>
            <a href={`mailto:${support.privacyEmail}`} className="legal__link">
              {support.privacyEmail}
            </a>
          </dd>
        </div>
        <div>
          <dt>Sales</dt>
          <dd>
            <a href={`mailto:${support.salesEmail}`} className="legal__link">
              {support.salesEmail}
            </a>
          </dd>
        </div>
      </dl>
      {!compact && (
        <p className="small help-contact__tip">
          When you write, tell us your company, whether you're on the technician app or the web dashboard, and your phone
          model if it's about the app. A screenshot helps.
        </p>
      )}
    </aside>
  );
}

