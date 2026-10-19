/**
 * A job's form for the web (tech page and office): load it, save answers as
 * they're given (shown at once, sent in order), upload photos for questions.
 */
import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiHeaders } from "../../lib/api";
import type { Answer, Answers, FormDef } from "../../../shared/forms/form-model";

export interface JobFormData {
  templateId: string | null;
  templateName: string;
  version: number;
  form: FormDef;
  answers: Answers;
  status: "in_progress" | "complete";
  missing: string[];
  flagged: string[];
  progress: { answered: number; total: number };
  updatedAt: string | null;
  updatedBy: string;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: "include", ...init, headers: { "Content-Type": "application/json", "X-Forms": "2", ...apiHeaders(), ...init?.headers } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((body as { message?: string }).message || `Request failed (${r.status})`), { status: r.status, body });
  return body as T;
}

export function useJobForm(bookingId: string | undefined) {
  const qc = useQueryClient();
  const key = ["job-form", bookingId];
  const q = useQuery({
    queryKey: key,
    enabled: !!bookingId,
    queryFn: () => call<{ form: JobFormData | null }>(`/api/job-forms/${bookingId}`).then((r) => r.form),
  });
  const [pending, setPending] = useState<Answers>({});
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const answer = useCallback(
    (itemId: string, a: Answer) => {
      setPending((p) => ({ ...p, [itemId]: a }));
      setState("saving");
      chain.current = chain.current
        .catch(() => {})
        .then(() => call<{ form: JobFormData }>(`/api/job-forms/${bookingId}`, { method: "PATCH", body: JSON.stringify({ answers: { [itemId]: a } }) }))
        .then((r) => {
          qc.setQueryData(key, r.form);
          setPending((p) => {
            if (p[itemId] !== a) return p;
            const { [itemId]: _done, ...rest } = p;
            return rest;
          });
          setState("idle");
        })
        .catch(() => setState("error"));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookingId, qc],
  );

  const uploadPhoto = useCallback(
    async (itemId: string, file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("formItemId", itemId);
      fd.append("phase", "during");
      const r = await fetch(`/api/bookings/${bookingId}/photos`, { method: "POST", body: fd, credentials: "include", headers: apiHeaders() });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((body as { message?: string }).message || "Couldn't upload that photo");
      const p = (body as { photo?: { id: string; url: string } }).photo ?? (body as { id: string; url: string });
      return { id: p.id, url: p.url };
    },
    [bookingId],
  );

  const photosQ = useQuery({
    queryKey: ["booking-photos", bookingId],
    enabled: !!bookingId && !!q.data,
    queryFn: () => call<{ photos: { id: string; url: string }[] }>(`/api/bookings/${bookingId}/photos`),
  });
  const photoUrls = Object.fromEntries((photosQ.data?.photos ?? []).map((p) => [p.id, p.url]));

  const data = q.data ?? null;
  const answers = data ? { ...data.answers, ...pending } : {};
  return { data, loading: q.isLoading, answers, answer, uploadPhoto, photoUrls, saveState: state, settled: () => chain.current };
}

/** Finish a job from a form-aware page; a 409 lists the required questions still open. */
export async function completeJob(bookingId: string): Promise<{ ok: true } | { ok: false; message: string; missing: { id: string; label: string }[] }> {
  try {
    await call(`/api/bookings/${bookingId}/status`, { method: "POST", body: JSON.stringify({ status: "completed" }) });
    return { ok: true };
  } catch (e) {
    const err = e as Error & { status?: number; body?: { missing?: { id: string; label: string }[]; message?: string } };
    if (err.status === 409 && err.body?.missing) return { ok: false, message: err.body.message ?? err.message, missing: err.body.missing };
    return { ok: false, message: err.message, missing: [] };
  }
}
