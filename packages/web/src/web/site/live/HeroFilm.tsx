import { useEffect, useRef, useState, type JSX } from "react";
import { hero } from "../config";
import { useAnchorNav } from "../components/SiteHeader";
import { usePlayback } from "../motion/playback";
import { PauseButton, useLivePlay } from "./shared";

/**
 * Hero. A film loop of a technician arriving at a home sits behind the copy;
 * in front, the same moment on real ArrivePing screens: Jordan's technician
 * app on the way, and on Dana's phone the on-the-way text and her live ETA.
 *
 * The copy answers the four buyer objections (hardware, setup time, training,
 * price) and states the trial terms before the buttons.
 */

type AssuranceIcon = (typeof hero.assurances)[number]["icon"];

const stroke = { stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const;

const assuranceIcons: Record<AssuranceIcon, JSX.Element> = {
  phone: (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="6" y="2" width="10" height="18" rx="2.5" {...stroke} />
      <path d="M9.5 16.8h3" {...stroke} />
    </svg>
  ),
  clock: (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r="8.5" {...stroke} />
      <path d="M11 6.5V11l3 2" {...stroke} />
    </svg>
  ),
  tap: (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M9 10.5V4.8a1.6 1.6 0 1 1 3.2 0v5.2l3.7.9a2 2 0 0 1 1.5 2.3l-.8 4.3a2 2 0 0 1-2 1.6H11a2 2 0 0 1-1.6-.8L6 14.3a1.5 1.5 0 0 1 2.1-2.1L9 13" {...stroke} />
    </svg>
  ),
  tag: (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M3 4.5V10l8.6 8.6a1.6 1.6 0 0 0 2.3 0l4.7-4.7a1.6 1.6 0 0 0 0-2.3L10 3H4.5A1.5 1.5 0 0 0 3 4.5z" {...stroke} />
      <circle cx="7.2" cy="7.2" r="1.3" fill="currentColor" />
    </svg>
  ),
};

export function HeroFilm() {
  const go = useAnchorNav();
  const { ref, play } = useLivePlay<HTMLElement>(0.1);
  const { reduced } = usePlayback();
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const d = hero.device;

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
            <video ref={video} aria-hidden="true" src={src} poster={hero.film.posterWebp} muted loop playsInline autoPlay preload="auto" disablePictureInPicture tabIndex={-1} />
          ) : null}
        </div>
      </div>
      <div className="lv-hero__shade" aria-hidden="true" />

      <div className="container lv-hero__inner">
        <div className="lv-hero__copy">
          <p className="lv-hero__badge enter">
            {hero.pillars.map((p, i) => (
              <span key={p} className="lv-hero__pillar">
                {i > 0 ? <span className={`lv-livedot lv-hero__sep lv-hero__sep--${i}`} aria-hidden="true" /> : null}
                {p}
              </span>
            ))}
          </p>
          <h1 id="hero-title" className="lv-hero__title enter enter--2">
            {hero.title}
          </h1>
          <p className="lv-hero__promise enter enter--3">
            {hero.promise.map((p) => (
              <span key={p.who}>
                <strong>{p.who}</strong> {p.rest}
              </span>
            ))}
          </p>

          <ul className="lv-assure enter enter--3">
            {hero.assurances.map((a) => (
              <li key={a.label}>
                <span className="lv-assure__ico">{assuranceIcons[a.icon]}</span>
                <span>
                  <strong>{a.label}</strong>
                  <span>{a.sub}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="lv-hero__act enter enter--3">
            <p className="lv-hero__risk">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="7.25" fill="rgb(16 185 129 / 18%)" stroke="#34d399" strokeWidth="1.5" />
                <path d="M5 8.2l2 1.9 4-4.1" fill="none" stroke="#34d399" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {hero.risk}
            </p>
            <div className="lv-hero__ctas">
              <a href={hero.primary.href} className="btn btn--primary beam" onClick={(e) => go(e, hero.primary.href)}>
                {hero.primary.label}
              </a>
              <a href={hero.secondary.href} className="btn btn--secondary" onClick={(e) => go(e, hero.secondary.href)}>
                {hero.secondary.label}
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M7 2.5v9M3 7.5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        <figure className="lv-stage" aria-labelledby="hero-stage-cap">
          <div className="lv-stage__tech ap-once">
            <span className="lv-stage__who">
              <span className="lv-stage__dot" aria-hidden="true" />
              {d.techLabel}
            </span>
            <div className="ap-phone ap-phone--hero">
              <img src={d.tech.src} width={d.tech.width} height={d.tech.height} alt={d.tech.alt} decoding="async" />
            </div>
          </div>

          <div className="lv-stage__cust">
            <span className="lv-stage__who lv-stage__who--cust ap-once">
              <span className="lv-stage__dot" aria-hidden="true" />
              {d.custLabel}
            </span>
            <div className="ap-notif lv-stage__notif ap-once">
              <span className="ap-notif__app" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 22 22">
                  <path d="M11 3.5c4.7 0 8.3 2.9 8.3 6.6s-3.6 6.6-8.3 6.6c-.9 0-1.8-.1-2.6-.3L4.6 18.3l1.1-3.4c-1.8-1.2-3-3-3-4.8 0-3.7 3.6-6.6 8.3-6.6z" fill="#fff" />
                </svg>
              </span>
              <div>
                <div className="ap-notif__row">
                  <strong className="ap-notif__from">{d.sms.from}</strong>
                  <span className="ap-notif__when">now</span>
                </div>
                <p className="ap-notif__body">{d.sms.body}</p>
              </div>
            </div>
            <img className="lv-stage__eta ap-once" src={d.eta.src} width={d.eta.width} height={d.eta.height} alt={d.eta.alt} decoding="async" />
          </div>

          <figcaption id="hero-stage-cap" className="lv-stage__cap">
            {d.caption}
          </figcaption>
        </figure>
      </div>

      <PauseButton className="lv-hero__pause" />
    </section>
  );
}
