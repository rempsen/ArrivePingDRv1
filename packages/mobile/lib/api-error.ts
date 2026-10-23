/**
 * Reading a failed API response. The server sends errors two ways: route-level
 * `{ message }` and the global handler's `{ error: { message } }`. Reading only
 * one of them turns the server's own explanation into a generic fallback, so
 * every call site goes through here.
 */

export const SIGNED_OUT = "You've been signed out — sign in again.";

/** The server's message from a parsed error body, or null if it sent none. */
export function messageFromBody(body: unknown): string | null {
  const b = body as { message?: unknown; error?: { message?: unknown } } | null | undefined;
  const msg = b?.message ?? b?.error?.message;
  return typeof msg === "string" && msg ? msg : null;
}

/** Message for a failed response: the server's, else sign-in prompt on 401, else `fallback`. */
export async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return messageFromBody(body) ?? (res.status === 401 ? SIGNED_OUT : fallback);
}

/** Throw an Error carrying `apiErrorMessage` unless the response is ok. */
export async function throwIfNotOk(res: Response, fallback: string): Promise<void> {
  if (!res.ok) throw new Error(await apiErrorMessage(res, fallback));
}
