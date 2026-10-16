import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Briefcase, Loader2, UserCheck, UserMinus } from "lucide-react";
import { apiHeaders } from "../lib/api";
import { Modal, BtnGhost } from "./modal";
import { useWorkerNoun } from "../lib/use-brand";

/**
 * Per-user Deactivate / Reactivate, used from Technicians and Internal Team.
 *
 * Deactivate: shows the person's open jobs and makes the admin say what
 * happens to them (reassign to someone, or back to the board) before the
 * button enables. Reactivate: if it would exceed the paid seat count, the
 * server answers 409 seat_required and this asks "add a user and reactivate?"
 */

type OpenJob = { id: string; title: string; scheduledAt: string; status: string };
type Teammate = { userId: string; name: string };
type ApiError = { code?: string; message?: string; meta?: { seatsNeeded?: number; monthlyDelta?: number } | null };

async function postJson(path: string, body: unknown): Promise<{ res: Response; data: ApiError & Record<string, unknown> }> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as ApiError & Record<string, unknown>;
  return { res, data };
}

function invalidateRosters(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([qc.invalidateQueries({ queryKey: ["team"] }), qc.invalidateQueries({ queryKey: ["riders"] }), qc.invalidateQueries({ queryKey: ["billing"] })]);
}

export function DeactivateDialog({
  userId,
  name,
  teammates,
  onClose,
  onDone,
}: {
  userId: string | null;
  name: string;
  /** Active people who could take over the jobs (excluding this user). */
  teammates: Teammate[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [choice, setChoice] = useState<string>(""); // "" | "__unassign" | userId
  const [err, setErr] = useState("");
  useEffect(() => {
    setChoice("");
    setErr("");
  }, [userId]);

  const jobs = useQuery({
    queryKey: ["team", "open-jobs", userId],
    enabled: !!userId,
    queryFn: async () => {
      const res = await fetch(`/api/team/${userId}/open-jobs`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Couldn't load their jobs.");
      return (await res.json()) as { count: number; jobs: OpenJob[] };
    },
  });
  const count = jobs.data?.count ?? 0;
  const needsChoice = count > 0 && choice === "";

  const run = useMutation({
    mutationFn: async () => {
      const body = count > 0 ? { reassignTo: choice === "__unassign" ? null : choice } : {};
      const { res, data } = await postJson(`/api/team/${userId}/deactivate`, body);
      if (!res.ok) throw new Error(data.message || "Something went wrong");
    },
    onSuccess: async () => {
      await invalidateRosters(qc);
      onDone?.();
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Modal
      open={!!userId}
      onClose={onClose}
      title={`Deactivate ${name}`}
      size="sm"
      footer={
        <>
          <BtnGhost onClick={onClose}>Cancel</BtnGhost>
          <button
            type="button"
            onClick={() => run.mutate()}
            disabled={run.isPending || jobs.isLoading || needsChoice}
            className="nvc-btn-primary flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />} Deactivate
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-300">
        <p>
          {name} will no longer be able to sign in to your company and won't count towards your bill. Their jobs, photos and history stay. You can
          reactivate them at any time.
        </p>
        {jobs.isLoading && (
          <p className="flex items-center gap-2 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking their open jobs…
          </p>
        )}
        {count > 0 && (
          <div className="rounded-xl border border-amber-warn/30 bg-amber-warn/10 p-3">
            <p className="flex items-center gap-2 font-semibold text-amber-warn">
              <Briefcase className="h-4 w-4" /> {count} open {count === 1 ? "job" : "jobs"} assigned to {name}
            </p>
            <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs text-slate-300">
              {jobs.data!.jobs.slice(0, 8).map((j) => (
                <li key={j.id}>
                  {j.title || "Job"} · {new Date(j.scheduledAt).toLocaleDateString()} · {j.status.replace(/_/g, " ")}
                </li>
              ))}
              {count > 8 && <li>…and {count - 8} more</li>}
            </ul>
            <label className="mt-3 block text-xs font-semibold text-slate-200" htmlFor="deactivate-reassign">
              What happens to them?
            </label>
            <select id="deactivate-reassign" className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-ink px-2 text-sm text-white" value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">Choose…</option>
              <option value="__unassign">Unassign (back to the board)</option>
              {teammates.length > 0 && (
                <optgroup label="Reassign all to…">
                  {teammates.map((t) => (
                    <option key={t.userId} value={t.userId}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        )}
        {err && (
          <p className="flex items-center gap-2 text-rose-300">
            <AlertTriangle className="h-4 w-4" /> {err}
          </p>
        )}
      </div>
    </Modal>
  );
}

export function ReactivateDialog({ userId, name, onClose, onDone }: { userId: string | null; name: string; onClose: () => void; onDone?: () => void }) {
  const qc = useQueryClient();
  const { noun } = useWorkerNoun();
  const [seatPrompt, setSeatPrompt] = useState<{ seatsNeeded: number; monthlyDelta: number } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setSeatPrompt(null);
    setErr("");
  }, [userId]);

  const run = useMutation({
    mutationFn: async (addSeat: boolean) => {
      const { res, data } = await postJson(`/api/team/${userId}/reactivate`, addSeat ? { addSeat: true } : {});
      if (res.status === 409 && data.code === "seat_required") {
        setSeatPrompt({ seatsNeeded: data.meta?.seatsNeeded ?? 1, monthlyDelta: data.meta?.monthlyDelta ?? 0 });
        return "seat_required" as const;
      }
      if (!res.ok) throw new Error(data.message || "Something went wrong");
      return "ok" as const;
    },
    onSuccess: async (r) => {
      if (r !== "ok") return;
      await invalidateRosters(qc);
      onDone?.();
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Modal
      open={!!userId}
      onClose={onClose}
      title={`Reactivate ${name}`}
      size="sm"
      footer={
        <>
          <BtnGhost onClick={onClose}>Cancel</BtnGhost>
          <button
            type="button"
            onClick={() => run.mutate(!!seatPrompt)}
            disabled={run.isPending}
            className="nvc-btn-primary flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
            {seatPrompt ? `Add a ${noun.toLowerCase()} and reactivate` : "Reactivate"}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-300">
        {!seatPrompt && <p>{name} will be able to sign in and take jobs again.</p>}
        {seatPrompt && (
          <p>
            Reactivating <span className="font-semibold text-white">{name}</span> needs {seatPrompt.seatsNeeded} more {noun.toLowerCase()} on your plan,{" "}
            <span className="font-semibold text-white">${seatPrompt.monthlyDelta}/month</span> from your next bill. Add a {noun.toLowerCase()} and reactivate?
          </p>
        )}
        {err && (
          <p className="flex items-center gap-2 text-rose-300">
            <AlertTriangle className="h-4 w-4" /> {err}
          </p>
        )}
      </div>
    </Modal>
  );
}
