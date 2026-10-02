/**
 * Time-based scene controller.
 *
 * A scene is described by `marks` — ascending millisecond offsets at which it
 * advances one step — and a `total` length. The hook returns the current
 * `step` (0 = establish, marks.length = settled), a `cycle` counter that
 * increments on each loop (scenes key their content on it so the loop reset
 * is a deliberate re-entrance rather than a reverse transition) and
 * `restart`.
 *
 * Playback requires the scene to be meaningfully visible AND the site-wide
 * playback not paused/hidden. Pausing freezes the elapsed time; resuming
 * continues from the same moment — scrollspy or re-renders never restart it.
 * Under reduced motion the scene renders its settled step immediately and
 * exposes `prev`/`next` for explicit stepping.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { usePlayback } from "./playback";

export function useInView(ref: RefObject<Element | null>, threshold = 0.35): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setInView(e.isIntersecting && e.intersectionRatio >= threshold * 0.9);
      },
      { threshold: [0, threshold, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold]);
  return inView;
}

export type SceneClock = {
  step: number;
  cycle: number;
  playing: boolean;
  settled: boolean;
  reduced: boolean;
  restart: () => void;
  prev: () => void;
  next: () => void;
};

export function useSceneClock(
  ref: RefObject<Element | null>,
  opts: { marks: readonly number[]; total: number; loop?: boolean; threshold?: number; enabled?: boolean },
): SceneClock {
  const { marks, total, loop = true, threshold = 0.35, enabled = true } = opts;
  const { paused, reduced, hidden } = usePlayback();
  const inView = useInView(ref, threshold);
  const playing = enabled && inView && !paused && !hidden && !reduced;

  const [step, setStep] = useState(reduced ? marks.length : 0);
  const [cycle, setCycle] = useState(0);
  const [nonce, setNonce] = useState(0);
  const elapsedRef = useRef(0);
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const marksKey = marks.join(",");

  useEffect(() => {
    if (reduced) {
      setStep(marks.length);
      return;
    }
    if (!playing || doneRef.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    startRef.current = performance.now() - elapsedRef.current;

    const tick = () => {
      const elapsed = performance.now() - startRef.current;
      let s = 0;
      for (const m of marks) if (m <= elapsed) s++;
      setStep(s);
      const nextMark = marks.find((m) => m > elapsed);
      if (nextMark !== undefined) {
        timer = setTimeout(tick, Math.max(16, nextMark - elapsed));
        return;
      }
      if (elapsed < total) {
        timer = setTimeout(tick, Math.max(16, total - elapsed));
        return;
      }
      if (!loop) {
        elapsedRef.current = total;
        doneRef.current = true;
        return;
      }
      // loop: deliberate reset
      startRef.current = performance.now();
      elapsedRef.current = 0;
      setStep(0);
      setCycle((c) => c + 1);
      timer = setTimeout(tick, Math.max(16, marks[0] ?? total));
    };
    tick();
    return () => {
      if (timer) clearTimeout(timer);
      elapsedRef.current = Math.min(total, performance.now() - startRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, reduced, loop, total, marksKey, nonce]);

  const restart = useCallback(() => {
    elapsedRef.current = 0;
    doneRef.current = false;
    setStep(0);
    setCycle((c) => c + 1);
    setNonce((n) => n + 1);
  }, []);
  const prev = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);
  const next = useCallback(() => setStep((s) => Math.min(marks.length, s + 1)), [marks.length]);

  return { step, cycle, playing, settled: step >= marks.length, reduced, restart, prev, next };
}
