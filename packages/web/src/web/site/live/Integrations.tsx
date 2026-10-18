import type { JSX } from "react";
import { integrations } from "../config";
import { useAnchorNav } from "../components/SiteHeader";
import { useLivePlay } from "./shared";
import { IntegrationTrace } from "./IntegrationTrace";

/**
 * Integrations — what connects today, and an open door for the rest.
 * Light section (like "What your customer sees"); the custom-integration panel
 * is the dark, emphasised card, with a small connector animation.
 */

type Icon = (typeof integrations.works)[number]["icon"];
const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const icons: Record<Icon, JSX.Element> = {
  zap: (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M12.5 2.5L4.5 12.5h6l-1 7 8-10h-6z" {...s} />
    </svg>
  ),
  hook: (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="6" cy="15.5" r="2.5" {...s} />
      <circle cx="16" cy="15.5" r="2.5" {...s} />
      <circle cx="11" cy="6" r="2.5" {...s} />
      <path d="M9.8 8.2L7.2 13.3M12.2 8.2l2.6 5.1M8.5 15.5h5" {...s} />
    </svg>
  ),
  calendar: (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="3" y="4.5" width="16" height="14" rx="2.5" {...s} />
      <path d="M3 9h16M7.5 2.5v4M14.5 2.5v4M7 13h2.5M12.5 13H15" {...s} />
    </svg>
  ),
  card: (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="2.5" y="5" width="17" height="12" rx="2.5" {...s} />
      <path d="M2.5 9h17M6 13.5h3.5" {...s} />
    </svg>
  ),
  sheet: (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="3.5" y="2.5" width="15" height="17" rx="2.5" {...s} />
      <path d="M3.5 8h15M3.5 13.5h15M9.5 2.5v17" {...s} />
    </svg>
  ),
  ai: (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M11 2.8l1.7 4.4 4.5 1.7-4.5 1.7L11 15l-1.7-4.4-4.5-1.7 4.5-1.7z" {...s} />
      <path d="M17 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" {...s} />
    </svg>
  ),
};

export function Integrations() {
  const go = useAnchorNav();
  const { ref, play } = useLivePlay<HTMLDivElement>(0.3);
  const c = integrations.custom;
  return (
    <section id="integrations" className="ap-int anchor" aria-labelledby="int-title">
      <div className="container">
        <div className="ap-int__head" data-reveal="">
          <div>
            <span className="eyebrow">{integrations.eyebrow}</span>
            <h2 id="int-title" className="h-section">
              {integrations.title} <span className="h-muted">{integrations.titleMuted}</span>
            </h2>
          </div>
          <p className="lede">{integrations.body}</p>
        </div>

        <ul className="ap-int__grid">
          {integrations.works.map((w, i) => (
            <li key={w.title} className="ap-int__tile" data-reveal="" data-reveal-delay={String((i % 3) + 1)}>
              <span className="ap-int__ico">{icons[w.icon]}</span>
              <h3>{w.title}</h3>
              <p>{w.body}</p>
            </li>
          ))}
        </ul>

        <div className="ap-int__custom lv" ref={ref} data-play={play} data-reveal="">
          <div className="ap-int__customcopy">
            <h3>{c.title}</h3>
            <p>{c.body}</p>
            <ul className="ap-int__points">
              {c.points.map((p) => (
                <li key={p}>
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3.5 8.4l2.8 2.7 6.2-6.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {p}
                </li>
              ))}
            </ul>
            <div className="ap-int__ctas">
              <a href={c.cta.href} className="btn btn--primary">
                {c.cta.label}
              </a>
              <a href={c.secondary.href} className="btn btn--secondary" onClick={(e) => go(e, c.secondary.href)}>
                {c.secondary.label}
              </a>
            </div>
          </div>

          {/* ArrivePing → your system: a job event goes out as a webhook and is acknowledged */}
          <div className="ap-int__link" aria-hidden="true">
            <IntegrationTrace play={play} />
          </div>
        </div>
      </div>
    </section>
  );
}
