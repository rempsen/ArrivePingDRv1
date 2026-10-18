import { apiHeaders } from "../lib/api";
import type { GuideEvent } from "../../shared/guide-events";

/**
 * Report a Guide event (shared/guide-events.ts). Batched for two seconds and
 * sent with keepalive, so a tour step or an Ask question costs one small
 * request at most, and a page change doesn't lose the last few. Never throws.
 */
let queue: GuideEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  if (!queue.length) return;
  const events = queue.slice(0, 30);
  queue = queue.slice(30);
  try {
    void fetch("/api/me/guide-events", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...apiHeaders() },
      body: JSON.stringify({ events }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* analytics must never break the app */
  }
  if (queue.length) timer = setTimeout(flush, 2_000);
}

export function trackGuide(e: GuideEvent) {
  queue.push(e);
  if (!timer) timer = setTimeout(flush, 2_000);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
}
