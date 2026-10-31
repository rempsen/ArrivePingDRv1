import { useEffect, useRef } from "react";
import { useAuth } from "../../hooks/use-auth";
import { PlaybackProvider, usePlayback } from "../../site/motion/playback";
import { useReveal } from "../../site/motion/use-reveal";
import { useHeaderOffset } from "../../site/motion/use-scrollspy";
import { SiteHeader } from "../../site/components/SiteHeader";
import { SiteFooter } from "../../site/components/SiteFooter";
import { ClosingCTA, OurStory, Pricing } from "../../site/sections";
import { brand } from "../../site/config";
import { TradeCards } from "../../site/components/TradeCards";
import { AppStoreBadge } from "../../site/components/AppStoreBadge";
import { TradeDay, TradeFeatures, TradeHero, TradeStats } from "../../site/live/TradeParts";
import { landingByPath, type Cell, type LandingPage, type Section } from "../../site/content/landing";
import { seoByPath } from "../../site/seo/pages";
import { usePageMeta } from "../../site/seo/head";
import "../../site/site.css";
import "../../site/landing.css";
import "../../site/live/live.css";
import "../../site/live/opening.css";
import "../../site/live/trade.css";
import { homeFor } from "../../lib/home";

/**
 * Public solution, pricing, about and comparison pages. Content lives in
 * site/content/landing.ts; this file only lays it out. The same component is
 * rendered to static HTML at build time (vite/plugins/prerender-plugin.ts).
 */
export function LandingRoute({ path }: { path: string }) {
  const page = landingByPath[path];
  if (!page) return null;
  return (
    <PlaybackProvider>
      <Landing page={page} />
    </PlaybackProvider>
  );
}

/** Route components (wouter passes no props we need). */
export const makeLanding = (path: string) =>
  function LandingPageRoute() {
    return <LandingRoute path={path} />;
  };

function Landing({ page }: { page: LandingPage }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const { isAuthed, role } = useAuth();
  const dashboardHref = isAuthed ? homeFor(role) : undefined;
  // Same as the homepage: the live sections' CSS drops all motion under this flag.
  const { reduced } = usePlayback();

  useReveal(rootRef);
  useHeaderOffset(headerRef, rootRef);
  usePageMeta(page.path);

  useEffect(() => {
    const prev = document.documentElement.style.backgroundColor;
    document.documentElement.style.backgroundColor = "#070b12";
    return () => {
      document.documentElement.style.backgroundColor = prev;
    };
  }, []);

  return (
    <div className="site" ref={rootRef} data-reduced={reduced ? "true" : undefined}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteHeader ref={headerRef} dashboardHref={dashboardHref} />
      <main id="main" tabIndex={-1}>
        {page.trade ? <TradeBody page={page} /> : <GenericBody page={page} />}
        <Related page={page} />
        <ClosingCTA />
      </main>
      <SiteFooter />
    </div>
  );
}

/** Trade pages: the homepage's design language, led by the trade's own film. */
function TradeBody({ page }: { page: LandingPage }) {
  const t = page.trade!;
  return (
    <>
      <TradeHero page={page} crumbs={<Breadcrumbs page={page} />} />
      <section className="section--tight lp-answer-wrap tr-answer" aria-labelledby="lp-answer">
        <div className="container">
          <div className="lp-answer" data-reveal="">
            <h2 id="lp-answer" className="lp-answer__q">
              {page.answer.q}
            </h2>
            <p className="lp-answer__a">{page.answer.a}</p>
          </div>
        </div>
      </section>
      <TradeStats t={t} />
      <TradeDay t={t} />
      <TradeFeatures t={t} />
      {page.sections.map((s, i) => (
        <SectionBlock key={i} section={s} page={page} />
      ))}
      <Faqs page={page} />
    </>
  );
}

