/**
 * Job forms v2 data hooks.
 *
 *  - useJobForm(bookingId): GET /api/job-forms/:bookingId. `null` means the
 *    job wasn't booked on forms v2 (keep the old screen).
 *  - useSaveJobAnswers(bookingId): PATCH answers through TanStack Query, so
 *    the app-wide offline setup (lib/network.ts) pauses the save with no
 *    signal and replays it on reconnect. Saves share a mutation scope, so they
 *    replay in the order the tech gave them; the server also keeps the newer
 *    answer per question by `at`.
 *
 * Answers that haven't been acknowledged yet are folded back over every
 * refetch (they live in the global mutation cache, so this survives leaving
 * and re-opening the job while offline).
 */
import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { authHeaders } from "../auth";
import type { Answers } from "./form-model";
import { combineAnswers, patchBody, withAnswers, type JobForm } from "./job-form-data";
import { SIGNED_OUT, messageFromBody } from "../api-error";

const API = ((Constants.expoConfig?.extra?.apiUrl as string) ?? "").replace(/\/$/, "");

export const jobFormKey = (bookingId: string | undefined) => ["job-form", bookingId] as const;
export const jobFormSaveKey = (bookingId: string | undefined) => ["job-form-save", bookingId] as const;
/** Mutations in this scope run one after another (form saves, then "Complete job"). */
export const jobFormScope = (bookingId: string | undefined) => `job-form-${bookingId}`;

/** Answers still on their way to the server (queued offline or in flight). */
export function unsentAnswers(qc: QueryClient, bookingId: string | undefined): Answers {
  const pending = qc
    .getMutationCache()
    .findAll({ mutationKey: jobFormSaveKey(bookingId), status: "pending" })
    .map((m) => m.state.variables as Answers | undefined)
    .filter((v): v is Answers => !!v && typeof v === "object");
  return combineAnswers(pending);
}

export function useJobForm(bookingId: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: jobFormKey(bookingId),
    enabled: !!bookingId,
    queryFn: async (): Promise<JobForm | null> => {
      const res = await fetch(`${API}/api/job-forms/${bookingId}`, { headers: authHeaders() });
      // An older server without forms v2: behave exactly as before.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Couldn't load this job's form");
      const body = (await res.json().catch(() => null)) as { form?: JobForm | null } | null;
      const jf = body?.form ?? null;
      if (!jf) return null;
      return withAnswers(jf, unsentAnswers(qc, bookingId));
    },
    // Only jobs that HAVE a form keep polling (office edits show up).
    refetchInterval: (q) => (q.state.data ? 30000 : false),
  });
}

export function useSaveJobAnswers(bookingId: string | undefined) {
  const qc = useQueryClient();
  const key = jobFormKey(bookingId);
  return useMutation({
    mutationKey: jobFormSaveKey(bookingId),
    scope: { id: jobFormScope(bookingId) },
    mutationFn: async (answers: Answers): Promise<JobForm> => {
      const res = await fetch(`${API}/api/job-forms/${bookingId}`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(patchBody(answers)),
      });
      const body = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        throw new Error(messageFromBody(body) ?? (res.status === 401 ? SIGNED_OUT : "Couldn't save that answer."));
      }
      return body.form as JobForm;
    },
    // Show the answer NOW; the server reconciles.
    onMutate: async (answers) => {
      await qc.cancelQueries({ queryKey: key });
      qc.setQueryData<JobForm | null>(key, (old) => (old ? withAnswers(old, answers) : old));
    },
    onSuccess: (form) => {
      if (form) qc.setQueryData<JobForm | null>(key, withAnswers(form, unsentAnswers(qc, bookingId)));
    },
    // A refused answer (400) must not linger on screen as if it were saved.
    onError: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });
}
