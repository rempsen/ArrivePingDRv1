/**
 * Scroll reveals.
 *
 * Elements carry `data-reveal` (optionally `data-reveal-delay="1|2|3"` for a
 * 60ms stagger). Content is visible by default; only after mount — and only
 * when motion is allowed — does the root get `data-motion="on"`, which lets
 * CSS hide not-yet-revealed elements. Elements already in the viewport at
 * mount are marked revealed synchronously, so nothing flashes.
 */
import { useEffect, type RefObject } from "react";
import { usePlayback } from "./playback";

export function useReveal(root: RefObject<HTMLElement | null>) {
  const { reduced } = usePlayback();
  useEffect(() => {
    const el = root.current;
    if (!el || reduced || typeof IntersectionObserver === "undefined") return;
    const items = Array.from(el.querySelectorAll<HTMLElement>("[data-reveal]"));
    const vh = window.innerHeight;
    const pending: HTMLElement[] = [];
    for (const it of items) {
      const r = it.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) it.classList.add("is-in");
      else pending.push(it);
    }
    el.setAttribute("data-motion", "on");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -5% 0px" },
    );
    for (const it of pending) io.observe(it);
    return () => {
      io.disconnect();
      el.removeAttribute("data-motion");
    };
  }, [root, reduced]);
}
