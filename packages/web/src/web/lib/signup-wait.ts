/**
 * The self-serve signup when its request doesn't come back cleanly.
 *
 * Setting up a company takes a while (the AI writers), and if the answer
 * takes longer than the edge proxy allows, the browser gets the proxy's HTML
 * error page while the server carries on and finishes. The page used to show
 * that HTML as the error. Now it recognises that kind of failure and asks the
 * server where the signup got to (by the card's Stripe customer) until it's
 * done, stuck, or clearly never happened.
 */
import { ApiError } from "./api-error";

/**
 * True when the request failed on the way (proxy timeout or error page, lost
 * connection) rather than the API answering with a reason of its own: the
 * server may well still be working, or may have finished.
 */
export function isGatewayFailure(e: unknown): boolean {
  if (e instanceof ApiError) {
    // Our API always answers errors with JSON. Anything else (Cloudflare's
    // HTML page, an empty body) came from something in front of it.
    const fromApi = !!e.body && typeof e.body === "object";
    return !fromApi && e.status >= 500;
  }
  // fetch() rejects with a TypeError when the connection drops.
  return e instanceof TypeError;
}

export type SignupStatus =
  | { state: "done"; [k: string]: unknown }
  | { state: "pending" | "stalled" | "taken" | "none"; message?: string };

export interface WaitOpts {
  check: () => Promise<SignupStatus>;
  sleep?: (ms: number) => Promise<void>;
  /** Between checks. */
  everyMs?: number;
  /** Give up after this long in total. */
  maxMs?: number;
  /**
   * "none" this many times in a row = the signup never got going. Generous:
   * if the connection dropped early, the first request may still be talking
   * to Stripe before it inserts the company row.
   */
  noneLimit?: number;
  now?: () => number;
}

export class SignupWaitError extends Error {}

/** Resolves with the finished signup's details, or throws a SignupWaitError with what to tell the person. */
export async function waitForSignup(o: WaitOpts): Promise<Record<string, unknown>> {
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const every = o.everyMs ?? 5_000;
  const now = o.now ?? Date.now;
  const until = now() + (o.maxMs ?? 5 * 60_000);
  const noneLimit = o.noneLimit ?? 18;
  let nones = 0;
  for (;;) {
    await sleep(every);
    let st: SignupStatus | null = null;
    try {
      st = await o.check();
    } catch {
      st = null; // a blip (or rate limit) while checking: just check again
    }
    if (st?.state === "done") {
      const { state: _state, ...rest } = st;
      return rest;
    }
    if (st?.state === "stalled" || st?.state === "taken") throw new SignupWaitError(st.message || "We couldn't finish setting up your account.");
    nones = st?.state === "none" ? nones + 1 : 0;
    if (nones >= noneLimit) throw new SignupWaitError("We couldn't finish setting up your account. Please try again.");
    if (now() > until)
      throw new SignupWaitError(
        "Your workspace is taking longer than usual to set up. Try signing in with your email and password in a few minutes, or contact support@arriveping.com.",
      );
  }
}
