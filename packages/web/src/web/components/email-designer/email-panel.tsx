/**
 * The Email tab: subject, inbox preview text, starting points (templates and
 * "Describe it"), saving as a reusable template and sending a test.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, LayoutTemplate, Save, Send, Sparkles, Trash2, X } from "lucide-react";
import { api } from "../../lib/api";
import { DialogPanel } from "../dialog-panel";
import { dismiss } from "../../lib/utils";
import { normalizeDesign, type EmailDesign } from "../../../shared/email/design";
import { copyStarter, startersFor } from "../../../shared/email/starters";
import { makeCtx, renderBlock, type EmailBrand } from "../../../shared/email/render";
import { Field, TokenInput, inputBase } from "./fields";

export interface EmailPanelProps {
  subject: string;
  setSubject: (s: string) => void;
  preheader: string;
  setPreheader: (s: string) => void;
  design: EmailDesign;
  replaceDesign: (d: EmailDesign, subject?: string) => void;
  event?: string;
  recipient?: string;
  brand: EmailBrand;
  vars: object;
  /** Unsaved theme and colours, so the test shows what's on screen. */
  brandOverride: () => Record<string, unknown>;
}

export function EmailPanel(p: EmailPanelProps) {
  const [gallery, setGallery] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  return (
    <div>
      <Field label="Subject line" htmlFor="ep-subject" hint="Keep it under about 60 characters so phones show all of it.">
        <TokenInput id="ep-subject" label="Subject line" value={p.subject} onChange={p.setSubject} placeholder="{{company}}: an update on your {{service}}" />
      </Field>
      <Field label="Preview text" htmlFor="ep-pre" hint="The grey line after the subject in the inbox. Blank uses the first words of the email.">
        <TokenInput id="ep-pre" label="Preview text" value={p.preheader} onChange={p.setPreheader} placeholder="e.g. Jordan is on the way. Track them live." />
      </Field>

      <div className="mb-5 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setGallery(true)} className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-ink px-3 py-2 text-xs font-semibold text-slate-200 hover:border-brand/50">
          <LayoutTemplate className="h-4 w-4 text-cyan-300" aria-hidden="true" /> Templates
        </button>
        <button type="button" onClick={() => setSaveOpen(true)} className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-ink px-3 py-2 text-xs font-semibold text-slate-200 hover:border-brand/50">
          <Save className="h-4 w-4 text-cyan-300" aria-hidden="true" /> Save as template
        </button>
      </div>

      <Describe {...p} />
      <TestSend {...p} />

      {gallery && <Gallery {...p} onClose={() => setGallery(false)} />}
      {saveOpen && <SaveTemplate design={p.design} subject={p.subject} onClose={() => setSaveOpen(false)} />}
    </div>
  );
}

function Describe(p: EmailPanelProps) {
  const [text, setText] = useState("");
  const gen = useMutation({
    mutationFn: async () => {
      const r = await (api["notif-config"] as any).email.generate.$post({ json: { description: text, event: p.event, recipient: p.recipient } });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message || "Couldn't draft the email right now.");
      return body.draft as { subject: string; design: EmailDesign };
    },
    onSuccess: (d) => {
      p.replaceDesign(normalizeDesign(d.design), d.subject);
      setText("");
    },
  });
  return (
    <section aria-labelledby="ep-ai" className="mb-5 rounded-xl border border-violet-400/25 bg-violet-400/5 p-3">
      <h3 id="ep-ai" className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-violet-200">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Describe it
      </h3>
      <p className="mb-2 text-[11px] leading-snug text-slate-400">Say what this email should do and AI drafts it. It replaces the current blocks; Undo brings them back.</p>
      <textarea
        aria-label="Describe the email"
        rows={3}
        maxLength={1500}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Tell the customer their technician is on the way with the arrival time, the tech's photo and a big tracking button. Remind them to secure pets."
        className={`${inputBase} text-xs`}
      />
      {gen.isError && <p className="mt-1 text-xs text-amber-300">{(gen.error as Error).message}</p>}
      <button
        type="button"
        disabled={text.trim().length < 12 || gen.isPending}
        onClick={() => gen.mutate()}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-400 disabled:opacity-40"
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {gen.isPending ? "Drafting…" : "Draft the email"}
      </button>
    </section>
  );
}

function TestSend(p: EmailPanelProps) {
  const [to, setTo] = useState("");
  const send = useMutation({
    mutationFn: async () => (await api["notif-config"].email.test.$post({ json: { to, subject: p.subject, design: p.design, brand: p.brandOverride() } as any })).json() as Promise<any>,
  });
  const r = send.data as { ok?: boolean; skipped?: boolean; error?: string; message?: string } | undefined;
  return (
    <section aria-labelledby="ep-test" className="rounded-xl border border-white/10 p-3">
      <h3 id="ep-test" className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-300">
        <Send className="h-3.5 w-3.5" aria-hidden="true" /> Send a test
      </h3>
      <p className="mb-2 text-[11px] text-slate-500">Sample job details, with your unsaved changes. The subject starts with [TEST].</p>
      <div className="flex gap-1.5">
        <input aria-label="Send the test to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@company.com" className={`${inputBase} text-xs`} />
        <button type="button" disabled={!/^\S+@\S+\.\S+$/.test(to) || send.isPending} onClick={() => send.mutate()} className="shrink-0 rounded-lg bg-brand px-3 text-xs font-bold text-white hover:bg-brand-deep disabled:opacity-40">
          {send.isPending ? "Sending…" : "Send"}
        </button>
      </div>
      {r && (
        <p aria-live="polite" className={`mt-1.5 text-xs ${r.ok ? "text-emerald-300" : "text-amber-300"}`}>
          {r.ok ? `Sent to ${to}. Check your inbox.` : r.skipped ? "Email sending isn't set up on this server." : r.message || r.error || "The test didn't send."}
        </p>
      )}
    </section>
  );
}

