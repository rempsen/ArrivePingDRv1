import { useEffect, useId, useState, type CSSProperties } from "react";
import { techApp } from "../config";
import { usePlayback } from "../motion/playback";
import { PauseButton, useLivePlay } from "./shared";

/**
 * "Accept. Drive. Arrive. Done." The technician side, shown with the app's
 * buttons and two real screens. Selecting a step brings the screen where it
 * happens to the front and marks the spot. While the section is on screen the
 * steps advance on their own; hovering pauses that, and focusing or picking a
 * step (or Pause motion under the phones) stops it.
 */

const STEP_MS = 3800;

export function TechApp() {
  const { ref, play } = useLivePlay<HTMLElement>(0.35);
  const { reduced } = usePlayback();
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(false);
  const [hover, setHover] = useState(false);
  const uid = useId();
  const auto = play === "on" && !reduced && !touched && !hover;

  useEffect(() => {
    if (!auto) return;
    const t = window.setInterval(() => setActive((a) => (a + 1) % techApp.taps.length), STEP_MS);
    return () => window.clearInterval(t);
  }, [auto]);

  const tap = techApp.taps[active];
  const pick = (i: number) => {
    setTouched(true);
    setActive(i);
  };

  return (
    <section id="technician-app" className="section section--divided anchor lv ap-tech" ref={ref} data-play={play} aria-labelledby="tech-title">
      <div className="container ap-tech__grid">
        <div className="ap-tech__copy">
          <div className="ap-tech__head" data-reveal="">
            <span className="eyebrow">{techApp.eyebrow}</span>
            <h2 id="tech-title" className="h-section">
              {techApp.title} <span className="h-muted">{techApp.titleMuted}</span>
            </h2>
            <p className="lede">{techApp.body}</p>
          </div>

          <ol
            className="ap-taps"
            data-reveal=""
            data-reveal-delay="1"
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onFocus={() => setTouched(true)}
          >
            {techApp.taps.map((t, i) => (
              <li key={t.title}>
                <button
                  type="button"
                  className="ap-tap"
                  aria-current={i === active ? "step" : undefined}
                  aria-labelledby={`${uid}-t${i}`}
                  aria-describedby={`${uid}-b${i}`}
                  onClick={() => pick(i)}
                >
                  <span className="ap-tap__n tnum" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="ap-tap__btn">
                    <img src={t.button.src} width={t.button.width} height={t.button.height} alt="" loading="lazy" decoding="async" />
                  </span>
                  <span className="ap-tap__t" id={`${uid}-t${i}`}>
                    {t.title}
                  </span>
                  <span className="ap-tap__b" id={`${uid}-b${i}`}>
                    {t.body}
                  </span>
                  {auto && i === active ? <span className="ap-tap__timer" aria-hidden="true" key={`t-${active}`} /> : null}
                </button>
              </li>
            ))}
          </ol>

          <ul className="ap-facts" data-reveal="" data-reveal-delay="2">
            {techApp.facts.map((f, i) => (
              <li key={f.title}>
                {i === 0 ? (
                  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                    <rect x="5.5" y="2" width="9" height="16" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M2 2l16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                    <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M10 5.8V10l2.8 1.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                )}
                <span>
                  <strong>{f.title}</strong>
                  <span>{f.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <figure className="ap-tech__stage" aria-labelledby="tech-cap">
          <div className="ap-tech__phones" data-front={tap.screen}>
            {techApp.screens.map((s, i) => (
              <div key={s.src} className={`ap-phone ap-tech__phone ap-tech__phone--${i}`}>
                <div className="ap-phone__screen">
                  <img src={s.src} width={s.width} height={s.height} alt={s.alt} loading="lazy" decoding="async" />
                  {i === tap.screen && tap.spot ? (
                    <span
                      key={`spot-${active}`}
                      className="ap-tech__spot"
                      aria-hidden="true"
                      style={{ "--x": `${tap.spot.x}%`, "--y": `${tap.spot.y}%`, "--w": `${tap.spot.w}%`, "--h": `${tap.spot.h}%` } as CSSProperties}
                    />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <div className="ap-tech__foot">
            <figcaption id="tech-cap" className="ap-tech__cap">
              {techApp.caption}
            </figcaption>
            <PauseButton />
          </div>
        </figure>
      </div>
    </section>
  );
}
