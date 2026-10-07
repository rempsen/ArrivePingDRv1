import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { setupAgent } from "../config";
import { usePlayback } from "../motion/playback";
import { useLivePlay } from "./shared";

/**
 * Getting started — option 1: "Website in, workspace out".
 *
 * A scripted playback of the real onboarding (services/brand-scout.ts +
 * company-provisioning.ts): the agent reads a website, then the workspace
 * fills in — brand, trade and services, priced catalog, job templates and
 * forms, customer texts. It plays once when the section scrolls into view;
 * "Run setup agent" replays it with whatever website the visitor typed.
 * The result is a labelled sample; nothing is fetched.
 */

const STEP_GAP = 1.5; // seconds between agent steps
const delay = (s: number) => ({ "--lv-sa-d": `${s}s` }) as CSSProperties;

export function SetupAgent() {
  const { ref, play } = useLivePlay<HTMLElement>(0.3);
  const { reduced } = usePlayback();
  const [site, setSite] = useState(setupAgent.defaultSite);
  const [runSite, setRunSite] = useState(setupAgent.defaultSite);
  const [epoch, setEpoch] = useState(0);
  const [started, setStarted] = useState(false);

  // Start the first playback the first time the section is properly on screen.
  useEffect(() => {
    if (play === "on" && !started) setStarted(true);
  }, [play, started]);

  const onRun = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = site.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || setupAgent.defaultSite;
    setRunSite(cleaned);
    setStarted(true);
    setEpoch((n) => n + 1);
  };

  const state = reduced ? "is-done" : started ? "is-run" : "is-idle";
  const last = setupAgent.steps.length * STEP_GAP + 0.3;

  return (
    <section id="getting-started" className="section section--divided anchor lv" ref={ref} data-play={play} aria-labelledby="sa-title">
      <div className="container">
        <div className="lv-sa-head" data-reveal="">
          <div className="intro">
            <span className="eyebrow">{setupAgent.eyebrow}</span>
            <h2 id="sa-title" className="h-section">
              {setupAgent.title} <span className="h-muted">{setupAgent.titleMuted}</span>
            </h2>
          </div>
          <p className="lede">{setupAgent.body}</p>
        </div>

        <div key={epoch} className={`lv-sa ${state}`}>
          <div className="lv-sa-agent">
            <div className="lv-sa-brand">
              <span className="lv-sa-badge" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1.5l1.6 3.8 3.9.4-2.9 2.6.9 3.9L8 10.2l-3.5 2 .9-3.9L2.5 5.7l3.9-.4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                </svg>
              </span>
              ArrivePing setup agent
            </div>
            <form className="lv-sa-form" onSubmit={onRun}>
              <label htmlFor="sa-site" className="visually-hidden">
                Your website
              </label>
              <input id="sa-site" aria-label="Your website" className="lv-sa-input" type="text" inputMode="url" autoComplete="url" value={site} onChange={(e) => setSite(e.target.value)} />
              <button type="submit" className="btn btn--primary">
                {setupAgent.run}
              </button>
            </form>
            <ol className="lv-sa-log" aria-live="polite">
              {setupAgent.steps.map((s, i) => {
                const d = 0.3 + i * STEP_GAP;
                return (
                  <li key={i} className="lv-sa-row" style={delay(d)}>
                    <span className="lv-sa-ico" aria-hidden="true">
                      <span className="lv-sa-spin" />
                      <svg className="lv-sa-check" width="18" height="18" viewBox="0 0 18 18" fill="none">
                        <circle cx="9" cy="9" r="8" fill="rgb(16 185 129 / 16%)" />
                        <path d="M5.5 9.3l2.3 2.2 4.7-4.8" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span>{s.text(runSite)}</span>
                    <span className="lv-sa-time tnum">{s.t}</span>
                  </li>
                );
              })}
              <li className="lv-sa-row lv-sa-row--done" style={delay(last)}>
                <span className="lv-sa-ico" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <circle cx="9" cy="9" r="8" fill="#10b981" />
                    <path d="M5.5 9.3l2.3 2.2 4.7-4.8" stroke="#04261b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span>{setupAgent.done.text}</span>
                <span className="lv-sa-time tnum">{setupAgent.done.t}</span>
              </li>
            </ol>
            <a href={setupAgent.cta.href} className="btn btn--secondary lv-sa-cta">
              {setupAgent.cta.label}
            </a>
          </div>

          <div className="lv-sa-ws">
            <div className="lv-sa-ws__bar">
              <span className="lv-sa-logo lv-sa-tile" style={delay(1.8)} aria-hidden="true" />
              <strong>Your workspace</strong>
              <span className="lv-sa-ws__site">{runSite}</span>
              <span className="lv-sa-ws__tag">Sample result</span>
            </div>
            <div className="lv-sa-grid">
              <div className="lv-sa-card lv-sa-tile" style={delay(1.8 + 1)}>
                <span className="lv-sa-k">Brand</span>
                <div className="lv-sa-brandrow">
                  <span className="lv-sa-sw" style={{ background: "#0ea5e9" }} />
                  <span className="lv-sa-sw" style={{ background: "#f59e0b" }} />
                  <span>Logo and colors on every text, email and tracking page</span>
                </div>
              </div>
              <div className="lv-sa-card lv-sa-tile" style={delay(0.3 + 3 * STEP_GAP + 1)}>
                <span className="lv-sa-k">Trade · services</span>
                <div className="lv-sa-chips">
                  {["HVAC & Plumbing", "Furnace repair", "AC tune-up", "Water heaters", "+4"].map((c) => (
                    <span key={c} className="lv-sa-chip">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
              <div className="lv-sa-card lv-sa-tile" style={delay(0.3 + 4 * STEP_GAP + 1)}>
                <span className="lv-sa-k">Priced catalog</span>
                <span className="lv-sa-big">34 items</span>
                <span className="lv-sa-sub">Parts, labour and good / better / best options for your trade</span>
              </div>
              <div className="lv-sa-card lv-sa-tile" style={delay(0.3 + 5 * STEP_GAP + 1)}>
                <span className="lv-sa-k">Job templates · intake forms</span>
                <span className="lv-sa-big">5 · 3</span>
                <span className="lv-sa-sub">Checklists, time estimates and online booking forms</span>
              </div>
              <div className="lv-sa-card lv-sa-card--wide lv-sa-tile" style={delay(0.3 + 6 * STEP_GAP + 1)}>
                <span className="lv-sa-k">Customer texts, in your voice</span>
                <span className="lv-sa-bubble">Hi Dana, Marcus from Prairie Comfort is on the way for your furnace call. Track him live: arriveping.app/t/7k2q</span>
              </div>
            </div>
          </div>
        </div>
        <p className="lv-story-foot">{setupAgent.note}</p>
      </div>
    </section>
  );
}
