import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { setupFilm as F } from "../config";
import { usePlayback } from "../motion/playback";
import { useLivePlay } from "./shared";

/**
 * The setup film: the real onboarding agent, acted out on a made-up plumber.
 *
 * Left, their website; right, the ArrivePing workspace it becomes. A camera
 * pushes in on each thing the agent reads (logo, colours, address, trade,
 * their words, services, team), tags it like motion capture, and the piece
 * flies across into the workspace. The agent's own questions and answers run
 * underneath, against a clock that reaches the real ~2 minutes.
 *
 * It plays once when it is properly on screen, holds while off screen or
 * paused, and can be replayed. Without JavaScript, with reduced motion, or
 * paused before it starts, it shows the finished workspace. Every beat is
 * something the agent does today (see setupFilm in config.ts).
 */

type Focus = "overview" | "logo" | "colors" | "address" | "words" | "services" | "team";
type Line = keyof typeof F.lines;
type Slot = "logo" | "name" | "c1" | "c2" | "where" | "area" | "trade" | "staff" | "work" | "svc" | "catalog" | "team" | "templates" | "text";

type State = {
  typed: number;
  pressed: boolean;
  loaded: boolean;
  read: number;
  focus: Focus;
  mark: string | null;
  tag: string;
  drops: boolean;
  line: Line | null;
  clock: string;
  on: Partial<Record<Slot, boolean>>;
  svc: number;
  team: number;
  count: number;
  nouns: boolean;
  skin: boolean;
  done: boolean;
};

const ALL: Record<Slot, boolean> = { logo: true, name: true, c1: true, c2: true, where: true, area: true, trade: true, staff: true, work: true, svc: true, catalog: true, team: true, templates: true, text: true };
const FINAL: State = {
  typed: F.site.length,
  pressed: true,
  loaded: true,
  read: F.pages.length,
  focus: "overview",
  mark: null,
  tag: "",
  drops: false,
  line: "done",
  clock: "1:52",
  on: ALL,
  svc: F.services.length,
  team: F.team.length,
  count: F.catalogItems,
  nouns: true,
  skin: true,
  done: true,
};
const START: State = { ...FINAL, typed: 0, pressed: false, loaded: false, read: 0, line: null, clock: "0:00", on: {}, svc: 0, team: 0, count: 0, nouns: false, skin: false, done: false };

/** A flight: something lifts off their website and lands in the workspace. */
type Fly = { from: string; to: string; token: string; land: Partial<State> | ((s: State) => Partial<State>); delay?: number };
type Cue = { t: number; set?: Partial<State> | ((s: State) => Partial<State>); fly?: Fly[]; count?: boolean };

const swatch = (c: string) => `<span class="sf-tok-sw" style="background:${c}"></span>`;
const chip = (text: string, cls = "") => `<span class="sf-tok-chip ${cls}">${text}</span>`;

