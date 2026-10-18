import { firstHour } from "../config";
import { SetupAgent } from "./SetupAgent";
import { useLivePlay } from "./shared";

/**
 * Getting started — one section, led by the first-hour dial.
 *
 * A 60-minute dial fills as the setup milestones light up (16 s loop, six
 * equal windows). Below it the setup agent demo is the proof, then the trial
 * and price. (Tools and data formats moved to the Integrations section.)
 * Milestone k uses a negative delay so its active window lines up with the
 * dial: delay = -(16 - k × 16/6) s.
 */
const LOOP = 16;

export function FirstHour() {
  const { ref, play } = useLivePlay<HTMLDivElement>();
  const n = firstHour.milestones.length;
  return (
    <section id="getting-started" className="section section--divided anchor lv lv-fh" aria-labelledby="fh-title">
      <div className="container">
        <div className="lv-fh-head" data-reveal="">
          <div className="intro">
            <span className="eyebrow">{firstHour.eyebrow}</span>
            <h2 id="fh-title" className="h-section">
              {firstHour.title} <span className="h-muted">{firstHour.titleMuted}</span>
            </h2>
          </div>
          <p className="lede">{firstHour.body}</p>
        </div>

        <div className="lv-fh-main" ref={ref} data-play={play}>
          <svg className="lv-fh-dial" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
            <circle cx="200" cy="200" r="190" fill="var(--surface)" stroke="rgb(255 255 255 / 8%)" />
            <g stroke="rgb(255 255 255 / 18%)" strokeWidth="2">
              <line x1="200" y1="22" x2="200" y2="34" />
              <line x1="378" y1="200" x2="366" y2="200" />
              <line x1="200" y1="378" x2="200" y2="366" />
              <line x1="22" y1="200" x2="34" y2="200" />
            </g>
            <circle cx="200" cy="200" r="160" fill="none" stroke="#14233a" strokeWidth="16" />
            <circle className="lv-fh-arc" cx="200" cy="200" r="160" fill="none" stroke="var(--accent)" strokeWidth="16" strokeLinecap="round" transform="rotate(-90 200 200)" />
            <g className="lv-fh-hand">
              <line x1="200" y1="200" x2="200" y2="58" stroke="#e2e8f0" strokeWidth="3" strokeLinecap="round" />
            </g>
            <circle cx="200" cy="200" r="7" fill="#e2e8f0" />
            <text x="200" y="250" textAnchor="middle" className="lv-disp" fill="#fff" fontSize="44" fontWeight="700">
              {"< 60 min"}
            </text>
            <text x="200" y="280" textAnchor="middle" fill="#8a97ad" fontSize="15">
              to your first dispatched job
            </text>
          </svg>

          <ol className="lv-fh-list">
            {firstHour.milestones.map((m, k) => (
              <li key={m.title} className="lv-fh-ms" style={{ animationDelay: k === 0 ? "0s" : `-${(LOOP - (k * LOOP) / n).toFixed(2)}s` }}>
                <b className="tnum">{m.at}</b>
                <div>
                  <strong>{m.title}</strong>
                  <span>{m.body}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <p className="lv-fh-note">{firstHour.note}</p>

        <div className="lv-fh-demo">
          <div className="lv-fh-demo__head" data-reveal="">
            <h3>{firstHour.demo.title}</h3>
            <p>{firstHour.demo.body}</p>
          </div>
          <SetupAgent />
        </div>

        <div className="lv-fh-cta" data-reveal="">
          <div>
            <p className="lv-fh-cta__price">{firstHour.cta.price}</p>
            <p className="lv-fh-cta__detail">{firstHour.cta.detail}</p>
          </div>
          <a href={firstHour.cta.href} className="btn btn--primary beam">
            {firstHour.cta.label}
          </a>
        </div>
      </div>
    </section>
  );
}
