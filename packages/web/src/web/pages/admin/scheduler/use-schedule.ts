/**
 * The dispatch calendar's data: a board snapshot for the visible day (or week)
 * from /api/dispatch/board, kept fresh by the dispatch stream instead of
 * polling every booking, plus the one action the calendar has: put a job on a
 * technician at a time.
 *
 * Moves are optimistic. The block jumps at once; the requests go out; a
 * refusal the office may override ("already booked at 2:00 PM") becomes one
 * question; anything else puts the block back and says why. Assigning from the
 * queue and moving in time both come back with Undo tokens, and the server holds
 * the notices for the Undo window, so an undone move texts nobody. Moving a job
 * from one technician to another is a reassignment: it asks first, notifies at
 * once and has no Undo (the same rule as the dispatch map).
 *
 * A drop is one request, so it happens whole or not at all: a technician and a
 * time together go through /api/dispatch/assign (from the queue with one Undo
 * for both; a reassignment notifies at once, without Undo), a time alone
 * through /api/dispatch/schedule.
 */
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { activeCompany } from "../../../lib/tenant";
import { withAssignConfirm } from "../../../lib/assign-job";
import { runWithForceConfirm, type ConfirmFn } from "../../../lib/force-confirm";
import { fetchBoard, fetchLoad, postAssign, postSchedule, postUndo } from "../../../features/dispatch/data/api";
import { openDispatchStream } from "../../../features/dispatch/data/stream";
import type { Board, BoardJob } from "../../../features/dispatch/data/types";
import { instantFor } from "../../../../shared/schedule-layout";
import { isInFlightStatus } from "../../../../shared/job-status";
import { applyLocations } from "../../../../shared/board-patch";

export interface ScheduleToast {
  id: number;
  text: string;
  /** Undo tokens, newest last; empty when this change can't be undone. */
  undo: string[];
  tone: "ok" | "warn";
}

export interface PlaceArgs {
  job: BoardJob;
  techId: string;
  techName: string;
  /** Company-time day, YYYY-MM-DD */
  dayKey: string;
  /** Minutes since midnight, company time */
  startMin: number;
}

type Overlay = Pick<BoardJob, "id"> & Partial<Pick<BoardJob, "riderId" | "scheduledAt" | "status" | "assignStatus">>;

const TOAST_MS = 6_000;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export function useScheduleBoard(day: string, days: 1 | 7) {
  const qc = useQueryClient();
  const company = activeCompany() ?? "home";
  const key = useMemo(() => ["schedule-board", company, day, days] as const, [company, day, days]);
  const [connected, setConnected] = useState(false);

  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchBoard(day, signal, days),
    staleTime: 5_000,
    placeholderData: keepPreviousData,
    // The stream says when jobs change; poll fast only while it's down. Time
    // off and technicians' details don't come down the stream, so a slow
    // refresh keeps those current while it's up.
    refetchInterval: connected ? 120_000 : 30_000,
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refetchSoon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["schedule-board", company] });
        void qc.invalidateQueries({ queryKey: ["schedule-load", company] });
      }, 400);
    };
    const close = openDispatchStream({
      onState: setConnected,
      onReady: (again) => {
        if (again) refetchSoon();
      },
      onChanged: refetchSoon,
      // Positions move the "Find a slot" starting points; patch them in place.
      onLocations: (frames) => qc.setQueriesData<Board>({ queryKey: ["schedule-board", company] }, (b) => (b ? applyLocations(b, frames) : b)),
    });
    return () => {
      close();
      if (timer) clearTimeout(timer);
    };
  }, [qc, company]);

  // Optimistic overlays, laid over whatever the server sends until released.
  const overlays = useRef(new Map<string, Overlay>());
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const board = useMemo<Board | undefined>(() => {
    const b = q.data;
    if (!b || overlays.current.size === 0) return b;
    return { ...b, jobs: b.jobs.map((j) => ({ ...j, ...overlays.current.get(j.id) })) };
    // `version` is the overlay map's change counter.
  }, [q.data, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const overlay = useCallback((o: Overlay) => {
    overlays.current.set(o.id, o);
    bump();
    return () => {
      if (overlays.current.get(o.id) === o) {
        overlays.current.delete(o.id);
        bump();
      }
    };
  }, []);

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["schedule-board", company] });
    void qc.invalidateQueries({ queryKey: ["schedule-load", company] });
    void qc.invalidateQueries({ queryKey: ["bookings"] });
  }, [qc, company]);

  // `stale`: still showing the previous day's board while the new one loads.
  return { board, isLoading: q.isLoading, stale: q.isPlaceholderData, error: q.error as Error | null, connected, overlay, refresh };
}

