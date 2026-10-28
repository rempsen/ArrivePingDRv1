/**
 * Drag-and-drop on the dispatch board: where a finger is, in board terms.
 * Pure (no react-native) so bun tests cover the geometry.
 *
 * The timeline is one vertical ScrollView holding a fixed gutter and a
 * sideways-scrolling grid; the hour header scrolls with the rows. A drop is
 * the same placement as tap-to-place (lib/board-place.ts): it fills in the
 * technician and time, and the confirm card does the rest.
 */
import { GUTTER_W, ROW_H, minuteAtX, type Range } from "./timeline";

export const HEADER_H = 36;
/** Finger travel (pt) before a held block counts as dragged rather than held to open. */
export const DRAG_SLOP = 8;
/** How close to an edge (pt) starts auto-scrolling, and how far each move scrolls. */
export const EDGE = 56;
export const EDGE_STEP = 18;

export interface TimelineGeom {
  /** The vertical ScrollView's frame in window coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Current offsets of the vertical and the horizontal scroll views. */
  scrollX: number;
  scrollY: number;
}

/** The technician row and raw minute under a window point, or null outside the grid. */
export function hitCell(g: TimelineGeom, absX: number, absY: number, techIds: readonly string[], range: Range): { techId: string; rawMin: number } | null {
  const lx = absX - g.x;
  const ly = absY - g.y;
  if (lx < GUTTER_W || lx > g.w || ly < 0 || ly > g.h) return null;
  const gy = ly + g.scrollY - HEADER_H;
  if (gy < 0) return null;
  const techId = techIds[Math.floor(gy / ROW_H)];
  if (!techId) return null;
  const rawMin = minuteAtX(lx - GUTTER_W + g.scrollX, range);
  return { techId, rawMin: Math.max(range.startMin, Math.min(range.endMin, rawMin)) };
}

/** Sideways and vertical nudges when the finger sits near an edge of the grid while dragging. */
export function edgeScroll(g: TimelineGeom, absX: number, absY: number): { dx: number; dy: number } {
  const lx = absX - g.x;
  const ly = absY - g.y;
  const dx = lx > g.w - EDGE && lx <= g.w ? EDGE_STEP : lx >= GUTTER_W && lx < GUTTER_W + EDGE ? -EDGE_STEP : 0;
  const dy = ly > g.h - EDGE && ly <= g.h ? EDGE_STEP : ly >= 0 && ly < EDGE ? -EDGE_STEP : 0;
  return { dx, dy };
}

export function travelled(dx: number, dy: number): boolean {
  return Math.abs(dx) + Math.abs(dy) > DRAG_SLOP;
}

/** Shortest a job can be dragged to, and the step the edge snaps to. */
export const MIN_JOB_MINS = 15;
export const RESIZE_STEP = 15;

/**
 * The job's new length after dragging its right edge `dxPt` points: snapped
 * to 15 minutes, at least 15 long, never past midnight.
 */
export function resizedMins(startMin: number, durationMins: number, dxPt: number, hourW: number): number {
  const rawEnd = startMin + durationMins + (dxPt / hourW) * 60;
  const snapped = Math.round(rawEnd / RESIZE_STEP) * RESIZE_STEP;
  const end = Math.min(24 * 60, Math.max(startMin + MIN_JOB_MINS, snapped));
  return end - startMin;
}

/** "45 min", "2 h", "2 h 30 min". */
export function lengthLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
