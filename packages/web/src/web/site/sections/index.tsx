import { useState } from "react";
import { brand, closing, faqs, monthlyPrice, pricing, stats, story } from "../config";
import { TradeCards } from "../components/TradeCards";
import { ContactAsk } from "../components/ContactAsk";
import { useAnchorNav } from "../components/SiteHeader";
import { CountUp, handleSpotlight } from "../motion/effects";

/* ---------------- Who it's for: one card per trade ---------------- */
export function Audiences() {
  return (
    <section id="who-its-for" className="section section--divided anchor">
      <div className="container">
        <div className="intro intro--center" data-reveal="">
          <span className="eyebrow">Who it's for</span>
          <h2 className="h-section">
            Built for teams that work <span className="h-muted">at the customer's door.</span>
          </h2>
          <p className="lede">Pick your trade to see how ArrivePing runs a real day of it.</p>
        </div>
        <TradeCards />
      </div>
    </section>
  );
}

/* ---------------- Pricing ---------------- */
const PRESETS = [2, 5, 10, 20, 29, 30, 50, 100];

export function Pricing() {
  const go = useAnchorNav();
  const [drivers, setDrivers] = useState(10);
  // One dispatcher licence comes with every plan; each extra office user
  // (a second dispatcher or a manager) is a licence priced like a driver.
  const [office, setOffice] = useState(0);
  const est = monthlyPrice(drivers + office);
  const nav = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (href.startsWith("#") || href.startsWith("/#")) go(e, href);
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
        <ul className="pricing__assure" data-reveal="">
          {pricing.assurances.map((x) => (
            <li key={x}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3.5 8.4l2.8 2.7 6.2-6.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {x}
            </li>
          ))}
        </ul>
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
              How many drivers? <span className="estimator__n tnum">{drivers}</span>
            </label>
            <input
              id="estimator-drivers"
              type="range"
              min={1}
              max={100}
              step={1}
              value={drivers}
              onChange={(e) => setDrivers(Number(e.target.value))}
              className="estimator__range"
              aria-label="Number of drivers"
            />
            <div className="estimator__presets">
              {PRESETS.map((v) => (
                <button key={v} type="button" className="estimator__chip" aria-pressed={drivers === v} onClick={() => setDrivers(v)}>
                  {v === 1 ? "1 driver" : `${v} drivers`}
                </button>
              ))}
            </div>
          </div>
          <div className="estimator__office">
            <span className="estimator__officelabel" id="estimator-office-label">
              Extra dispatchers or managers
              <small>1 dispatcher is included; each extra is priced like a driver</small>
            </span>
            <div className="estimator__stepper">
              <button type="button" onClick={() => setOffice((n) => Math.max(0, n - 1))} disabled={office === 0} aria-label="Remove an extra dispatcher or manager">
                −
              </button>
              <output className="tnum" aria-live="polite" aria-label={`${office} extra dispatchers or managers`}>
                {office}
              </output>
              <button type="button" onClick={() => setOffice((n) => Math.min(20, n + 1))} disabled={office === 20} aria-label="Add an extra dispatcher or manager">
                +
              </button>
            </div>
          </div>
          <div className="estimator__result" aria-live="polite">
            <span className="estimator__plan">Your plan · {est.plan}</span>
            <span className="estimator__total tnum">
              ${est.total.toLocaleString("en-US")} <span>USD / month</span>
            </span>
            <span className="estimator__breakdown">{est.breakdown}</span>
            {office > 0 ? (
              <span className="estimator__breakdown">
                {drivers} {drivers === 1 ? "driver" : "drivers"} + {office} extra office {office === 1 ? "user" : "users"}, each priced like a driver
              </span>
            ) : null}
          </div>
        </div>

        <p className="pricing__int" data-reveal="">
          {pricing.integrationsNote.text}{" "}
          <a href={pricing.integrationsNote.link.href} onClick={(e) => nav(e, pricing.integrationsNote.link.href)}>
            {pricing.integrationsNote.link.label}
          </a>
        </p>
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
          <h2 className="h-section">Questions we hear before every signup</h2>
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

      </div>
    </section>
  );
}

/* ---------------- Closing CTA ---------------- */
export function ClosingCTA() {
  const t = closing.trial;
  return (
    <section id="free-trial" className="closing anchor">
      <img src={brand.watermark} alt="" aria-hidden="true" className="closing__watermark" />
      <div className="container closing__grid">
        <div data-reveal="">
          <span className="eyebrow" style={{ color: "#b9bcc4" }}>
            {brand.launch}
          </span>
          <h2>{closing.title}</h2>
          <p className="closing__body">{closing.body}</p>
          <ol className="closing__steps">
            {closing.steps.map((st, i) => (
              <li key={st.title}>
                <span className="closing__n tnum" aria-hidden="true">
                  {i + 1}
                </span>
                <span>
                  <strong>{st.title}</strong>
                  <span>{st.body}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="closing__contact">
            {closing.help} <a href={`mailto:${brand.contactEmail}`}>{brand.contactEmail}</a>
          </p>
        </div>
        <div data-reveal="" data-reveal-delay="1">
          <div className="form-card trial-card">
            <h3>{t.title}</h3>
            <ul className="trial-card__points">
              {t.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <a href={brand.urls.signUp} className="btn btn--primary trial-card__cta">
              {t.cta}
            </a>
            <p className="small trial-card__fine">{t.fine}</p>
            <ContactAsk />
          </div>
        </div>
      </div>
    </section>
  );
}
