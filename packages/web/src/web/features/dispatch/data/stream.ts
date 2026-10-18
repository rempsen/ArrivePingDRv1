/**
 * The live feed that keeps an open map fresh without polling.
 *
 * Read with fetch() rather than EventSource because the request needs the
 * Authorization and X-Company-Id headers. Reconnects on its own with a growing
 * pause (1, 2, 4, 8, 16, then 30 seconds; back to 1 after a good connection),
 * gives up on a connection that has gone silent, and reconnects at once when the
 * tab comes back or the network returns.
 */
import { apiHeaders } from "../../../lib/api";
import { parseSse } from "../../../../shared/sse";
import type { LocationFrame } from "./types";

export interface ChangedSignal {
  techs: string[];
  jobs: string[];
  /** Too much changed to list: re-read everything. */
  all?: boolean;
}

export interface StreamHandlers {
  /** The connection is open (true) or lost (false). */
  onState?(connected: boolean): void;
  /** Fired when the server says ready; `again` is true on a reconnect. */
  onReady?(again: boolean): void;
  onLocations?(frames: LocationFrame[]): void;
  onChanged?(change: ChangedSignal): void;
}

const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
/** The server pings about every 20 s; this much silence means the connection is dead. */
const SILENCE_MS = 50_000;

const isFrame = (f: unknown): f is LocationFrame =>
  !!f && typeof f === "object" && typeof (f as LocationFrame).techId === "string" && typeof (f as LocationFrame).lat === "number" && typeof (f as LocationFrame).lng === "number";

export function openDispatchStream(h: StreamHandlers, url = "/api/dispatch/stream"): () => void {
  let stopped = false;
  let attempt = 0;
  let everReady = false;
  let abort: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let live = false;
  /** Each connection attempt gets a number; only the newest may report or retry. */
  let gen = 0;

  const setLive = (v: boolean) => {
    if (live === v) return;
    live = v;
    h.onState?.(v);
  };

  function dispatch(event: string, data: string) {
    try {
      if (event === "ready") {
        const again = everReady;
        everReady = true;
        attempt = 0;
        setLive(true);
        h.onReady?.(again);
      } else if (event === "locations") {
        const list = JSON.parse(data);
        if (Array.isArray(list)) h.onLocations?.(list.filter(isFrame));
      } else if (event === "changed") {
        const c = JSON.parse(data) as Partial<ChangedSignal>;
        h.onChanged?.({ techs: Array.isArray(c.techs) ? c.techs : [], jobs: Array.isArray(c.jobs) ? c.jobs : [], all: c.all === true });
      }
    } catch {
      /* a malformed frame is skipped, never fatal */
    }
  }

  async function run() {
    const my = ++gen;
    abort = new AbortController();
    const ctl = abort;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => ctl.abort(), SILENCE_MS);
    };
    try {
      bump();
      const res = await fetch(url, {
        headers: { ...apiHeaders(), Accept: "text/event-stream" },
        credentials: "include",
        signal: ctl.signal,
        cache: "no-store",
      });
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bump();
        const parsed = parseSse(buf + dec.decode(value, { stream: true }));
        buf = parsed.rest;
        for (const m of parsed.messages) dispatch(m.event, m.data);
      }
    } catch {
      /* fall through to the retry below */
    } finally {
      if (watchdog) clearTimeout(watchdog);
    }
    if (stopped || my !== gen) return; // superseded by a newer attempt
    setLive(false);
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
    attempt++;
    retryTimer = setTimeout(() => void run(), wait);
  }

  /** Try now instead of waiting out the pause. */
  function retryNow() {
    if (stopped || live) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    attempt = 0;
    abort?.abort(); // the old attempt notices it was superseded and says nothing
    void run();
  }

  const onVisible = () => {
    if (document.visibilityState === "visible") retryNow();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", retryNow);
  void run();

  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", retryNow);
    if (retryTimer) clearTimeout(retryTimer);
    abort?.abort();
    setLive(false);
  };
}
