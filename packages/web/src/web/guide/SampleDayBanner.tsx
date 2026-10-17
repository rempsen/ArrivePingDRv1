import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FlaskConical } from "lucide-react";
import { Modal } from "../components/modal";
import { useToast } from "../components/toast";
import { useAuth } from "../hooks/use-auth";
import { apiFetch, apiHeaders } from "../lib/api";
import { useCustomerNoun, useJobNoun, useWorkerNoun } from "../lib/use-brand";

/**
 * The strip over a new company's sample day (services/sample-day.ts): says
 * plainly that the people and jobs are pretend and message nobody, links to
 * the live van's customer tracking page, and lets an admin clear it all.
 */
export interface SampleDayStatus {
  active: boolean;
  jobs?: number;
  techs?: number;
  customers?: number;
  seededAt?: string | null;
  clearedAt?: string | null;
  trackToken?: string | null;
}

const OFFICE = new Set(["superadmin", "admin", "manager", "dispatcher", "project_manager"]);
export const SAMPLE_DAY_KEY = ["sample-day"] as const;

export function useSampleDay() {
  const { role } = useAuth();
  return useQuery({
    queryKey: SAMPLE_DAY_KEY,
    queryFn: async () => {
      const res = await apiFetch("/api/sample-day", { headers: apiHeaders() });
      if (!res.ok) return { active: false } as SampleDayStatus;
      return (await res.json()) as SampleDayStatus;
    },
    enabled: OFFICE.has(role),
    staleTime: 60_000,
  });
}

/** Add the sample day back after it was cleared (admins). */
export function useAddSampleDay() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/sample-day", { method: "POST", headers: apiHeaders() });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message || "Couldn't add sample data.");
    },
    onSuccess: async () => {
      await qc.invalidateQueries();
      toast.success("Sample day added.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function SampleDayBanner() {
  const { role } = useAuth();
  const isAdmin = role === "admin" || role === "superadmin";
  const q = useSampleDay();
  const qc = useQueryClient();
  const toast = useToast();
  const worker = useWorkerNoun();
  const customer = useCustomerNoun();
  const job = useJobNoun();
  const [confirm, setConfirm] = useState(false);

  const clear = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/sample-day", { method: "DELETE", headers: apiHeaders() });
      if (!res.ok) throw new Error("Couldn't clear sample data. Try again.");
      return (await res.json()) as { jobs: number; people: number; linkedJobs: number; unassigned: number };
    },
    onSuccess: async (r) => {
      setConfirm(false);
      // Every list on screen may hold sample rows.
      await qc.invalidateQueries();
      toast.success(
        "Sample data cleared.",
        r.unassigned ? `${r.unassigned} of your own ${r.unassigned === 1 ? job.noun.toLowerCase() : job.nounPlural.toLowerCase()} went back to unassigned.` : undefined,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const s = q.data;
  if (!s?.active) return null;
  const lc = (x: string) => x.toLowerCase();

  return (
    <>
      <section
        aria-label="Sample data"
        data-tour="sample.banner"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber-400/20 bg-amber-400/[0.07] px-4 py-2.5 text-sm md:px-6"
      >
        <FlaskConical className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-slate-200">
          <span className="font-semibold text-white">You're looking at a sample day.</span>{" "}
          <span className="text-slate-300">
            The {lc(worker.nounPlural)}, {lc(customer.nounPlural)} and {lc(job.nounPlural)} marked “(sample)” are pretend, so you can
            try things safely. Nobody is texted or emailed about them.
          </span>
        </p>
        <div className="flex w-full flex-wrap items-center gap-2 pl-8 sm:w-auto sm:shrink-0 sm:pl-0">
          {s.trackToken && (
            <a
              href={`/t/${s.trackToken}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold text-amber-200 hover:bg-white/5"
            >
              <span className="sm:hidden">{customer.noun} view</span>
              <span className="hidden sm:inline">See what your {lc(customer.noun)} sees</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="rounded-lg bg-white/10 px-3 py-1.5 font-semibold text-white ring-1 ring-white/10 hover:bg-white/15"
            >
              Clear sample data
            </button>
          )}
        </div>
      </section>

      <Modal
        open={confirm}
        onClose={() => !clear.isPending && setConfirm(false)}
        size="sm"
        title="Clear sample data?"
        subtitle="Ready to use your own? This can't be undone, but you can add a fresh sample day later from Guide & help."
        footer={
          <div className="flex w-full justify-end gap-2">
            <button
              type="button"
              disabled={clear.isPending}
              onClick={() => setConfirm(false)}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-400 hover:text-white"
            >
              Keep it for now
            </button>
            <button
              type="button"
              disabled={clear.isPending}
              onClick={() => clear.mutate()}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-60"
            >
              {clear.isPending ? "Clearing…" : "Clear sample data"}
            </button>
          </div>
        }
      >
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-300">
          <li>
            Removes {s.jobs ?? 0} sample {lc(job.nounPlural)}, {s.techs ?? 0} sample {lc(worker.nounPlural)} and {s.customers ?? 0} sample{" "}
            {lc(customer.nounPlural)}.
          </li>
          <li>Your own {lc(job.nounPlural)}, {lc(customer.nounPlural)} and team are kept.</li>
          <li>
            Any of your own {lc(job.nounPlural)} given to a sample {lc(worker.noun)} go back to unassigned. Any you booked for a sample{" "}
            {lc(customer.noun)} are removed with them.
          </li>
        </ul>
      </Modal>
    </>
  );
}
