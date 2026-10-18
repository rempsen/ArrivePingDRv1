/**
 * Screen geometry for dragging a job onto a technician (dispatch map).
 *
 * Pure maths so it can be unit-tested; the drag engine feeds it screen points
 * (from MapLibre's `project()`) and the map's bounding rectangle every frame.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ScreenTarget {
  id: string;
  x: number;
  y: number;
}

/** The target closest to `p`, if it is within `radius` pixels (inclusive). Ties keep the first. */
export function nearestWithin(p: Pt, targets: readonly ScreenTarget[], radius: number): { id: string; d: number } | null {
  let best: { id: string; d: number } | null = null;
  for (const t of targets) {
    if (!Number.isFinite(t.x) || !Number.isFinite(t.y)) continue;
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (d <= radius && (best === null || d < best.d)) best = { id: t.id, d };
  }
  return best;
}

export function pointInRect(p: Pt, r: Rect): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

/**
 * How far to pan the map this frame when the pointer rests near its edge.
 * Returns a MapLibre `panBy` offset: negative x shows more to the west. Speed
 * grows linearly from 0 at `edge` px inside the border to `maxSpeed` at the
 * border. Outside the map (e.g. back over the queue) it never pans.
 */
export function edgePan(p: Pt, r: Rect, edge = 32, maxSpeed = 18): { dx: number; dy: number } {
  if (!pointInRect(p, r) || edge <= 0) return { dx: 0, dy: 0 };
  const push = (dist: number) => (dist < edge ? maxSpeed * (1 - dist / edge) : 0);
  const dx = push(r.right - p.x) - push(p.x - r.left);
  const dy = push(r.bottom - p.y) - push(p.y - r.top);
  return { dx, dy };
}
