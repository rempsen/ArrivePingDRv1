/**
 * Assigning a job to a technician, with Undo, and a pause only on a clash.
 *
 * The drop is optimistic: the card jumps to the technician at once, the request
 * goes out, and if the server refuses with a clash (not qualified, busy, time
 * off, double-booked, offline) the card goes back and the one-sentence clash
 * card asks "Assign anyway?". Assigning anyway repeats the request with force.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobFields } from "../../../../shared/board-patch";
import { postAssign, postUndo, refusalOf } from "../data/api";
import type { Board } from "../data/types";

export interface PendingClash {
  jobId: string;
  techId: string;
  techName: string;
  message: string;
  forceable: boolean;
}

export interface Toast {
  id: number;
  text: string;
  /** Present while the assignment can still be undone. */
  undo: string | null;
  tone: "ok" | "warn";
}

interface BoardApi {
  board: Board | undefined;
  optimistic(patch: JobFields): () => void;
  commit(patch: JobFields): void;
  refetch(): unknown;
  settle?(): unknown;
}

const TOAST_MS = 10_000;
const MAX_TOASTS = 3;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export function useAssign(api: BoardApi) {
  const [clash, setClash] = useState<PendingClash | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [announce, setAnnounce] = useState("");
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const held = useRef(new Set<number>());
  const undoing = useRef(new Set<number>());
  const seq = useRef(0);
  const busy = useRef(new Set<string>());
  const live = useRef(api);
  live.current = api;

  const drop = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    held.current.delete(id);
    setToasts((l) => l.filter((x) => x.id !== id));
  }, []);

  const arm = useCallback(
    (id: number) => {
      const t = timers.current.get(id);
      if (t) clearTimeout(t);
      timers.current.set(id, setTimeout(() => drop(id), TOAST_MS));
    },
    [drop],
  );

  const showToast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = ++seq.current;
      setToasts((l) => [...l, { ...t, id }].slice(-MAX_TOASTS));
      setAnnounce(t.text);
      arm(id);
    },
    [arm],
  );

  /** Hovering or focusing a toast keeps it on screen (no timeout while a person is reading it). */
  const hold = useCallback(
    (id: number, on: boolean) => {
      if (on) {
        held.current.add(id);
        const t = timers.current.get(id);
        if (t) clearTimeout(t);
        timers.current.delete(id);
      } else if (held.current.delete(id)) arm(id);
    },
    [arm],
  );

  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all.values()) clearTimeout(t);
    };
  }, []);

  const assign = useCallback(
    async (jobId: string, techId: string, force = false) => {
      const { board, optimistic, commit, refetch, settle } = live.current;
      const job = board?.jobs.find((j) => j.id === jobId);
      const tech = board?.techs.find((t) => t.id === techId);
      if (!job || !tech || busy.current.has(jobId)) return;
      const noun = (board?.jobNoun ?? "Job").toLowerCase();
      if (job.riderId === techId) {
        setAnnounce(`${tech.name} already has this ${noun}.`);
        return;
      }
      // Someone else took it while this drag was in the air: ask, don't overwrite.
      if (job.riderId && !force) {
        const other = board?.techs.find((t) => t.id === job.riderId);
        const message = `This ${noun} is already with ${other?.name ?? "another technician"}.`;
        setClash({ jobId, techId, techName: tech.name, message, forceable: true });
        setAnnounce(`${message} Assign anyway?`);
        return;
      }
      busy.current.add(jobId);
      setClash(null);
      await settle?.();
      const release = optimistic({ id: jobId, status: "assigned", assignStatus: "offered", riderId: techId });
      try {
        const res = await postAssign({ bookingId: jobId, riderId: techId, ...(force ? { force: true } : {}) });
        await settle?.();
        commit(res.job);
        release();
        showToast({ text: `Offered to ${firstName(tech.name)}`, undo: res.undo, tone: "ok" });
      } catch (err) {
        release();
        const refusal = refusalOf(err);
        if (refusal?.forceable) {
          setClash({ jobId, techId, techName: tech.name, message: refusal.message, forceable: true });
          setAnnounce(`${refusal.message} Assign anyway?`);
        } else if (refusal) {
          showToast({ text: refusal.message, undo: null, tone: "warn" });
        } else {
          showToast({ text: "Couldn't assign. Try again.", undo: null, tone: "warn" });
          void refetch();
        }
      } finally {
        busy.current.delete(jobId);
      }
    },
    [showToast],
  );

  const confirmClash = useCallback(() => {
    if (clash) void assign(clash.jobId, clash.techId, true);
  }, [assign, clash]);

  const dismissClash = useCallback(() => setClash(null), []);

  const undo = useCallback(
    async (id: number) => {
      const token = toasts.find((t) => t.id === id)?.undo;
      if (!token || undoing.current.has(id)) return;
      undoing.current.add(id);
      drop(id);
      try {
        const res = await postUndo(token);
        await live.current.settle?.();
        live.current.commit(res.job);
        setAnnounce("Undone.");
      } catch {
        showToast({ text: "Too late to undo. The technician already has it.", undo: null, tone: "warn" });
        void live.current.refetch();
      } finally {
        undoing.current.delete(id);
      }
    },
    [toasts, drop, showToast],
  );

  return { assign, clash, confirmClash, dismissClash, toasts, undo, dismissToast: drop, holdToast: hold, announce };
}
