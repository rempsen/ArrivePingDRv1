import { useRef, type RefObject } from "react";
import { usePlayback } from "../motion/playback";
import { useInView } from "../motion/use-scene-clock";

/**
 * Shared pieces for the live sections (hero film, ops bento, dispatch story).
 *
 * The street map is a stylised Winnipeg-style grid where 1 SVG unit = 1 metre.
 * Vans drive closed loops on real streets (keyframes in live.css are sampled
 * from a kinematic sim), so speeds and ETAs shown next to them stay realistic.
 */

/** "on" while the section is on screen and the visitor hasn't paused motion. */
export function useLivePlay<T extends Element>(threshold = 0.2): { ref: RefObject<T | null>; play: "on" | "off" } {
  const ref = useRef<T>(null);
  const inView = useInView(ref, threshold);
  const { paused, hidden } = usePlayback();
  return { ref, play: inView && !paused && !hidden ? "on" : "off" };
}

/** Top-down van glyph, heading east at rotate(0). */
export function Van({ fill = "#4f7fae" }: { fill?: string }) {
  return (
    <g fill={fill}>
      <rect x={-15} y={-8.5} width={30} height={17} rx={5} />
      <rect x={5} y={-6.5} width={6} height={13} rx={2} fill="#06101c" opacity={0.55} />
    </g>
  );
}

/** Fleet vans by loop index (see .lv-f0 … .lv-f9 in live.css). */
export function Fleet({ loops }: { loops: number[] }) {
  return (
    <g>
      {loops.map((i) => (
        <g key={i} className={`lv-van lv-f${i}`}>
          <Van />
        </g>
      ))}
    </g>
  );
}

const MINOR =
  "M0 0V1000M130 0V730M130 870V1000M250 0V1000M510 0V1000M620 0V1000M740 0V650M740 730V1000M850 0V730M850 870V1000M1100 0V1000M1210 0V1000M1330 0V1000M1450 0V1000M1560 0V1000M0 0H1600M0 85H1600M0 250H1600M0 345H1600M0 425H1600M0 650H130M250 650H1450M1560 650H1600M0 730H1450M1560 730H1600M0 870H1560M0 950H1100M1210 950H1330M1450 950H1600";
const MAJOR = "M400 0V1000M980 0V1000M0 170H1600M0 565H1600M0 860L1000 250";
const RIVER = "M-20 905 C 180 860, 300 960, 470 925 S 720 840, 860 905 S 1100 1010, 1240 975 L 1240 1040 L -20 1040 Z";

/** Streets, parks, river and a few street names (Winnipeg flavour). */
export function StreetMap({ labels = true }: { labels?: boolean }) {
  return (
    <g>
      <rect x={-100} y={-100} width={1800} height={1200} fill="#081321" />
      <rect x={146} y={93} width={88} height={69} rx={6} fill="#0b211f" />
      <rect x={748} y={353} width={94} height={64} rx={6} fill="#0b211f" />
      <rect x={1218} y={258} width={104} height={79} rx={6} fill="#0b211f" />
      <path d={MINOR} fill="none" stroke="#12243a" strokeWidth={9} />
      <path d={RIVER} fill="#0a2236" />
      <path d={MAJOR} fill="none" stroke="#1a3450" strokeWidth={16} />
      <path d={MAJOR} fill="none" stroke="#24486e" strokeWidth={1.5} opacity={0.7} />
      {labels ? (
        <g fill="#3f5d7d" fontSize={12} fontWeight={600} letterSpacing={1.6}>
          <text x={1120} y={416}>CORYDON AVE</text>
          <text x={760} y={556}>GRANT AVE</text>
          <text x={1060} y={161}>PORTAGE AVE</text>
          <text transform="translate(1338 640) rotate(90)">WAVERLEY ST</text>
          <text transform="translate(988 760) rotate(90)">PEMBINA HWY</text>
        </g>
      ) : null}
    </g>
  );
}

/** Technicians on site (pulsing green) and equipment (amber squares). */
export function PeopleAndAssets({ people, assets }: { people: [number, number][]; assets: [number, number][] }) {
  return (
    <g>
      {people.map(([x, y], i) => (
        <g key={`p${i}`} transform={`translate(${x} ${y})`}>
          <circle className={`lv-pulse lv-pulse--${i % 3}`} r={14} fill="none" stroke="#10b981" strokeWidth={2} />
          <circle r={5} fill="#10b981" />
        </g>
      ))}
      {assets.map(([x, y], i) => (
        <rect key={`a${i}`} x={x} y={y} width={11} height={11} rx={2.5} fill="#f59e0b" />
      ))}
    </g>
  );
}

export function PauseButton({ className = "" }: { className?: string }) {
  const { paused, toggle } = usePlayback();
  return (
    <button type="button" className={`lv-pause ${className}`} onClick={toggle} aria-pressed={paused}>
      {paused ? (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5h2v9H3zM7 1.5h2v9H7z" fill="currentColor" /></svg>
      )}
      {paused ? "Play motion" : "Pause motion"}
    </button>
  );
}
