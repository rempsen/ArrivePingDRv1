/**
 * Hand a starting point (a library template or an AI draft) to the editor
 * for a brand-new template. Kept in sessionStorage so a reload of /new keeps
 * it until the template is saved or abandoned.
 */
import type { Draft } from "./editor";

const key = (k: string) => `builder:seed:${k}`;

export function putSeed(seed: Partial<Draft>): string {
  const k = Math.random().toString(36).slice(2, 10);
  try {
    sessionStorage.setItem(key(k), JSON.stringify(seed));
  } catch {
    /* storage unavailable: the editor opens blank */
  }
  return k;
}

export function takeSeed(k: string | null): Partial<Draft> | null {
  if (!k) return null;
  try {
    const raw = sessionStorage.getItem(key(k));
    return raw ? (JSON.parse(raw) as Partial<Draft>) : null;
  } catch {
    return null;
  }
}
