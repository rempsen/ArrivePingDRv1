import { useId, useState } from "react";
import { officeView } from "../config";
import { useLivePlay } from "./shared";

/**
 * For the office: the dispatcher's day on real ArrivePing screens (sample
 * company and data), with tabs to switch screens, then the three value
 * propositions from the hero pill as columns of what the office actually gets.
 */

export function OfficeView() {
  const { ref, play } = useLivePlay<HTMLElement>(0.2);
  const [tab, setTab] = useState(0);
  const uid = useId();
  const shots = officeView.shots;
  const shot = shots[tab] ?? shots[0];

  return (
    <section id="product" className="section section--divided anchor lv ap-office" ref={ref} data-play={play} aria-labelledby="office-title">
      <div className="container">
        <div className="ap-office__head" data-reveal="">
          <div>
            <span className="eyebrow">{officeView.eyebrow}</span>
            <h2 id="office-title" className="h-section">
              {officeView.title} <span className="h-muted">{officeView.titleMuted}</span>
            </h2>
          </div>
          <p className="lede">{officeView.body}</p>
        </div>

        <figure className="ap-office__stage" data-reveal="">
          <div className="ap-office__tabs" role="tablist" aria-label="ArrivePing office screens">
            {shots.map((s, i) => (
              <button
                key={s.label}
                type="button"
                role="tab"
                id={`${uid}-tab-${i}`}
                aria-selected={i === tab}
                aria-controls={`${uid}-panel`}
                tabIndex={i === tab ? 0 : -1}
                className="ap-office__tab"
                onClick={() => setTab(i)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                  e.preventDefault();
                  const n = (tab + (e.key === "ArrowRight" ? 1 : shots.length - 1)) % shots.length;
                  setTab(n);
                  document.getElementById(`${uid}-tab-${n}`)?.focus();
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="ap-office__window">
            <div className="ap-office__bar" aria-hidden="true">
              <span />
              <span />
              <span />
              <em>{shot.url}</em>
            </div>
            {/* On phones the screen keeps a readable size and pans sideways; the panel takes focus so keyboards can scroll it. */}
            <div className="ap-office__screens" role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`} tabIndex={0}>
              {shots.map((s, i) => (
                <img
                  key={s.src}
                  src={s.src}
                  width={s.width}
                  height={s.height}
                  alt={i === tab ? s.alt : ""}
                  aria-hidden={i === tab ? undefined : true}
                  className={i === tab ? "is-on" : undefined}
                  loading="lazy"
                  decoding="async"
                />
              ))}
            </div>
          </div>
          <figcaption className="ap-office__cap">
            <span>
              {shot.caption}
              <span className="ap-office__swipe"> Swipe to see the whole screen.</span>
            </span>
            <span className="ap-office__note">{officeView.shotsNote}</span>
          </figcaption>
        </figure>

        <div className="ap-office__pillars">
          {officeView.pillars.map((p, i) => (
            <div key={p.title} className="ap-office__pillar" data-reveal="" data-reveal-delay={String(i + 1)}>
              <h3>
                <span className="lv-livedot" aria-hidden="true" />
                {p.title}
              </h3>
              <ul>
                {p.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="ap-office__fit" data-reveal="">
          {officeView.fit}
        </p>
      </div>
    </section>
  );
}
