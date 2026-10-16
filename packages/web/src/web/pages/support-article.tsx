import { useRoute } from "wouter";
import { HelpShell, ArticleBlocks, ContactCard } from "../site/components/HelpShell";
import { articleBySlug, articlesIn, categoryById } from "../site/support/articles";

/** One help article — https://arriveping.com/support/:slug */
export default function SupportArticlePage() {
  const [, params] = useRoute("/support/:slug");
  const slug = params?.slug ?? "";
  const a = articleBySlug[slug];

  if (!a) {
    return (
      <HelpShell path="/support">
        <main id="main" tabIndex={-1} className="help help-article">
          <div className="container help-article__grid">
            <article className="help-article__body">
              <span className="eyebrow">Help Center</span>
              <h1 className="help-article__title">We couldn't find that guide.</h1>
              <p>
                It may have moved. <a href="/support">Browse all guides</a> or search from the Help Center.
              </p>
            </article>
            <ContactCard compact />
          </div>
        </main>
      </HelpShell>
    );
  }

  const cat = categoryById[a.category];
  const siblings = articlesIn(a.category).filter((x) => x.slug !== a.slug);

  return (
    <HelpShell path={`/support/${a.slug}`}>
      <main id="main" tabIndex={-1} className="help help-article">
        <div className="container help-article__grid">
          <nav className="help-article__crumbs" aria-label="Breadcrumb">
            <a href="/support">Help Center</a>
            <span aria-hidden="true">›</span>
            <a href={`/support#${cat.id}`}>{cat.title}</a>
          </nav>

          <article className="help-article__body">
            <header className="help-article__head">
              <span className="help-cat__chip">{cat.audience}</span>
              <h1 className="help-article__title">{a.title}</h1>
              <p className="help-article__summary">{a.summary}</p>
              <p className="small">Last updated {a.updated}</p>
            </header>
            <div className="help-article__content legal__section">
              <ArticleBlocks blocks={a.blocks} />
            </div>
            <ContactCard compact />
          </article>

          <aside className="help-article__side">
            <p className="legal__toc-label">More in {cat.title}</p>
            <ul className="help-article__related">
              {siblings.map((s) => (
                <li key={s.slug}>
                  <a href={`/support/${s.slug}`}>{s.title}</a>
                </li>
              ))}
              {!siblings.length && <li className="small">This is the only guide here so far.</li>}
            </ul>
            <a className="help-article__all" href="/support">
              ← All guides
            </a>
          </aside>
        </div>
      </main>
    </HelpShell>
  );
}
