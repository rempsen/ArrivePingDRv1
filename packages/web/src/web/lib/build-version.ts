/**
 * Is a newer build of the app deployed than the one this tab is running?
 *
 * Crashes like "U is not a function" on a long-open tab are usually version
 * skew: the tab holds an older bundle while the API (or a lazily loaded chunk)
 * has moved on, and a reload fixes it. The HTML shell is served `no-store`, so
 * fetching it tells us the entry script of the live build; if that differs
 * from the entry script we booted with, we are behind.
 */
const RELOAD_KEY = "nvc360:build-reload-at";
const RELOAD_WINDOW_MS = 60_000;

const ENTRY_RE = /\/assets\/index-[\w-]+\.js/;

function runningEntry(): string | null {
  const el = Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]")).find((s) =>
    ENTRY_RE.test(s.src),
  );
  return el ? (ENTRY_RE.exec(el.src)?.[0] ?? null) : null;
}

export async function isNewerBuildAvailable(): Promise<boolean> {
  try {
    const mine = runningEntry();
    if (!mine) return false; // dev server or unrecognised layout
    const res = await fetch("/", { cache: "no-store", headers: { accept: "text/html" } });
    if (!res.ok) return false;
    const live = ENTRY_RE.exec(await res.text())?.[0] ?? null;
    return !!live && live !== mine;
  } catch {
    return false;
  }
}

/** sessionStorage can throw (privacy modes); that must only disable the loop guard. */
function readLast(): number {
  try {
    return Number(window.sessionStorage.getItem(RELOAD_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function markReload(): void {
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // No storage: reload anyway. A build that stays "newer" would loop, but
    // the entry hash then matches after one reload, so it cannot.
  }
}

/** Reload once (per minute) if a newer build exists. Resolves true when a reload was triggered. */
export async function reloadIfStale(): Promise<boolean> {
  if (Date.now() - readLast() < RELOAD_WINDOW_MS) return false;
  if (!(await isNewerBuildAvailable())) return false;
  markReload();
  window.location.reload();
  return true;
}
