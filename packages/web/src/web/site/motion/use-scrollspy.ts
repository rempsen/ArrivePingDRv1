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
      let next = tops[0]!.id;
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
/** Extra offset needed when the target sits under the sticky chapter strip (narrow screens). */
export function stickyRailExtra(el: Element): number {
  const chapters = el.closest(".showcase-chapters");
  const rail = chapters?.parentElement?.querySelector<HTMLElement>(".showcase-rail");
  if (!rail || getComputedStyle(rail).position !== "sticky") return 0;
  return rail.getBoundingClientRect().height;
}

/**
 * Gap left under the header when a section marked `.anchor--content` is
 * scrolled to: its own top padding is skipped, so the heading sits just
 * below the header instead of a band of empty space (Pricing).
 */
export const CONTENT_ANCHOR_GAP = 16;

export function scrollToAnchor(id: string, reduced: boolean, extra?: number) {
  const el = document.getElementById(id);
  if (!el) return;
  const base = el.classList.contains("anchor--content")
    ? CONTENT_ANCHOR_GAP - (parseFloat(getComputedStyle(el).paddingTop) || 0)
    : 24;
  const gap = extra ?? base + stickyRailExtra(el);
  const target = () => el.getBoundingClientRect().top + window.scrollY - readHeaderOffset() - gap;
  window.scrollTo({ top: target(), behavior: reduced ? "auto" : "smooth" });
  settleOn(target);
}

/**
 * Content above a section can still change height during a long smooth
 * scroll (images and demos loading as they come into view). On a phone that
 * left Pricing's heading under the header on the first tap. Once the scroll
 * comes to rest, re-measure and correct; stop if the person scrolls themselves.
 */
let settling = 0;
function settleOn(target: () => number) {
  // A newer anchor click takes over from this one.
  const run = ++settling;
  let last = Number.NaN;
  let still = 0;
  let frames = 0;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };
  const opts: AddEventListenerOptions = { once: true, passive: true };
  window.addEventListener("wheel", cancel, opts);
  window.addEventListener("touchstart", cancel, opts);
  window.addEventListener("keydown", cancel, opts);
  window.addEventListener("pointerdown", cancel, opts);
  const done = () => {
    window.removeEventListener("wheel", cancel);
    window.removeEventListener("touchstart", cancel);
    window.removeEventListener("keydown", cancel);
    window.removeEventListener("pointerdown", cancel);
  };
  const tick = () => {
    if (cancelled || run !== settling || ++frames > 240) return done();
    const y = window.scrollY;
    still = y === last ? still + 1 : 0;
    last = y;
    if (still < 6) {
      requestAnimationFrame(tick);
      return;
    }
    done();
    const want = Math.round(target());
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (Math.abs(Math.min(want, max) - y) > 3) window.scrollTo({ top: want, behavior: "auto" });
  };
  requestAnimationFrame(tick);
}
