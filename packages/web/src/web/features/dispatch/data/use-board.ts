/**
 * The dispatch board, kept live.
 *
 * One snapshot from /api/dispatch/board, then the stream does the rest:
 *  - location frames move pins in place, no refetch;
 *  - "changed" signals refetch the snapshot (debounced 400 ms, so a burst of
 *    changes is one read);
 *  - after the connection comes back, one refetch catches up on what was missed;
 *  - a 30 s poll is the safety net when the stream can't connect at all.
 *
 * Drops are optimistic. `optimistic(patch)` lays a patch over whatever the
 * server sends until `release()` is called, so a refresh that lands while the
 * assign request is still in flight can't flicker the card back to the queue.
 */
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { activeCompany } from "../../../lib/tenant";
import { applyJobPatch, applyLocations, type JobFields } from "../../../../shared/board-patch";
import { fetchBoard } from "./api";
import { openDispatchStream } from "./stream";
import type { Board } from "./types";

export function useBoard(day: string | null) {
  const qc = useQueryClient();
  const company = activeCompany() ?? "home";
  const key = useMemo(() => ["dispatch-board", company, day ?? "today"] as const, [company, day]);

  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchBoard(day, signal),
    refetchInterval: 30_000,
    staleTime: 5_000,
    // Changing the day keeps the previous day's board on screen until the new one arrives.
    placeholderData: keepPreviousData,
  });

  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refetchSoon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: key });
        void qc.invalidateQueries({ queryKey: ["dispatch-candidates", company] });
      }, 400);
    };
    const close = openDispatchStream({
      onState: setConnected,
      onReady: (again) => {
        const fetchedAt = qc.getQueryState(key)?.dataUpdatedAt ?? 0;
        // Reconnected: catch up. First connect: only if the snapshot is already old.
        if (again || Date.now() - fetchedAt > 1_500) refetchSoon();
      },
      onLocations: (frames) => qc.setQueryData<Board>(key, (b) => (b ? applyLocations(b, frames) : b)),
      onChanged: refetchSoon,
    });
    return () => {
      close();
      if (timer) clearTimeout(timer);
    };
  }, [qc, key, company]);

  // Optimistic overlays: patches laid over the fetched board until released.
  const overlays = useRef(new Map<string, JobFields>());
  const [version, bump] = useReducer((n: number) => n + 1, 0);

  const board = useMemo(() => {
    const b = q.data;
    if (!b || overlays.current.size === 0) return b;
    let out = b;
    for (const p of overlays.current.values()) out = applyJobPatch(out, p);
    return out;
    // `version` is the overlay map's change counter.
  }, [q.data, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const optimistic = useCallback((patch: JobFields) => {
    overlays.current.set(patch.id, patch);
    bump();
    return () => {
      if (overlays.current.get(patch.id) === patch) {
        overlays.current.delete(patch.id);
        bump();
      }
    };
  }, []);

  /** Write what the server said into the cached board. */
  const commit = useCallback(
    (patch: JobFields) => qc.setQueryData<Board>(key, (b) => (b ? applyJobPatch(b, patch) : b)),
    [qc, key],
  );

  const refetch = useCallback(() => q.refetch(), [q]);

  return { board, isLoading: q.isLoading, error: q.error as Error | null, connected, optimistic, commit, refetch };
}
