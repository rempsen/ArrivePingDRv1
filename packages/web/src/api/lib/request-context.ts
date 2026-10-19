/**
 * Facts about the current request that deep code needs without threading them
 * through every call: today, which ArrivePing support person is behind a
 * request made while acting as one of a tenant's people (Control Hub
 * act-as). `audit()` reads it so every audit entry written during act-as
 * names the staff member, with no change at the ~60 call sites.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestFacts {
  supportActor?: { id: string; name: string; sessionId: string };
}

const store = new AsyncLocalStorage<RequestFacts>();

/** Run `fn` with these facts visible to everything it calls. */
export function withRequestFacts<T>(facts: RequestFacts, fn: () => T): T {
  return store.run(facts, fn);
}

export function requestFacts(): RequestFacts | undefined {
  return store.getStore();
}
