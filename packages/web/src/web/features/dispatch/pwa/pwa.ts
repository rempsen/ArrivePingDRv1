/**
 * Installable app: manifest link, service worker, install prompt, badge.
 * Everything is optional. Where a browser lacks a piece, that piece is skipped.
 */
interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
let started = false;

const notify = () => listeners.forEach((fn) => fn());

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** Safari on iPhone and iPad can't prompt; it has Share, then Add to Home Screen. */
export function needsManualInstall(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1);
  return ios && !isStandalone();
}

export function initPwa() {
  if (started || typeof window === "undefined") return;
  started = true;
  if (!document.querySelector('link[rel="manifest"]')) {
    const l = document.createElement("link");
    l.rel = "manifest";
    l.href = "/admin/manifest.webmanifest";
    document.head.appendChild(l);
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/" }).catch(() => {});
  }
}

export const canInstall = () => deferred !== null && !isStandalone();

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const ev = deferred;
  deferred = null;
  notify();
  await ev.prompt();
  return (await ev.userChoice).outcome === "accepted";
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Unassigned count on the app icon. Zero clears it. */
export function setBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (count > 0) void nav.setAppBadge?.(count).catch(() => {});
    else void nav.clearAppBadge?.().catch(() => {});
  } catch {
    /* unsupported */
  }
}
