/**
 * Tap-to-place on the dispatch board.
 *
 * Dragging a block across a touch board is where mistakes happen, and it
 * would cost two native modules. Instead: tap a job (a block on a row or a
 * row in the Unassigned column) and it arms; tap a time on a technician's
 * row and a confirm card asks "Move X to Y at 2:15?"; Place runs the same
 * assign / schedule calls the Assign sheet uses, with the same force and
 * Undo handling. Pure state machine so bun tests cover every transition.
 */
import { TERMINAL } from "./board";
import { clampStart, durationOf, instantFor, snapMinutes, type Range } from "./timeline";

export type PlaceState =
  | { kind: "idle" }
  | { kind: "armed"; jobId: string }
  | { kind: "confirm"; jobId: string; techId: string; startMin: number };

export type PlaceAction =
  | { type: "arm"; jobId: string }
  | { type: "tapCell"; techId: string; startMin: number }
  | { type: "cancel" }
  | { type: "done" };

export const IDLE: PlaceState = { kind: "idle" };

export function placeReducer(state: PlaceState, action: PlaceAction): PlaceState {
  switch (action.type) {
    case "arm":
      // Tapping the armed job again disarms it; tapping another re-arms.
      if (state.kind === "armed" && state.jobId === action.jobId) return IDLE;
      return { kind: "armed", jobId: action.jobId };
    case "tapCell":
      if (state.kind === "armed") return { kind: "confirm", jobId: state.jobId, techId: action.techId, startMin: action.startMin };
      if (state.kind === "confirm") return { ...state, techId: action.techId, startMin: action.startMin };
      return state;
    case "cancel":
    case "done":
      return IDLE;
  }
}

/** Finished jobs don't move. */
export function canArm(job: { status: string }): boolean {
  return !TERMINAL.has(job.status);
}

/** A technician on time off that day takes nothing. */
export function canPlace(dayOff: boolean): boolean {
  return !dayOff;
}

/** Where on the row a tap lands, snapped to the quarter hour and kept inside the window. */
export function placedStart(rawMin: number, job: { durationMins?: number | null }, range: Range): number {
  return clampStart(snapMinutes(rawMin), durationOf(job), range);
}

export type PlacementRequest =
  | { kind: "assign"; riderId: string; scheduledAt: string; expectRiderId: string | null }
  | { kind: "schedule"; scheduledAt: string };

/**
 * One request, so the move happens whole or not at all: a new technician (or
 * a job nobody had) goes through assign with the time; the same technician
 * at a new time is a schedule change only.
 */
export function placementRequest(job: { riderId: string | null }, techId: string, startMin: number, day: string, tz: string): PlacementRequest {
  const scheduledAt = instantFor(day, startMin, tz);
  if (job.riderId === techId) return { kind: "schedule", scheduledAt };
  return { kind: "assign", riderId: techId, scheduledAt, expectRiderId: job.riderId };
}