// Seconds of film. The clock shows the real elapsed time of a typical run.
const CUES: Cue[] = [
  { t: 0.3, set: { typed: 1 } },
  ...Array.from({ length: F.site.length - 1 }, (_, i) => ({ t: 0.3 + (i + 1) * 0.055, set: { typed: i + 2 } })),
  { t: 1.65, set: { pressed: true, line: "read", clock: "0:02" } },
  { t: 1.95, set: { loaded: true } },
  ...F.pages.map((_, i) => ({ t: 2.2 + i * 0.22, set: { read: i + 1, clock: `0:0${Math.min(9, 3 + i)}` } })),
  { t: 3.7, set: { focus: "logo", mark: "logo", tag: "Logo", line: "logo", clock: "0:14" } },
  {
    t: 4.9,
    fly: [
      { from: "logo-mark", to: "logo", token: "logo", land: { on: { logo: true } } },
      { from: "logo-word", to: "name", token: "name", land: (s) => ({ on: { ...s.on, name: true } }), delay: 0.12 },
    ],
  },
  { t: 5.9, set: { focus: "colors", mark: null, drops: true, line: "colors", clock: "0:17" } },
  {
    t: 6.9,
    fly: [
      { from: "drop-1", to: "c1", token: swatch(F.colors.primary), land: (s) => ({ on: { ...s.on, c1: true } }) },
      { from: "drop-2", to: "c2", token: swatch(F.colors.accent), land: (s) => ({ on: { ...s.on, c2: true } }), delay: 0.12 },
    ],
  },
  { t: 7.9, set: { focus: "address", mark: "address", tag: "Address", drops: false, line: "address", clock: "0:22" } },
  {
    t: 9.0,
    fly: [
      { from: "address", to: "where", token: chip(F.address, "sf-tok-chip--pin"), land: (s) => ({ on: { ...s.on, where: true } }) },
      { from: "area", to: "area", token: chip(F.serviceArea), land: (s) => ({ on: { ...s.on, area: true } }), delay: 0.15 },
    ],
  },
  { t: 10.0, set: { focus: "words", mark: "trade-word", tag: "Trade", line: "trade", clock: "0:31" } },
  { t: 11.2, fly: [{ from: "trade-word", to: "trade", token: chip("Plumbing", "sf-tok-chip--trade"), land: (s) => ({ on: { ...s.on, trade: true } }) }] },
  { t: 12.0, set: { mark: "words", tag: "Their words", line: "words", clock: "0:38" } },
  {
    t: 13.1,
    fly: [
      { from: "word-staff", to: "staff", token: chip("Plumbers"), land: (s) => ({ on: { ...s.on, staff: true }, nouns: true }) },
      { from: "word-work", to: "work", token: chip("Jobs"), land: (s) => ({ on: { ...s.on, work: true } }), delay: 0.15 },
    ],
  },
  { t: 14.1, set: { focus: "services", mark: "services", tag: "8 services", line: "services", clock: "0:48" } },
  {
    t: 15.0,
    fly: F.services.map((name, i) => ({ from: `svc-${i}`, to: `svc-${i}`, token: chip(name), delay: i * 0.08, land: (s: State) => ({ svc: Math.max(s.svc, i + 1), on: { ...s.on, svc: true } }) })),
  },
  { t: 15.9, count: true, set: (s) => ({ on: { ...s.on, catalog: true } }) },
  { t: 16.9, set: { focus: "team", mark: "team", tag: "Team page", line: "team", clock: "1:02" } },
  {
    t: 17.9,
    fly: F.team.map((p, i) => ({ from: `team-${i}`, to: `team-${i}`, token: `<span class="sf-tok-av sf-av--${i}">${p.name[0]}</span>`, delay: i * 0.12, land: (s: State) => ({ team: Math.max(s.team, i + 1), on: { ...s.on, team: true } }) })),
  },
  { t: 19.0, set: { focus: "overview", mark: null, line: "joke", clock: "1:20" } },
  { t: 19.8, set: (s) => ({ on: { ...s.on, templates: true } }) },
  { t: 20.6, set: (s) => ({ line: "texts", clock: "1:44", on: { ...s.on, text: true } }) },
  { t: 22.2, set: { skin: true, line: "done", clock: "1:52", done: true } },
];
const END = 23;

const ZOOM: Record<Focus, number> = { overview: 1, logo: 2.3, colors: 1, address: 1.9, words: 1.7, services: 1, team: 1.6 };
const PAGE_W = 760;

