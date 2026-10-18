/**
 * Pointer-driven drag of a job onto a technician. One engine for mouse, touch
 * and pen, because the HTML5 drag-and-drop API doesn't work on touch and can't
 * see a WebGL canvas.
 *
 * Sources: anything with `data-drag-job="<id>"` inside a bound root (queue
 * cards, inspector header), and map pins via `attachSurface`.
 * Targets: DOM elements with `data-drop-tech="<id>"` (strip, inspector), and
 * technician markers on the map, which are found with a magnet radius instead
 * of exact hits so a drop near a face counts.
 *
 * Mouse picks up after 4 px of travel. Touch needs a 250 ms hold, and moving
 * more than 8 px first means the person is scrolling, so it lets go.
 */
import { edgePan, nearestWithin, pointInRect, type Rect, type ScreenTarget } from "../../../../shared/drag-geometry";

export interface DragInfo {
  jobId: string;
  title: string;
  sub: string;
}

export interface DragHooks {
  /** Technician markers on screen, in viewport pixels. Empty when the map shows dots. */
  targets(): ScreenTarget[];
  mapRect(): Rect | null;
  panBy(dx: number, dy: number): void;
  /** A drag has started. Return false to refuse (nothing is dragged). */
  begin(info: DragInfo): boolean | void;
  /** The technician under the pointer changed (null: none). */
  hover(techId: string | null, via: "dom" | "magnet" | null): void;
  /** Released over a technician. Not called when released on nothing. */
  drop(jobId: string, techId: string): void;
  /** Always called last, after a drop or a cancel. */
  end(): void;
  /** Stop the map reacting to pointers while a drag owns them. */
  lockMap(locked: boolean): void;
}

export interface SurfaceHit {
  jobId: string;
  title: string;
  sub: string;
}

export interface DragEngine {
  bindRoot(root: HTMLElement): () => void;
  attachSurface(el: HTMLElement, hit: (clientX: number, clientY: number) => SurfaceHit | null): () => void;
  active(): boolean;
  cancel(): void;
  destroy(): void;
}

const MOUSE_SLOP = 4;
const TOUCH_SLOP = 8;
const HOLD_MS = 250;
const EDGE_DWELL_MS = 300;

export const MAGNET_MOUSE = 56;
export const MAGNET_TOUCH = 72;

