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
import "../site.css";

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

  const dashboardHref = isAuthed ? (role === "admin" ? "/admin" : role === "rider" ? "/rider" : "/app") : undefined;

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
      <SlackButton />
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

/** Official Slack mark (four-colour hash). Brand colours must not be altered. */
function SlackMark() {
  return (
    <svg viewBox="0 0 122.8 122.8" aria-hidden="true" focusable="false">
      <path
        fill="#e01e5a"
        d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
      />
      <path
        fill="#36c5f0"
        d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
      />
      <path
        fill="#2eb67d"
        d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"
      />
      <path
        fill="#ecb22e"
        d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
      />
    </svg>
  );
}

/** "Message us on Slack" — opens the customer-support channel in a new tab. */
function SlackButton() {
  return (
    <a
      className="help-slack"
      href={support.slackUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Message us on Slack (opens in a new tab)"
    >
      <span className="help-slack__mark">
        <SlackMark />
      </span>
      <span className="help-slack__text">
        <span className="help-slack__title">Message us on Slack</span>
        <span className="help-slack__sub">Chat with our support team</span>
      </span>
      <svg className="help-slack__arrow" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path
          d="M7 13l6-6M8 7h5v5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </a>
  );
}
