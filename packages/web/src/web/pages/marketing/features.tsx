import { useEffect, useState, type ComponentType } from "react";
import { MarketingShell } from "../../site/components/MarketingShell";
import { useAnchorNav } from "../../site/components/SiteHeader";
import { ClosingCTA } from "../../site/sections";
import { brand } from "../../site/config";
import { chapters, exportFormats, featuresMeta, hero, milestones, workflows, type Chapter } from "../../site/content/features";
import "../../site/site.css";
import "../../site/landing.css";
import "../../site/features.css";

/* ---------------- icons ---------------- */

const PATHS: Record<string, string> = {
  form: "M6 3h9l3 3v15H6zM9 11h6M9 15h6M9 7h3",
  catalog: "M4 7l8-4 8 4-8 4zM4 12l8 4 8-4M4 17l8 4 8-4",
  pin: "M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11zM12 12a2.4 2.4 0 100-4.8 2.4 2.4 0 000 4.8z",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z",
  route: "M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM8 17h6a3 3 0 000-6h-4a3 3 0 010-6h6",
  gauge: "M4 17a8 8 0 1116 0M12 17l4-5M7 17h.01M17 17h.01",
  clock: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2",
  fence: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 15a3 3 0 100-6 3 3 0 000 6z",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 16a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
  mic: "M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zM6 11a6 6 0 0012 0M12 17v4",
  sign: "M4 17c3 0 3-7 6-7s1 7 4 7 2-4 6-4M4 21h16",
  card: "M3 6h18v12H3zM3 10h18M7 15h3",
  sms: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
  map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
  phone: "M6 3h4l1.5 4-2 1.5a11 11 0 005 5L16 11.5l4 1.5v4a2 2 0 01-2 2A15 15 0 014 5a2 2 0 012-2z",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  calc: "M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01",
  wallet: "M4 7h14a2 2 0 012 2v9H5a1 1 0 01-1-1zM4 7l11-3v3M16 13h2",
  book: "M5 4h10a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h10",
  export: "M12 4v11M8 8l4-4 4 4M5 14v6h14v-6",
  swap: "M7 7h12l-3-3M17 17H5l3 3",
};

function Icon({ name }: { name: string }) {
  return (
    <svg className="ft-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.spark} />
    </svg>
  );
}

/* ---------------- demos ---------------- */

const FT_PER_M = 1 / 0.3048;

