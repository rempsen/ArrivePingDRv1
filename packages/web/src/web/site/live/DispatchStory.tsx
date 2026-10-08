import { useState, type CSSProperties } from "react";
import { dispatchStory } from "../config";
import { DEV, DEV_ROUTE, HOME, MAP_H, MAP_IMAGE, MAP_W, MARCUS, MARCUS_ROUTE, PRIYA, PRIYA_ROUTE } from "./dispatch-map";
import { PauseButton, useLivePlay } from "./shared";

/**
 * A · Live dispatch story — the "How it works" section.
 *
 * One urgent job plays out on the real ArrivePing map (ArrivePing Ink basemap,
 * River Heights, Winnipeg). Routes are real road routes projected onto the map
 * image (see dispatch-map.ts). 20 s loop:
 *   0–17.5 %   team live on the map                    (step 1)
 *   17.5–35 %  work order WO-4821 is created            (step 2)
 *   35–55 %    auto-assign: Dev (0.4 km) is busy, Priya (0.5 km) has no gas
 *              ticket, Marcus (0.9 km, gas fitter, free) is chosen  (step 3)
 *   55–68 %    job lands on Marcus's phone, he accepts             (step 4)
 *   68–100 %   customer text, then live tracking with ETA, while Marcus pulls
 *              away north on Niagara St at a realistic 1.6 m/s²   (step 5)
 *
 * Clicking a step restarts the story at that step.
 */

const LOOP_S = 20;
/** Technicians on site and equipment, placed on real lots near the streets. */
const ON_SITE: [number, number][] = [[338, 222], [252, 352], [505, 640], [884, 432]];
const EQUIPMENT: [number, number][] = [[418, 300], [762, 662], [928, 252]];

