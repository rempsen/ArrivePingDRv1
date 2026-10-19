/**
 * Job forms v2 — a filled form, read-only: the office's work order and job
 * report (audience "office"), and anything a customer sees (audience
 * "customer": office-only questions and flags are left out).
 *
 * The rows come from shared/forms/form-results.ts, the same source as the
 * job PDF, the customer's emailed copy and the CSV export.
 */
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Lock } from "lucide-react";
import { apiHeaders } from "../../lib/api";
import { fmtDate, cn } from "../../lib/utils";
import { formResults, resultsProgress, type FormAudience, type JobFormView, type ResultRow } from "../../../shared/forms/form-results";

export type FormPhoto = { id: string; url: string; caption?: string | null };

export interface FormAnswersProps {
  form: JobFormView;
  /** The job, for its photos (GET /api/bookings/:id/photos) when `photos` isn't given. */
  bookingId: string;
  audience: FormAudience;
  /** The job's photos, when the page already has them (skips the fetch). */
  photos?: FormPhoto[];
  /** Slot in the header, right side — e.g. a future "Edit answers" button. */
  actions?: ReactNode;
  className?: string;
}

function usePhotos(bookingId: string, given: FormPhoto[] | undefined, needed: boolean) {
  const q = useQuery({
    queryKey: ["job-photos", bookingId],
    queryFn: async () => {
      const res = await fetch(`/api/bookings/${bookingId}/photos`, { headers: apiHeaders() });
      if (!res.ok) return [] as FormPhoto[];
      const data = (await res.json()) as { photos?: FormPhoto[] };
      return data.photos ?? [];
    },
    enabled: needed && !given,
  });
  return useMemo(() => new Map((given ?? q.data ?? []).map((p) => [p.id, p])), [given, q.data]);
}

function Pill({ tone, children }: { tone: "flag" | "internal"; children: ReactNode }) {
  const cls = tone === "flag" ? "border-amber-500/40 bg-amber-500/15 text-amber-300" : "border-white/10 bg-white/5 text-slate-400";
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", cls)}>
      {children}
    </span>
  );
}

function AnswerValue({ row, photos, audience }: { row: ResultRow; photos: Map<string, FormPhoto>; audience: FormAudience }) {
  const { item, answer } = row;
  if (row.missing) return <span className="text-sm font-medium text-rose-300/80">Not answered</span>;
  if (!row.answered && item.type !== "checklist") return <span className="text-sm text-slate-600">—</span>;

  if (item.type === "signature") {
    const src = typeof answer?.value === "string" ? answer.value : "";
    return (
      <div>
        {src && (
          <div className="inline-block rounded-lg border border-white/10 bg-white p-2">
            <img src={src} alt={answer?.name ? `Signature of ${answer.name}` : "Signature"} className="h-16 max-w-[240px] object-contain" />
          </div>
        )}
        <p className="mt-1 text-xs text-slate-400">{answer?.name ? `Signed by ${answer.name}` : "Signed"}</p>
      </div>
    );
  }

  if (item.type === "photo") {
    const list = row.photoIds.map((id) => photos.get(id)).filter((p): p is FormPhoto => !!p);
    return (
      <div>
        {list.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {list.map((p, i) => (
              <li key={p.id}>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open photo ${i + 1} for ${item.label}`}
                  className="block h-16 w-16 overflow-hidden rounded-lg border border-white/10 bg-ink-3 hover:border-brand/40"
                >
                  <img src={p.url} alt={p.caption || `${item.label}, photo ${i + 1}`} className="h-full w-full object-cover" />
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <p className={cn("text-xs text-slate-400", list.length > 0 && "mt-1")}>{row.text}</p>
      </div>
    );
  }

  if ((item.type === "checklist" || item.type === "multi_choice") && Array.isArray(answer?.value) && answer.value.length) {
    const picked = answer.value as string[];
    return (
      <div>
        <p className="text-sm font-medium text-slate-100">{row.text}</p>
        {item.type === "checklist" ? (
          <ul className="mt-1 space-y-0.5">
            {(item.options ?? []).map((o) => {
              const done = picked.includes(o);
              return (
                <li key={o} className={cn("flex items-center gap-1.5 text-xs", done ? "text-slate-300" : "text-slate-600")}>
                  <CheckCircle2 aria-hidden="true" className={cn("h-3.5 w-3.5", done ? "text-emerald-400" : "text-slate-700")} />
                  <span>{o}</span>
                  <span className="sr-only">{done ? "(done)" : "(not done)"}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <p className={cn("whitespace-pre-wrap text-sm font-medium", row.flagged && audience === "office" ? "text-amber-200" : "text-slate-100")}>
      {row.text}
    </p>
  );
}

export function FormAnswers({ form, bookingId, audience, photos, actions, className }: FormAnswersProps) {
  const groups = useMemo(() => formResults(form, audience), [form, audience]);
  const needsPhotos = groups.some((g) => g.rows.some((r) => r.photoIds.length > 0));
  const photoMap = usePhotos(bookingId, photos, needsPhotos);
  const p = resultsProgress(groups);
  const office = audience === "office";

  return (
    <section aria-label={`${form.templateName} answers`} className={cn("space-y-4", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-bold text-white">
            <ClipboardCheck aria-hidden="true" className="h-4 w-4 text-brand" />
            <span className="truncate">{form.templateName || "Form"}</span>
            {form.version > 0 && <span className="text-xs font-normal text-slate-500">Version {form.version}</span>}
          </h4>
          <p className="mt-0.5 text-xs text-slate-400">
            <span className="font-semibold text-cyan-glow">
              {p.answered} of {p.total} answered
            </span>
            {form.updatedAt && (
              <span className="text-slate-500">
                {" · Last updated "}
                {form.updatedBy ? `by ${form.updatedBy} ` : ""}
                {fmtDate(form.updatedAt)}
              </span>
            )}
          </p>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 py-6 text-center text-sm text-slate-500">No questions to show.</p>
      ) : (
        groups.map((g, gi) => (
          <div key={g.section?.id ?? `lead-${gi}`} className="rounded-xl border border-white/10 bg-white/[0.02]">
            {g.section && (
              <div className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2">
                <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{g.section.label}</h5>
                {office && g.internal && (
                  <Pill tone="internal">
                    <Lock aria-hidden="true" className="h-3 w-3" /> Office only
                  </Pill>
                )}
              </div>
            )}
            <dl className="divide-y divide-white/5">
              {g.rows.map((r) => (
                <div
                  key={r.item.id}
                  className={cn(
                    "grid gap-1 px-3 py-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4",
                    r.flagged && "bg-amber-500/[0.06]",
                  )}
                >
                  <dt className="flex flex-wrap items-start gap-1.5 text-xs font-semibold text-slate-300">
                    <span>
                      {r.item.label}
                      {r.item.required && (
                        <>
                          <span className="text-slate-500" aria-hidden="true"> *</span>
                          <span className="sr-only"> (required)</span>
                        </>
                      )}
                    </span>
                    {office && r.internal && !g.internal && (
                      <Pill tone="internal">
                        <Lock aria-hidden="true" className="h-3 w-3" /> Office only
                      </Pill>
                    )}
                  </dt>
                  <dd className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <AnswerValue row={r} photos={photoMap} audience={audience} />
                    </div>
                    {office && r.flagged && (
                      <Pill tone="flag">
                        <AlertTriangle aria-hidden="true" className="h-3 w-3" /> Flagged
                      </Pill>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))
      )}
    </section>
  );
}
