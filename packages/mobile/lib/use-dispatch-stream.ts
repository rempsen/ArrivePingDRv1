import { useEffect, useRef, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import EventSource from "react-native-sse";
import Constants from "expo-constants";
import { useQueryClient } from "@tanstack/react-query";
import { authHeaders, getToken } from "./auth";
import { getActiveCompany } from "./active-company";
import { backoffMs, initialStreamState, streamReducer, type StreamState } from "./stream-state";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");

/**
 * One module-level connection state so any screen can ask "is the live feed
 * up?" — `useBoard` switches to polling while it is down.
 */
let state: StreamState = initialStreamState;
const listeners = new Set<() => void>();
function dispatch(action: Parameters<typeof streamReducer>[1]) {
  state = streamReducer(state, action);
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useStreamHealthy(): boolean {
  return useSyncExternalStore(subscribe, () => state.status !== "down", () => true);
}

type Changed = { techs: string[]; jobs: string[]; all?: boolean };

/**
 * Keep the dispatch board fresh while office screens are open.
 *
 * `GET /api/dispatch/stream` sends `changed` events ({techs, jobs} ids, or
 * `all`) and `locations` batches. The app never applies payloads itself: a
 * `changed` event invalidates every board query for this company and the
 * existing GET re-reads the truth. That keeps this additive and low-risk, the
 * same approach as `useLiveMessageSignal`.
 *
 * The connection is closed while the app is in the background (a phone in a
 * pocket should not hold a socket open) and reopened on resume with one
 * refetch, so a dispatcher never looks at a stale board after unlocking.
 * Two failures in a row mark the stream down (see stream-state.ts) and the
 * board polls until a connection opens again.
 */
export function useDispatchStream(enabled: boolean) {
  const qc = useQueryClient();
  const company = getActiveCompany();
  const es = useRef<EventSource<"ready" | "changed" | "locations" | "ping"> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !getToken()) return;
    let alive = true;

    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["board", company] });
    };

    const close = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      es.current?.close();
      es.current = null;
      dispatch("close");
    };

    const open = () => {
      if (!alive || es.current) return;
      const src = new EventSource<"ready" | "changed" | "locations" | "ping">(`${API}/api/dispatch/stream`, {
        headers: authHeaders(),
        // We own reconnects (so the reducer can count failures); the library's
        // own retry would hide them.
        pollingInterval: 0,
        debug: false,
      });
      es.current = src;
      src.addEventListener("ready", () => dispatch("open"));
      src.addEventListener("changed", (e) => {
        try {
          const data = JSON.parse((e as { data: string }).data) as Changed;
          if (data.all || data.techs.length || data.jobs.length) invalidate();
        } catch {
          invalidate();
        }
      });
      src.addEventListener("locations", () => {
        // Location batches arrive every second while techs move; the board
        // query is cheap but not that cheap. Techs' positions refresh with the
        // next `changed` or the 10 s staleTime, which is fine for a phone list.
      });
      src.addEventListener("error", () => {
        src.close();
        es.current = null;
        dispatch("error");
        if (!alive) return;
        timer.current = setTimeout(open, backoffMs(state.failures));
      });
    };

    open();
    // Any gap (first open, or a reconnect) could have missed events.
    invalidate();

    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        if (!es.current) {
          dispatch("reset");
          open();
        }
        invalidate();
      } else {
        close();
      }
    });

    return () => {
      alive = false;
      sub.remove();
      close();
    };
  }, [enabled, company, qc]);
}