/** Drag the technician in and out of the circle; the clock follows. */
function GeofenceDemo() {
  const [unit, setUnit] = useState<"ft" | "m">("ft");
  const [radius, setRadius] = useState(300);
  const [dist, setDist] = useState(700);
  const cfg = unit === "ft" ? { min: 100, max: 1000, step: 50, dmax: 1200 } : { min: 30, max: 300, step: 10, dmax: 360 };
  const toFt = (v: number) => (unit === "ft" ? v : v * FT_PER_M);
  const inside = dist <= radius;
  const rPx = (toFt(radius) / toFt(cfg.dmax)) * 250;
  const dPx = (toFt(dist) / toFt(cfg.dmax)) * 250;
  const switchUnit = (u: "ft" | "m") => {
    if (u === unit) return;
    const f = u === "m" ? 1 / FT_PER_M : FT_PER_M;
    const next = u === "m" ? { min: 30, max: 300, step: 10, dmax: 360 } : { min: 100, max: 1000, step: 50, dmax: 1200 };
    const snap = (v: number, c: { min: number; max: number; step: number }) => Math.min(c.max, Math.max(c.min, Math.round((v * f) / c.step) * c.step));
    setRadius(snap(radius, next));
    setDist(Math.min(next.dmax, Math.max(0, Math.round((dist * f) / next.step) * next.step)));
    setUnit(u);
  };
  return (
    <div className="ft-demo" aria-label="Geofence demo">
      <div className="ft-demo__stage">
        <svg viewBox="0 0 400 300">
          <title>{inside ? "Technician inside the job geofence: the clock is running" : "Technician outside the job geofence: the clock is stopped"}</title>
          <defs>
            <pattern id="ft-grid" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M30 0H0V30" fill="none" stroke="rgb(255 255 255 / 6%)" />
            </pattern>
          </defs>
          <rect width="400" height="300" fill="url(#ft-grid)" />
          <circle cx="110" cy="150" r={rPx} className={inside ? "ft-fence ft-fence--on" : "ft-fence"} />
          <circle cx="110" cy="150" r="7" className="ft-job" />
          <text x="110" y={Math.max(rPx, 8) + 168} textAnchor="middle" className="ft-label">Job address</text>
          <g style={{ transform: `translate(${110 + dPx}px, 150px)`, transition: "transform .25s var(--ease-out)" }}>
            <circle r="9" className={inside ? "ft-tech ft-tech--on" : "ft-tech"} />
            <text y="-16" textAnchor="middle" className="ft-label">Technician</text>
          </g>
        </svg>
        <div className={inside ? "ft-clock ft-clock--on" : "ft-clock"} aria-live="polite">
          <span className="ft-clock__dot" />
          {inside ? "On site. Clock running" : "Not on site. Clock stopped"}
        </div>
      </div>
      <div className="ft-demo__controls">
        <fieldset className="ft-seg" aria-label="Units">
          {(["ft", "m"] as const).map((u) => (
            <button key={u} type="button" aria-pressed={unit === u} onClick={() => switchUnit(u)}>
              {u === "ft" ? "Feet" : "Meters"}
            </button>
          ))}
        </fieldset>
        <label>
          <span>Your range from the job address <b>{radius} {unit}</b></span>
          <input type="range" aria-label="Range from the job address" min={cfg.min} max={cfg.max} step={cfg.step} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
        </label>
        <label>
          <span>Technician is <b>{dist} {unit}</b> away</span>
          <input type="range" aria-label="Technician distance from the job" min={0} max={cfg.dmax} step={cfg.step} value={dist} onChange={(e) => setDist(Number(e.target.value))} />
        </label>
        <p className="ft-note">Each company sets its own range. Arriving starts the clock and leaving stops it. Nobody has to remember.</p>
      </div>
    </div>
  );
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

/** A flat fee with the first hour included, then time on top. Example numbers; every company sets its own. */
function PricingDemo() {
  const [mins, setMins] = useState(95);
  const [rate, setRate] = useState(90);
  const extra = Math.max(0, mins - 60);
  const extraCost = (extra / 60) * rate;
  const total = 150 + extraCost;
  return (
    <div className="ft-demo ft-demo--pricing" aria-label="Pricing logic demo">
      <div className="ft-receipt">
        <p className="ft-receipt__kicker">Example rule</p>
        <p className="ft-receipt__rule">$150 service fee, first 60 minutes included</p>
        <dl>
          <div><dt>Service fee</dt><dd>{usd(150)}</dd></div>
          <div><dt>Time on site</dt><dd>{mins} min</dd></div>
          <div><dt>Included</dt><dd>60 min</dd></div>
          <div><dt>Extra time ({extra} min)</dt><dd>{usd(extraCost)}</dd></div>
        </dl>
        <p className="ft-receipt__total"><span>Total</span><b>{usd(total)}</b></p>
      </div>
      <div className="ft-demo__controls">
        <label>
          <span>Time on site <b>{mins} min</b></span>
          <input type="range" aria-label="Time on site in minutes" min={0} max={180} step={5} value={mins} onChange={(e) => setMins(Number(e.target.value))} />
        </label>
        <label>
          <span>Your rate after the first hour <b>{usd(rate)}/hr</b></span>
          <input type="range" aria-label="Rate per hour after the first hour" min={40} max={200} step={5} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
        </label>
        <p className="ft-note">Example numbers only. You set the fee, the included time and the rate that follows.</p>
      </div>
    </div>
  );
}

/** The four texts a customer can get, and what a tracking link carries. */
function MilestoneDemo() {
  const [i, setI] = useState(1);
  const m = milestones[i];
  const link = i === 1 || i === 3;
  return (
    <div className="ft-demo ft-demo--sms" aria-label="Customer text demo">
      <div className="ft-demo__controls">
        <div className="ft-tabs" role="tablist" aria-label="Milestones">
          {milestones.map((x, k) => (
            <button key={x.key} type="button" role="tab" aria-selected={i === k} onClick={() => setI(k)}>
              <b>{x.label}</b>
              <span>{x.when}</span>
            </button>
          ))}
        </div>
        <p className="ft-note">Pick the milestones that matter to your customers. The wording shown is a sample.</p>
      </div>
      <div className="ft-phone" aria-live="polite">
        <div className="ft-phone__bar">Prairie Heating &amp; Cooling</div>
        <div className="ft-bubble">
          {m.text}
          {link && <span className="ft-link">arriveping.com/t/your-job</span>}
        </div>
        {i === 1 && (
          <div className="ft-track">
            <div className="ft-track__eta"><b>18 min</b><span>Live arrival time</span></div>
            <div className="ft-track__btns"><span>Text Jordan</span><span>Call Jordan</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

const SAMPLE_ROWS = [
  ["Job", "Technician", "Travel (km)", "Travel (min)", "On site (min)"],
  ["1042", "Jordan", "11.4", "18", "74"],
  ["1043", "Priya", "6.2", "11", "52"],
];

function ExportDemo() {
  const [fmt, setFmt] = useState<(typeof exportFormats)[number]>("CSV");
  const csv = SAMPLE_ROWS.map((r) => r.join(",")).join("\n");
  const json = JSON.stringify(
    SAMPLE_ROWS.slice(1).map((r) => ({ job: r[0], technician: r[1], travelKm: Number(r[2]), travelMin: Number(r[3]), onSiteMin: Number(r[4]) })),
    null,
    2,
  );
  return (
    <div className="ft-demo ft-demo--export" aria-label="Export demo">
      <fieldset className="ft-seg ft-seg--wide" aria-label="Export format">
        {exportFormats.map((f) => (
          <button key={f} type="button" aria-pressed={fmt === f} onClick={() => setFmt(f)}>{f}</button>
        ))}
      </fieldset>
      <div className={`ft-file ft-file--${fmt.toLowerCase()}`}>
        <div className="ft-file__name">jobs-export.{fmt === "Excel" ? "xlsx" : fmt.toLowerCase()}</div>
        {fmt === "CSV" && <pre>{csv}</pre>}
        {fmt === "JSON" && <pre>{json}</pre>}
        {(fmt === "Excel" || fmt === "PDF") && (
          <table>
            <tbody>
              {SAMPLE_ROWS.map((r, k) => (
                <tr key={r[0]}>{r.map((c, j) => (k === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="ft-note">Sample data. Everything you collect can be exported, then imported into any of your other tools.</p>
    </div>
  );
}

const COMPANIES = [
  { name: "Prairie Heating & Cooling", note: "Employee" },
  { name: "Northern Plumbing Co.", note: "Subcontractor" },
  { name: "Red River Electric", note: "Subcontractor" },
];

function CompanyDemo() {
  const [c, setC] = useState(0);
  return (
    <div className="ft-demo ft-demo--co" aria-label="Company switcher demo">
      <div className="ft-phone">
        <div className="ft-phone__bar">Who are you working for?</div>
        <ul className="ft-co">
          {COMPANIES.map((x, k) => (
            <li key={x.name}>
              <button type="button" aria-pressed={c === k} onClick={() => setC(k)}>
                <span>{x.name}<small>{x.note}</small></span>
                <i aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <div className="ft-co__now" aria-live="polite">Showing jobs for <b>{COMPANIES[c].name}</b></div>
      </div>
      <p className="ft-note">Sample companies. One technician can work for you and for other companies, and chooses at the start of each shift.</p>
    </div>
  );
}

function WorkflowsDemo() {
  return (
    <div className="ft-demo ft-demo--wf" aria-label="Workflows built from your website">
      <p className="ft-receipt__kicker">Built from your website, ready on day one</p>
      <ol className="ft-wf">
        {workflows.map((w, k) => (
          <li key={w}><span>{k + 1}</span>{w}</li>
        ))}
      </ol>
      <div className="ft-big"><b>18</b><span>industries of best practices and workflows behind them</span></div>
      <p className="ft-note">Example workflow names. Yours are generated from your own site.</p>
    </div>
  );
}


const CATALOG = [
  { id: "call", name: "Service call, first hour included", price: 150 },
  { id: "part", name: "Hot surface igniter (part)", price: 68 },
  { id: "labour", name: "Extra labour, 1 hour", price: 90 },
];

/** Build a work order from catalog items and watch it price itself. */
function CreateDemo() {
  const [on, setOn] = useState<string[]>(["call"]);
  const total = CATALOG.filter((c) => on.includes(c.id)).reduce((n, c) => n + c.price, 0);
  const toggle = (id: string) => setOn((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  return (
    <div className="ft-demo" aria-label="Work order demo">
      <div className="ft-wo">
        <div className="ft-wo__head"><b>Furnace not heating</b><span className="ft-pill">Urgent</span></div>
        <dl className="ft-wo__facts">
          <div><dt>Customer</dt><dd>Dana Reyes</dd></div>
          <div><dt>Address</dt><dd>214 Waverley St</dd></div>
          <div><dt>Skills needed</dt><dd>Gas fitter</dd></div>
        </dl>
        <p className="ft-receipt__kicker">Add from your catalog</p>
        <ul className="ft-co">
          {CATALOG.map((c) => (
            <li key={c.id}>
              <button type="button" aria-pressed={on.includes(c.id)} onClick={() => toggle(c.id)}>
                <span>{c.name}<small>{usd(c.price)}</small></span>
                <i aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <p className="ft-receipt__total"><span>Work order total</span><b>{usd(total)}</b></p>
      </div>
      <p className="ft-note">Sample job and prices. Your catalog arrives pre-filled and is yours to edit.</p>
    </div>
  );
}

const STAGES = [
  { key: "Before", cap: ["The unit as found", "Panel and wiring"] },
  { key: "During", cap: ["Igniter removed", "Replacement fitted"] },
  { key: "After", cap: ["Unit running", "Area left clean"] },
];

/** The job record as the technician builds it on site. */
function CaptureDemo() {
  const [k, setK] = useState(0);
  const st = STAGES[k];
  return (
    <div className="ft-demo" aria-label="Job record demo">
      <fieldset className="ft-seg ft-seg--wide" aria-label="Stage of the job">
        {STAGES.map((x, i) => (
          <button key={x.key} type="button" aria-pressed={k === i} onClick={() => setK(i)}>{x.key}</button>
        ))}
      </fieldset>
      <div className="ft-shots">
        {st.cap.map((c, i) => (
          <figure key={c} className={`ft-shot ft-shot--${i}`}>
            <Icon name="camera" />
            <figcaption>{c}</figcaption>
          </figure>
        ))}
      </div>
      <div className="ft-voice">
        <span className="ft-voice__btn"><Icon name="mic" /></span>
        <span className="ft-voice__bars" aria-hidden="true">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ height: `${30 + ((i * 37) % 60)}%` }} />)}</span>
        <small>Voice note, 0:24, added to the record</small>
      </div>
      {k === 2 && (
        <div className="ft-close" aria-live="polite">
          <svg viewBox="0 0 240 60" aria-hidden="true"><path d="M8 44c20 0 22-30 40-30s6 30 26 30 14-18 40-18 20 16 44 4 22-4 40-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <span>Customer signature</span>
          <span className="ft-pay">Charge card with Stripe</span>
        </div>
      )}
      <p className="ft-note">Sample job record. Which steps a technician sees follows your workflow.</p>
    </div>
  );
}

const DEMOS: Partial<Record<string, ComponentType>> = {
  create: CreateDemo,
  capture: CaptureDemo,
  track: GeofenceDemo,
  inform: MilestoneDemo,
  price: PricingDemo,
  start: WorkflowsDemo,
  own: () => (
    <div className="ft-pair">
      <ExportDemo />
      <CompanyDemo />
    </div>
  ),
};

/* ---------------- page ---------------- */

function useActiveChapter() {
  const [active, setActive] = useState("");
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const line = window.innerHeight * 0.35;
      let cur = "";
      for (const c of chapters) {
        const el = document.getElementById(`ft-${c.id}`);
        if (el && el.getBoundingClientRect().top <= line) cur = c.id;
      }
      setActive(cur);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return active;
}

function ChapterView({ c }: { c: Chapter }) {
  const Demo = DEMOS[c.id];
  return (
    <section id={`ft-${c.id}`} className="ft-chapter" aria-labelledby={`ft-${c.id}-h`}>
      <div className="container">
        <header className="ft-chapter__head" data-reveal>
          <span className="ft-chapter__n" aria-hidden="true">{c.n}</span>
          <div>
            <h2 id={`ft-${c.id}-h`}>{c.title}</h2>
            <p className="lede">{c.promise}</p>
          </div>
        </header>
        <div className={Demo ? "ft-chapter__body ft-chapter__body--demo" : "ft-chapter__body"}>
          <ul className="ft-tiles">
            {c.tiles.map((t, k) => (
              <li key={t.title} className="ft-tile" data-reveal data-reveal-delay={String(Math.min(k, 3))}>
                <span className="ft-tile__icon"><Icon name={t.icon} /></span>
                <h3>{t.title}</h3>
                <p>{t.text}</p>
              </li>
            ))}
          </ul>
          {Demo && (
            <div className="ft-chapter__demo" data-reveal>
              <Demo />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function FeaturesPage() {
  const active = useActiveChapter();
  const go = useAnchorNav();
  return (
    <MarketingShell path={featuresMeta.path}>
      <header className="lp-hero ft-hero">
        <div className="container">
          <span className="eyebrow">{hero.eyebrow}</span>
          <h1 className="lp-hero__title">{hero.title}</h1>
          <p className="lede lp-hero__lede">{hero.lede}</p>
          <div className="lp-hero__cta">
            <a className="btn btn--primary" href={brand.urls.signUp}>Sign up free</a>
            <a className="btn btn--secondary" href="/pricing">See pricing</a>
          </div>
          <p className="lp-hero__fine">Free for 30 days. No setup fee, no contract.</p>
        </div>
      </header>
      <nav className="ft-rail" aria-label="Feature chapters">
        <div className="container ft-rail__in">
          {chapters.map((c) => (
            <a key={c.id} href={`#ft-${c.id}`} aria-current={active === c.id ? "true" : undefined} onClick={(e) => go(e, `#ft-${c.id}`)}>
              <i>{c.n}</i>
              {c.label}
            </a>
          ))}
        </div>
      </nav>
      {chapters.map((c) => (
        <ChapterView key={c.id} c={c} />
      ))}
      <ClosingCTA />
    </MarketingShell>
  );
}
