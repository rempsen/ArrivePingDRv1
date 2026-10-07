import { useEffect, useState } from "react";
import { posts, bodyLoaders, type PostMeta } from "virtual:blog-index";
import { MarketingShell } from "../../site/components/MarketingShell";
import { ClosingCTA } from "../../site/sections";
import { blogCategories, categoryBySlug } from "../../site/blog/categories";
import { authorFor, formatDate } from "../../site/blog/meta";
import { brand } from "../../site/config";
import "../../site/site.css";
import "../../site/landing.css";
import "../../site/blog/blog.css";

/**
 * The ArrivePing blog: index, category and post pages. Posts are Markdown
 * files compiled at build time (vite/plugins/blog-plugin.ts) and prerendered
 * to static HTML like the rest of the public site.
 */

/* ---------------- Index and category pages ---------------- */

export function BlogIndexRoute() {
  return (
    <MarketingShell path="/blog">
      <header className="lp-hero blog-hero">
        <div className="container">
          <Crumbs trail={[{ label: "Home", path: "/" }, { label: "Blog", path: "/blog" }]} />
          <span className="eyebrow">Blog</span>
          <h1 className="lp-hero__title">The ArrivePing blog</h1>
          <p className="lede lp-hero__lede">
            Practical writing on dispatch, technician tracking, customer communication and running a more profitable field
            service business, from the NVC360 team that ran more than 800 field technicians.
          </p>
        </div>
      </header>
      <CategoryNav active="" />
      <PostGrid list={posts} featureFirst />
      <ClosingCTA />
    </MarketingShell>
  );
}

export function makeBlogCategory(slug: string) {
  return function BlogCategoryRoute() {
    const cat = categoryBySlug[slug];
    const list = posts.filter((p) => p.category === slug);
    return (
      <MarketingShell path={`/blog/category/${slug}`}>
        <header className="lp-hero blog-hero">
          <div className="container">
            <Crumbs
              trail={[
                { label: "Home", path: "/" },
                { label: "Blog", path: "/blog" },
                { label: cat.label, path: `/blog/category/${slug}` },
              ]}
            />
            <span className="eyebrow">Blog · {list.length} articles</span>
            <h1 className="lp-hero__title">{cat.label}</h1>
            <p className="lede lp-hero__lede">{cat.description}</p>
            <p className="blog-hero__product">
              Looking for the software? <a href={cat.productPath}>See how ArrivePing handles it →</a>
            </p>
          </div>
        </header>
        <CategoryNav active={slug} />
        <PostGrid list={list} />
        <ClosingCTA />
      </MarketingShell>
    );
  };
}

