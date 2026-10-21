/**
 * Shapes of a dispatch write (`/dispatch/assign`, `/schedule`, `/undo`,
 * `/bookings/admin`) as the screens see them. Pure, so the classification
 * of a server answer is testable.
 */
export type DispatchOk<T = unknown> = { ok: true; job: T; undo?: string | null; notified?: boolean };
export type DispatchFail = {
  ok: false;
  status: number;
  message: string;
  /** The server will do it anyway with `force: true` (double-booking, time off, already accepted). */
  forceable: boolean;
  /** Why it was refused when forceable: e.g. "busy", "timeoff". */
  reason?: string;
};
export type DispatchResult<T = unknown> = DispatchOk<T> | DispatchFail;

const FALLBACK: Record<number, string> = {
  401: "Your session has expired. Sign in again.",
  403: "Your role can't do that. Ask an admin on your account.",
  404: "That job no longer exists.",
  409: "That changed while you were looking. Pull to refresh.",
};

export function classifyResponse<T = unknown>(status: number, body: unknown): DispatchResult<T> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (status >= 200 && status < 300) {
    return {
      ok: true,
      job: (b.job ?? b.booking ?? b) as T,
      undo: typeof b.undo === "string" ? b.undo : null,
      notified: typeof b.notified === "boolean" ? b.notified : undefined,
    };
  }
  const message = typeof b.message === "string" && b.message ? b.message : (FALLBACK[status] ?? `Something went wrong (${status}).`);
  return {
    ok: false,
    status,
    message,
    forceable: status === 409 && b.forceable === true,
    ...(typeof b.reason === "string" ? { reason: b.reason } : {}),
  };
}
