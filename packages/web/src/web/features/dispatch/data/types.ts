/**
 * The shapes the dispatch map shares with its API. Type-only re-exports, so the
 * server and the screen can't drift apart.
 */
export type { Board, BoardJob, BoardTech } from "../../../../services/dispatch-board";
export type { DispatchCandidate } from "../../../../services/dispatch-candidates";
export type { JobPatch } from "../../../../services/dispatch-assign";
export type { Clash, ClashKind, Fit } from "../../../../shared/dispatch-fit";
export type { LocationFrame } from "../../../../shared/board-patch";

/** What is selected on the map: a technician or a job, mirrored to the URL. */
export type Selection = { kind: "tech" | "job"; id: string } | null;