function Thumb({ design, brand, vars }: { design: EmailDesign; brand: EmailBrand; vars: object }) {
  const ctx = makeCtx(brand, vars, { editor: false });
  const html = design.blocks
    .slice(0, 4)
    .map((b) => renderBlock(ctx, b))
    .join("");
  return (
    <div aria-hidden="true" className="pointer-events-none h-44 overflow-hidden rounded-lg border border-white/10 bg-white">
      <div style={{ width: 600, transform: "scale(0.47)", transformOrigin: "top left", padding: "32px 40px", fontFamily: ctx.font }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function Gallery(p: EmailPanelProps & { onClose: () => void }) {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["email-templates"], queryFn: async () => (await api["notif-config"].email.templates.$get()).json() });
  const del = useMutation({
    mutationFn: async (id: string) => (await api["notif-config"].email.templates[":id"].$delete({ param: { id } })).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-templates"] }),
  });
  const mine = (((saved.data as any)?.templates ?? []) as any[]).filter((t) => !t.isBuiltin);
  const starters = startersFor(p.event || "", p.recipient || "client");
  const use = (d: EmailDesign, subject?: string) => {
    p.replaceDesign(d, subject);
    p.onClose();
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" {...dismiss(p.onClose)}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" />
      <DialogPanel onClose={p.onClose} label="Email templates" className="relative max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-white/10 bg-ink-2 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Start from a template</h2>
            <p className="text-xs text-slate-400">The best matches for this message come first. Using one replaces the current blocks (Undo brings them back).</p>
          </div>
          <button type="button" onClick={p.onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {starters.map((s) => (
            <li key={s.key}>
              <button type="button" aria-label={`Use the ${s.name} template: ${s.description}`} onClick={() => { const c = copyStarter(s); use(c.design, c.subject); }} className="group w-full rounded-xl border border-white/10 bg-ink p-2.5 text-left hover:border-brand/60">
                <Thumb design={s.design} brand={p.brand} vars={p.vars} />
                <div className="mt-2 flex items-center gap-2 px-0.5">
                  <span className="text-sm font-semibold text-white">{s.name}</span>
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">{s.recipient === "client" ? "Customer" : s.recipient === "tech" ? "Technician" : "Office"}</span>
                </div>
                <p className="px-0.5 text-[11px] leading-snug text-slate-500">{s.description}</p>
              </button>
            </li>
          ))}
        </ul>
        {mine.length > 0 && (
          <>
            <h3 className="mb-2 mt-6 flex items-center gap-1.5 text-sm font-bold text-white">
              <BookMarked className="h-4 w-4 text-cyan-300" aria-hidden="true" /> Your saved templates
            </h3>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {mine.map((t) => {
                const d = normalizeDesign(t.design);
                return (
                  <li key={t.id} className="relative">
                    <button type="button" aria-label={`Use your template ${t.name}`} onClick={() => use(d, t.subject || undefined)} className="w-full rounded-xl border border-white/10 bg-ink p-2.5 text-left hover:border-brand/60">
                      <Thumb design={d} brand={p.brand} vars={p.vars} />
                      <div className="mt-2 px-0.5 text-sm font-semibold text-white">{t.name}</div>
                      {t.description && <p className="px-0.5 text-[11px] text-slate-500">{t.description}</p>}
                    </button>
                    <button type="button" onClick={() => del.mutate(t.id)} aria-label={`Delete the template ${t.name}`} className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-lg bg-slate-900/80 text-slate-300 hover:text-red-400">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </DialogPanel>
    </div>
  );
}

function SaveTemplate({ design, subject, onClose }: { design: EmailDesign; subject: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const save = useMutation({
    mutationFn: async () => (await api["notif-config"].email.templates.$post({ json: { name: name.trim() || "Untitled template", description, subject, design } as any })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-templates"] });
      onClose();
    },
  });
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" {...dismiss(onClose)}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" />
      <DialogPanel onClose={onClose} label="Save as a template" className="relative w-full max-w-md rounded-2xl border border-white/10 bg-ink-2 p-5 shadow-2xl">
        <h2 className="mb-1 text-lg font-bold text-white">Save as a template</h2>
        <p className="mb-4 text-xs text-slate-400">Reuse this layout on any other notification email.</p>
        <Field label="Name" htmlFor="st-name">
          <input id="st-name" aria-label="Template name" className={inputBase} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Winter tune-up reminder" />
        </Field>
        <Field label="Description (optional)" htmlFor="st-desc">
          <input id="st-desc" aria-label="Template description" className={inputBase} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {save.isError && <p className="mb-2 text-xs text-amber-300">The template didn't save. Try again.</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:text-white">
            Cancel
          </button>
          <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-deep disabled:opacity-50">
            {save.isPending ? "Saving…" : "Save template"}
          </button>
        </div>
      </DialogPanel>
    </div>
  );
}
