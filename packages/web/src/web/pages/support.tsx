import { useEffect, useMemo, useRef, useState } from "react";
import { HelpShell, ContactCard } from "../site/components/HelpShell";
import { articles, articlesIn, categories, categoryById, popularSlugs, support } from "../site/support/articles";
import { searchArticles } from "../site/support/search";

/**
 * Help Center hub — https://arriveping.com/support
 *
 * The support URL every app store listing requires, and the page the
 * technician app's Profile → "Help & Support" link opens. Task-based like
 * Jobber's help center: search first, then "what do you want to get done?"
 * categories, popular articles, and a clear path to a person.
 */
export default function SupportPage() {
  return (
    <HelpShell path="/support">
      <main id="main" tabIndex={-1} className="help">
        <Hero />
        <section className="help__section container" aria-labelledby="help-cats-h">
          <div className="help__section-head">
            <h2 id="help-cats-h">What do you want to get done?</h2>
            <p>Browse by task. Office staff and technicians each have their own guides.</p>
          </div>
          <ul className="help-cats">
            {categories.map((c) => {
              const n = articlesIn(c.id).length;
              return (
                <li key={c.id}>
                  <a className="help-cat" href={`/support#${c.id}`} onClick={(e) => jump(e, c.id)}>
                    <span className="help-cat__chip">{c.audience}</span>
                    <strong>{c.title}</strong>
                    <span className="help-cat__blurb">{c.blurb}</span>
                    <span className="help-cat__count tnum">
                      {n} {n === 1 ? "guide" : "guides"} →
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="help__section container help__split" aria-labelledby="help-pop-h">
          <div>
            <div className="help__section-head">
              <h2 id="help-pop-h">Popular right now</h2>
              <p>The questions people arrive with most often.</p>
            </div>
            <ol className="help-pop">
              {popularSlugs.map((slug) => {
                const a = articles.find((x) => x.slug === slug);
                if (!a) return null;
                return (
                  <li key={slug}>
                    <a href={`/support/${a.slug}`}>
                      <strong>{a.title}</strong>
                      <span>{a.summary}</span>
                    </a>
                  </li>
                );
              })}
            </ol>
          </div>
          <ContactCard />
        </section>

        <section className="help__section container" aria-label="All guides by category">
          {categories.map((c) => (
            <div key={c.id} id={c.id} className="help-group anchor">
              <div className="help-group__head">
                <h2>{c.title}</h2>
                <p>{c.blurb}</p>
              </div>
              <ul className="help-list">
                {articlesIn(c.id).map((a) => (
                  <li key={a.slug}>
                    <a href={`/support/${a.slug}`}>
                      <strong>{a.title}</strong>
                      <span>{a.summary}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="help__section container help-foot" aria-label="Status, security and legal">
          <div className="help-foot__grid">
            <div>
              <h3>Is ArrivePing down?</h3>
              <p>
                If the app or dashboard won't load, email{" "}
                <a href={`mailto:${support.email}`} className="legal__link">
                  {support.email}
                </a>{" "}
                and we'll confirm whether it's a platform issue or a device issue. A public status page is coming.
              </p>
            </div>
            <div>
              <h3>Security</h3>
              <p>
                Found a vulnerability? See <a href="/support/report-a-security-issue">how to report a security concern</a>.
                Please give us a chance to respond before posting publicly.
              </p>
            </div>
            <div>
              <h3>Legal</h3>
              <p>
                <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a>. {support.maker}
              </p>
            </div>
          </div>
        </section>
      </main>
    </HelpShell>
  );
}

function jump(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  history.replaceState(null, "", `#${id}`);
  el.scrollIntoView({ block: "start", behavior: "smooth" });
}

/* ------------------------------------------------------------------ */
/* Search hero                                                          */
/* ------------------------------------------------------------------ */

const SUGGESTED = [
  { label: "Why does the app ask for \"Always\" location?", slug: "location-sharing" },
  { label: "How do I invite a technician?", slug: "invite-your-technicians" },
  { label: "What does the customer actually see?", slug: "what-customers-receive" },
];

function Hero() {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchArticles(q), [q]);

  // ⌘K / Ctrl+K focuses the search, like every help center people already use.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === inputRef.current) setQ("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const open = q.trim().length > 1;

  return (
    <section className="help-hero">
      <div className="container help-hero__inner">
        <span className="eyebrow">Help Center</span>
        <h1 className="help-hero__title">How can we help?</h1>
        <p className="help-hero__lede">Search for a topic, or browse by what you're trying to get done.</p>

        <form className="help-search" onSubmit={(e) => e.preventDefault()}>
          <svg className="help-search__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            id="help-q"
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search for answers"
            autoComplete="off"
            aria-label="Search help articles"
            aria-controls="help-results"
          />
          <kbd className="help-search__kbd" aria-hidden="true">
            ⌘K
          </kbd>
        </form>

        <div id="help-results" className="help-results" aria-live="polite">
          {open ? (
            results.length ? (
              <ul>
                {results.map((a) => (
                  <li key={a.slug}>
                    <a href={`/support/${a.slug}`}>
                      <span className="help-results__cat">{categoryById[a.category].title}</span>
                      <strong>{a.title}</strong>
                      <span>{a.summary}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="help-results__empty">
                No guides match “{q}” yet. Email{" "}
                <a href={`mailto:${support.email}?subject=${encodeURIComponent(`Help: ${q}`)}`} className="legal__link">
                  {support.email}
                </a>{" "}
                and we'll answer, then write the guide.
              </p>
            )
          ) : (
            <p className="help-hero__suggested">
              Try:{" "}
              {SUGGESTED.map((s, i) => (
                <span key={s.slug}>
                  <a href={`/support/${s.slug}`}>{s.label}</a>
                  {i < SUGGESTED.length - 1 ? " · " : ""}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

