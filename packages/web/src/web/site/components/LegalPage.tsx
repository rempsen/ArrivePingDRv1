import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { useAuth } from "../../hooks/use-auth";
import { PlaybackProvider, usePlayback } from "../motion/playback";
import { useHeaderOffset } from "../motion/use-scrollspy";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import type { LegalBlock, LegalDoc } from "../legal/types";
import { usePageMeta } from "../seo/head";
import "../site.css";

/**
 * Renderer for the public legal documents. Same header/footer and light
 * canvas as the landing page; a sticky table of contents on wide screens.
 */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <PlaybackProvider>
      <Body doc={doc} />
    </PlaybackProvider>
  );
}

function Body({ doc }: { doc: LegalDoc }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const { isAuthed, role } = useAuth();
  const { reduced } = usePlayback();
  useHeaderOffset(headerRef, rootRef);
  usePageMeta(doc.path);

  const dashboardHref = isAuthed
    ? role === "admin"
      ? "/admin"
      : role === "rider"
        ? "/rider"
        : "/app"
    : undefined;

  useEffect(() => {
    const prevBg = document.documentElement.style.backgroundColor;
    document.documentElement.style.backgroundColor = "#070b12";
    // Deep links (`/privacy#location-data`) land below the sticky header.
    const id = window.location.hash.replace(/^#/, "");
    if (id) {
      requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
      });
    }
    return () => {
      document.documentElement.style.backgroundColor = prevBg;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.path]);

  return (
    <div className="site" ref={rootRef} data-reduced={reduced ? "true" : undefined}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteHeader ref={headerRef} dashboardHref={dashboardHref} />
      <main id="main" tabIndex={-1} className="legal">
        <div className="container legal__grid">
          <header className="legal__head">
            <span className="eyebrow">{doc.eyebrow}</span>
            <h1 className="legal__title">{doc.title}</h1>
            <p className="small">Last updated {doc.updated}</p>
          </header>

          <nav className="legal__toc" aria-label="On this page">
            <p className="legal__toc-label">On this page</p>
            <ol>
              {doc.sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>{s.title}</a>
                </li>
              ))}
            </ol>
          </nav>

          <article className="legal__body">
            <div className="legal__intro">
              {doc.intro.map((t, i) => (
                <p key={i}>{rich(t)}</p>
              ))}
            </div>
            {doc.sections.map((s, i) => (
              <section key={s.id} id={s.id} className="legal__section anchor">
                <h2>
                  <span className="legal__num tnum">{i + 1}</span>
                  {s.title}
                </h2>
                {s.blocks.map((b, j) => (
                  <Fragment key={j}>{block(b)}</Fragment>
                ))}
              </section>
            ))}
            <p className="legal__other small">
              See also:{" "}
              {doc.path === "/privacy" ? <a href="/terms">Terms &amp; Conditions</a> : <a href="/privacy">Privacy Policy</a>}
            </p>
          </article>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function block(b: LegalBlock): ReactNode {
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
    case "note":
      return (
        <aside className="legal__note">
          <strong>{b.title}</strong> {rich(b.text)}
        </aside>
      );
  }
}

/** Turns `[label](href)` into links; everything else is plain text. */
function rich(text: string): ReactNode {
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a key={m.index} href={m[2]} className="legal__link">
        {m[1]}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