export function SetupFilm() {
  const { ref, play } = useLivePlay<HTMLDivElement>(0.35);
  const { reduced, paused } = usePlayback();
  const [mounted, setMounted] = useState(false);
  const [started, setStarted] = useState(false);
  const [run, setRun] = useState(0);
  const [s, setS] = useState<State>(FINAL);
  const stage = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const ws = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const clockT = useRef(0);
  const next = useRef(0);
  const [base, setBase] = useState(0.8);

  useEffect(() => setMounted(true), []);

  // The website is designed 760 px wide and scaled to fit its pane.
  useLayoutEffect(() => {
    const v = view.current;
    if (!v) return;
    const fit = () => setBase(v.clientWidth / PAGE_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(v);
    return () => ro.disconnect();
  }, []);

  const motion = mounted && !reduced;
  const live = motion && started && !s.done;

  // First time it's properly on screen (and motion is allowed): roll from the top.
  useEffect(() => {
    if (!motion || started || paused || play !== "on") return;
    setStarted(true);
    setRun((n) => n + 1);
  }, [motion, started, paused, play]);

  useEffect(() => {
    if (!run) return;
    clockT.current = 0;
    next.current = 0;
    layer.current?.replaceChildren();
    setS(START);
  }, [run]);

  const flyOne = useCallback((f: Fly) => {
    const st = stage.current;
    const src = page.current?.querySelector<HTMLElement>(`[data-k="${f.from}"]`);
    const dst = ws.current?.querySelector<HTMLElement>(`[data-slot="${f.to}"]`);
    const lay = layer.current;
    const apply = () => setS((cur) => ({ ...cur, ...(typeof f.land === "function" ? f.land(cur) : f.land) }));
    if (!st || !src || !dst || !lay || typeof lay.animate !== "function") return apply();
    const S = st.getBoundingClientRect();
    const a = src.getBoundingClientRect();
    const b = dst.getBoundingClientRect();
    const tok = document.createElement("div");
    tok.className = `sf-tok sf-tok--${f.token === "logo" || f.token === "name" ? f.token : "x"}`;
    if (f.token === "logo") tok.innerHTML = page.current!.querySelector('[data-k="logo-mark"]')!.innerHTML;
    else if (f.token === "name") tok.textContent = F.company;
    else tok.innerHTML = f.token;
    Object.assign(tok.style, { left: `${b.left - S.left}px`, top: `${b.top - S.top}px`, width: `${b.width}px`, height: `${b.height}px` });
    lay.appendChild(tok);
    const k = Math.max(0.35, Math.min(3, a.width / Math.max(1, b.width)));
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    const lift = Math.min(90, Math.abs(dx) * 0.18 + 30);
    const anim = tok.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${k})`, opacity: 0, filter: "drop-shadow(0 0 0 rgb(56 189 248 / 0%))" },
        { offset: 0.12, opacity: 1 },
        { offset: 0.5, transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) scale(${(k + 1) / 2 + 0.12})`, filter: "drop-shadow(0 0 14px rgb(56 189 248 / 85%))" },
        { transform: "translate(0, 0) scale(1)", opacity: 1, filter: "drop-shadow(0 0 0 rgb(56 189 248 / 0%))" },
      ],
      { duration: 950, delay: (f.delay ?? 0) * 1000, easing: "cubic-bezier(.55,0,.2,1)", fill: "both" },
    );
    anim.onfinish = () => {
      apply();
      tok.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: "forwards" }).onfinish = () => tok.remove();
    };
  }, []);

  // The film's clock: advances only while on screen, playing and not paused.
  useEffect(() => {
    if (!live || play !== "on" || paused) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      clockT.current += Math.min(0.1, (now - last) / 1000);
      last = now;
      while (next.current < CUES.length && CUES[next.current].t <= clockT.current) {
        const c = CUES[next.current++];
        if (c.set) setS((cur) => ({ ...cur, ...(typeof c.set === "function" ? c.set(cur) : c.set) }));
        if (c.count) countUp();
        c.fly?.forEach(flyOne);
      }
      if (clockT.current < END) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, play, paused, flyOne]);

  const countUp = () => {
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 1300);
      setS((cur) => ({ ...cur, count: Math.round(F.catalogItems * (1 - Math.pow(1 - p, 3))) }));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // Camera: push in on the thing being read, never showing past the page edges.
  useLayoutEffect(() => {
    const v = view.current;
    const p = page.current;
    if (!v || !p) return;
    const vw = v.clientWidth;
    const vh = v.clientHeight;
    const z = base * ZOOM[s.focus];
    let tx = 0;
    let ty = 0;
    const el = s.focus === "overview" ? null : p.querySelector<HTMLElement>(`[data-k="${s.focus}"]`);
    if (el) {
      let x = 0;
      let y = 0;
      let n: HTMLElement | null = el;
      while (n && n !== p) {
        x += n.offsetLeft;
        y += n.offsetTop;
        n = n.offsetParent as HTMLElement | null;
      }
      tx = vw / 2 - (x + el.offsetWidth / 2) * z;
      ty = vh / 2 - (y + el.offsetHeight / 2) * z;
      tx = Math.min(0, Math.max(vw - PAGE_W * z, tx));
      ty = Math.min(0, Math.max(vh - p.offsetHeight * z, ty));
    }
    p.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
    p.style.setProperty("--z", String(z));
  }, [s.focus, base]);

  // The highlight box follows the marked element on the page.
  const [markBox, setMarkBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const p = page.current;
    const el = s.mark ? p?.querySelector<HTMLElement>(`[data-k="${s.mark}"]`) : null;
    if (!p || !el) return setMarkBox(null);
    let x = 0;
    let y = 0;
    let n: HTMLElement | null = el;
    while (n && n !== p) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent as HTMLElement | null;
    }
    setMarkBox({ x: x - 6, y: y - 6, w: el.offsetWidth + 12, h: el.offsetHeight + 12 });
  }, [s.mark, base]);

  const replay = () => {
    setStarted(true);
    setRun((n) => n + 1);
  };

  const L = s.line ? (F.lines[s.line] as { q?: string; a: string }) : null;
  const typedSite = F.site.slice(0, s.typed);
  const on = (k: Slot) => (s.on[k] ? "true" : "false");

  return (
    <figure className="sf" aria-labelledby="sf-cap" style={{ "--bs-1": F.colors.primary, "--bs-2": F.colors.accent } as CSSProperties}>
      <div
        ref={(n) => {
          (ref as { current: HTMLDivElement | null }).current = n;
          stage.current = n;
        }}
        className={`lv sf-stage${s.loaded ? " is-loaded" : ""}${s.skin ? " is-skinned" : ""}${s.done ? " is-done" : ""}${live ? " is-live" : ""}`}
        data-play={play}
        aria-hidden="true"
      >
        {/* The agent: paste a website, build a workspace. */}
        <div className="sf-bar">
          <span className="sf-bar__agent">
            <span className="sf-bar__spark">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 1.5l1.6 3.8 3.9.4-2.9 2.6.9 3.9L8 10.2l-3.5 2 .9-3.9L2.5 5.7l3.9-.4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </span>
            ArrivePing setup agent
          </span>
          <span className={`sf-bar__field${s.typed && !s.pressed ? " is-typing" : ""}`}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
              <path d="M1.8 8h12.4M8 1.8c2 2 2 10.4 0 12.4M8 1.8c-2 2-2 10.4 0 12.4" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            {typedSite ? <span className="sf-bar__site">{typedSite}</span> : <span className="sf-bar__ph">yourwebsite.com</span>}
          </span>
          <span className={`sf-bar__go${s.pressed ? " is-pressed" : ""}`}>Build my workspace</span>
          <span className="sf-bar__clock tnum">
            <span className="sf-bar__dot" />
            {s.clock}
          </span>
        </div>

        {/* Their website, under the agent's camera. */}
        <div className="sf-site">
          <div className="sf-site__chrome">
            <span />
            <span />
            <span />
            <em>{s.loaded ? F.site : "about:blank"}</em>
          </div>
          <div className="sf-site__read">
            {F.pages.map((p, i) => (
              <span key={p} className={i < s.read ? "is-read" : undefined}>
                {p}
              </span>
            ))}
          </div>
          <div className="sf-site__view" ref={view}>
            <div className="sf-page" ref={page} style={{ width: PAGE_W }}>
              <SampleSite drops={s.drops} />
              {markBox ? (
                <div key={s.mark} className="sf-mark" style={{ left: markBox.x, top: markBox.y, width: markBox.w, height: markBox.h }}>
                  <i />
                  <i />
                  <i />
                  <i />
                  <b>{s.tag}</b>
                </div>
              ) : null}
            </div>
            <div className="sf-scan" />
          </div>
        </div>

        <div className="sf-link">
          <span />
        </div>

        {/* The workspace it becomes. */}
        <div className="sf-ws" ref={ws}>
          <div className="sf-ws__chrome">
            <span />
            <span />
            <span />
            <em>arriveping.com/admin</em>
          </div>
          <div className="sf-ws__head">
            <span className="sf-ws__logo" data-slot="logo" data-on={on("logo")}>
              <BluestemMark />
            </span>
            <span className="sf-ws__name" data-slot="name" data-on={on("name")}>
              {F.company}
            </span>
            <span className="sf-ws__new">+ New job</span>
          </div>
          <div className="sf-ws__tabs">
            <span>Scheduler</span>
            <span className="is-on">Jobs</span>
            <span className={`sf-ws__noun${s.nouns ? " is-swapped" : ""}`}>
              <s>Technicians</s>
              <ins>Plumbers</ins>
            </span>
            <span>Customers</span>
            <span>Catalog</span>
          </div>
          <div className="sf-ws__grid">
            <div className="sf-card">
              <b>Brand</b>
              <div className="sf-card__row">
                <span className="sf-sw" data-slot="c1" data-on={on("c1")} style={{ background: F.colors.primary }} />
                <span className="sf-sw" data-slot="c2" data-on={on("c2")} style={{ background: F.colors.accent }} />
                <small>On every text, email and tracking page</small>
              </div>
            </div>
            <div className="sf-card">
              <b>Trade</b>
              <span className="sf-badge" data-slot="trade" data-on={on("trade")}>
                Plumbing
              </span>
            </div>
            <div className="sf-card">
              <b>Where</b>
              <span className="sf-fill sf-fill--pin" data-slot="where" data-on={on("where")}>
                {F.address}
              </span>
              <span className="sf-fill sf-fill--muted" data-slot="area" data-on={on("area")}>
                Serves {F.serviceArea}
              </span>
            </div>
            <div className="sf-card">
              <b>Their words</b>
              <div className="sf-card__row sf-words">
                <span>
                  Staff <em data-slot="staff" data-on={on("staff")}>Plumbers</em>
                </span>
                <span>
                  Work <em data-slot="work" data-on={on("work")}>Jobs</em>
                </span>
              </div>
            </div>
            <div className="sf-card sf-card--wide">
              <b>
                Services · catalog <span className="sf-count tnum" data-on={on("catalog")}>{s.count} priced items</span>
              </b>
              <div className="sf-chips">
                {F.services.map((name, i) => (
                  <span key={name} className="sf-chip" data-slot={`svc-${i}`} data-on={i < s.svc ? "true" : "false"}>
                    {name}
                  </span>
                ))}
              </div>
            </div>
            <div className="sf-card">
              <b>Team</b>
              <div className="sf-card__row">
                {F.team.map((p, i) => (
                  <span key={p.name} className={`sf-av sf-av--${i}`} data-slot={`team-${i}`} data-on={i < s.team ? "true" : "false"} title={p.name}>
                    {p.name[0]}
                  </span>
                ))}
                <small className="sf-invite" data-on={s.team >= F.team.length ? "true" : "false"}>
                  Invite?
                </small>
              </div>
            </div>
            <div className="sf-card">
              <b>Templates · forms</b>
              <span className="sf-big tnum" data-on={on("templates")}>
                {F.templates} · {F.forms}
              </span>
            </div>
            <div className="sf-card sf-card--wide sf-card--text">
              <b>Customer texts, in their words</b>
              <span className="sf-bubble" data-on={on("text")}>
                {F.text}
              </span>
            </div>
          </div>
          <div className="sf-ws__ready" data-on={s.done ? "true" : "false"}>
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="8" fill="#10b981" />
              <path d="M5.5 9.3l2.3 2.2 4.7-4.8" stroke="#04261b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Workspace ready in 1:52
          </div>
        </div>

        {/* What the agent is thinking. */}
        <p className="sf-say" key={s.line ?? "none"}>
          {L ? (
            <>
              <span className="sf-say__spark" />
              {L.q ? <span className="sf-say__q">{L.q}</span> : null}
              <span className="sf-say__a">{L.a}</span>
            </>
          ) : (
            <span className="sf-say__q">Paste a website to start.</span>
          )}
        </p>

        <div className="sf-fly" ref={layer} />
      </div>

      {/* The same story for screen readers, in order. */}
      <ol className="visually-hidden">
        {Object.values(F.lines).map((l) => (
          <li key={l.a}>{"q" in l ? `${l.q} ${l.a}` : l.a}</li>
        ))}
      </ol>

      <figcaption id="sf-cap" className="sf-cap">
        <span>{F.caption}</span>
        <span className="sf-cap__act">
          {motion ? (
            <button type="button" className="sf-replay" onClick={replay} disabled={live && !paused}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M2.2 1.8v2.8H5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Watch again
            </button>
          ) : null}
        </span>
      </figcaption>
    </figure>
  );
}

