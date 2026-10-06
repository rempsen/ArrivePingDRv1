/**
 * Lightweight, on-brand motion accents for the marketing site.
 *
 * Built natively on top of the already-installed `motion` package (the
 * successor to Framer Motion) plus a few CSS-driven effects — no extra
 * runtime dependency added. The categories mirror what a component library
 * like Inspira UI / Aceternity UI offers (ambient backgrounds, cursor-follow
 * card glow, animated number counters, animated borders), reimplemented
 * here in React/CSS instead of pulling in a Vue-only library.
 *
 * Everything respects `prefers-reduced-motion` and the site's own
 * "pause animations" control via `usePlayback()`.
 */
import { useEffect, useRef } from "react";
import { animate, useInView } from "motion/react";
import { usePlayback } from "./playback";

/* ---------------- Aurora ambient background ---------------- */
/** Drop into any `position: relative` section as the first child. Pure CSS
 *  drift animation — cheap (transform/opacity only), paused with everything
 *  else when the visitor turns off motion. */
export function Aurora({ className = "" }: { className?: string }) {
  return <div className={`aurora ${className}`.trim()} aria-hidden="true" />;
}

/* ---------------- Spotlight card glow ---------------- */
/** Attach `onMouseMove={handleSpotlight}` to a grid/flex container and add
 *  the `spot` class to each card inside it. A soft radial highlight follows
 *  the cursor across whichever card it's over — one listener for the whole
 *  group, zero re-renders. */
export function handleSpotlight(e: React.MouseEvent<HTMLElement>) {
  const card = (e.target as HTMLElement).closest<HTMLElement>(".spot");
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${e.clientX - r.left}px`);
  card.style.setProperty("--my", `${e.clientY - r.top}px`);
}

/* ---------------- Count-up stat ---------------- */
function parseStat(raw: string): { prefix: string; target: number; decimals: number; suffix: string } {
  const m = raw.match(/^([^\d]*)([\d.]+)(.*)$/);
  if (!m) return { prefix: "", target: 0, decimals: 0, suffix: raw };
  const [, prefix = "", numStr = "", suffix = ""] = m;
  const decimals = numStr.includes(".") ? (numStr.split(".")[1]?.length ?? 0) : 0;
  return { prefix, target: parseFloat(numStr), decimals, suffix };
}

/** Renders the final value immediately (so it's never blank), then — once
 *  scrolled into view, and only if motion is allowed — counts up to it. */
export function CountUp({ value, className }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px 0px" });
  const { reduced, paused } = usePlayback();

  useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    if (reduced || paused) {
      el.textContent = value;
      return;
    }
    const { prefix, target, decimals, suffix } = parseStat(value);
    el.textContent = `${prefix}${(0).toFixed(decimals)}${suffix}`;
    const controls = animate(0, target, {
      duration: 1.3,
      ease: [0.22, 1, 0.36, 1],
      onUpdate(v) {
        el.textContent = `${prefix}${v.toFixed(decimals)}${suffix}`;
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduced, paused, value]);

  return (
    <span ref={ref} className={className}>
      {value}
    </span>
  );
}

/* ---------------- Border beam ---------------- */
/** A thin light traveling around a card or button's border — add the
 *  `beam` class alongside the element's existing classes. Pure CSS
 *  (`@property --beam-angle` + a rotating conic-gradient ring), it reads
 *  the element's own border-radius so no extra markup is needed. */