function GenericBody({ page }: { page: LandingPage }) {
  return (
    <>
      <header className="lp-hero">
        <div className="container">
          <Breadcrumbs page={page} />
          <span className="eyebrow">{page.eyebrow}</span>
          <h1 className="lp-hero__title">{page.h1}</h1>
          <p className="lede lp-hero__lede">{page.lede}</p>
          <div className="lp-hero__cta">
            <a href={brand.urls.signUp} className="btn btn--primary">
              Sign up free
            </a>
            <a href={brand.urls.how} className="btn btn--secondary">
              See how it works
            </a>
          </div>
          <p className="lp-hero__fine">Free for 30 days · Then from US$49 a month · No setup fee, no contract</p>
          <div className="lp-hero__app">
            <AppStoreBadge height={40} />
            <span>Technician app for iPhone and iPad</span>
          </div>
        </div>
      </header>

      <section className="section--tight lp-answer-wrap" aria-labelledby="lp-answer">
        <div className="container">
          <div className="lp-answer" data-reveal="">
            <h2 id="lp-answer" className="lp-answer__q">
              {page.answer.q}
            </h2>
            <p className="lp-answer__a">{page.answer.a}</p>
          </div>
        </div>
      </section>

      {page.sections.map((s, i) => (
        <SectionBlock key={i} section={s} page={page} />
      ))}

      {page.sources && (
        <section className="section--tight lp-sources-wrap" aria-labelledby="lp-sources">
          <div className="container">
            <h2 id="lp-sources" className="lp-sources__title">
              Sources
            </h2>
            <p className="small">
              Competitor details are from each company's public website, checked {page.verified}. Features and prices change;
              check the source before deciding. Tell us at <a href={`mailto:${brand.contactEmail}`}>{brand.contactEmail}</a> if
              anything here is out of date.
            </p>
            <ul className="lp-sources">
              {page.sources.map((s) => (
                <li key={s.href}>
                  <a href={s.href} rel="nofollow noopener" target="_blank">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <Faqs page={page} />
    </>
  );
}

function Faqs({ page }: { page: LandingPage }) {
  if (!page.faqs.length) return null;
  return (
    <section id="faqs" className="section section--divided anchor" aria-labelledby="lp-faqs">
      <div className="container">
        <div className="intro intro--center" data-reveal="">
          <span className="eyebrow">FAQs</span>
          <h2 id="lp-faqs" className="h-section">
            Common questions
          </h2>
        </div>
        <div className="faq" data-reveal="">
          {page.faqs.map((f) => (
            <details key={f.q}>
              <summary>
                <h3 className="lp-faq__q">{f.q}</h3>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </summary>
              <p className="faq__a">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Breadcrumbs({ page }: { page: LandingPage }) {
  const trail = [{ label: "Home", path: "/" }, ...(page.parent ? [page.parent] : []), { label: page.label, path: page.path }];
  return (
    <nav aria-label="Breadcrumb" className="lp-crumbs">
      <ol>
        {trail.map((t, i) => (
          <li key={t.path}>
            {i < trail.length - 1 ? <a href={t.path}>{t.label}</a> : <span aria-current="page">{t.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function CellView({ cell }: { cell: Cell }) {
  if (typeof cell === "string") return <>{cell}</>;
  if (!cell.href) return <>{cell.text}</>;
  const external = cell.href.startsWith("http");
  return (
    <a href={cell.href} {...(external ? { rel: "nofollow noopener", target: "_blank" } : {})}>
      {cell.text}
    </a>
  );
}

function Head({ eyebrow, title, body }: { eyebrow?: string; title: string; body?: string }) {
  return (
    <div className="intro" data-reveal="">
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h2 className="h-section">{title}</h2>
      {body && <p className="lede">{body}</p>}
    </div>
  );
}

function SectionBlock({ section: s, page }: { section: Section; page: LandingPage }) {
  switch (s.kind) {
    case "pricing":
      return <Pricing />;
    case "story":
      return <OurStory />;
    case "features":
      return (
        <section className="section section--divided" id={s.id}>
          <div className="container">
            <Head eyebrow={s.eyebrow} title={s.title} body={s.body} />
            <div className="lp-grid">
              {s.items.map((it, i) => (
                <div key={it.title} className="lp-card" data-reveal="" data-reveal-delay={String(i % 3)}>
                  <h3 className="h-card">{it.title}</h3>
                  <p>{it.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    case "steps":
      return (
        <section className="section section--divided" id={s.id}>
          <div className="container">
            <Head eyebrow={s.eyebrow} title={s.title} body={s.body} />
            <ol className="lp-steps">
              {s.items.map((it, i) => (
                <li key={it.title} data-reveal="" data-reveal-delay={String(i % 3)}>
                  <span className="lp-steps__n tnum" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="h-card">{it.title}</h3>
                  <p>{it.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      );
    case "prose":
      return (
        <section className="section section--divided" id={s.id}>
          <div className="container">
            <div className="lp-prose" data-reveal="">
              {s.eyebrow && <span className="eyebrow">{s.eyebrow}</span>}
              <h2 className="h-section">{s.title}</h2>
              {s.paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
              {s.bullets && (
                <ul>
                  {s.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      );
    case "table":
      return (
        <section className="section section--divided" id={s.id}>
          <div className="container">
            <Head eyebrow={s.eyebrow} title={s.title} body={s.body} />
            <div className="lp-table-wrap" data-reveal="">
              <table className="lp-table">
                <caption className="visually-hidden">{page.h1}</caption>
                <thead>
                  <tr>
                    {s.columns.map((c, i) => (
                      <th key={i} scope="col">
                        {c || <span className="visually-hidden">Feature</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r) => (
                    <tr key={r.label}>
                      <th scope="row">{r.label}</th>
                      {r.cells.map((c, i) => (
                        // data-col: on phones each row becomes a card and the
                        // cells are labelled with their column (landing.css).
                        <td key={i} className={i === 0 ? "lp-table__ours" : undefined} data-col={s.columns[i + 1] || undefined}>
                          <CellView cell={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(s.note || page.verified) && (
              <p className="small lp-table__note">
                {s.note ? `${s.note} ` : ""}
                {page.verified ? `Competitor details checked ${page.verified}.` : ""}
              </p>
            )}
          </div>
        </section>
      );
    case "choose":
      return (
        <section className="section section--divided" id={s.id}>
          <div className="container">
            <Head title={s.title} />
            <div className="lp-choose">
              {[s.ours, s.theirs].map((col, i) => (
                <div key={col.title} className={`lp-card${i === 0 ? " lp-card--ours" : ""}`} data-reveal="" data-reveal-delay={String(i)}>
                  <h3 className="h-card">{col.title}</h3>
                  <ul>
                    {col.items.map((it) => (
                      <li key={it}>{it}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    case "trades":
      return (
        <section className="section section--divided">
          <div className="container">
            <Head title={s.title} body={s.body} />
            <TradeCards exclude={page.path} />
          </div>
        </section>
      );
  }
}

function Related({ page }: { page: LandingPage }) {
  const links = page.related.map((p) => seoByPath[p]).filter(Boolean);
  if (!links.length) return null;
  return (
    <section className="section--tight lp-related-wrap" aria-labelledby="lp-related">
      <div className="container">
        <h2 id="lp-related" className="lp-related__title">
          Related
        </h2>
        <ul className="lp-related">
          {links.map((l) => (
            <li key={l.path}>
              <a href={l.path} className="lp-related__link">
                <strong>{l.label}</strong>
                <span>{l.description}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
