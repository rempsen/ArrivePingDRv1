/**
 * Tour anchors — the single list of elements the ArrivePing Guide points at.
 *
 * Every tour step names one of these ids, and the element it means carries
 * `data-tour="<id>"` (spread `tourAttr(id)` on it). Keeping the list typed
 * means a renamed anchor is a compile error, and the guide-lint e2e test can
 * walk the same list to prove every anchor still renders.
 */
export const ANCHORS = [
  // Shell: sidebar groups, guide button, mobile top bar
  "nav.group.operations",
  "nav.group.catalog-forms",
  "nav.group.people",
  "nav.group.money",
  "nav.group.setup",
  "nav.scheduler",
  "nav.jobs",
  "nav.map",
  "guide.button",
  "topbar.menu",
  // Jobs page + new-job form
  "jobs.new",
  "wo.customer",
  "wo.schedule",
  "wo.assign",
  "wo.create",
  // Scheduler
  "sched.mode",
  "sched.calendar",
  "sched.new-job",
  "sched.views",
  "sched.queue",
] as const;

export type AnchorId = (typeof ANCHORS)[number];

/** Spread on the element a tour step points at: `<div {...tourAttr("sched.views")}>`. */
export function tourAttr(id: AnchorId): { "data-tour": AnchorId } {
  return { "data-tour": id };
}

/** Slug used for sidebar group anchors ("Catalog & Forms" → "catalog-forms"). */
export function groupAnchor(heading: string): string {
  return `nav.group.${heading.toLowerCase().replace(/&/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

/** Sidebar link anchors for the routes a tour points at. */
const NAV_ROUTE_ANCHORS: Record<string, AnchorId> = {
  "/admin/scheduler": "nav.scheduler",
  "/admin/work-orders": "nav.jobs",
  "/admin/fleet": "nav.map",
};
export function navAnchor(route: string): AnchorId | undefined {
  return NAV_ROUTE_ANCHORS[route];
}

/**
 * The first VISIBLE element carrying the anchor. The sidebar renders twice
 * (desktop aside + mobile drawer), so a plain querySelector could return the
 * hidden copy and the spotlight would land on nothing.
 */
export function findAnchor(id: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
  }
  return null;
}

/** Resolves once the anchor is visible, or null after `timeoutMs`. */
export function waitForAnchor(id: string, timeoutMs = 4000): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      const el = findAnchor(id);
      if (el) return resolve(el);
      if (performance.now() - start > timeoutMs) return resolve(null);
      requestAnimationFrame(tick);
    };
    tick();
  });
}
