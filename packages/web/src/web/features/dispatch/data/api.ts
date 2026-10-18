/**
 * Calls to /api/dispatch. Every one carries the same auth and company headers
 * as the rest of the app (apiHeaders), and a failed call throws ApiError with
 * the server's sentence in `message` and its JSON in `body`.
 */
import { apiFetch, apiHeaders } from "../../../lib/api";
import { ApiError } from "../../../lib/api-error";
import type { Board, DispatchCandidate, JobPatch } from "./types";

const BASE = "/api/dispatch";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(`${BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...apiHeaders(), ...init.headers },
  });
  return (await res.json()) as T;
}

export const fetchSettings = () => call<{ mapV2Default: boolean }>("/settings");

export const fetchBoard = (day?: string | null, signal?: AbortSignal, days = 1) => {
  const q = new URLSearchParams();
  if (day) q.set("day", day);
  if (days > 1) q.set("days", String(days));
  const qs = q.toString();
  return call<Board>(`/board${qs ? `?${qs}` : ""}`, { signal });
};

/** Jobs and booked minutes per company-time day (the calendar's Month view). */
export interface DayLoad {
  tz: string;
  techs: number;
  days: Array<{ day: string; jobs: number; bookedMins: number }>;
}
export const fetchLoad = (from: string, days: number, signal?: AbortSignal) =>
  call<DayLoad>(`/load?from=${encodeURIComponent(from)}&days=${days}`, { signal });

export async function fetchCandidates(ids: readonly string[], signal?: AbortSignal): Promise<Record<string, DispatchCandidate[]>> {
  if (ids.length === 0) return {};
  const r = await call<{ candidates: Record<string, DispatchCandidate[]> }>(`/candidates?jobs=${ids.map(encodeURIComponent).join(",")}`, { signal });
  return r.candidates;
}

export interface AssignInput {
  bookingId: string;
  riderId: string;
  force?: boolean;
}
export interface AssignResponse {
  job: JobPatch;
  /** Present when the assignment can be undone. */
  undo: string | null;
}

export const postAssign = (input: AssignInput) => call<AssignResponse>("/assign", { method: "POST", body: JSON.stringify(input) });
export interface ScheduleInput {
  bookingId: string;
  /** ISO instant */
  scheduledAt: string;
  force?: boolean;
}
export interface ScheduleResponse {
  job: JobPatch & { scheduledAt: string };
  /** Present when the move changed the time and can be undone. */
  undo: string | null;
}
export const postSchedule = (input: ScheduleInput) => call<ScheduleResponse>("/schedule", { method: "POST", body: JSON.stringify(input) });
export const postUndo = (token: string) => call<{ job: JobPatch }>("/undo", { method: "POST", body: JSON.stringify({ token }) });

/** A 409 from /assign: the sentence to show, and whether "Assign anyway" may override it. */
export interface Refusal {
  message: string;
  forceable: boolean;
  reason?: string;
}

/** The refusal inside an assign error, or null when the failure was something else. */
export function refusalOf(err: unknown): Refusal | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const b = err.body as { message?: unknown; forceable?: unknown; reason?: unknown } | undefined;
  return {
    message: typeof b?.message === "string" && b.message ? b.message : err.message,
    forceable: b?.forceable === true,
    ...(typeof b?.reason === "string" ? { reason: b.reason } : {}),
  };
}
