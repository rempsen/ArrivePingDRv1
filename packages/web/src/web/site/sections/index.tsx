import { useEffect, useRef, useState } from "react";
import { audiences, brand, chapters, closing, faqs, monthlyPrice, pricing, stats, stories, story } from "../config";
import { MediaSlot } from "../components/MediaSlot";
import { DemoForm } from "../components/DemoForm";
import { useAnchorNav } from "../components/SiteHeader";
import { usePlayback } from "../motion/playback";
import { scrollToAnchor, useScrollspy } from "../motion/use-scrollspy";
import { CountUp, handleSpotlight } from "../motion/effects";

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
const PRESETS = [1, 5, 10, 20, 30, 31, 50];

export function Pricing() {
  const go = useAnchorNav();
  const [drivers, setDrivers] = useState(10);
  const est = monthlyPrice(drivers);
  const nav = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (href.startsWith("#")) go(e, href);
  };
  return (
    <section id="pricing" className="section section--divided anchor">
      <div className="container">
        <div className="intro intro--center" data-reveal="">
          <span className="eyebrow">Pricing</span>
          <h2 className="h-section">
            {pricing.title} <span className="h-muted">{pricing.titleMuted}</span>
          </h2>
          <p className="lede">{pricing.body}</p>
        </div>
        <div className="tiers" onMouseMove={handleSpotlight}>
          {pricing.tiers.map((t, i) => {
            const featured = "featured" in t && t.featured;
            const active = est.plan === t.name;
            return (
              <div
                key={t.name}
                className={`tier spot${featured ? " tier--featured beam" : ""}`}
                data-active={active ? "true" : undefined}
                data-reveal=""
                data-reveal-delay={String(i)}
              >
                <div className="tier__name">
                  {t.name}
                  {featured && <span className="tier__tag">Most common</span>}
                </div>
                <div className="tier__range">{t.range}</div>
                <div className="tier__price">
                  {t.price} <span className="tier__cur">USD</span>
                </div>
                <div className="tier__unit">{t.unit}</div>
                <ul className="tier__features">
                  {t.features.map((f) => (
                    <li key={f}>
                      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <path d="M4 9.5l3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <a href={t.cta.href} className={`btn ${featured ? "btn--primary" : "btn--secondary"}`} onClick={(e) => nav(e, t.cta.href)}>
                  {t.cta.label}
                </a>
              </div>
            );
          })}
        </div>

        <div className="estimator" data-reveal="">
          <div className="estimator__input">
            <label htmlFor="estimator-drivers" className="estimator__label">
              How many drivers or vehicles? <span className="estimator__n tnum">{drivers}</span>
            </label>
            <input
              id="estimator-drivers"
              type="range"
              min={1}
              max={60}
              step={1}
              value={drivers}
              onChange={(e) => setDrivers(Number(e.target.value))}
              className="estimator__range"
              aria-label="Number of drivers or vehicles"
            />
            <div className="estimator__presets">
              {PRESETS.map((v) => (
                <button key={v} type="button" className="estimator__chip" aria-pressed={drivers === v} onClick={() => setDrivers(v)}>
                  {v === 1 ? "1 driver" : `${v} ${v > 30 ? "vehicles" : "drivers"}`}
                </button>
              ))}
            </div>
          </div>
          <div className="estimator__result" aria-live="polite">
            <span className="estimator__plan">Your plan · {est.plan}</span>
            <span className="estimator__total tnum">
              ${est.total.toLocaleString("en-US")} <span>USD / month</span>
            </span>
            <span className="estimator__breakdown">{est.breakdown}</span>
          </div>
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
      <img src={brand.watermark} alt="" aria-hidden="true" className="closing__watermark" />
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
