/**
 * Undo / redo for the builder. Typing in one field coalesces into a single
 * step (same key within 800 ms), so Ctrl+Z undoes a word, not a letter.
 */
import { useCallback, useRef, useState } from "react";

const LIMIT = 50;

export function useHistory<T>(initial: T) {
  const [state, setState] = useState<{ past: T[]; present: T; future: T[] }>({ past: [], present: initial, future: [] });
  const lastKey = useRef<{ key: string; at: number } | null>(null);

  const commit = useCallback((next: T | ((cur: T) => T), key?: string) => {
    setState((s) => {
      const value = typeof next === "function" ? (next as (cur: T) => T)(s.present) : next;
      if (Object.is(value, s.present)) return s;
      const nowMs = Date.now();
      const coalesce = key && lastKey.current?.key === key && nowMs - lastKey.current.at < 800;
      lastKey.current = key ? { key, at: nowMs } : null;
      if (coalesce) return { past: s.past, present: value, future: [] };
      return { past: [...s.past, s.present].slice(-LIMIT), present: value, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    lastKey.current = null;
    setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1]!, future: [s.present, ...s.future] } : s));
  }, []);

  const redo = useCallback(() => {
    lastKey.current = null;
    setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0]!, future: s.future.slice(1) } : s));
  }, []);

  /** Replace everything (loading a template) without an undo step. */
  const reset = useCallback((value: T) => {
    lastKey.current = null;
    setState({ past: [], present: value, future: [] });
  }, []);

  return { value: state.present, commit, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
