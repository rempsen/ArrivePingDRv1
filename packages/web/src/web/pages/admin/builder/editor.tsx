/**
 * Job forms v2 — the template editor (/admin/builder/:id, or /new).
 *
 *   top bar   name · category · version · save state · undo/redo · Save
 *   tabs      Form │ Pricing & pay │ Settings
 *   Form tab  [Add palette (sticky)] [canvas] [Question settings │ Preview (sticky)]
 *
 * Every edit goes through one undo history. A draft is kept in this browser
 * so a reload never loses work, and leaving with unsaved changes asks first.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, Eye, Plus, Redo2, Save, SlidersHorizontal, Smartphone, Undo2, X } from "lucide-react";
import { api } from "../../../lib/api";
import { useAccess } from "../../../hooks/use-access";
import { ok } from "../../../lib/api-ok";
import { FullLoader } from "../../../components/loader";
import { Modal } from "../../../components/modal";
import { toast } from "../../../components/toast";
import { RateModelEditor } from "../../../components/rate-model-editor";
import { CollectPaymentToggle, TechPayEditor } from "../../../components/tech-pay-editor";
import { CategoryManagerButton } from "../../../components/category-manager";
import { FormFill } from "../../../components/forms/form-fill";
import { JobDetailsStrip, SampleJobHeader } from "../../../components/forms/job-details-strip";
import { ITEM_HINTS, ITEM_ICONS, PALETTE_GROUPS } from "../../../components/forms/item-meta";
import { EMPTY_RATE_MODEL, parseRateModel, type RateModel } from "../../../../shared/pricing";
import { parseTechPayModel, type TechPayModel } from "../../../../shared/tech-pay";
import {
  EMPTY_FORM,
  FORM_SCHEMA,
  ITEM_LABELS,
  formProblems,
  normalizeForm,
  questionCount,
  type Answers,
  type FormDef,
  type FormItem,
  type ItemType,
} from "../../../../shared/forms/form-model";
import { Canvas } from "./canvas";
import { Inspector } from "./inspector";
import { Palette } from "./palette";
import { duplicateItem, insertItem, moveItem, nudgeItem, removeItem, updateItem } from "./form-ops";
import { useHistory } from "./use-history";
import { BuilderTour } from "./tour";
import { takeSeed } from "./seed";

export interface Draft {
  name: string;
  category: string;
  description: string;
  color: string;
  estimatedMins: number;
  sendCustomerCopy: boolean;
  rateModel: RateModel;
  techPayModel: TechPayModel | null;
  collectPayment: "" | "on_site";
  items: FormItem[];
}

const COLORS = ["#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#ec4899", "#14b8a6", "#64748b"];

export const emptyDraft = (category = "General"): Draft => ({
  name: "",
  category,
  description: "",
  color: COLORS[0]!,
  estimatedMins: 60,
  sendCustomerCopy: false,
  rateModel: { ...EMPTY_RATE_MODEL },
  techPayModel: null,
  collectPayment: "",
  items: [],
});

function draftFromTemplate(t: any): Draft {
  const formDef: FormDef = t.formDef ?? EMPTY_FORM;
  return {
    name: t.name ?? "",
    category: t.category || "General",
    description: t.description ?? "",
    color: t.color || COLORS[0]!,
    estimatedMins: t.estimatedMins || 60,
    sendCustomerCopy: !!t.sendCustomerCopy,
    rateModel: parseRateModel(t.rateModel) ?? { ...EMPTY_RATE_MODEL },
    techPayModel: parseTechPayModel(t.techPayModel),
    collectPayment: t.collectPayment === "on_site" ? "on_site" : "",
    items: formDef.items,
  };
}

const draftKey = (id: string) => `builder:draft:${id}`;
type Tab = "form" | "pricing" | "settings";

export default function TemplateEditor() {
  const { id: routeId } = useParams<{ id: string }>();
  const isNew = routeId === "new";
  const search = useSearch();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { access } = useAccess();
  const v2 = !access || !!access.features?.includes("forms.v2");
  useEffect(() => {
    if (!v2) navigate("/admin/builder", { replace: true });
  }, [v2, navigate]);

  const tplQ = useQuery({
    queryKey: ["templates", routeId],
    enabled: !isNew,
    queryFn: async () => ok(await api.templates[":id"].$get({ param: { id: routeId } })),
  });
  const categoriesQ = useQuery({ queryKey: ["form-categories"], queryFn: async () => ok(await api.catalog.categories.$get()) });
  const categories: string[] = ((categoriesQ.data as any)?.categories ?? []).map((c: any) => c.name);

  const history = useHistory<Draft>(emptyDraft());
  const draft = history.value;
  const [saved, setSaved] = useState<Draft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [restore, setRestore] = useState<{ at: number; draft: Draft } | null>(null);
  const [tab, setTab] = useState<Tab>("form");
  const [pane, setPane] = useState<"settings" | "preview">("settings");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewAnswers, setPreviewAnswers] = useState<Answers>({});
  const [quickAdd, setQuickAdd] = useState(false);
  const [sheet, setSheet] = useState<"add" | "settings" | "preview" | null>(null);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [lastRemoved, setLastRemoved] = useState<{ label: string; before: FormItem[]; after: FormItem[]; item: FormItem; index: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const tpl = tplQ.data?.template as any;

  // Load once: an existing template, or a new one from a start (blank / library / AI draft).
  useEffect(() => {
    if (loaded) return;
    if (isNew) {
      const seed = takeSeed(new URLSearchParams(search).get("seed"));
      const base = emptyDraft(categories[0] ?? "General");
      const d: Draft = seed ? { ...base, ...seed, items: normalizeForm({ items: seed.items ?? [] }).items } : base;
      history.reset(d);
      setSaved(null);
      setLoaded(true);
      try {
        const raw = localStorage.getItem(draftKey("new"));
        const parsed = raw ? (JSON.parse(raw) as { at: number; draft: Draft }) : null;
        if (parsed && (parsed.draft.name || parsed.draft.items.length) && JSON.stringify(parsed.draft) !== JSON.stringify(d)) setRestore(parsed);
      } catch {
        /* storage unavailable */
      }
      return;
    }
    if (!tpl) return;
    const d = draftFromTemplate(tpl);
    history.reset(d);
    setSaved(d);
    setLoaded(true);
    try {
      const raw = localStorage.getItem(draftKey(tpl.id));
      if (raw) {
        const parsed = JSON.parse(raw) as { at: number; draft: Draft; base: string };
        if (parsed.base === JSON.stringify(d) && JSON.stringify(parsed.draft) !== JSON.stringify(d)) setRestore(parsed);
        else localStorage.removeItem(draftKey(tpl.id));
      }
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl, isNew, loaded, categoriesQ.data]);

  const dirty = loaded && (saved ? JSON.stringify(saved) !== JSON.stringify(draft) : draft.name !== "" || draft.items.length > 0);

  // Keep a local draft so a reload never loses work (a new template's under "new").
  useEffect(() => {
    if (!loaded || !dirty) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(routeId), JSON.stringify({ at: Date.now(), draft, base: saved ? JSON.stringify(saved) : "" }));
      } catch {
        /* storage unavailable */
      }
    }, 800);
    return () => clearTimeout(t);
  }, [draft, dirty, loaded, saved, routeId]);

  // Links elsewhere in the dashboard ask before leaving unsaved changes too.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank") return;
      const href = a.getAttribute("href") ?? "";
      if (!href.startsWith("/") || href === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveTo(href);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const form: FormDef = useMemo(() => ({ schema: FORM_SCHEMA, items: draft.items }), [draft.items]);
  const problems = useMemo(() => formProblems(form), [form]);
  const problemIds = useMemo(() => new Set(problems.map((p) => p.itemId).filter(Boolean) as string[]), [problems]);
  const blocker = !draft.name.trim() ? "Add a name for this template" : problems[0]?.message ?? null;
  const selected = draft.items.find((i) => i.id === selectedId) ?? null;

  const setItems = useCallback(
    (fn: (items: FormItem[]) => FormItem[], key?: string) => history.commit((d) => ({ ...d, items: fn(d.items) }), key),
    [history],
  );
  const setField = useCallback(<K extends keyof Draft>(k: K, v: Draft[K], key?: string) => history.commit((d) => ({ ...d, [k]: v }), key), [history]);

  const addType = useCallback(
    (type: ItemType, index?: number) => {
      let newId = "";
      setItems((items) => {
        const r = insertItem(items, type, index !== undefined ? { index } : { afterId: selectedId });
        newId = r.item.id;
        return r.items;
      });
      // select after the state update lands
      requestAnimationFrame(() => {
        setSelectedId(newId);
        document.querySelector<HTMLInputElement>(`[data-item-id="${newId}"] input`)?.focus();
        document.querySelector(`[data-item-id="${newId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
      setQuickAdd(false);
      setSheet(null);
    },
    [setItems, selectedId],
  );

  const removeSelected = useCallback(
    (id: string) => {
      const index = draft.items.findIndex((x) => x.id === id);
      const it = draft.items[index];
      if (!it) return;
      const after = removeItem(draft.items, id);
      setItems(() => after);
      if (selectedId === id) setSelectedId(null);
      setLastRemoved({ label: it.label, before: draft.items, after, item: it, index });
    },
    [draft.items, selectedId, setItems],
  );
  const undoRemove = useCallback(() => {
    if (!lastRemoved) return;
    // Nothing else changed since: put everything back (logic rules included).
    // Otherwise put the question back where it was, keeping the later edits.
    setItems((items) => {
      if (items === lastRemoved.after) return lastRemoved.before;
      if (items.some((x) => x.id === lastRemoved.item.id)) return items;
      const next = items.slice();
      next.splice(Math.min(lastRemoved.index, next.length), 0, lastRemoved.item);
      return next;
    });
    setLastRemoved(null);
  }, [lastRemoved, setItems]);

  const savingRef = useRef<string>("");
  const save = useMutation({
    mutationFn: async () => {
      savingRef.current = JSON.stringify(draft);
      const payload = {
        name: draft.name.trim(),
        category: draft.category,
        description: draft.description,
        color: draft.color,
        estimatedMins: draft.estimatedMins,
        sendCustomerCopy: draft.sendCustomerCopy,
        rateModel: draft.rateModel,
        techPayModel: draft.techPayModel ?? "",
        collectPayment: draft.collectPayment,
        form,
      };
      if (isNew) return ok(await api.templates.$post({ json: payload as any }));
      return ok(await api.templates[":id"].$patch({ param: { id: routeId }, json: payload as any }));
    },
    onSuccess: (r: any) => {
      const t = r.template;
      qc.invalidateQueries({ queryKey: ["templates"] });
      const d = draftFromTemplate(t);
      setSaved(d);
      // Keep the undo history, and anything typed while the save was in
      // flight; only swap in the server's copy when nothing changed since.
      if (JSON.stringify(history.value) === savingRef.current) history.replacePresent(d);
      try {
        localStorage.removeItem(draftKey(t.id));
        if (isNew) localStorage.removeItem(draftKey("new"));
      } catch {
        /* ignore */
      }
      toast({ kind: "success", message: `Saved ${t.name}`, detail: t.version ? `Version ${t.version}. Jobs already booked keep their version.` : undefined });
      if (isNew) navigate(`/admin/builder/${t.id}`, { replace: true });
    },
    onError: (e: Error) => toast({ kind: "error", message: e.message || "Couldn't save the template" }),
  });

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      // A dialog (leave, quick add, question settings) owns the keyboard.
      if (document.querySelector('[aria-modal="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!blocker && dirty && !save.isPending) save.mutate();
        return;
      }
      if (mod && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        history.redo();
        return;
      }
      if (tab !== "form") return;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        setQuickAdd(true);
        return;
      }
      if (!selectedId || typing) return;
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setItems((items) => {
          const r = duplicateItem(items, selectedId);
          if (r.copyId) requestAnimationFrame(() => setSelectedId(r.copyId));
          return r.items;
        });
        return;
      }
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        setItems((items) => nudgeItem(items, selectedId, e.key === "ArrowUp" ? -1 : 1));
        requestAnimationFrame(() => document.querySelector(`[data-item-id="${selectedId}"]`)?.scrollIntoView({ block: "nearest" }));
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelected(selectedId);
      } else if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [blocker, dirty, save, history, tab, selectedId, setItems, removeSelected]);

  useEffect(() => {
    if (!lastRemoved) return;
    const t = setTimeout(() => setLastRemoved(null), 6000);
    return () => clearTimeout(t);
  }, [lastRemoved]);

  if (!isNew && tplQ.isLoading) return <FullLoader />;
  if (!isNew && !tpl) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-sm text-slate-400">This template doesn't exist any more.</p>
        <Link href="/admin/builder" className="mt-3 inline-block text-sm font-semibold text-cyan-300 underline">
          Back to templates
        </Link>
      </div>
    );
  }

  const leave = (to: string) => (dirty ? setLeaveTo(to) : navigate(to));
  const qCount = questionCount(form);

  const inspector = selected ? (
    <Inspector
      item={selected}
      items={draft.items}
      onChange={(patch, key) => setItems((items) => updateItem(items, selected.id, patch), key)}
      onReplace={(next) => setItems((items) => items.map((x) => (x.id === next.id ? next : x)))}
      onRemove={() => removeSelected(selected.id)}
    />
  ) : (
    <NothingSelected problems={problems} onPick={setSelectedId} count={qCount} />
  );
  const preview = (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-slate-400">What the technician sees. Try it: logic and required checks work here.</p>
        {Object.keys(previewAnswers).length > 0 && (
          <button type="button" onClick={() => setPreviewAnswers({})} className="text-[11px] font-semibold text-cyan-300 hover:text-white">
            Clear answers
          </button>
        )}
      </div>
      <div className="mx-auto w-full max-w-[380px] rounded-[2rem] border border-white/15 bg-ink p-2 shadow-2xl shadow-black/40">
        <div className="max-h-[calc(100vh-14rem)] overflow-y-auto rounded-[1.6rem] bg-ink-2 p-3">
          <SampleJobHeader title={draft.name} />
          <FormFill form={form} answers={previewAnswers} by="Preview" onAnswer={(id, a) => setPreviewAnswers((m) => ({ ...m, [id]: a }))} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-w-0 pb-24">
      {/* top bar */}
      <div className="sticky top-16 z-20 border-b border-white/5 bg-ink px-4 py-2.5 md:top-0 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => leave("/admin/builder")} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Back to templates">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="h-6 w-1.5 shrink-0 rounded-full" style={{ background: draft.color }} aria-hidden="true" />
          <label htmlFor="tpl-name" className="sr-only">
            Template name
          </label>
          <input
            id="tpl-name"
            aria-label="Template name"
            value={draft.name}
            onChange={(e) => setField("name", e.target.value, "name")}
            placeholder="Name this template, e.g. Furnace tune-up"
            className="min-w-[12rem] flex-1 rounded-lg bg-transparent px-2 py-1.5 text-lg font-semibold text-white outline-none placeholder:font-normal placeholder:text-slate-500 hover:bg-white/5 focus:bg-white/5"
          />
          <span className="hidden text-xs text-slate-500 lg:inline">
            {qCount} question{qCount === 1 ? "" : "s"}
            {tpl?.version ? ` · version ${tpl.version}` : ""}
            {tpl?.jobCount ? ` · on ${tpl.jobCount} job${tpl.jobCount === 1 ? "" : "s"}` : ""}
          </span>
          <span aria-live="polite" className={`hidden text-xs sm:inline ${dirty ? "text-amber-300" : "text-slate-500"}`}>
            {save.isPending ? "Saving…" : dirty ? "Unsaved changes" : saved ? "All changes saved" : ""}
          </span>
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white disabled:opacity-30">
              <Undo2 className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white disabled:opacity-30">
              <Redo2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            data-tour="save"
            onClick={() => save.mutate()}
            disabled={!!blocker || !dirty || save.isPending}
            title={blocker ?? (dirty ? "Save (Ctrl+S)" : "No changes to save")}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-deep disabled:opacity-40"
          >
            <Save className="h-4 w-4" aria-hidden="true" /> {isNew ? "Save template" : "Save"}
          </button>
        </div>
        {blocker && dirty && (
          <p className="mt-1 flex items-center gap-1.5 pl-11 text-xs text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> {blocker} to save.
          </p>
        )}
        <div className="mt-2 flex gap-1 pl-11" role="tablist" aria-label="Template sections">
          {(
            [
              ["form", "Form"],
              ["pricing", "Pricing & pay"],
              ["settings", "Settings"],
            ] as [Tab, string][]
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === k ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {restore && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 md:mx-6">
          You have unsaved changes from {new Date(restore.at).toLocaleString()}.
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => {
              history.commit(restore.draft);
              setRestore(null);
            }}
          >
            Restore them
          </button>
          <button
            type="button"
            className="text-amber-200/70 underline"
            onClick={() => {
              setRestore(null);
              try {
                localStorage.removeItem(draftKey(routeId));
              } catch {
                /* ignore */
              }
            }}
          >
            Discard
          </button>
        </div>
      )}

      <div className="px-4 pt-4 md:px-6">
        {tab === "form" && (
          <div className="grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_360px]">
            <Canvas
              items={draft.items}
              selectedId={selectedId}
              problems={problemIds}
              onSelect={(id, opts) => {
                setSelectedId(id);
                if (id && !opts?.fromInput && window.innerWidth < 1280) setSheet("settings");
              }}
              onMove={(from, to) => setItems((items) => moveItem(items, from, to))}
              onInsert={(type, index) => addType(type, index)}
              onLabel={(id, label) => setItems((items) => updateItem(items, id, { label }), `label:${id}`)}
              onDuplicate={(id) =>
                setItems((items) => {
                  const r = duplicateItem(items, id);
                  if (r.copyId) requestAnimationFrame(() => setSelectedId(r.copyId));
                  return r.items;
                })
              }
              onRemove={removeSelected}
              onQuickAdd={() => setQuickAdd(true)}
              palette={
                <div className="sticky top-[7.5rem] hidden lg:block">
                  <Palette onAdd={(t) => addType(t)} searchRef={searchRef} />
                </div>
              }
            >
              <div className="mb-3 flex items-center gap-2 xl:hidden">
                <button type="button" onClick={() => setSheet("add")} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-sm font-semibold text-slate-200 lg:hidden">
                  <Plus className="h-4 w-4" aria-hidden="true" /> Add
                </button>
                <button type="button" onClick={() => setSheet("preview")} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-sm font-semibold text-slate-200">
                  <Smartphone className="h-4 w-4" aria-hidden="true" /> Preview
                </button>
              </div>
              <JobDetailsStrip />
              {draft.items.length === 0 && (
                <div className="mb-3 rounded-xl border border-white/10 bg-ink-2/60 p-4">
                  <p className="text-sm font-semibold text-white">Build the form your technicians fill in on site</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Start with a section like “Arrival”, then add the checks, readings, photos and the customer's signature. Drag to reorder. Questions can show only when an earlier answer calls for them.
                  </p>
                </div>
              )}
            </Canvas>
            <div className="sticky top-[7.5rem] hidden xl:block" data-tour="right-pane">
              <div className="nvc-card flex max-h-[calc(100vh-14rem)] flex-col">
                <div className="flex gap-1 border-b border-white/5 p-1.5" role="tablist" aria-label="Side panel">
                  <button type="button" role="tab" aria-selected={pane === "settings"} onClick={() => setPane("settings")} className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm ${pane === "settings" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`}>
                    <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> Question
                  </button>
                  <button type="button" role="tab" aria-selected={pane === "preview"} data-tour="preview" onClick={() => setPane("preview")} className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm ${pane === "preview" ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`}>
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Preview
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3">{pane === "settings" ? inspector : preview}</div>
              </div>
            </div>
          </div>
        )}

        {tab === "pricing" && (
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="nvc-card p-4">
              <p className="text-sm font-semibold text-white">What the customer pays</p>
              <p className="mb-3 text-xs text-slate-400">Charged on completion using actual on-site time and tracked mileage. Jobs already booked keep the prices they were booked with.</p>
              <RateModelEditor key={`rate-${saved ? "s" : "n"}`} value={draft.rateModel} onChange={(v) => setField("rateModel", v, "rate")} />
            </div>
            <div className="nvc-card space-y-3 p-4">
              <TechPayEditor key={`pay-${saved ? "s" : "n"}`} value={draft.techPayModel} onChange={(v) => setField("techPayModel", v, "pay")} />
              <CollectPaymentToggle value={draft.collectPayment} onChange={(v) => setField("collectPayment", v)} />
            </div>
          </div>
        )}

        {tab === "settings" && <SettingsTab draft={draft} setField={setField} categories={categories} tpl={tpl} />}
      </div>

      {lastRemoved && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-white/10 bg-ink-3 px-4 py-2.5 text-sm text-white shadow-2xl shadow-black/50">
          Deleted “{lastRemoved.label}”
          <button type="button" className="font-semibold text-cyan-300 hover:text-white" onClick={undoRemove}>
            Undo
          </button>
          <button type="button" aria-label="Dismiss" onClick={() => setLastRemoved(null)} className="text-slate-500 hover:text-white">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <QuickAdd open={quickAdd} onClose={() => setQuickAdd(false)} onPick={(t) => addType(t)} />
      <Modal open={sheet === "add"} onClose={() => setSheet(null)} title="Add a question" size="sm">
        <Palette onAdd={(t) => addType(t)} />
      </Modal>
      <Modal open={sheet === "settings" && !!selected} onClose={() => setSheet(null)} title="Question settings" size="sm">
        {inspector}
      </Modal>
      <Modal open={sheet === "preview"} onClose={() => setSheet(null)} title="Preview" size="sm">
        {preview}
      </Modal>
      <Modal
        open={!!leaveTo}
        onClose={() => setLeaveTo(null)}
        title="Leave without saving?"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setLeaveTo(null)} className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-white/5">
              Keep editing
            </button>
            <button
              type="button"
              onClick={() => {
                const to = leaveTo!;
                setLeaveTo(null);
                try {
                  localStorage.removeItem(draftKey(routeId));
                } catch {
                  /* ignore */
                }
                history.reset(saved ?? emptyDraft());
                navigate(to);
              }}
              className="rounded-lg bg-red-500/90 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
            >
              Discard changes
            </button>
          </div>
        }
      >
        <p className="text-sm text-slate-300">Your changes to this template haven't been saved.</p>
      </Modal>
      <BuilderTour enabled={tab === "form"} />
    </div>
  );
}

function NothingSelected({ problems, onPick, count }: { problems: { itemId?: string; message: string }[]; onPick: (id: string) => void; count: number }) {
  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-300">Select a question to change its wording, choices, flags and logic.</p>
      {problems.length > 0 && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3">
          <p className="mb-1 text-xs font-semibold text-amber-200">To fix before saving</p>
          <ul className="space-y-1">
            {problems.map((p, i) => (
              <li key={i}>
                {p.itemId ? (
                  <button type="button" onClick={() => onPick(p.itemId!)} className="text-left text-xs text-amber-100 underline decoration-amber-400/40 hover:decoration-amber-200">
                    {p.message}
                  </button>
                ) : (
                  <span className="text-xs text-amber-100">{p.message}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="rounded-lg border border-white/10 p-3 text-xs text-slate-400">
        <p className="mb-1.5 font-semibold text-slate-300">Shortcuts</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt><kbd>/</kbd></dt><dd>Add a question</dd>
          <dt><kbd>Alt ↑ ↓</kbd></dt><dd>Move the selected question</dd>
          <dt><kbd>Ctrl D</kbd></dt><dd>Duplicate</dd>
          <dt><kbd>Del</kbd></dt><dd>Delete</dd>
          <dt><kbd>Ctrl Z</kbd></dt><dd>Undo</dd>
          <dt><kbd>Ctrl S</kbd></dt><dd>Save</dd>
        </dl>
      </div>
      {count > 0 && <p className="text-xs text-slate-500">Open Preview to try the form the way a technician will.</p>}
    </div>
  );
}

function QuickAdd({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (t: ItemType) => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  useEffect(() => {
    if (open) {
      setQ("");
      setI(0);
    }
  }, [open]);
  const all = PALETTE_GROUPS.flatMap((g) => g.types);
  const list = all.filter((t) => !q || `${ITEM_LABELS[t]} ${ITEM_HINTS[t]}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal open={open} onClose={onClose} title="Add a question" size="sm">
      <input
        ref={(el) => {
          if (el && open) requestAnimationFrame(() => el.focus());
        }}
        aria-label="Type to find a question type"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setI(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setI((x) => Math.min(list.length - 1, x + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setI((x) => Math.max(0, x - 1));
          } else if (e.key === "Enter" && list[i]) {
            e.preventDefault();
            onPick(list[i]!);
          }
        }}
        placeholder="Photo, pass/fail, checklist…"
        className="mb-2 h-10 w-full rounded-lg border border-white/10 bg-ink-3/60 px-3 text-sm text-white placeholder:text-slate-500 focus:border-brand focus:outline-none"
      />
      <ul className="max-h-80 space-y-0.5 overflow-y-auto">
        {list.map((t, idx) => {
          const I = ITEM_ICONS[t];
          return (
            <li key={t}>
              <button
                type="button"
                onClick={() => onPick(t)}
                onMouseEnter={() => setI(idx)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm ${idx === i ? "bg-white/10 text-white" : "text-slate-300"}`}
              >
                <I className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                <span className="flex-1">{ITEM_LABELS[t]}</span>
                <span className="text-xs text-slate-500">{ITEM_HINTS[t]}</span>
              </button>
            </li>
          );
        })}
        {list.length === 0 && <li className="px-2 py-3 text-xs text-slate-500">No type matches “{q}”.</li>}
      </ul>
    </Modal>
  );
}

function SettingsTab({
  draft,
  setField,
  categories,
  tpl,
}: {
  draft: Draft;
  setField: <K extends keyof Draft>(k: K, v: Draft[K], key?: string) => void;
  categories: string[];
  tpl: any;
}) {
  const versionsQ = useQuery({
    queryKey: ["templates", tpl?.id, "versions"],
    enabled: !!tpl?.id,
    queryFn: async () => ok(await api.templates[":id"].versions.$get({ param: { id: tpl.id } })),
  });
  const versions = ((versionsQ.data as any)?.versions ?? []) as { id: string; version: number; createdBy: string; createdAt: string }[];
  const field = "w-full rounded-lg border border-white/10 bg-ink-3/60 px-3 py-2 text-sm text-white focus:border-brand focus:outline-none";
  return (
    <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
      <div className="nvc-card space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
          <div>
            <label htmlFor="tpl-cat" className="mb-1 block text-xs font-medium text-slate-400">
              Category
            </label>
            <div className="flex gap-1.5">
              <select id="tpl-cat" value={draft.category} onChange={(e) => setField("category", e.target.value)} className={field}>
                {!categories.includes(draft.category) && <option value={draft.category}>{draft.category}</option>}
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <CategoryManagerButton label="" />
            </div>
          </div>
          <div>
            <label htmlFor="tpl-mins" className="mb-1 block text-xs font-medium text-slate-400">
              Usual time on site
            </label>
            <div className="relative">
              <input id="tpl-mins" aria-label="Usual time on site, in minutes" type="number" min={0} value={draft.estimatedMins} onChange={(e) => setField("estimatedMins", Math.max(0, +e.target.value || 0), "mins")} className={`${field} pr-12`} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">min</span>
            </div>
          </div>
        </div>
        <div>
          <label htmlFor="tpl-desc" className="mb-1 block text-xs font-medium text-slate-400">
            Description
          </label>
          <textarea id="tpl-desc" aria-label="Description" rows={3} value={draft.description} onChange={(e) => setField("description", e.target.value, "desc")} placeholder="When to use this template, in a sentence." className={field} />
        </div>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-slate-400">Colour on the schedule</legend>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                aria-pressed={draft.color === c}
                onClick={() => setField("color", c)}
                className={`grid h-8 w-8 place-items-center rounded-full ring-offset-2 ring-offset-ink-2 ${draft.color === c ? "ring-2 ring-white" : ""}`}
                style={{ background: c }}
              >
                {draft.color === c && <Check className="h-4 w-4 text-white" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </fieldset>
        <label htmlFor="tpl-copy" className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 p-3">
          <input id="tpl-copy" aria-label="Email the customer a copy when the job is done" type="checkbox" checked={draft.sendCustomerCopy} onChange={(e) => setField("sendCustomerCopy", e.target.checked)} className="mt-1 accent-brand" />
          <span>
            <span className="block text-sm text-slate-200">Email the customer a copy when the job is done</span>
            <span className="block text-xs text-slate-500">Their copy leaves out questions marked Office only.</span>
          </span>
        </label>
      </div>
      <div className="nvc-card h-fit p-4">
        <p className="mb-2 text-sm font-semibold text-white">Versions</p>
        <p className="mb-3 text-xs text-slate-400">Each save with new questions, prices or pay makes a version. Jobs keep the version they were booked with.</p>
        {versions.length === 0 ? (
          <p className="text-xs text-slate-500">Saved versions appear here.</p>
        ) : (
          <ol className="space-y-2">
            {versions.map((v, i) => (
              <li key={v.id} className="flex items-baseline justify-between gap-2 text-xs">
                <span className={i === 0 ? "font-semibold text-white" : "text-slate-300"}>
                  Version {v.version}
                  {i === 0 && <span className="ml-1.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">current</span>}
                </span>
                <span className="text-right text-slate-500">
                  {new Date(v.createdAt).toLocaleDateString()}
                  {v.createdBy ? ` · ${v.createdBy}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