function Crumbs({ trail }: { trail: { label: string; path: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="lp-crumbs">
      <ol>
        {trail.map((t, i) => (
          <li key={t.path}>{i < trail.length - 1 ? <a href={t.path}>{t.label}</a> : <span aria-current="page">{t.label}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}

function CategoryNav({ active }: { active: string }) {
  return (
    <nav className="blog-cats" aria-label="Blog categories">
      <div className="container">
        <ul>
          <li>
            <a href="/blog" aria-current={active === "" ? "page" : undefined}>
              All articles
            </a>
          </li>
          {blogCategories.map((c) => (
            <li key={c.slug}>
              <a href={`/blog/category/${c.slug}`} aria-current={active === c.slug ? "page" : undefined}>
                {c.label}
              </a>
            </li>
          ))}
          <li className="blog-cats__rss">
            <a href="/blog/rss.xml">RSS</a>
          </li>
        </ul>
      </div>
    </nav>
  );
}

function Cover({ post, eager }: { post: PostMeta; eager?: boolean }) {
  if (post.image) {
    return (
      <img
        className="post-cover"
        src={post.image}
        alt={post.imageAlt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        width={1600}
        height={900}
      />
    );
  }
  // No photo yet: a branded card in the category's colour, so the grid stays even.
  return (
    <div className={`post-cover post-cover--art cat-${post.category}`} aria-hidden="true">
      <span>{categoryBySlug[post.category]?.label}</span>
    </div>
  );
}

function PostCard({ post, feature, headingLevel = 2 }: { post: PostMeta; feature?: boolean; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className={`post-card${feature ? " post-card--feature" : ""}`} data-reveal="">
      <a href={`/blog/${post.slug}`} className="post-card__link">
        <Cover post={post} eager={feature} />
        <div className="post-card__body">
          <span className="post-card__cat">{categoryBySlug[post.category]?.label}</span>
          <H className="post-card__title">{post.title}</H>
          <p className="post-card__desc">{post.description}</p>
          <span className="post-card__meta">
            <time dateTime={post.date}>{formatDate(post.date)}</time> · {post.readingMinutes} min read
          </span>
        </div>
      </a>
    </article>
  );
}

function PostGrid({ list, featureFirst }: { list: PostMeta[]; featureFirst?: boolean }) {
  const [first, ...rest] = list;
  return (
    <section className="section--tight blog-list" aria-label="Articles">
      <div className="container">
        {featureFirst && first && <PostCard post={first} feature />}
        <div className="post-grid">
          {(featureFirst ? rest : list).map((p) => (
            <PostCard key={p.slug} post={p} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Post page ---------------- */

type BodyGlobal = { __BLOG_BODIES__?: Record<string, string> };

/** The article HTML: from the prerender, from the prerendered DOM, or loaded on demand. */
function initialBody(slug: string): string {
  const fromBuild = (globalThis as BodyGlobal).__BLOG_BODIES__?.[slug];
  if (fromBuild) return fromBuild;
  if (typeof document !== "undefined") {
    const el = document.querySelector(`[data-blog-body="${CSS.escape(slug)}"]`);
    if (el) return el.innerHTML;
  }
  return "";
}

export function makeBlogPost(slug: string) {
  return function BlogPostRoute() {
    return <BlogPost slug={slug} />;
  };
}

function BlogPost({ slug }: { slug: string }) {
  const post = posts.find((p) => p.slug === slug)!;
  const cat = categoryBySlug[post.category];
  const author = authorFor(post.author);
  const [html, setHtml] = useState(() => initialBody(slug));

  useEffect(() => {
    if (html) return;
    let live = true;
    bodyLoaders[slug]?.().then((h) => live && setHtml(h));
    return () => {
      live = false;
    };
  }, [slug, html]);

  const sameCat = posts.filter((p) => p.slug !== slug && p.category === post.category);
  const related = [...sameCat, ...posts.filter((p) => p.slug !== slug && p.category !== post.category)].slice(0, 3);

  return (
    <MarketingShell path={`/blog/${slug}`}>
      <article className="post">
        <header className="lp-hero post__hero">
          <div className="container post__narrow">
            <Crumbs
              trail={[
                { label: "Home", path: "/" },
                { label: "Blog", path: "/blog" },
                { label: cat?.label ?? "Article", path: `/blog/category/${post.category}` },
              ]}
            />
            <a className="eyebrow post__cat" href={`/blog/category/${post.category}`}>
              {cat?.label}
            </a>
            <h1 className="post__title">{post.title}</h1>
            <p className="lede post__lede">{post.description}</p>
            <p className="post__meta">
              <span>
                By <strong>{author.name}</strong>, {author.role}
              </span>
              <span>
                <time dateTime={post.date}>{formatDate(post.date)}</time>
                {post.updated > post.date && (
                  <>
                    {" "}
                    · Updated <time dateTime={post.updated}>{formatDate(post.updated)}</time>
                  </>
                )}
              </span>
              <span>{post.readingMinutes} min read</span>
            </p>
          </div>
          {post.image && (
            <div className="container post__wide">
              <img className="post__image" src={post.image} alt={post.imageAlt} width={1600} height={900} decoding="async" />
            </div>
          )}
        </header>

        <div className="container post__layout">
          {post.headings.length >= 3 && (
            <aside className="post__toc" aria-label="On this page">
              <span className="post__toc-title">On this page</span>
              <ol>
                {post.headings.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`}>{h.text}</a>
                  </li>
                ))}
              </ol>
            </aside>
          )}
          <div className="post__main">
            {/* Trusted HTML: compiled at build time from our own Markdown files. */}
            <div className="post__body" data-blog-body={slug} dangerouslySetInnerHTML={{ __html: html }} />

            {post.tags.length > 0 && (
              <ul className="post__tags" aria-label="Topics">
                {post.tags.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}

            <aside className="post__author" aria-label="About the author">
              <span className="post__avatar" aria-hidden="true">
                {author.initials}
              </span>
              <div>
                <strong>{author.name}</strong>
                <span>{author.role}</span>
                <p>{author.bio}</p>
              </div>
            </aside>

            <aside className="post__cta" aria-label="ArrivePing">
              <div>
                <strong>See it on your own jobs.</strong>
                <p>
                  ArrivePing auto-assigns the closest qualified technician and texts your customer a live ETA. From $49 USD a
                  month. {brand.launch}.
                </p>
              </div>
              <div className="post__cta-actions">
                <a href="#book-a-demo" className="btn btn--primary">
                  Book a demo
                </a>
                {cat && (
                  <a href={cat.productPath} className="btn btn--secondary">
                    How it works
                  </a>
                )}
              </div>
            </aside>
          </div>
        </div>
      </article>

      {related.length > 0 && (
        <section className="section--tight blog-related" aria-labelledby="blog-related">
          <div className="container">
            <h2 id="blog-related" className="blog-related__title">
              Keep reading
            </h2>
            <div className="post-grid">
              {related.map((p) => (
                <PostCard key={p.slug} post={p} headingLevel={3} />
              ))}
            </div>
          </div>
        </section>
      )}
      <ClosingCTA />
    </MarketingShell>
  );
}
