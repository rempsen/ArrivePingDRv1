/**
 * Guard against effects that return something other than a cleanup function.
 *
 * React calls whatever an effect returned when the component unmounts. If an
 * effect returns a value that is not a function (an object, a number, a
 * promise), React throws "<x> is not a function" at unmount, which in the
 * production bundle reads as "U is not a function". That is exactly the crash
 * seen when switching modules: leaving a page unmounts it, and the bad cleanup
 * fires. React's own effect code has no type guard, so the error lands in the
 * route error boundary and the page dies until a reload.
 *
 * This wraps React's effect hooks once at startup. A non-function, non-
 * undefined return is dropped (so the unmount can't crash) and reported once
 * per call site with the effect's source, so the real
 * offender shows up in Sentry and the console instead of a generic crash.
 *
 * It patches the React exports object, which every bundled module reads the
 * hooks from at call time (`React.useEffect(...)`), so library effects are
 * covered as well as ours. Hook order and count are unchanged.
 */
import React from "react";
import { reportError } from "./sentry";

type EffectHook = (effect: () => unknown, deps?: readonly unknown[]) => void;
const HOOKS = ["useEffect", "useLayoutEffect", "useInsertionEffect"] as const;

const reported = new Set<string>();

function report(hook: string, effect: () => unknown, value: unknown): void {
  const source = String(effect).slice(0, 300);
  const key = `${hook}:${source}`;
  if (reported.has(key)) return;
  reported.add(key);
  const err = new Error(
    `${hook} returned ${value === null ? "null" : typeof value} instead of a cleanup function`,
  );
  reportError(err, {
    source: "effect-guard",
    hook,
    effect: source,
    path: typeof window !== "undefined" ? window.location.pathname : undefined,
  });
}

let installed = false;

export function installEffectGuard(): void {
  if (installed) return;
  installed = true;
  const target = React as unknown as Record<string, EffectHook>;
  for (const name of HOOKS) {
    const original = target[name];
    if (typeof original !== "function") continue;
    const guarded: EffectHook = (effect, deps) => {
      return original(() => {
        const result = effect();
        if (result === undefined || typeof result === "function") return result;
        report(name, effect, result);
        return undefined;
      }, deps);
    };
    try {
      target[name] = guarded;
    } catch {
      // Frozen exports (not expected with the bundled CJS build): leave React as is.
    }
  }
}
