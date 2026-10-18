import { useEffect, useRef, useState, type ReactNode } from "react";
import { brand, customerView, hero } from "../config";
import type { LandingPage, TradeContent } from "../content/landing";
import { usePlayback } from "../motion/playback";
import { SmsScreen } from "./CustomerView";
import { PauseButton, useLivePlay } from "./shared";

/**
 * Trade pages (HVAC, plumbing, electrical, installers, property maintenance,
 * delivery) in the homepage's design language: a film hero of the trade at
 * work with the customer's on-the-way text, the trade's sourced figures on the
 * light band, a time-stamped day in the trade beside the real customer screens,
 * and trade-specific features.
 */

/** ArrivePing's default on-the-way text, with the trade's word for the field person. */
const smsBody = (t: TradeContent) =>
  `${t.sms.company}: Your ${t.sms.who} ${t.sms.tech} is on the way! ETA ~${t.sms.eta} min. Track live, see ETA & message them: https://arriveping.com/t/7k2q9x`;

export function TradeHero({ page, crumbs }: { page: LandingPage; crumbs: ReactNode }) {
  const t = page.trade as TradeContent;
  const { ref, play } = useLivePlay<HTMLElement>(0.1);
  const { reduced } = usePlayback();
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);

  // The film is chosen after hydration, so the prerendered page ships only the poster.
  useEffect(() => {
    if (!t.media.film) return;
    setSrc(window.innerWidth < 900 ? t.media.film.small : t.media.film.large);
  }, [t.media.film]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (play === "on" && !reduced) v.play().catch(() => {});
    else v.pause();
  }, [play, reduced, src]);

  return (
    <header className="lv lv-hero lv-hero--trade" ref={ref} data-play={play} aria-labelledby="trade-title">
      <div className="lv-hero__film" aria-hidden="true">
        <picture>
          <source type="image/webp" srcSet={t.media.posterWebp} />
          <img src={t.media.poster} alt="" width={1600} height={900} fetchPriority="high" decoding="async" />
        </picture>
        {src && !reduced ? (
          <video ref={video} aria-hidden="true" src={src} poster={t.media.posterWebp} muted loop playsInline autoPlay preload="auto" disablePictureInPicture tabIndex={-1} />
        ) : null}
      </div>
      <div className="lv-hero__shade" aria-hidden="true" />

      <div className="container lv-hero__inner">
        <div className="lv-hero__copy">
          {crumbs}
          <p className="lv-hero__badge enter">
            <span className="lv-hero__pillar">
              <span className="lv-livedot" aria-hidden="true" />
              {page.eyebrow}
            </span>
          </p>
          <h1 id="trade-title" className="lv-hero__title enter enter--2">
            {page.h1}
          </h1>
          <p className="lv-hero__promise enter enter--3">{page.lede}</p>
          <ul className="lv-proof enter enter--3">
            {t.proof.map((p) => (
              <li key={p}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M3.5 8.4l2.8 2.7 6.2-6.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {p}
              </li>
            ))}
          </ul>
          <div className="lv-hero__act enter enter--3">
            <div className="lv-hero__ctas">
              <a href={brand.urls.signUp} className="btn btn--primary beam">
                Start free for 30 days
              </a>
              <a href="#day" className="btn btn--secondary">
                {t.day.cta}
              </a>
            </div>
            <p className="lv-hero__risk">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="7.25" fill="rgb(16 185 129 / 18%)" stroke="#34d399" strokeWidth="1.5" />
                <path d="M5 8.2l2 1.9 4-4.1" fill="none" stroke="#34d399" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {hero.risk}
            </p>
          </div>
        </div>

        <figure className="lv-trade-note ap-once" aria-labelledby="trade-note-cap">
          <div className="ap-notif">
            <span className="ap-notif__app" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 22 22">
                <path d="M11 3.5c4.7 0 8.3 2.9 8.3 6.6s-3.6 6.6-8.3 6.6c-.9 0-1.8-.1-2.6-.3L4.6 18.3l1.1-3.4c-1.8-1.2-3-3-3-4.8 0-3.7 3.6-6.6 8.3-6.6z" fill="#fff" />
              </svg>
            </span>
            <div>
              <div className="ap-notif__row">
                <strong className="ap-notif__from">{hero.device.sms.from}</strong>
                <span className="ap-notif__when">now</span>
              </div>
              <p className="ap-notif__body">{smsBody(t)}</p>
            </div>
          </div>
          <figcaption id="trade-note-cap" className="lv-trade-note__cap">
            What your customer gets when the {t.sms.who} taps Start Driving · sample company and people
          </figcaption>
        </figure>
      </div>
      <PauseButton className="lv-hero__pause" />
    </header>
  );
}

/** The trade's sourced figures, set large on the light band. */
export function TradeStats({ t }: { t: TradeContent }) {
  return (
    <section className="ap-cv ap-cv--band" aria-labelledby="trade-stats">
      <div className="container">
        <h2 id="trade-stats" className="ap-cv__whyhead">
          {t.statsTitle}
        </h2>
        <ul className="ap-cv__stats">
          {t.stats.map((st) => (
            <li key={st.label} data-reveal="">
              <span className="ap-cv__val tnum">{st.value}</span>
              <span className="ap-cv__lbl">{st.label}</span>
              <a className="ap-cv__src" href={st.href} target="_blank" rel="noopener noreferrer">
                {st.source}
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** A day in the trade: the customer's text and live page beside a time-stamped timeline. */
export function TradeDay({ t }: { t: TradeContent }) {
  const track = customerView.steps[1].screen;
  return (
    <section id="day" className="section anchor lv tr-day" aria-labelledby="tr-day-title">
      <div className="container">
        <div className="intro tr-day__intro" data-reveal="">
          <span className="eyebrow">{t.day.eyebrow}</span>
          <h2 id="tr-day-title" className="h-section">
            {t.day.title}
          </h2>
        </div>
        <div className="tr-day__grid">
          <figure className="tr-day__media" data-reveal="">
            <div className="tr-day__phones">
              <div className="tr-day__phone">
                <div className="ap-phone ap-phone--crop">
                  <SmsScreen from={hero.device.sms.from} body={smsBody(t)} />
                </div>
              </div>
              <div className="tr-day__phone tr-day__phone--2">
                <div className="ap-phone ap-phone--crop">
                  {track.kind === "img" ? <img src={track.src} width={track.width} height={track.height} alt={track.alt} loading="lazy" decoding="async" /> : null}
                </div>
              </div>
            </div>
            <figcaption className="tr-day__cap">The on-the-way text and the real live page · sample data</figcaption>
          </figure>
          <ol className="tr-day__steps">
            {t.day.steps.map((s, i) => (
              <li key={s.time} data-reveal="" data-reveal-delay={String(Math.min(3, i + 1))}>
                <span className="tr-day__time tnum">{s.time}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function TradeFeatures({ t }: { t: TradeContent }) {
  return (
    <section className="section section--divided tr-feat" aria-labelledby="tr-feat-title">
      <div className="container">
        <div className="intro" data-reveal="">
          <span className="eyebrow">{t.features.eyebrow}</span>
          <h2 id="tr-feat-title" className="h-section">
            {t.features.title}
          </h2>
        </div>
        <ul className="tr-feat__grid">
          {t.features.items.map((f, i) => (
            <li key={f.title} data-reveal="" data-reveal-delay={String((i % 3) + 1)}>
              <span className="tr-feat__n tnum">{String(i + 1).padStart(2, "0")}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
