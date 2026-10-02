/**
 * Site-wide playback state for ambient scenes.
 *
 *  - `paused`  : visitor pressed "Pause animations" (persists for the session)
 *  - `reduced` : prefers-reduced-motion — scenes render their settled state
 *  - `hidden`  : document.visibilityState === "hidden"
 *
 * Scenes combine this with their own in-view check (see `useSceneClock`).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type Playback = {
  paused: boolean;
  reduced: boolean;
  hidden: boolean;
  setPaused: (v: boolean) => void;
  toggle: () => void;
};

const Ctx = createContext<Playback>({
  paused: false,
  reduced: false,
  hidden: false,
  setPaused: () => {},
  toggle: () => {},
});

const KEY = "ap-site-paused";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [paused, setPausedState] = useState(false);
  const [hidden, setHidden] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    try {
      setPausedState(sessionStorage.getItem(KEY) === "1");
    } catch {
      /* storage unavailable */
    }
    const onVis = () => setHidden(document.visibilityState === "hidden");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const setPaused = useCallback((v: boolean) => {
    setPausedState(v);
    try {
      sessionStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);
  const toggle = useCallback(() => setPaused(!paused), [paused, setPaused]);

  const value = useMemo(() => ({ paused, reduced, hidden, setPaused, toggle }), [paused, reduced, hidden, setPaused, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlayback() {
  return useContext(Ctx);
}
