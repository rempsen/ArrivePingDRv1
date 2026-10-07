import { benefits, bento } from "../config";
import { Fleet, PeopleAndAssets, StreetMap, useLivePlay } from "./shared";

/**
 * B · Live ops bento. The five capabilities as five live tiles; a highlight
 * passes through them in order (12.5 s loop) so the sequence still reads
 * while everything is visible at once.
 */
export function OpsBento() {
  const { ref, play } = useLivePlay<HTMLElement>();
  return (
    <section id="platform" className="section--tight lv anchor" ref={ref} data-play={play} aria-labelledby="bento-title">
      <div className="container">
        <div className="lv-bento__head" data-reveal="">
          <div className="intro">
            <span className="eyebrow">{bento.eyebrow}</span>
            <h2 id="bento-title" className="h-section">
              {bento.title} <span className="h-muted">{bento.titleMuted}</span>
            </h2>
          </div>
          <p className="lede" style={{ maxWidth: 420 }}>
            {bento.body}
          </p>
        </div>

        <div className="lv-grid">
          <article className="lv-tile lv-tile--wide">
            <h3 className="lv-tile__tag">
              <span className="lv-num">1</span>Real-time visibility
              <span className="lv-tile__sub">
                <span className="lv-livedot" aria-hidden="true" />
                Technicians · drivers · assets
              </span>
            </h3>
            <div className="lv-mapbox" aria-hidden="true">
              <svg viewBox="820 60 760 400" preserveAspectRatio="xMidYMid slice" focusable="false">
                <StreetMap labels={false} />
                <PeopleAndAssets people={[[1280, 300], [1160, 120], [905, 400], [1505, 230]]} assets={[[1025, 325], [1520, 420], [880, 270]]} />
                <Fleet loops={[2, 3, 5, 6, 8, 9]} />
                <g transform="translate(1364 451)">
                  <circle r={20} fill="#10b981" opacity={0.25} />
                  <circle r={12} fill="#10b981" />
                </g>
              </svg>
            </div>
            <p className="lv-tile__body">Every technician, driver and piece of equipment on one live map, so the office always knows who is where.</p>
          </article>

          <article className="lv-tile">
            <h3 className="lv-tile__tag">
              <span className="lv-num">2</span>Custom work orders
              <span className="lv-tile__sub">WO-4821</span>
            </h3>
            <div className="lv-field"><b>Job</b><span className="lv-val lv-t1">No heat · furnace</span></div>
            <div className="lv-field"><b>Skills</b><span className="lv-val lv-t2">Gas fitter</span></div>
            <div className="lv-field"><b>Window</b><span className="lv-val lv-t3">Today 9:00–11:00 AM</span></div>
            <div className="lv-field"><b>Priority</b><span className="lv-val lv-t4" style={{ color: "#fbbf24" }}>Urgent</span></div>
            <div className="lv-field"><b>Access</b><span className="lv-val">Gate 4417 · side door</span></div>
          </article>

          <article className="lv-tile">
            <h3 className="lv-tile__tag">
              <span className="lv-num">3</span>Auto-assignment
              <span className="lv-tile__sub">distance · skills · availability</span>
            </h3>
            <div className="lv-row">
              <span className="lv-av" aria-hidden="true">MT</span>
              <div style={{ minWidth: 0 }}>
                <div className="lv-row__name">Marcus T. · 0.9 km</div>
                <div className="lv-track"><div className="lv-fill" style={{ width: "96%", background: "var(--accent)" }} /></div>
              </div>
              <span className="lv-best">BEST MATCH</span>
            </div>
            <div className="lv-row lv-row--dim">
              <span className="lv-av" aria-hidden="true">DK</span>
              <div style={{ minWidth: 0 }}>
                <div className="lv-row__name">Dev K. · 0.4 km</div>
                <div className="lv-track"><div className="lv-fill" style={{ width: "64%", background: "#64748b" }} /></div>
              </div>
              <span className="lv-flag" style={{ color: "#fcd34d" }}>On a job</span>
            </div>
            <div className="lv-row lv-row--dim">
              <span className="lv-av" aria-hidden="true">PS</span>
              <div style={{ minWidth: 0 }}>
                <div className="lv-row__name">Priya S. · 0.5 km</div>
                <div className="lv-track"><div className="lv-fill" style={{ width: "38%", background: "#64748b" }} /></div>
              </div>
              <span className="lv-flag" style={{ color: "#fca5a5" }}>No gas ticket</span>
            </div>
          </article>

          <article className="lv-tile">
            <h3 className="lv-tile__tag">
              <span className="lv-num">4</span>Straight to the tech's app
            </h3>
            <div className="lv-phone">
              <div className="lv-notif">
                <span className="lv-kicker">NEW JOB · WO-4821</span>
                <span className="lv-notif__title">No heat · furnace</span>
                <span className="lv-notif__meta">214 Waverley St · gate 4417 · side door</span>
                <span className="lv-notif__meta">Dana R. · today 9:00–11:00 AM</span>
                <span className="lv-accept" aria-hidden="true">
                  <span className="lv-accept__go">Accept job</span>
                  <span className="lv-accept__done">Accepted · navigating</span>
                </span>
              </div>
            </div>
          </article>

          <article className="lv-tile">
            <h3 className="lv-tile__tag">
              <span className="lv-num">5</span>Customer live ETA
              <span className="lv-tile__sub">
                <span className="lv-livedot" aria-hidden="true" />
                Live
              </span>
            </h3>
            <div style={{ position: "relative", flex: "1 1 auto", display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="lv-toast" aria-hidden="true">
                <b style={{ color: "#fff" }}>Prairie Comfort HVAC</b>
                <br />
                Marcus is on the way. Track live.
              </div>
              <svg viewBox="0 0 220 84" preserveAspectRatio="xMidYMid slice" width="100%" height="84" aria-hidden="true" focusable="false" style={{ display: "block", borderRadius: 10, background: "#0a1320" }}>
                <path d="M0 30H220M0 64H220M50 0V84M120 0V84M180 0V84" stroke="#16283d" strokeWidth={5} />
                <path d="M50 8 V64 H180 L196 74" fill="none" stroke="#38bdf8" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
                <circle cx={196} cy={74} r={6} fill="#10b981" />
                <g transform="translate(50 10)">
                  <g className="lv-minivan">
                    <circle r={5} fill="#38bdf8" />
                  </g>
                </g>
              </svg>
              <div className="lv-eta-row">
                <span className="lv-eta-big">3 min</span>
                <span className="lv-eta-meta">
                  <b>~9:14 AM</b>
                  <br />
                  0.9 km away
                </span>
              </div>
              <div className="lv-cta2" aria-hidden="true">
                <span style={{ background: "var(--action-solid)", color: "#fff" }}>Text Marcus</span>
                <span style={{ background: "#10b981", color: "#04261b" }}>Call</span>
              </div>
            </div>
          </article>
        </div>

        <div className="lv-proof">
          {benefits.map((b) => (
            <p key={b.stat}>{b.stat}</p>
          ))}
        </div>
      </div>
    </section>
  );
}
