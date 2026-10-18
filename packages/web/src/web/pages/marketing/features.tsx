import { useEffect, useState, type ComponentType } from "react";
import { MarketingShell } from "../../site/components/MarketingShell";
import { useAnchorNav } from "../../site/components/SiteHeader";
import { ClosingCTA } from "../../site/sections";
import { brand } from "../../site/config";
import { chapters, featuresMeta, hero, industries, jobPhotos, screens, type Chapter, type Screen } from "../../site/content/features";
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

/* ---------------- real screens ---------------- */

/** One real screen from the app, framed like the product it came from. */
function ScreenShot({ shot }: { shot: Screen }) {
  return (
    <figure className={`ft-screen ft-screen--${shot.span}${shot.phone ? " ft-screen--phone" : ""}`} data-reveal>
      <div className="ft-screen__frame">
        <img src={shot.src} width={shot.w} height={shot.h} alt={shot.alt} loading="lazy" decoding="async" />
      </div>
      <figcaption>{shot.caption}</figcaption>
    </figure>
  );
}

/** The real photos from the finished call, one stage at a time. */
function JobPhotos() {
  const [k, setK] = useState(0);
  const p = jobPhotos[k];
  return (
    <figure className="ft-screen ft-screen--12 ft-photos" data-reveal>
      <div className="ft-photos__bar">
        <fieldset className="ft-seg" aria-label="Stage of the job">
          {jobPhotos.map((x, i) => (
            <button key={x.stage} type="button" aria-pressed={k === i} onClick={() => setK(i)}>{x.stage}</button>
          ))}
        </fieldset>
        <span className="ft-photos__meta">Rooftop AC not cooling · Tom Rivera</span>
      </div>
      <div className="ft-photos__stage">
        {jobPhotos.map((x, i) => (
          <picture key={x.stage} className={i === k ? "is-on" : undefined}>
            <source srcSet={`${x.src}.webp`} type="image/webp" />
            <img src={`${x.src}.jpg`} width={1200} height={900} alt={i === k ? `${x.stage} photo: ${x.caption}` : ""} loading="lazy" decoding="async" />
          </picture>
        ))}
        <p className="ft-photos__cap" aria-live="polite"><b>{p.stage}</b> {p.caption}<span>{p.time}</span></p>
      </div>
      <figcaption>The photos the technician took on this call, filed under before, during and after.</figcaption>
    </figure>
  );
}

/** The 18 industries, and the workflows each one starts with. */
function IndustryPicker() {
  const [id, setId] = useState("hvac-plumbing");
  const ind = industries.find((x) => x.id === id) ?? industries[0];
  const groups = [...new Set(industries.map((x) => x.group))];
  return (
    <div className="ft-screen ft-screen--8 ft-industry" data-reveal>
      <div className="ft-industry__card">
        <div className="ft-big"><b>{industries.length}</b><span>industries researched, each with its own best practices and pre-built workflows</span></div>
        <label className="ft-industry__pick">
          <span>Choose an industry</span>
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {industries.filter((x) => x.group === g).map((x) => (
                  <option key={x.id} value={x.id}>{x.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <p className="ft-receipt__kicker">Workflows ready for {ind.label}</p>
        <ol className="ft-wf" aria-live="polite">
          {ind.workflows.map((w, k) => (
            <li key={w}><span>{k + 1}</span>{w}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

const EXTRA: Partial<Record<string, ComponentType>> = {
  capture: JobPhotos,
  start: IndustryPicker,
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
  const shots = screens[c.id] ?? [];
  const Extra = EXTRA[c.id];
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
        <ul className="ft-tiles">
          {c.tiles.map((t, k) => (
            <li key={t.title} className="ft-tile" data-reveal data-reveal-delay={String(Math.min(k, 3))}>
              <span className="ft-tile__icon"><Icon name={t.icon} /></span>
              <h3>{t.title}</h3>
              <p>{t.text}</p>
            </li>
          ))}
        </ul>
        {(shots.length > 0 || Extra) && (
          <div className="ft-screens">
            {c.id === "start" ? (
              <>
                {shots.map((x) => <ScreenShot key={x.src} shot={x} />)}
                {Extra && <Extra />}
              </>
            ) : (
              <>
                {Extra && <Extra />}
                {shots.map((x) => <ScreenShot key={x.src} shot={x} />)}
              </>
            )}
          </div>
        )}
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