/** Bluestem Plumbing & Drain's mark: a water drop with a stem of bluestem grass. Invented for the demo. */
function BluestemMark() {
  return (
    <svg viewBox="0 0 40 40" width="40" height="40" fill="none">
      <path d="M20 3c6.5 8.2 11 14.4 11 20.2A11 11 0 0 1 9 23.2C9 17.4 13.5 11.2 20 3z" fill={F.colors.primary} />
      <path d="M20 33c0-7 1.6-12 6.5-16.5M20 33c-.4-5.2-2.6-8.8-6-11.2" stroke={F.colors.accent} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

const ICONS = [
  "M8 2l4.5 6.2A5 5 0 1 1 3.5 8.2z",
  "M2 6h12M4 6v6h8V6M6 2h4v4",
  "M8 2c2 3 3.5 4.8 3.5 7a3.5 3.5 0 0 1-7 0C4.5 6.8 6 5 8 2z",
  "M3 13l4-4M9 3l4 4-6 6-4-4z",
  "M4 2h8v12H4zM6 6h4M6 9h4",
  "M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z",
  "M3 8h10M8 3v10",
  "M2 5h9l3 3-3 3H2z",
];

/** A believable small-business site for a made-up plumber. Every element the agent reads carries data-k. */
function SampleSite({ drops }: { drops: boolean }) {
  return (
    <div className="bs">
      <div className="bs-util">
        <span>Open 24/7 · {F.phone}</span>
        <span>Licensed and insured</span>
      </div>
      <header className="bs-head" data-k="colors">
        <span className="bs-logo" data-k="logo">
          <span className="bs-logo__mark" data-k="logo-mark">
            <BluestemMark />
            {drops ? <span className="bs-drop bs-drop--1" data-k="drop-1" /> : <span data-k="drop-1" className="bs-drop-anchor bs-drop-anchor--1" />}
          </span>
          <span className="bs-logo__word" data-k="logo-word">
            <strong>Bluestem</strong>
            <span>Plumbing &amp; Drain</span>
          </span>
        </span>
        <nav className="bs-nav">
          <span>Services</span>
          <span>Service area</span>
          <span>About</span>
          <span>Our team</span>
          <span>Contact</span>
        </nav>
        <span className="bs-cta">
          Book a plumber
          {drops ? <span className="bs-drop bs-drop--2" data-k="drop-2" /> : <span data-k="drop-2" className="bs-drop-anchor bs-drop-anchor--2" />}
        </span>
      </header>
      <section className="bs-hero" data-k="hero">
        <div>
          <h4>Winnipeg's 24/7 plumbers.</h4>
          <p data-k="words">
            <span data-k="trade-word">Licensed plumbers</span> for burst pipes, drains and water heaters. <span data-k="word-work">No job too small.</span>
          </p>
          <div className="bs-hero__btns">
            <span className="bs-btn" data-k="word-staff">
              Book a plumber
            </span>
            <span className="bs-btn bs-btn--ghost">{F.phone}</span>
          </div>
        </div>
        <picture>
          <source type="image/webp" srcSet="/img/site/trades/plumbing-card.webp" />
          <img src="/img/site/trades/plumbing-card.jpg" alt="" width={800} height={600} loading="lazy" decoding="async" />
        </picture>
      </section>
      <section className="bs-svc" data-k="services">
        <h5>Services</h5>
        <div className="bs-svc__grid">
          {F.services.map((name, i) => (
            <span key={name} className="bs-svc__card" data-k={`svc-${i}`}>
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d={ICONS[i]} stroke={F.colors.primary} strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
              {name}
            </span>
          ))}
        </div>
      </section>
      <section className="bs-team">
        <h5>Meet our team</h5>
        <div className="bs-team__row" data-k="team">
          {F.team.map((p, i) => (
            <span key={p.name} className="bs-team__card">
              <span className={`bs-team__av sf-av--${i}`} data-k={`team-${i}`}>
                {p.name[0]}
              </span>
              <strong>{p.name}</strong>
              <small>{p.role}</small>
            </span>
          ))}
        </div>
      </section>
      <footer className="bs-foot" data-k="address-block">
        <div>
          <strong>Bluestem Plumbing &amp; Drain</strong>
          <span data-k="address">{F.address}</span>
          <span data-k="area">Serving {F.serviceArea}</span>
        </div>
        <div>
          <span>{F.hours}</span>
          <span>{F.phone}</span>
        </div>
      </footer>
      <div className="bs-legal">© Bluestem Plumbing &amp; Drain · Licensed, bonded and insured</div>
    </div>
  );
}
