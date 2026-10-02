/**
 * Header offset + chapter scrollspy for the product showcase.
 *
 * `useHeaderOffset` measures the sticky header at runtime (ResizeObserver) and
 * writes `--header-offset` on the site root so sticky/scroll-margin CSS never
 * hardcodes a value that goes stale when the header wraps.
 *
 * `useScrollspy` selects the chapter whose start most recently crossed a
 * reading line 30% down the viewport below the header. One rAF per
 * scroll/resize; geometry cached and refreshed via ResizeObserver. Selection
 * is independent of scene playback.
 */
import { useEffect, useRef, useState, type RefObject } from "react";

export function useHeaderOffset(headerRef: RefObject<HTMLElement | null>, rootRef: RefObject<HTMLElement | null>) {
  const [offset, setOffset] = useState(72);
  useEffect(() => {
    const header = headerRef.current;
    const root = rootRef.current;
    if (!header || !root) return;
    const apply = () => {
      const h = Math.round(header.getBoundingClientRect().height);
      setOffset(h);
      root.style.setProperty("--header-offset", `${h}px`);
    };
    apply();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    ro?.observe(header);
    window.addEventListener("resize", apply);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [headerRef, rootRef]);
  return offset;
}

export function readHeaderOffset(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--header-offset") ||
    getComputedStyle(document.querySelector(".site") ?? document.documentElement).getPropertyValue("--header-offset");
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 72;
}

export function useScrollspy(containerRef: RefObject<HTMLElement | null>, ids: readonly string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");
  const activeRef = useRef(active);
  const idsKey = ids.join("|");

  useEffect(() => {
    const container = containerRef.current;
    if (!container || ids.length === 0) return;
    let tops: { id: string; top: number }[] = [];
    let raf = 0;

    const measure = () => {
      tops = ids
        .map((id) => {
          const el = document.getElementById(id);
          return el ? { id, top: el.getBoundingClientRect().top + window.scrollY } : null;
        })
        .filter((x): x is { id: string; top: number } => !!x);
    };

    const select = () => {
      raf = 0;
      if (!tops.length) return;
      const header = readHeaderOffset();
      const readingLine = header + (window.innerHeight - header) * 0.3;
      const pos = window.scrollY + readingLine;
      let next = tops[0].id;
      for (const t of tops) if (t.top <= pos) next = t.id;
      if (next !== activeRef.current) {
        activeRef.current = next;
        setActive(next);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(select);
    };
    const remeasure = () => {
      measure();
      schedule();
    };

    measure();
    select();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", remeasure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(remeasure) : null;
    ro?.observe(container);
    ro?.observe(document.body);
    // fonts/late media can shift geometry
    const t = setTimeout(remeasure, 800);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", remeasure);
      ro?.disconnect();
      clearTimeout(t);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, idsKey]);

  return active;
}

/** Scroll to an in-page anchor below the measured header; instant under reduced motion. */
export function scrollToAnchor(id: string, reduced: boolean, extra = 24) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - readHeaderOffset() - extra;
  window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
}
