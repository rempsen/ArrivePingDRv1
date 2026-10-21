/**
 * Connection state for the dispatch live stream. Pure, so the "give up and
 * poll" rule is testable without sockets: two failed connections in a row
 * mark the stream down and the board query falls back to polling until a
 * connection opens again.
 */
export type StreamStatus = "idle" | "open" | "down";

export interface StreamState {
  status: StreamStatus;
  failures: number;
}

export type StreamAction = "open" | "error" | "close" | "reset";

export const DOWN_AFTER = 2;

export const initialStreamState: StreamState = { status: "idle", failures: 0 };

export function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action) {
    case "open":
      return { status: "open", failures: 0 };
    case "error": {
      const failures = state.failures + 1;
      return { status: failures >= DOWN_AFTER ? "down" : "idle", failures };
    }
    case "close":
      return { status: state.status === "down" ? "down" : "idle", failures: state.failures };
    case "reset":
      return initialStreamState;
  }
}

/** Reconnect delay: 1 s, 2 s, 4 s … capped at 30 s. */
export function backoffMs(failures: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, failures - 1));
}
