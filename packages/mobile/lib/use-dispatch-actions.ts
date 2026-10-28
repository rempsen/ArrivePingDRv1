import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { authHeaders } from "./auth";
import { getActiveCompany } from "./active-company";
import { classifyResponse, type DispatchResult } from "./dispatch-result";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");

async function post<T = unknown>(path: string, json: unknown, method: "POST" | "PATCH" = "POST"): Promise<DispatchResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(json),
    });
  } catch {
    return { ok: false, status: 0, message: "No connection. Check your signal and try again.", forceable: false };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return classifyResponse<T>(res.status, body);
}

export interface AssignOpts {
  /** Interrupt an in-field job / re-offer an accepted one. */
  force?: boolean;
  /** Double-book over a clash or time off (checked separately by the server). */
  forceBusy?: boolean;
  expectRiderId?: string | null;
  scheduledAt?: string;
}

/**
 * The dispatcher's writes. Every success invalidates this company's board
 * queries and the job's own query so each open screen re-reads the truth;
 * the caller decides what to show (an Undo toast, a force confirm).
 */
export function useDispatchActions() {
  const qc = useQueryClient();
  const company = getActiveCompany();

  const settle = useCallback(
    (bookingId: string) => {
      qc.invalidateQueries({ queryKey: ["board", company] });
      qc.invalidateQueries({ queryKey: ["booking", company, bookingId] });
      qc.invalidateQueries({ queryKey: ["candidates", company, bookingId] });
    },
    [qc, company],
  );

  const assign = useCallback(
    async (bookingId: string, riderId: string, opts: AssignOpts = {}) => {
      const r = await post("/api/dispatch/assign", { bookingId, riderId, ...opts });
      if (r.ok) settle(bookingId);
      return r;
    },
    [settle],
  );

  const schedule = useCallback(
    async (bookingId: string, scheduledAt: string, opts: { force?: boolean } = {}) => {
      const r = await post("/api/dispatch/schedule", { bookingId, scheduledAt, ...opts });
      if (r.ok) settle(bookingId);
      return r;
    },
    [settle],
  );

  const undo = useCallback(
    async (token: string, bookingId?: string) => {
      const r = await post("/api/dispatch/undo", { token });
      if (r.ok) {
        qc.invalidateQueries({ queryKey: ["board", company] });
        if (bookingId) settle(bookingId);
      }
      return r;
    },
    [qc, company, settle],
  );

  const cancel = useCallback(
    async (bookingId: string) => {
      const r = await post(`/api/bookings/${encodeURIComponent(bookingId)}/cancel`, {});
      if (r.ok) settle(bookingId);
      return r;
    },
    [settle],
  );

  /**
   * How long the job is booked for (the board's edge drag). `null` goes back
   * to the service's length. A clash with the tech's next job comes back
   * forceable, like a move. Undo is the same call with the old length and
   * `expect` set to the new one, so it won't overwrite a later change.
   */
  const resize = useCallback(
    async (bookingId: string, durationMins: number | null, opts: { force?: boolean; expect?: number | null } = {}) => {
      const body = { durationMins, ...(opts.force ? { force: true } : {}), ...(opts.expect !== undefined ? { expectDurationMins: opts.expect } : {}) };
      const r = await post(`/api/bookings/${encodeURIComponent(bookingId)}`, body, "PATCH");
      if (r.ok) settle(bookingId);
      return r;
    },
    [settle],
  );

  return { assign, schedule, undo, cancel, resize };
}
