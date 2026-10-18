import { useEffect, useMemo, useRef } from "react";
import { Joyride, EVENTS, STATUS, ACTIONS, type Controls, type EventData, type Step } from "react-joyride";
import { useLocation } from "wouter";
import { ApTooltip } from "./ApTooltip";
import { findAnchor, waitForAnchor } from "./anchors";
import { interpolate, type Chapter, type Terms } from "./registry";

/**
 * Runs one Guide chapter with React Joyride v3.
 *
 * Lazy-loaded (see GuideProvider) so Joyride and Floating UI only download
 * when someone actually starts a tour.
 *
 * Cross-page steps: a step with `route` navigates there in its `before` hook
 * and waits for its anchor to render. Sidebar steps on small screens open the
 * mobile drawer first (the shell listens for the `ap:guide` window event).
 * A step whose anchor never appears is skipped rather than leaving the user
 * stuck — and reported, so guide-lint and analytics can catch it.
 */
export interface TourRunnerProps {
  chapter: Chapter;
  terms: Terms;
  onFinish: (result: "completed" | "skipped", lastIndex: number) => void;
}

const MOBILE_QUERY = "(max-width: 767px)";

function setDrawer(open: boolean) {
  window.dispatchEvent(new CustomEvent("ap:guide", { detail: { drawer: open ? "open" : "close" } }));
}

export default function TourRunner({ chapter, terms, onFinish }: TourRunnerProps) {
  const [location, navigate] = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;
  const controlsRef = useRef<Controls | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null,
  );
  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const steps: Step[] = useMemo(
    () =>
      chapter.steps.map((s) => {
        const anchor = s.anchor;
        return {
          id: `${chapter.id}.${s.id}`,
          title: interpolate(s.title, terms),
          content: interpolate(s.body, terms),
          data: { chapter: `Chapter ${chapter.number} · ${interpolate(chapter.title, terms)}` },
          target: anchor ? () => findAnchor(anchor) : "body",
          placement: anchor ? (s.placement ?? "auto") : "center",
          ...(s.centerScroll ? { skipScroll: true } : {}),
          before: async () => {
            const mobile = window.matchMedia(MOBILE_QUERY).matches;
            if (s.route && locationRef.current !== s.route) {
              setDrawer(false);
              navigate(s.route);
            }
            if (mobile) setDrawer(Boolean(s.inNav));
            if (anchor && s.open && !findAnchor(anchor)) {
              (await waitForAnchor(s.open, 4000))?.click();
            }
            if (anchor) {
              // Joyride scrolls the page vertically; a target inside a sideways-
              // scrolling container (the notification matrix on a phone) also
              // needs its container scrolled, or the card points off screen.
              const el = await waitForAnchor(anchor, 4000);
              // Mark the current target (read by the guide e2e to check it's on screen).
              for (const prev of document.querySelectorAll("[data-guide-active]")) prev.removeAttribute("data-guide-active");
              if (el) {
                el.setAttribute("data-guide-active", "");
                // A small target that is off screen is centred, leaving room for
                // the card above or below it. Joyride's own scroll picks the
                // nearest scrolling ancestor, which for a table cell is the
                // table, not the page.
                const r = el.getBoundingClientRect();
                const offY = r.top < 0 || r.bottom > window.innerHeight;
                const small = r.height < window.innerHeight * 0.4;
                el.scrollIntoView({ block: s.centerScroll || (offY && small) ? "center" : "nearest", inline: "nearest", behavior: "auto" });
              }
            }
          },
        } satisfies Step;
      }),
    [chapter, terms, navigate],
  );

  // ← → move between steps; Esc exits the chapter. (Joyride's own Esc
  // "close" only closes the current step and moves on, which reads as Next.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "ArrowRight") controlsRef.current?.next();
      if (e.key === "ArrowLeft") controlsRef.current?.prev();
      if (e.key === "Escape") controlsRef.current?.skip("button_close");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleEvent = (data: EventData, controls: Controls) => {
    controlsRef.current = controls;
    if (data.type === EVENTS.TARGET_NOT_FOUND) {
      console.warn(`[guide] anchor missing for ${String(data.step?.id)}; skipping step`);
      controls.next();
      return;
    }
    if (data.type === EVENTS.TOUR_END || data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
      if (data.type !== EVENTS.TOUR_END && data.type !== EVENTS.TOUR_STATUS) return;
      setDrawer(false);
      const skipped = data.status === STATUS.SKIPPED || data.action === ACTIONS.CLOSE || data.action === ACTIONS.SKIP;
      // Back to where the user was; if that was a menu item that has since
      // closed (e.g. the Guide menu), back to the Guide launcher instead.
      const el = returnFocusRef.current;
      const target = el && document.contains(el) && el !== document.body ? el : findAnchor("guide.button");
      target?.focus({ preventScroll: true });
      onFinish(skipped ? "skipped" : "completed", data.index);
    }
  };

  return (
    <Joyride
      run
      continuous
      steps={steps}
      onEvent={handleEvent}
      tooltipComponent={ApTooltip}
      scrollToFirstStep
      floatingOptions={{ hideArrow: false }}
      options={{
        zIndex: 10_000,
        overlayColor: "rgba(3, 6, 12, 0.62)",
        primaryColor: "#0ea5e9",
        arrowColor: "#0d1424",
        backgroundColor: "#0d1424",
        textColor: "#e2e8f0",
        spotlightRadius: 12,
        spotlightPadding: 6,
        dismissKeyAction: false,
        overlayClickAction: false,
        closeButtonAction: "skip",
        skipBeacon: true,
        blockTargetInteraction: false,
        targetWaitTimeout: 4000,
        beforeTimeout: 6000,
        scrollDuration: reducedMotion ? 0 : 300,
        scrollOffset: 96,
      }}
    />
  );
}
