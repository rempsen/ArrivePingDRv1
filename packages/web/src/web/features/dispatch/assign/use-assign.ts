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
import { shortName } from "../map/tech-markers";

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
}

const TOAST_MS = 6_000;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export function useAssign(api: BoardApi) {
  const [clash, setClash] = useState<PendingClash | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [announce, setAnnounce] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const busy = useRef(new Set<string>());
  const live = useRef(api);
  live.current = api;

  const showToast = useCallback((t: Omit<Toast, "id">) => {
    if (timer.current) clearTimeout(timer.current);
    const id = ++seq.current;
    setToast({ ...t, id });
    setAnnounce(t.text);
    timer.current = setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), TOAST_MS);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const assign = useCallback(
    async (jobId: string, techId: string, force = false) => {
      const { board, optimistic, commit, refetch } = live.current;
      const job = board?.jobs.find((j) => j.id === jobId);
      const tech = board?.techs.find((t) => t.id === techId);
      if (!job || !tech || busy.current.has(jobId)) return;
      const noun = (board?.jobNoun ?? "Job").toLowerCase();
      if (job.riderId === techId) {
        setAnnounce(`${tech.name} already has this ${noun}.`);
        return;
      }
      busy.current.add(jobId);
      setClash(null);
      const release = optimistic({ id: jobId, status: "assigned", assignStatus: "offered", riderId: techId });
      try {
        const res = await postAssign({ bookingId: jobId, riderId: techId, ...(force ? { force: true } : {}) });
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

  const undo = useCallback(async () => {
    const token = toast?.undo;
    if (!token) return;
    setToast(null);
    try {
      const res = await postUndo(token);
      live.current.commit(res.job);
      setAnnounce("Undone.");
    } catch {
      showToast({ text: "Too late to undo. The technician already has it.", undo: null, tone: "warn" });
      void live.current.refetch();
    }
  }, [toast, showToast]);

  const dismissToast = useCallback(() => setToast(null), []);

  return { assign, clash, confirmClash, dismissClash, toast, undo, dismissToast, announce, shortName };
}