export function createDragEngine(hooks: DragHooks): DragEngine {
  const unbinders = new Set<() => void>();

  interface Pending {
    info: DragInfo;
    pointerId: number;
    touch: boolean;
    x0: number;
    y0: number;
    x: number;
    y: number;
    timer: number;
    /** For a map pin on mouse the map's own pan is stopped from the first press. */
    lockedMap: boolean;
  }
  let pending: Pending | null = null;
  let live: { info: DragInfo; touch: boolean; ghost: HTMLElement; x: number; y: number; tech: string | null; via: "dom" | "magnet" | null; edgeSince: number; raf: number } | null = null;

  const isTouchy = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen";

  function makeGhost(info: DragInfo): HTMLElement {
    const g = document.createElement("div");
    g.className = "ap-ghost";
    g.setAttribute("aria-hidden", "true");
    const card = document.createElement("div");
    card.className = "ap-ghost__card";
    const t = document.createElement("div");
    t.className = "ap-ghost__title";
    t.textContent = info.title;
    const s = document.createElement("div");
    s.className = "ap-ghost__sub";
    s.textContent = info.sub;
    card.append(t, s);
    g.append(card);
    document.body.append(g);
    return g;
  }

  function place() {
    if (!live) return;
    live.ghost.style.transform = `translate3d(${Math.round(live.x + 14)}px, ${Math.round(live.y + 14)}px, 0)`;
  }

  function resolve(x: number, y: number): { tech: string | null; via: "dom" | "magnet" | null } {
    const el = document.elementFromPoint(x, y);
    const dom = el?.closest<HTMLElement>("[data-drop-tech]")?.dataset.dropTech;
    if (dom) return { tech: dom, via: "dom" };
    const rect = hooks.mapRect();
    if (rect && pointInRect({ x, y }, rect)) {
      const near = nearestWithin({ x, y }, hooks.targets(), live?.touch ? MAGNET_TOUCH : MAGNET_MOUSE);
      if (near) return { tech: near.id, via: "magnet" };
    }
    return { tech: null, via: null };
  }

  function update() {
    if (!live) return;
    place();
    const r = resolve(live.x, live.y);
    if (r.tech !== live.tech) {
      live.tech = r.tech;
      live.via = r.via;
      if (r.tech) live.ghost.setAttribute("data-magnet", "");
      else live.ghost.removeAttribute("data-magnet");
      hooks.hover(r.tech, r.via);
    }
  }

  function tick() {
    if (!live) return;
    const rect = hooks.mapRect();
    if (rect && pointInRect({ x: live.x, y: live.y }, rect)) {
      const p = edgePan({ x: live.x, y: live.y }, rect);
      if (p.dx || p.dy) {
        live.edgeSince ||= performance.now();
        if (performance.now() - live.edgeSince > EDGE_DWELL_MS) {
          hooks.panBy(p.dx, p.dy);
          update();
        }
      } else live.edgeSince = 0;
    } else live.edgeSince = 0;
    live.raf = requestAnimationFrame(tick);
  }

  const blockScroll = (e: TouchEvent) => {
    if (live && e.cancelable) e.preventDefault();
  };

  function start(p: Pending) {
    if (hooks.begin(p.info) === false) {
      abandon();
      return;
    }
    window.clearTimeout(p.timer);
    pending = null;
    hooks.lockMap(true);
    live = { info: p.info, touch: p.touch, ghost: makeGhost(p.info), x: p.x, y: p.y, tech: null, via: null, edgeSince: 0, raf: 0 };
    document.body.classList.add("ap-dragging");
    update();
    live.raf = requestAnimationFrame(tick);
  }

  function abandon() {
    if (!pending) return;
    window.clearTimeout(pending.timer);
    if (pending.lockedMap) hooks.lockMap(false);
    pending = null;
    detach();
  }

  function finish(drop: boolean) {
    if (!live) return;
    const l = live;
    live = null;
    cancelAnimationFrame(l.raf);
    l.ghost.remove();
    document.body.classList.remove("ap-dragging");
    hooks.lockMap(false);
    if (l.tech) hooks.hover(null, null);
    if (drop && l.tech) hooks.drop(l.info.jobId, l.tech);
    hooks.end();
    detach();
  }

  function onMove(e: PointerEvent) {
    if (pending && e.pointerId === pending.pointerId) {
      pending.x = e.clientX;
      pending.y = e.clientY;
      const moved = Math.hypot(e.clientX - pending.x0, e.clientY - pending.y0);
      if (!pending.touch && moved >= MOUSE_SLOP) start(pending);
      else if (pending.touch && moved > TOUCH_SLOP) abandon(); // they are scrolling
    } else if (live) {
      live.x = e.clientX;
      live.y = e.clientY;
      update();
    }
  }
  const onUp = (e: PointerEvent) => {
    if (pending && e.pointerId === pending.pointerId) abandon();
    else if (live) {
      live.x = e.clientX;
      live.y = e.clientY;
      update();
      finish(true);
    }
  };
  const onCancel = () => {
    abandon();
    finish(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && (live || pending)) {
      e.preventDefault();
      onCancel();
    }
  };

  function attach() {
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onCancel);
    document.addEventListener("touchmove", blockScroll, { passive: false });
  }
  function detach() {
    if (live || pending) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", onCancel);
    document.removeEventListener("touchmove", blockScroll);
  }

  function press(e: PointerEvent, info: DragInfo, lockMapNow: boolean) {
    if (pending || live) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const touch = isTouchy(e);
    const p: Pending = { info, pointerId: e.pointerId, touch, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, timer: 0, lockedMap: false };
    if (touch) p.timer = window.setTimeout(() => pending === p && start(p), HOLD_MS);
    else if (lockMapNow) {
      hooks.lockMap(true);
      p.lockedMap = true;
    }
    pending = p;
    attach();
  }

  return {
    bindRoot(root) {
      const down = (e: PointerEvent) => {
        const src = (e.target as Element | null)?.closest<HTMLElement>("[data-drag-job]");
        if (!src || !root.contains(src)) return;
        // Buttons inside a card (the "Assign" menu) stay clickable.
        if ((e.target as Element).closest("[data-no-drag]")) return;
        press(e, { jobId: src.dataset.dragJob!, title: src.dataset.dragTitle ?? "", sub: src.dataset.dragSub ?? "" }, false);
      };
      root.addEventListener("pointerdown", down);
      const off = () => root.removeEventListener("pointerdown", down);
      unbinders.add(off);
      return () => {
        off();
        unbinders.delete(off);
      };
    },
    attachSurface(el, hit) {
      const down = (e: PointerEvent) => {
        const h = hit(e.clientX, e.clientY);
        if (!h) return;
        // Capture phase: runs before the map's own handlers, so the map doesn't start a pan.
        press(e, { jobId: h.jobId, title: h.title, sub: h.sub }, true);
      };
      el.addEventListener("pointerdown", down, true);
      const off = () => el.removeEventListener("pointerdown", down, true);
      unbinders.add(off);
      return () => {
        off();
        unbinders.delete(off);
      };
    },
    active: () => !!live,
    cancel: onCancel,
    destroy() {
      onCancel();
      for (const u of unbinders) u();
      unbinders.clear();
    },
  };
}