export function useDayLoad(from: string, days: number, enabled: boolean) {
  const company = activeCompany() ?? "home";
  return useQuery({
    queryKey: ["schedule-load", company, from, days],
    queryFn: ({ signal }) => fetchLoad(from, days, signal),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/** Placing jobs, the toasts that report it, and Undo. */
export function usePlace(
  api: { overlay(o: Overlay): () => void; refresh(): Promise<void>; tz: string; /** First name of a technician, for messages. */ techName(id: string | null): string },
  confirm: ConfirmFn,
) {
  const [toasts, setToasts] = useState<ScheduleToast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const live = useRef(api);
  live.current = api;

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((l) => l.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (text: string, undo: string[] = [], tone: "ok" | "warn" = "ok") => {
      const id = ++seq.current;
      setToasts((l) => [...l.slice(-2), { id, text, undo, tone }]);
      timers.current.set(id, setTimeout(() => dismiss(id), TOAST_MS));
    },
    [dismiss],
  );

  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  /** Move the job's time, asking before a double booking. False when they back out. */
  const moveTime = useCallback(
    async (bookingId: string, at: string, tokens: string[]) => {
      const s = await runWithForceConfirm((force) => postSchedule({ bookingId, scheduledAt: at, force }), confirm, {
        title: "Move it there anyway?",
        confirmLabel: "Move it",
      });
      if (s === null) return false;
      if (s.undo) tokens.push(s.undo);
      return true;
    },
    [confirm],
  );

  const place = useCallback(
    async ({ job, techId, techName, dayKey, startMin }: PlaceArgs) => {
      const { overlay, refresh, tz } = live.current;
      const at = instantFor(dayKey, startMin, tz).toISOString();
      const moved = new Date(job.scheduledAt).getTime() !== new Date(at).getTime();
      const fromQueue = !job.riderId;
      const reassign = !!job.riderId && job.riderId !== techId;
      if (!moved && !fromQueue && !reassign) return;

      const release = overlay({ id: job.id, riderId: techId, scheduledAt: at, ...(fromQueue ? { status: "assigned", assignStatus: "offered" } : {}) });
      const tokens: string[] = [];
      try {
        if (fromQueue) {
          // One request: the technician and the time together, checked at the new
          // time, with one Undo that puts both back.
          const r = await runWithForceConfirm(
            (force) => postAssign({ bookingId: job.id, riderId: techId, force, ...(moved ? { scheduledAt: at } : {}) }),
            confirm,
            { title: `Assign to ${firstName(techName)} anyway?`, confirmLabel: "Assign anyway" },
          );
          if (r === null) return;
          if (r.undo) tokens.push(r.undo);
        } else if (reassign) {
          // No Undo for this, so ask first. (A job someone is on the way to or
          // working gets the server's own, more specific question instead.)
          if (!isInFlightStatus(job.status)) {
            const from = live.current.techName(job.riderId);
            const yes = await confirm({
              title: `Move this job to ${firstName(techName)}?`,
              message: `${from ? `${from} comes off it and ` : ""}${firstName(techName)} is notified right away. This can't be undone from here.`,
              confirmLabel: "Reassign",
            });
            if (!yes) return;
          }
          // One request: the new technician and the time together, checked at
          // the new time, in one conditional write. It notifies at once and has
          // no Undo, like a reassignment on the map.
          const r = await withAssignConfirm(
            // The live-visit question and the double-booking one are asked separately,
            // so taking a job off a visit doesn't skip the check at the new time.
            (f) => postAssign({ bookingId: job.id, riderId: techId, force: f.inflight, forceBusy: f.busy, ...(moved ? { scheduledAt: at } : {}) }),
            confirm,
            techName,
          );
          if (r.cancelled) return;
        } else if (!(await moveTime(job.id, at, tokens))) return;
        const when = new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz });
        const who = firstName(techName);
        if (reassign) toast(`${job.title || job.service} moved to ${who}, ${when}. ${who} has been notified.`);
        else if (fromQueue)
          toast(`${job.title || job.service} → ${who}, ${when}. ${tokens.length ? `The customer and ${who} hear about it in a few seconds.` : `The customer and ${who} have been told.`}`, tokens);
        else toast(`${job.title || job.service} moved to ${when}. ${tokens.length ? "The customer gets the new time in a few seconds." : "The customer has been told."}`, tokens);
      } catch (e) {
        toast((e as Error).message || "That didn't save. Try again.", [], "warn");
      } finally {
        await refresh().catch(() => {});
        release();
      }
    },
    [confirm, moveTime, toast],
  );

  const undo = useCallback(
    async (t: ScheduleToast) => {
      dismiss(t.id);
      try {
        let notified = false;
        for (const tok of [...t.undo].reverse()) notified = (await postUndo(tok)).notified === true || notified;
        toast(notified ? "Undone. The notice had already gone out before you undid it." : "Undone. Nobody was notified.");
      } catch (e) {
        toast((e as Error).message || "Couldn't undo that.", [], "warn");
      } finally {
        await live.current.refresh().catch(() => {});
      }
    },
    [dismiss, toast],
  );

  return { toasts, place, undo, dismiss, toast };
}
