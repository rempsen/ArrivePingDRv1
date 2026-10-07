import { useEffect, useRef, useState, type JSX } from "react";
import { hero, heroFeed } from "../config";
import { useAnchorNav } from "../components/SiteHeader";
import { usePlayback } from "../motion/playback";
import { PauseButton, useLivePlay } from "./shared";

/**
 * C · Cinematic hero. A seamless film loop of a technician arriving at a home,
 * with a live activity feed that builds the five steps of one job:
 * fleet visibility → work order → auto-assignment → technician app → customer ETA.
 */

const icons: Record<(typeof heroFeed)[number]["icon"], JSX.Element> = {
  live: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="3" fill="#10b981" />
      <circle cx="9" cy="9" r="7" stroke="#10b981" strokeWidth="1.5" opacity="0.6" />
    </svg>
  ),
  order: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3" y="2" width="12" height="14" rx="2" stroke="#7dd3fc" strokeWidth="1.5" />
      <path d="M6 6.5h6M6 9.5h6M6 12.5h3" stroke="#7dd3fc" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  assign: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6.5" stroke="#7dd3fc" strokeWidth="1.5" />
      <circle cx="9" cy="9" r="2.5" fill="#7dd3fc" />
      <path d="M9 .5v3M9 14.5v3M.5 9h3M14.5 9h3" stroke="#7dd3fc" strokeWidth="1.5" />
    </svg>
  ),
  phone: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="5" y="1.5" width="8" height="15" rx="2" stroke="#7dd3fc" strokeWidth="1.5" />
      <path d="M7.5 13.5h3" stroke="#7dd3fc" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  customer: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2 4.5A2.5 2.5 0 0 1 4.5 2h9A2.5 2.5 0 0 1 16 4.5v6a2.5 2.5 0 0 1-2.5 2.5H8l-4 3v-3H4.5A2.5 2.5 0 0 1 2 10.5z" stroke="#6ee7b7" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
};

export function HeroFilm() {
  const go = useAnchorNav();
  const { ref, play } = useLivePlay<HTMLElement>(0.1);
  const { reduced } = usePlayback();
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);

  // Pick the cut after mount (small screens get the 960 px file).
  useEffect(() => {
    setSrc(window.innerWidth < 900 ? hero.film.small : hero.film.large);
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (play === "on" && !reduced) {
      v.play().catch(() => {
        /* autoplay refused: the poster stays */
      });
    } else {
      v.pause();
    }
  }, [play, reduced, src]);

  return (
    <section className="lv lv-hero" ref={ref} data-play={play} aria-labelledby="hero-title">
      <div className="lv-hero__film" aria-hidden="true">
        <div className="lv-hero__kb">
          <picture>
            <source type="image/webp" srcSet={hero.film.posterWebp} />
            <img src={hero.film.poster} alt="" width={1600} height={1066} fetchPriority="high" decoding="async" />
          </picture>
          {src && !reduced ? (
            <video ref={video} aria-hidden="true" src={src} poster={hero.film.poster} muted loop playsInline autoPlay preload="auto" disablePictureInPicture tabIndex={-1} />
          ) : null}
        </div>
      </div>
      <div className="lv-hero__shade" aria-hidden="true" />

      <div className="container lv-hero__inner">
        <div className="lv-hero__copy">
          <span className="lv-hero__badge enter">
            <span className="lv-livedot" aria-hidden="true" />
            {hero.eyebrow}
          </span>
          <h1 id="hero-title" className="lv-hero__title enter enter--2">
            {hero.title}
          </h1>
          <p className="lv-hero__lede enter enter--3">{hero.body}</p>
          <div className="lv-hero__ctas enter enter--3">
            <a href={hero.primary.href} className="btn btn--primary beam" onClick={(e) => go(e, hero.primary.href)}>
              {hero.primary.label}
            </a>
            <a href={hero.secondary.href} className="btn btn--secondary" onClick={(e) => go(e, hero.secondary.href)}>
              {hero.secondary.label}
            </a>
          </div>
          <p className="lv-hero__fine enter enter--3">{hero.fine}</p>
        </div>

        <div>
          <p className="lv-feed__label" id="hero-feed-label">
            {hero.feedLabel}
          </p>
          <ol className="lv-feed" aria-labelledby="hero-feed-label">
            {heroFeed.map((n, i) => (
              <li key={n.title} className={`lv-note lv-n${i + 1}${n.done ? " lv-note--done" : ""}`}>
                <span className={`lv-note__ico${n.icon === "live" || n.icon === "customer" ? " lv-note__ico--green" : ""}`}>{icons[n.icon]}</span>
                <span>
                  <span className="lv-note__t">{n.title}</span>
                  <span className="lv-note__b">{n.body}</span>
                </span>
                {n.eta ? <span className="lv-note__eta">{n.eta}</span> : <span className="lv-note__when">{n.when}</span>}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <PauseButton className="lv-hero__pause" />
    </section>
  );
}
