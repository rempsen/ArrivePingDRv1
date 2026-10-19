/**
 * Three ways to start a template: from the ready-made library for this
 * company's trade, from a sentence (AI drafts it for review), or blank.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, FilePlus2, Library, Sparkles } from "lucide-react";
import { Modal } from "../../../components/modal";
import { FormFill } from "../../../components/forms/form-fill";
import { questionCount, type FormDef } from "../../../../shared/forms/form-model";
import { putSeed } from "./seed";
import { apiHeaders } from "../../../lib/api";

interface LibraryItem {
  key: string;
  name: string;
  category: string;
  description: string;
  estimatedMins: number;
  color: string;
  industries: string[];
  form: FormDef;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...apiHeaders(), ...init?.headers } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { message?: string }).message || `Request failed (${r.status})`);
  return body as T;
}

export function NewTemplateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<"pick" | "library" | "describe">("pick");
  const [peek, setPeek] = useState<LibraryItem | null>(null);
  const [text, setText] = useState("");
  const libQ = useQuery({
    queryKey: ["templates", "library"],
    enabled: open,
    queryFn: () => getJson<{ industryLabel: string | null; templates: LibraryItem[] }>("/api/templates/library"),
  });
  const gen = useMutation({
    mutationFn: () => getJson<{ draft: { name: string; category: string; description: string; estimatedMins: number; color: string; form: FormDef } }>("/api/templates/generate", { method: "POST", body: JSON.stringify({ description: text }) }),
    onSuccess: (r) => start({ name: r.draft.name, category: r.draft.category, description: r.draft.description, estimatedMins: r.draft.estimatedMins, color: r.draft.color, items: r.draft.form.items }),
  });

  function close() {
    setMode("pick");
    setPeek(null);
    onClose();
  }
  function start(seed: Parameters<typeof putSeed>[0]) {
    const k = putSeed(seed);
    close();
    navigate(`/admin/builder/new?seed=${k}`);
  }
  function fromLibrary(t: LibraryItem) {
    start({ name: t.name, category: t.category, description: t.description, estimatedMins: t.estimatedMins, color: t.color, items: t.form.items });
  }

  const lib = libQ.data?.templates ?? [];
  const title = mode === "library" ? "Start from the library" : mode === "describe" ? "Describe the job" : "New template";

  return (
    <Modal open={open} onClose={close} title={title} size={mode === "library" ? "lg" : "md"}>
      {mode !== "pick" && (
        <button type="button" onClick={() => (peek ? setPeek(null) : setMode("pick"))} className="mb-3 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back
        </button>
      )}

      {mode === "pick" && (
        <div className="grid gap-3 md:grid-cols-3">
          <StartCard icon={Library} title="From the library" body={libQ.data?.industryLabel ? `Ready-made forms for ${libQ.data.industryLabel}, written by people who know the trade.` : "Ready-made forms for common trades. Copy one and make it yours."} onClick={() => setMode("library")} recommended />
          <StartCard icon={Sparkles} title="Describe it" body="Write a sentence about the job and AI drafts the form. You review it before anything is saved." onClick={() => setMode("describe")} />
          <StartCard icon={FilePlus2} title="Blank" body="Start with an empty form and add your own questions." onClick={() => start({})} />
        </div>
      )}

      {mode === "library" && !peek && (
        <div>
          {libQ.isLoading && <p className="py-8 text-center text-sm text-slate-500">Loading the library…</p>}
          {libQ.isError && <p className="py-8 text-center text-sm text-red-400">The library didn't load. Close this and try again.</p>}
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {lib.map((t) => (
              <li key={t.key}>
                <button type="button" onClick={() => setPeek(t)} className="nvc-card flex h-full w-full flex-col p-3 text-left hover:border-brand/50">
                  <span className="flex items-start gap-2.5">
                    <span className="mt-1 h-6 w-1 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-white">{t.name}</span>
                      <span className="block text-[11px] text-slate-500">
                        {t.category} · {questionCount(t.form)} questions · ~{t.estimatedMins} min
                      </span>
                    </span>
                  </span>
                  <span className="mt-1.5 line-clamp-2 text-xs text-slate-400">{t.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mode === "library" && peek && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            <p className="text-lg font-semibold text-white">{peek.name}</p>
            <p className="mt-1 text-sm text-slate-400">{peek.description}</p>
            <p className="mt-3 text-xs text-slate-500">
              {questionCount(peek.form)} questions · ~{peek.estimatedMins} min · {peek.category}
            </p>
            <button type="button" onClick={() => fromLibrary(peek)} className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-deep">
              Use this template
            </button>
            <p className="mt-2 text-xs text-slate-500">It opens in the editor so you can change anything before saving.</p>
          </div>
          <div className="max-h-[60vh] overflow-y-auto rounded-2xl border border-white/10 bg-ink-2 p-3">
            <FormFill form={peek.form} answers={{}} onAnswer={() => {}} disabled />
          </div>
        </div>
      )}

      {mode === "describe" && (
        <div className="space-y-3">
          <label htmlFor="describe-job" className="block text-sm text-slate-300">
            What happens on this job, and what should the technician record?
          </label>
          <textarea
            id="describe-job"
            aria-label="Describe the job"
            rows={4}
            value={text}
            maxLength={1500}
            onChange={(e) => setText(e.target.value)}
            placeholder="Furnace tune-up: check the filter, test the igniter, record the CO reading and gas pressure, photos before and after, customer signs off."
            className="w-full rounded-lg border border-white/10 bg-ink-3/60 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-brand focus:outline-none"
          />
          {gen.isError && <p className="text-sm text-red-400">{(gen.error as Error).message}</p>}
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={text.trim().length < 12 || gen.isPending}
              onClick={() => gen.mutate()}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-deep disabled:opacity-40"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" /> {gen.isPending ? "Drafting…" : "Draft the form"}
            </button>
            <p className="text-xs text-slate-500">Nothing is saved until you press Save in the editor.</p>
          </div>
        </div>
      )}
    </Modal>
  );
}

function StartCard({ icon: Icon, title, body, onClick, recommended }: { icon: typeof Library; title: string; body: string; onClick: () => void; recommended?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`nvc-card flex h-full flex-col p-4 text-left transition hover:border-brand/60 ${recommended ? "border-brand/40" : ""}`}>
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-cyan-400/10">
        <Icon className="h-5 w-5 text-cyan-300" aria-hidden="true" />
      </span>
      <span className="mt-3 text-sm font-semibold text-white">{title}</span>
      <span className="mt-1 text-[13px] leading-relaxed text-slate-400">{body}</span>
    </button>
  );
}