export function DispatchStory() {
  const { ref, play } = useLivePlay<HTMLElement>();
  const [jump, setJump] = useState({ at: 0, epoch: 0 });
  const vars = { "--lv-off": `-${((jump.at / 100) * LOOP_S).toFixed(2)}s` } as CSSProperties;

  return (
    <section id="how-it-works" className="section section--divided anchor lv" ref={ref} data-play={play} aria-labelledby="story-title">
      <div className="container">
        <div className="intro intro--center" data-reveal="">
          <span className="eyebrow">{dispatchStory.eyebrow}</span>
          <h2 id="story-title" className="h-section">
            {dispatchStory.title} <span className="h-muted">{dispatchStory.titleMuted}</span>
          </h2>
          <p className="lede">{dispatchStory.body}</p>
        </div>

        <div className="lv-story" style={vars}>
          <ol className="lv-steps" key={`steps-${jump.epoch}`}>
            {dispatchStory.steps.map((s, i) => (
              <li key={s.title}>
                <button type="button" className={`lv-step lv-st lv-s-a${i + 1}`} onClick={() => setJump((j) => ({ at: s.at, epoch: j.epoch + 1 }))}>
                  <span className="lv-num">{i + 1}</span>
                  <span className="lv-step__t">{s.title}</span>
                  <span className="lv-step__b">{s.body}</span>
                  <span className="lv-step__bar" aria-hidden="true">
                    <span className={`lv-st lv-s-p${i + 1}`} />
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <div className="lv-map lv-map--real">
            <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} aria-hidden="true" focusable="false">
              <image href={MAP_IMAGE} x={0} y={0} width={MAP_W} height={MAP_H} preserveAspectRatio="xMidYMid slice" />
              <OnSite />
              <Story key={`story-${jump.epoch}`} />
            </svg>
            <div className="lv-map__bar">
              <span className="lv-map__note">
                <span className="lv-livedot" aria-hidden="true" style={{ marginRight: 8 }} />
                ArrivePing live map · River Heights, Winnipeg
              </span>
              <PauseButton />
            </div>
          </div>
        </div>
        <p className="lv-story-foot">{dispatchStory.note}</p>
      </div>
    </section>
  );
}

/** Truck glyph from the app's driver marker (lucide "truck"), centred on 0,0. */
function Truck({ size = 16, stroke = "#fff" }: { size?: number; stroke?: string }) {
  const s = size / 24;
  return (
    <g transform={`translate(${-size / 2} ${-size / 2}) scale(${s})`} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx={17} cy={18} r={2} />
      <circle cx={7} cy={18} r={2} />
    </g>
  );
}

/** The app's driver marker: white-ringed disc with a truck. */
function DriverPin({ fill = "#0ea5e9", pulse = true }: { fill?: string; pulse?: boolean }) {
  return (
    <g>
      {pulse ? <circle r={22} fill={fill} opacity={0.22} /> : null}
      <circle r={15} fill={fill} stroke="#fff" strokeWidth={3} />
      <Truck size={14} />
    </g>
  );
}

/** Technicians already on site (pulsing green) and tracked equipment (amber). */
function OnSite() {
  return (
    <g>
      {ON_SITE.map(([x, y], i) => (
        <g key={`p${i}`} transform={`translate(${x} ${y})`}>
          <circle className={`lv-pulse lv-pulse--${i % 3}`} r={14} fill="none" stroke="#10b981" strokeWidth={2} />
          <circle r={6} fill="#10b981" stroke="#04261b" strokeWidth={1.5} />
        </g>
      ))}
      {EQUIPMENT.map(([x, y], i) => (
        <rect key={`a${i}`} x={x - 6} y={y - 6} width={12} height={12} rx={3} fill="#f59e0b" stroke="#2a1a03" strokeWidth={1.5} />
      ))}
    </g>
  );
}

function Story() {
  const [hx, hy] = HOME;
  const [mx, my] = MARCUS;
  return (
    <g>
      {/* 3 · candidates: Dev is closest but busy, Priya has no gas ticket */}
      <g className="lv-st lv-s-cand">
        <g className="lv-st lv-s-dim">
          <path d={DEV_ROUTE} fill="none" stroke="#94a3b8" strokeWidth={3} strokeDasharray="7 9" strokeLinejoin="round" />
          <path d={PRIYA_ROUTE} fill="none" stroke="#94a3b8" strokeWidth={3} strokeDasharray="7 9" strokeLinejoin="round" />
          <g transform={`translate(${DEV[0]} ${DEV[1]})`}>
            <DriverPin fill="#64748b" pulse={false} />
          </g>
          <g transform={`translate(${PRIYA[0]} ${PRIYA[1]})`}>
            <DriverPin fill="#64748b" pulse={false} />
          </g>
          <g className="lv-ov" transform="translate(702 606)">
            <rect width={226} height={58} rx={12} fill="#0d1b2c" stroke="#2a3f57" />
            <text x={16} y={24} className="lv-disp" fill="#e2e8f0" fontSize={15} fontWeight={700}>Dev K. · 0.4 km</text>
            <text x={16} y={44} fill="#fcd34d" fontSize={12.5}>HVAC · busy until 10:30</text>
          </g>
          <g className="lv-ov" transform="translate(648 194)">
            <rect width={226} height={58} rx={12} fill="#0d1b2c" stroke="#2a3f57" />
            <text x={16} y={24} className="lv-disp" fill="#e2e8f0" fontSize={15} fontWeight={700}>Priya S. · 0.5 km</text>
            <text x={16} y={44} fill="#fca5a5" fontSize={12.5}>Plumber · no gas ticket</text>
          </g>
        </g>
        <path d={MARCUS_ROUTE} fill="none" stroke="#38bdf8" strokeWidth={3} strokeDasharray="7 9" strokeLinejoin="round" />
      </g>

      <g transform={`translate(${hx} ${hy})`}>
        <circle className="lv-st lv-s-ring lv-fb" r={150} fill="none" stroke="#10b981" strokeWidth={2} />
        <circle className="lv-st lv-s-ring lv-s-ring--2 lv-fb" r={150} fill="none" stroke="#10b981" strokeWidth={2} />
        <circle className="lv-st lv-s-ring lv-s-ring--3 lv-fb" r={150} fill="none" stroke="#10b981" strokeWidth={2} />
      </g>

      {/* chosen route, drawn like the app's live route; the driven part disappears */}
      <g className="lv-st lv-s-chosen">
        <path d={MARCUS_ROUTE} fill="none" stroke="#04121f" strokeOpacity={0.85} strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
        <path className="lv-st lv-s-ahead" d={MARCUS_ROUTE} fill="none" stroke="#0ea5e9" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* 2 · the customer's home: the app's destination pin */}
      <g transform={`translate(${hx} ${hy})`}>
        <g className="lv-st lv-s-pin">
          <ellipse cx={0} cy={2} rx={9} ry={3.5} fill="#000" opacity={0.45} />
          <path d="M0 0 C -4 -8 -15 -14 -15 -26 A15 15 0 1 1 15 -26 C 15 -14 4 -8 0 0 Z" fill="#2563eb" stroke="#fff" strokeWidth={3} strokeLinejoin="round" />
          <path d="M-6.5 -25 L0 -31 L6.5 -25 V-19 H-6.5 Z" fill="#fff" />
        </g>
      </g>

      {/* Marcus's van: the app's driver marker */}
      <g className="lv-st lv-s-vfade">
        <g transform={`translate(${mx} ${my})`}>
          <g className="lv-st lv-s-drive">
            <circle r={30} fill="#38bdf8" opacity={0.14} />
            <DriverPin />
          </g>
        </g>
      </g>

      <g className="lv-st lv-s-mchip lv-ov" transform="translate(26 388)">
        <rect width={236} height={60} rx={12} fill="#0d1b2c" stroke="#38bdf8" />
        <text x={16} y={25} className="lv-disp" fill="#fff" fontSize={15.5} fontWeight={700}>Marcus T. · 0.9 km</text>
        <text x={16} y={45} fill="#7dd3fc" fontSize={12.5}>Gas fitter · available now</text>
        <g className="lv-st lv-s-chosen" transform="translate(132 -14)">
          <rect width={96} height={24} rx={12} fill="#10b981" />
          <text x={48} y={16.5} textAnchor="middle" fill="#04261b" fontSize={11} fontWeight={800} letterSpacing={1}>BEST MATCH</text>
        </g>
      </g>

      {/* 2 · work order card */}
      <g className="lv-ov" transform="translate(24 24)">
        <g className="lv-st lv-s-card">
          <path d={`M280 204 L${hx - 30} ${hy - 50}`} stroke="#3b5f86" strokeWidth={2} strokeDasharray="4 6" />
          <rect width={304} height={204} rx={16} fill="#0d1b2c" stroke="#2a4664" />
          <text x={20} y={32} fill="#7aa7d1" fontSize={11.5} fontWeight={700} letterSpacing={1.6}>NEW WORK ORDER</text>
          <text x={284} y={32} textAnchor="end" fill="#8aa3bd" fontSize={12}>WO-4821</text>
          <text className="lv-st lv-s-l1 lv-disp" x={20} y={66} fill="#f1f5f9" fontSize={21} fontWeight={800}>No heat · furnace</text>
          <text className="lv-st lv-s-l2" x={20} y={92} fill="#a9bdd3" fontSize={14}>214 Waverley St · Dana R.</text>
          <g className="lv-st lv-s-l3" transform="translate(20 108)">
            <rect width={70} height={26} rx={13} fill="#3a2a0a" />
            <text x={35} y={17.5} textAnchor="middle" fill="#fbbf24" fontSize={12} fontWeight={700}>Urgent</text>
            <rect x={80} width={150} height={26} rx={13} fill="none" stroke="#38bdf8" />
            <text x={155} y={17.5} textAnchor="middle" fill="#7dd3fc" fontSize={12} fontWeight={600}>Needs: gas fitter</text>
          </g>
          <text className="lv-st lv-s-l4" x={20} y={166} fill="#8aa3bd" fontSize={13}>Window 9:00–11:00 AM · Est. 90 min</text>
          <text className="lv-st lv-s-l4" x={20} y={188} fill="#8aa3bd" fontSize={13}>Gate code 4417 · side door</text>
        </g>
      </g>

      {/* 4 · technician app */}
      <path className="lv-st lv-s-link lv-ov" d={`M${mx + 10} ${my - 24} C ${mx + 40} ${my - 40}, ${mx + 120} ${my - 40}, 318 424`} fill="none" stroke="#38bdf8" strokeWidth={2} strokeDasharray="4 6" />
      <g className="lv-ov" transform="translate(296 64) scale(0.82)">
        <g className="lv-st lv-s-tphone">
          <rect width={214} height={436} rx={34} fill="#0a1422" stroke="#3a4f68" strokeWidth={2} />
          <rect x={8} y={8} width={198} height={420} rx={27} fill="#0e1b2b" />
          <rect x={82} y={18} width={50} height={14} rx={7} fill="#000" />
          <text x={24} y={58} className="lv-disp" fill="#e2e8f0" fontSize={13} fontWeight={800}>ArrivePing</text>
          <text x={190} y={58} textAnchor="end" fill="#64748b" fontSize={11}>Technician</text>
          <rect x={18} y={72} width={178} height={262} rx={16} fill="#12233a" stroke="#1f3a5a" />
          <text x={32} y={98} fill="#38bdf8" fontSize={10.5} fontWeight={800} letterSpacing={1.4}>NEW JOB · WO-4821</text>
          <text x={32} y={124} className="lv-disp" fill="#fff" fontSize={16} fontWeight={800}>No heat · furnace</text>
          <text x={32} y={144} fill="#fbbf24" fontSize={11.5} fontWeight={600}>Urgent · 9:00–11:00 AM</text>
          <text x={32} y={172} fill="#dbe4ee" fontSize={12.5}>214 Waverley St</text>
          <text x={32} y={190} fill="#94a3b8" fontSize={11.5}>0.9 km · about 3 min away</text>
          <text x={32} y={214} fill="#94a3b8" fontSize={11.5}>Dana R. · gate code 4417</text>
          <text x={32} y={232} fill="#94a3b8" fontSize={11.5}>Basement unit · side door</text>
          <text x={32} y={250} fill="#94a3b8" fontSize={11.5}>Bring: igniter kit</text>
          <rect x={32} y={270} width={150} height={44} rx={11} fill="#0ea5e9" />
          <text x={107} y={297} textAnchor="middle" fill="#fff" fontSize={14} fontWeight={700}>Accept job</text>
          <circle className="lv-st lv-s-tap lv-fb" cx={107} cy={292} r={22} fill="#fff" />
          <g className="lv-st lv-s-accepted">
            <rect x={32} y={270} width={150} height={44} rx={11} fill="#10b981" />
            <text x={107} y={297} textAnchor="middle" fill="#04261b" fontSize={13} fontWeight={800}>Accepted · navigating</text>
          </g>
          <text x={107} y={366} textAnchor="middle" fill="#64748b" fontSize={11}>Next · 11:30 AM tune-up</text>
        </g>
      </g>

      {/* 5 · customer's phone: text, then live tracking on the same real map */}
      <g className="lv-ov" transform="translate(648 132) scale(0.82)">
        <g className="lv-st lv-s-cphone">
          <rect width={222} height={452} rx={34} fill="#0a1422" stroke="#3a4f68" strokeWidth={2} />
          <rect x={8} y={8} width={206} height={436} rx={27} fill="#0d1726" />
          <rect x={86} y={18} width={50} height={14} rx={7} fill="#000" />
          <g className="lv-st lv-s-sms">
            <text x={111} y={104} textAnchor="middle" className="lv-disp" fill="#e2e8f0" fontSize={46} fontWeight={700}>9:11</text>
            <rect x={16} y={150} width={190} height={112} rx={16} fill="#1b2a3e" />
            <text x={30} y={172} fill="#94a3b8" fontSize={10.5} fontWeight={700} letterSpacing={1}>MESSAGES · NOW</text>
            <text x={30} y={194} fill="#fff" fontSize={13} fontWeight={700}>Prairie Comfort HVAC</text>
            <text x={30} y={214} fill="#dbe4ee" fontSize={12}>Marcus is on the way to</text>
            <text x={30} y={230} fill="#dbe4ee" fontSize={12}>214 Waverley St. Track live:</text>
            <text x={30} y={246} fill="#7dd3fc" fontSize={12}>arriveping.app/t/7k2q</text>
          </g>
          <g className="lv-st lv-s-track">
            <text x={24} y={56} fill="#94a3b8" fontSize={11} fontWeight={600}>Prairie Comfort HVAC</text>
            <circle cx={186} cy={52} r={4} fill="#10b981" />
            <text x={178} y={56} textAnchor="end" fill="#6ee7b7" fontSize={10.5} fontWeight={700}>LIVE</text>
            <MiniMap />
            <text x={24} y={246} fill="#cbd5e1" fontSize={12.5}>Marcus is on the way</text>
            <text className="lv-st lv-s-eta3 lv-disp" x={24} y={284} fill="#fff" fontSize={36} fontWeight={800}>3 min</text>
            <text className="lv-st lv-s-eta2 lv-disp" x={24} y={284} fill="#fff" fontSize={36} fontWeight={800}>2 min</text>
            <text x={198} y={268} textAnchor="end" fill="#f1f5f9" fontSize={13} fontWeight={700}>~9:14 AM</text>
            <text x={198} y={285} textAnchor="end" fill="#7dd3fc" fontSize={11.5}>0.9 km away</text>
            <circle cx={40} cy={322} r={16} fill="#1e3a5f" />
            <text x={40} y={326.5} textAnchor="middle" fill="#bae6fd" fontSize={11} fontWeight={700}>MT</text>
            <text x={64} y={318} fill="#f1f5f9" fontSize={12.5} fontWeight={700}>Marcus T. · Gas fitter</text>
            <text x={64} y={335} fill="#94a3b8" fontSize={11}>Van 7 · white Ford Transit</text>
            <rect x={24} y={360} width={84} height={44} rx={11} fill="#0ea5e9" />
            <text x={66} y={387} textAnchor="middle" fill="#fff" fontSize={14} fontWeight={700}>Text</text>
            <rect x={116} y={360} width={84} height={44} rx={11} fill="#10b981" />
            <text x={158} y={387} textAnchor="middle" fill="#04261b" fontSize={14} fontWeight={700}>Call</text>
          </g>
        </g>
      </g>
    </g>
  );
}

/** The customer's tracking page map: a crop of the same real map, same route, same van. */
function MiniMap() {
  const [hx, hy] = HOME;
  const [mx, my] = MARCUS;
  return (
    <g>
      <defs>
        <clipPath id="lv-mini-clip">
          <rect x={16} y={68} width={190} height={150} rx={14} />
        </clipPath>
      </defs>
      <g clipPath="url(#lv-mini-clip)">
        <rect x={16} y={68} width={190} height={150} fill="#070b12" />
        <svg x={16} y={68} width={190} height={150} viewBox="40 250 620 490" preserveAspectRatio="xMidYMid slice">
          <image href={MAP_IMAGE} x={0} y={0} width={MAP_W} height={MAP_H} />
          <path d={MARCUS_ROUTE} fill="none" stroke="#04121f" strokeOpacity={0.85} strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" />
          <path className="lv-st lv-s-ahead" d={MARCUS_ROUTE} fill="none" stroke="#0ea5e9" strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={hx} cy={hy} r={20} fill="#2563eb" stroke="#fff" strokeWidth={6} />
          <g transform={`translate(${mx} ${my})`}>
            <g className="lv-st lv-s-drive">
              <circle r={44} fill="#38bdf8" opacity={0.25} />
              <circle r={24} fill="#0ea5e9" stroke="#fff" strokeWidth={6} />
            </g>
          </g>
        </svg>
      </g>
    </g>
  );
}
