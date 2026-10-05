import { useEffect, useRef, type JSX } from "react";
import { audiences, benefits, brand, chapters, closing, faqs, hero, pricing, stats, stories, story, workflow } from "../config";
import { MediaSlot } from "../components/MediaSlot";
import { DemoForm } from "../components/DemoForm";
import { useAnchorNav } from "../components/SiteHeader";
import { usePlayback } from "../motion/playback";
import { scrollToAnchor, useScrollspy } from "../motion/use-scrollspy";
import { Aurora, CountUp, handleSpotlight } from "../motion/effects";

const Arrow = () => (
  <svg className="arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ---------------- Hero ---------------- */
export function Hero() {
  const go = useAnchorNav();
  return (
    <section className="hero">
      <Aurora />
      <div className="container">
        <div className="hero__copy">
          <span className="eyebrow enter">{hero.eyebrow}</span>
          <h1 className="hero__title enter enter--2">
            {hero.title.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </h1>
          <p className="hero__lede enter enter--3">{hero.body}</p>
          <div className="hero__ctas enter enter--3">
            <a href={hero.primary.href} className="btn btn--primary beam" onClick={(e) => go(e, hero.primary.href)}>
              {hero.primary.label}
            </a>
            <a href={hero.secondary.href} className="btn btn--secondary" onClick={(e) => go(e, hero.secondary.href)}>
              {hero.secondary.label} <Arrow />
            </a>
          </div>
          <p className="hero__fine enter enter--3">No app for customers · Technicians use the ArrivePing mobile app · Up and running in hours</p>
        </div>
        <div className="hero__stage enter--stage">
          <MediaSlot id="hero-overview" raised />
        </div>
      </div>
    </section>
  );
}

/* ---------------- Benefits ---------------- */
const icons: Record<string, JSX.Element> = {
  customer: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="4" y="1.5" width="10" height="15" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.5 13.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  board: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1.5 7h15M6 7v8.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  technician: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 16s5.5-4.1 5.5-8.5a5.5 5.5 0 1 0-11 0C3.5 11.9 9 16 9 16Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="9" cy="7.5" r="1.8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
};

export function BenefitsStrip() {
  return (
    <section className="section--tight" aria-labelledby="benefits-title">
      <div className="container">
        <h2 id="benefits-title" className="visually-hidden">
          Why teams use ArrivePing
        </h2>
        <div className="benefits">
          {benefits.map((b, i) => (
            <div key={b.title} className="benefit" data-reveal="" data-reveal-delay={String(i)}>
              <div className="benefit__icon">{icons[b.icon]}</div>
              <h3>{b.title}</h3>
              <p>{b.body}</p>
              <span className="benefit__stat">{b.stat}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Showcase (sticky rail) ---------------- */
export function Showcase() {
  const containerRef = useRef<HTMLDivElement>(null);
  const ids = chapters.map((c) => c.id);
  const active = useScrollspy(containerRef, ids);
  const { paused, toggle, reduced } = usePlayback();

  const railRef = useRef<HTMLElement>(null);

  const onRail = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    // scrollToAnchor adds the sticky chip strip's height on narrow screens.
    scrollToAnchor(id, reduced);
    history.replaceState(null, "", `#${id}`);
  };

  // Keep the active chip visible inside the horizontal strip.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const inner = rail.querySelector<HTMLElement>(".showcase-rail-inner");
    const link = rail.querySelector<HTMLElement>(`.rail__link[aria-current="location"]`);
    if (!inner || !link || inner.scrollWidth <= inner.clientWidth) return;
    const left = link.offsetLeft - 16;
    inner.scrollTo({ left, behavior: reduced ? "auto" : "smooth" });
  }, [active, reduced]);

  return (
    <section id="product" className="section anchor">
      <div className="container">
        <div className="showcase__head" data-reveal="">
          <div className="intro">
            <span className="eyebrow">Product</span>
            <h2 className="h-section">One appointment record. <span className="h-muted">Three people who can see it.</span></h2>
            <p className="lede">The office, the technician and the customer each get the view they need — and every view updates from the same place.</p>
          </div>
        </div>

        <div className="showcase" ref={containerRef}>
          <aside className="showcase-rail" ref={railRef}>
            <nav className="showcase-rail-inner" aria-label="Product chapters">
              <div className="rail__label">In this section</div>
              {chapters.map((c, i) => (
                <a key={c.id} href={`#${c.id}`} className="rail__link" aria-current={active === c.id ? "location" : undefined} onClick={(e) => onRail(e, c.id)}>
                  <span className="rail__num">0{i + 1}</span>
                  {c.rail}
                </a>
              ))}
              <div className="rail__foot">
                <button type="button" className="btn btn--ghost btn--sm" onClick={toggle} aria-pressed={paused}>
                  {paused ? "Resume animations" : "Pause animations"}
                </button>
              </div>
            </nav>
          </aside>

          <div className="showcase-chapters">
            {chapters.map((c) => (
              <article key={c.id} id={c.id} className="showcase-chapter">
                <div className="chapter__intro" data-reveal="">
                  <h3>{c.title} <span className="h-muted">{c.titleMuted}</span></h3>
                  <p>{c.body}</p>
                </div>
                <div data-reveal="" data-reveal-delay="1">
                  <MediaSlot id={c.scene} />
                </div>
                <div className="showcase-support">
                  {c.support.map((sp, i) => (
                    <div key={sp.title} className="support" data-reveal="" data-reveal-delay={String(i + 1)}>
                      <h4>{sp.title}</h4>
                      <p>{sp.body}</p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Workflow ---------------- */
export function WorkflowSteps() {
  return (
    <section id="how-it-works" className="section section--divided anchor">
      <div className="container">
        <div className="intro intro--center" data-reveal="">
          <span className="eyebrow">How it works</span>
          <h2 className="h-section">From booked to arrived, in three steps</h2>
          <p className="lede">Nothing to learn for the customer. Two taps for the technician. One board for the office.</p>
        </div>
        <ol className="steps" style={{ listStyle: "none", padding: 0 }}>
          {workflow.map((w, i) => (
            <li key={w.step} className="step" data-reveal="" data-reveal-delay={String(i)}>
              <span className="step__num">{w.step}</span>
              <h3>{w.title}</h3>
              <p>{w.body}</p>
              <div className="step__art">
                <StepArt index={i} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function StepArt({ index }: { index: number }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (index === 0)
    return (
      <svg width="100%" viewBox="0 0 280 72" aria-hidden="true" style={{ color: "var(--ink-muted)", display: "block" }}>
        <rect x="1" y="1" width="278" height="70" rx="10" {...common} stroke="var(--line)" />
        <rect x="16" y="16" width="120" height="10" rx="3" fill="var(--line)" />
        <rect x="16" y="34" width="90" height="8" rx="3" fill="var(--surface-muted)" stroke="var(--line)" />
        <rect x="16" y="48" width="160" height="8" rx="3" fill="var(--surface-muted)" stroke="var(--line)" />
        <rect x="196" y="40" width="68" height="18" rx="5" fill="var(--ink)" />
        <text x="230" y="52.5" textAnchor="middle" fontSize="9" fill="#fff" fontFamily="Inter Variable, Inter, sans-serif" fontWeight="500">
          Save
        </text>
      </svg>
    );
  if (index === 1)
    return (
      <svg width="100%" viewBox="0 0 280 72" aria-hidden="true" style={{ color: "var(--ink-muted)", display: "block" }}>
        <rect x="1" y="1" width="278" height="70" rx="10" {...common} stroke="var(--line)" />
        <path d="M24 50 C 60 50, 90 20, 140 28 S 220 50, 256 22" {...common} stroke="var(--line-strong)" />
        <path d="M24 50 C 60 50, 90 20, 140 28" {...common} stroke="var(--accent)" strokeWidth={2} />
        <circle cx="140" cy="28" r="6" fill="var(--accent)" stroke="#fff" strokeWidth="2" />
        <circle cx="256" cy="22" r="4" fill="var(--surface)" stroke="var(--ink)" strokeWidth="1.5" />
        <rect x="150" y="38" width="98" height="20" rx="10" fill="var(--accent-soft)" />
        <text x="199" y="51.5" textAnchor="middle" fontSize="9.5" fill="var(--accent)" fontFamily="Inter Variable, Inter, sans-serif" fontWeight="500">
          On the way · 10:40–10:55
        </text>
      </svg>
    );
  return (
    <svg width="100%" viewBox="0 0 280 72" aria-hidden="true" style={{ color: "var(--ink-muted)", display: "block" }}>
      <rect x="1" y="1" width="278" height="70" rx="10" {...common} stroke="var(--line)" />
      <rect x="16" y="14" width="16" height="16" rx="4" fill="var(--ink)" />
      <rect x="40" y="16" width="96" height="6" rx="3" fill="var(--ink)" opacity="0.8" />
      <rect x="40" y="26" width="200" height="6" rx="3" fill="var(--line)" />
      <rect x="40" y="36" width="160" height="6" rx="3" fill="var(--line)" />
      <rect x="40" y="50" width="82" height="12" rx="6" fill="var(--surface-muted)" stroke="var(--line)" />
      <text x="81" y="59" textAnchor="middle" fontSize="7.5" fill="var(--ink-secondary)" fontFamily="Inter Variable, Inter, sans-serif" fontWeight="500">
        View arrival page
      </text>
    </svg>
  );
}

/* ---------------- Outcome stories ---------------- */
export function OutcomeStories() {
  return (
    <section className="section section--divided">
      <div className="container">
        <div className="intro" data-reveal="">
          <span className="eyebrow">In practice</span>
          <h2 className="h-section">Two questions. <span className="h-muted">Answered before anyone calls.</span></h2>
        </div>
        {stories.map((st, i) => (
          <div key={st.question} className={`story${i % 2 ? " story--flip" : ""}`}>
            <div className="story__copy" data-reveal="">
              <h3 className="story__q">{st.question}</h3>
              <p className="story__a">{st.answer}</p>
            </div>
            <div className="story__media" data-reveal="" data-reveal-delay="1">
              <picture>
                <source type="image/webp" srcSet={st.image.src.replace(/\.jpg$/, ".webp")} />
                <img className="story__photo" src={st.image.src} alt={st.image.alt} loading="lazy" width={1200} height={800} />
              </picture>
              <div className="story__card">
                <MediaSlot id={st.scene} raised />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- Audiences ---------------- */
export function Audiences() {
  return (
    <section id="who-its-for" className="section section--divided anchor">
      <div className="container">
        <div className="intro intro--center" data-reveal="">
          <span className="eyebrow">Who it's for</span>
          <h2 className="h-section">Built for teams that show up at the customer's door</h2>
          <p className="lede">If your day is a list of appointments at other people's addresses, ArrivePing fits.</p>
        </div>
        <div className="audiences">
          {audiences.map((a, i) => (
            <div key={a.label} className="audience" data-reveal="" data-reveal-delay={String(Math.min(3, i))}>
              <picture>
                <source type="image/webp" srcSet={a.image.replace(/\.jpg$/, ".webp")} />
                <img src={a.image} alt="" loading="lazy" width={900} height={600} />
              </picture>
              <div className="audience__copy">
                <span className="audience__label">{a.label}</span>
                <p className="audience__body">{a.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Pricing ---------------- */
export function Pricing() {
  const go = useAnchorNav();
  return (
    <section id="pricing" className="section section--divided anchor">
      <div className="container">
        <div className="intro intro--center" data-reveal="">
          <span className="eyebrow">Pricing</span>
          <h2 className="h-section">{pricing.title}</h2>
          <p className="lede">{pricing.body}</p>
        </div>
        <div className="tiers" onMouseMove={handleSpotlight}>
          {pricing.tiers.map((t, i) => {
            const featured = "featured" in t && t.featured;
            return (
              <div
                key={t.name}
                className={`tier spot${featured ? " tier--featured beam" : ""}`}
                data-reveal=""
                data-reveal-delay={String(i)}
              >
                <div className="tier__name">
                  {t.name}
                  {featured && <span className="tier__tag">Most common</span>}
                </div>
                <div className="tier__range">{t.range}</div>
                <div className="tier__price">{t.price}</div>
                <div className="tier__unit">{t.unit}</div>
                <a href={brand.urls.demo} className={`btn ${featured ? "btn--primary" : "btn--secondary"}`} onClick={(e) => go(e, brand.urls.demo)}>
                  Book a demo
                </a>
              </div>
            );
          })}
        </div>
        <p className="pricing__note" data-reveal="">
          {pricing.note}
        </p>
      </div>
    </section>
  );
}

/* ---------------- FAQ ---------------- */
export function FAQ() {
  return (
    <section id="faqs" className="section section--divided anchor">
      <div className="container">
        <div className="intro intro--center" data-reveal="">
          <span className="eyebrow">FAQs</span>
          <h2 className="h-section">Questions we hear at every demo</h2>
        </div>
        <div className="faq" data-reveal="">
          {faqs.map((f) => (
            <details key={f.q}>
              <summary>
                {f.q}
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

/* ---------------- Our story ---------------- */
export function OurStory() {
  return (
    <section id="our-story" className="section section--divided anchor">
      <div className="container">
        <div className="ourstory">
          <div className="ourstory__copy" data-reveal="">
            <span className="eyebrow">{story.eyebrow}</span>
            <h2 className="h-section">
              {story.title} <span className="h-muted">{story.titleMuted}</span>
            </h2>
            <p className="lede">{story.body}</p>
            <blockquote className="ourstory__quote">
              “{story.quote}”
              <cite>{story.quoteAttribution}</cite>
            </blockquote>
          </div>

          <div className="ourstory__stats" data-reveal="" data-reveal-delay="1" onMouseMove={handleSpotlight}>
            {stats.map((s) => (
              <div key={s.label} className="ourstat spot">
                <CountUp value={s.value} className="ourstat__value" />
                <p className="ourstat__label">{s.label}</p>
                {"source" in s && s.source && <span className="ourstat__source">{s.source}</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="ourstory__guarantee" data-reveal="">
          <h3>{story.guarantee.title}</h3>
          <p>{story.guarantee.body}</p>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Closing CTA ---------------- */
export function ClosingCTA() {
  return (
    <section id="book-a-demo" className="closing anchor">
      <div className="container closing__grid">
        <div data-reveal="">
          <span className="eyebrow" style={{ color: "#b9bcc4" }}>
            {brand.launch}
          </span>
          <h2>{closing.title}</h2>
          <p className="closing__body">
            ArrivePing is launching November 2026. Book a walkthrough now and be among the first teams set up.
          </p>
          <div className="closing__motif">
            <MediaSlot id="closing-motif" className="slot--dark" />
          </div>
          <p className="closing__contact">
            Prefer email? <a href={`mailto:${brand.contactEmail}`}>{brand.contactEmail}</a>
          </p>
        </div>
        <div data-reveal="" data-reveal-delay="1">
          <DemoForm />
        </div>
      </div>
    </section>
  );
}
