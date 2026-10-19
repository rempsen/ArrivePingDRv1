/**
 * Email designer: build a notification email on the real email, in place.
 *
 *  left   - block palette (click to add, or drag onto the email)
 *  centre - the email itself; click a block to edit, drag to reorder;
 *           Desktop / Phone, and an exact Preview of what inboxes receive
 *  right  - Block (selected block) | Email (subject, preview text, templates,
 *           Describe it, test) | Theme (the company-wide look)
 *
 * Undo/redo covers every edit. Save & apply saves the email and, when it
 * changed, the company theme. An unsaved draft survives a closed tab.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Eye, Monitor, PencilRuler, Redo2, Smartphone, Sparkles, Undo2, X, SlidersHorizontal } from "lucide-react";
import { BLOCK_LABELS, makeBlock, normalizeDesign, type Block, type BlockType, type EmailDesign } from "../../../shared/email/design";
import { renderEmail } from "../../../shared/email/render";
import { STARTERS, starterDesignFor } from "../../../shared/email/starters";
import { useHistory } from "../../pages/admin/builder/use-history";
import { BLOCK_ICONS, PALETTE_PREFIX } from "./block-meta";
import { EmailCanvas } from "./canvas";
import { EmailPanel } from "./email-panel";
import { BlockInspector } from "./inspector";
import { addToColumn, duplicateBlock, findBlock, insertAfter, insertAt, moveBlock, nudgeBlock, removeBlock, updateBlock } from "./ops";
import { Palette } from "./palette";
import { ThemePanel } from "./theme-panel";
import { useEmailBrand } from "./use-email-brand";

export interface EmailDesignerProps {
  /** "theme": edit only the company look, previewed on a sample email. */
  mode?: "email" | "theme";
  contextLabel?: string;
  event?: string;
  recipient?: string;
  eventLabel?: string;
  initialDesign?: EmailDesign | null;
  initialSubject?: string;
  /** Where an unsaved draft is kept in this browser. */
  draftKey?: string;
  /** true = saved; false or a message = not saved (the designer stays open). */
  onSave?: (subject: string, design: EmailDesign) => Promise<boolean | string> | boolean | string | void;
  onClose: () => void;
  onEditFooter?: () => void;
}

type Tab = "block" | "email" | "theme";
type Doc = { subject: string; design: EmailDesign };

function useNarrow() {
  const q = "(max-width: 1023px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

const readDraft = (key?: string): (Doc & { at: number }) | null => {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return { subject: String(d.subject ?? ""), design: normalizeDesign(d.design), at: Number(d.at) || 0 };
  } catch {
    return null;
  }
};
const clearDraft = (key?: string) => {
  try {
    if (key) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
};

export function EmailDesigner(p: EmailDesignerProps) {
  const themeOnly = p.mode === "theme";
  const initial = useMemo<Doc>(() => {
    if (p.initialDesign && p.initialDesign.blocks.length) return { subject: p.initialSubject || "", design: p.initialDesign };
    if (themeOnly) {
      const s = STARTERS.find((x) => x.key === "on-the-way")!;
      return { subject: s.subject, design: s.design };
    }
    const s = starterDesignFor(p.event || "", p.recipient || "client", p.eventLabel);
    return { subject: p.initialSubject || s.subject, design: s.design };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const h = useHistory<Doc>(initial);
  const doc = h.value;
  const design = doc.design;
  const brand = useEmailBrand();
  const narrow = useNarrow();
  const rootRef = useRef<HTMLElement>(null);

  const [selected, setSelected] = useState<string | null>(themeOnly ? null : design.blocks[0]?.id ?? null);
  const [tab, setTab] = useState<Tab>(themeOnly ? "theme" : "block");
  const [view, setView] = useState<"edit" | "preview">(themeOnly ? "preview" : "edit");
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [sheet, setSheet] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [restore, setRestore] = useState<(Doc & { at: number }) | null>(() => {
    const d = readDraft(p.draftKey);
    return d && JSON.stringify({ s: d.subject, d: d.design }) !== JSON.stringify({ s: initial.subject, d: initial.design }) ? d : null;
  });

  const docDirty = JSON.stringify(doc) !== JSON.stringify(initial);
  const dirty = (!themeOnly && docDirty) || brand.dirty;

  // Keep an unsaved draft in this browser.
  useEffect(() => {
    if (!p.draftKey || themeOnly || restore) return;
    const t = setTimeout(() => {
      try {
        if (docDirty) localStorage.setItem(p.draftKey!, JSON.stringify({ ...doc, at: Date.now() }));
        else localStorage.removeItem(p.draftKey!);
      } catch {
        /* storage full or blocked: nothing to keep */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [doc, docDirty, p.draftKey, themeOnly, restore]);

  const setDesign = useCallback((fn: (d: EmailDesign) => EmailDesign, key?: string) => h.commit((cur) => ({ ...cur, design: fn(cur.design) }), key), [h]);
  const setBlocks = useCallback((fn: (b: Block[]) => Block[], key?: string) => setDesign((d) => ({ ...d, blocks: fn(d.blocks) }), key), [setDesign]);

  const select = (id: string | null) => {
    setSelected(id);
    if (id) {
      setTab("block");
      if (narrow) setSheet(true);
    }
  };
  const add = (type: BlockType) => {
    const b = makeBlock(type);
    setBlocks((bs) => insertAfter(bs, selected, b));
    select(b.id);
    if (view === "preview") setView("edit");
  };
  const remove = (id: string) => {
    const f = findBlock(design.blocks, id);
    setBlocks((bs) => removeBlock(bs, id));
    if (selected === id) setSelected(f?.parent?.id ?? null);
  };
  const duplicate = (id: string) => {
    const r = duplicateBlock(design.blocks, id);
    h.commit((cur) => ({ ...cur, design: { ...cur.design, blocks: r.blocks } }));
    if (r.id) setSelected(r.id);
  };

  // ---- drag and drop ----
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const activePalette = activeId?.startsWith(PALETTE_PREFIX) ? (activeId.slice(PALETTE_PREFIX.length) as BlockType) : null;
  const activeBlock = activeId && !activePalette ? design.blocks.find((b) => b.id === activeId) : null;
  const onDragEnd = (e: DragEndEvent) => {
    const a = String(e.active.id);
    const o = e.over ? String(e.over.id) : null;
    setActiveId(null);
    setOverId(null);
    if (!o) return;
    if (a.startsWith(PALETTE_PREFIX)) {
      const b = makeBlock(a.slice(PALETTE_PREFIX.length) as BlockType);
      const idx = o === "canvas-end" ? design.blocks.length : Math.max(0, design.blocks.findIndex((x) => x.id === o));
      setBlocks((bs) => insertAt(bs, idx, b));
      select(b.id);
      return;
    }
    if (o === "canvas-end" && design.blocks.length) setBlocks((bs) => moveBlock(bs, a, bs[bs.length - 1]!.id));
    else if (o !== a) setBlocks((bs) => moveBlock(bs, a, o));
  };

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A dialog of the designer's own (templates, save as template) is open: leave keys to it.
      if (confirmClose || rootRef.current?.querySelector("[role=dialog], [aria-modal=true]")) return;
      const el = e.target as HTMLElement;
      const typing = el.closest("input, textarea, select, [contenteditable=true]");
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) h.redo();
        else h.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        h.redo();
        return;
      }
      if (typing || themeOnly) return;
      if (mod && e.key.toLowerCase() === "d" && selected) {
        e.preventDefault();
        duplicate(selected);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected && !e.repeat && (el === document.body || el.closest(".email-canvas"))) {
        e.preventDefault();
        remove(selected);
      } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && selected) {
        e.preventDefault();
        setBlocks((bs) => nudgeBlock(bs, selected, e.key === "ArrowUp" ? -1 : 1));
      } else if (e.key === "Escape" && selected) {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const found = findBlock(design.blocks, selected);
  const brandOverride = () =>
    brand.draft ? { brandColor: brand.draft.brandColor, bgColor: brand.draft.bgColor, logoUrl: brand.draft.logoUrl, logoHeight: brand.draft.logoHeight, theme: brand.draft.theme } : {};

  async function save() {
    setSaveErr(null);
    setSaving(true);
    try {
      const ok = await brand.saveIfDirty();
      if (!ok) {
        setSaveErr("The theme didn't save. Check the colours and links, then try again.");
        return;
      }
      if (!themeOnly && p.onSave) {
        const r = await p.onSave(doc.subject, normalizeDesign(design));
        if (r === false || typeof r === "string") {
          setSaveErr(typeof r === "string" ? `The email didn't save: ${r}` : "The email didn't save. Try again.");
          return;
        }
      }
      clearDraft(p.draftKey);
      p.onClose();
    } finally {
      setSaving(false);
    }
  }
  const close = () => (dirty ? setConfirmClose(true) : p.onClose());

  const previewHtml = useMemo(() => (brand.brand && view === "preview" ? renderEmail(design, brand.brand, brand.vars) : ""), [brand.brand, brand.vars, design, view]);

  const panel = (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Designer panels" className="flex shrink-0 gap-1 border-b border-white/10 p-1.5">
        {(themeOnly ? (["theme"] as Tab[]) : (["block", "email", "theme"] as Tab[])).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold capitalize ${tab === t ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"}`}
          >
            {t === "block" ? "Block" : t === "email" ? "Email" : "Theme"}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "block" &&
          (found ? (
            <BlockInspector
              found={found}
              onChange={(id, patch) => setBlocks((bs) => updateBlock(bs, id, patch), `edit:${id}:${Object.keys(patch).join(",")}`)}
              onSelect={select}
              onAddToColumn={(cid, col, type) => {
                const nb = makeBlock(type);
                setBlocks((bs) => addToColumn(bs, cid, col, nb));
                select(nb.id);
              }}
              onNudge={(id, d) => setBlocks((bs) => nudgeBlock(bs, id, d))}
              onRemove={remove}
              onOpenTheme={() => setTab("theme")}
            />
          ) : (
            <div className="py-10 text-center text-sm text-slate-400">
              <PencilRuler className="mx-auto mb-2 h-6 w-6 text-slate-500" aria-hidden="true" />
              Click any part of the email to edit it,
              <br />
              or add a block from the left.
            </div>
          ))}
        {tab === "email" && brand.brand && (
          <EmailPanel
            subject={doc.subject}
            setSubject={(subject) => h.commit((cur) => ({ ...cur, subject }), "subject")}
            preheader={design.preheader}
            setPreheader={(preheader) => setDesign((d) => ({ ...d, preheader }), "preheader")}
            design={design}
            replaceDesign={(d, subject) => {
              h.commit((cur) => ({ subject: subject ?? cur.subject, design: d }));
              setSelected(d.blocks[0]?.id ?? null);
            }}
            event={p.event}
            recipient={p.recipient}
            brand={brand.brand}
            vars={brand.vars}
            brandOverride={brandOverride}
          />
        )}
        {tab === "theme" && brand.draft && <ThemePanel draft={brand.draft} setDraft={brand.setDraft} company={brand.company} footer={brand.footer} onEditFooter={p.onEditFooter} saveLabel={themeOnly ? "Save theme" : "Save & apply"} />}
      </div>
    </div>
  );

  return createPortal(
    <section ref={rootRef} className="fixed inset-0 z-[60] flex flex-col bg-ink text-white" aria-label="Email designer">
      {/* top bar */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 bg-ink-2 px-3 py-2 sm:px-4">
        <button type="button" onClick={close} aria-label="Close the designer" className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-sm font-bold">
            <Sparkles className="h-4 w-4 text-cyan-300" aria-hidden="true" /> {themeOnly ? "Email theme" : "Email designer"}
          </div>
          {p.contextLabel && <div className="truncate text-[11px] text-slate-400">{p.contextLabel}</div>}
        </div>
        {!themeOnly && (
          <div className="flex items-center gap-0.5">
            <IconBtn label="Undo (Ctrl+Z)" onClick={h.undo} disabled={!h.canUndo} icon={Undo2} />
            <IconBtn label="Redo (Ctrl+Shift+Z)" onClick={h.redo} disabled={!h.canRedo} icon={Redo2} />
          </div>
        )}
        {/* On phones these sit on their own row under the title */}
        <div className="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto">
        {!themeOnly && (
            <Seg
              label="Mode"
              value={view}
              onChange={setView}
              options={[
                { value: "edit", icon: PencilRuler, text: "Edit" },
                { value: "preview", icon: Eye, text: "Preview" },
              ]}
            />
          )}
          <Seg
            label="Screen size"
            value={device}
            onChange={setDevice}
            options={[
              { value: "desktop", icon: Monitor, text: "Desktop" },
              { value: "phone", icon: Smartphone, text: "Phone" },
            ]}
          />
          {narrow && (
            <button type="button" onClick={() => setSheet((s) => !s)} aria-expanded={sheet} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs font-semibold text-slate-200">
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Settings
            </button>
          )}
        </div>
        <span className="hidden text-[11px] text-slate-500 md:inline" aria-live="polite">
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <button type="button" onClick={save} disabled={saving || brand.loading || (!dirty && !themeOnly && !!p.initialDesign?.blocks.length)} className="h-9 rounded-lg bg-brand px-4 text-sm font-bold text-white hover:bg-brand-deep disabled:opacity-50">
          {saving || brand.saving ? "Saving…" : themeOnly ? "Save theme" : narrow ? "Save" : "Save & apply"}
        </button>
      </header>
      {saveErr && (
        <p role="alert" className="shrink-0 bg-amber-500/15 px-4 py-2 text-xs text-amber-200">
          {saveErr}
        </p>
      )}
      {restore && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 bg-cyan-500/10 px-4 py-2 text-xs text-cyan-100">
          You have unsaved changes to this email from {new Date(restore.at).toLocaleString()}.
          <button type="button" className="font-bold underline" onClick={() => (h.commit({ subject: restore.subject, design: restore.design }), setRestore(null))}>
            Restore them
          </button>
          <button type="button" className="text-cyan-200/70 underline" onClick={() => (clearDraft(p.draftKey), setRestore(null))}>
            Discard
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragOver={(e: DragOverEvent) => setOverId(e.over ? String(e.over.id) : null)}
        onDragEnd={onDragEnd}
        onDragCancel={() => (setActiveId(null), setOverId(null))}
        accessibility={{ screenReaderInstructions: { draggable: "To pick up a block, press space. Use the arrow keys to move it and space again to drop it. Press escape to cancel." } }}
      >
        {narrow && !themeOnly && view === "edit" && <Palette compact onAdd={add} />}
        <div className={`grid min-h-0 flex-1 ${narrow ? "grid-cols-1" : themeOnly ? "grid-cols-[minmax(0,1fr)_380px]" : "grid-cols-[232px_minmax(0,1fr)_360px] xl:grid-cols-[248px_minmax(0,1fr)_380px]"}`}>
          {!narrow && !themeOnly && <Palette onAdd={add} />}
          <main className="relative min-h-0 overflow-y-auto bg-[#0b1020]" aria-label="Email">
            <InboxLine company={brand.company} subject={doc.subject} preheader={design.preheader} vars={brand.vars} />
            {!brand.brand ? (
              <p className="p-10 text-center text-sm text-slate-400">{brand.error ? "Your email settings didn't load. Close this and try again." : "Loading your email look…"}</p>
            ) : view === "edit" ? (
              <EmailCanvas
                design={design}
                brand={brand.brand}
                vars={brand.vars}
                device={device}
                selectedId={selected}
                dropBefore={activeId ? overId : null}
                dropSide={
                  // Moving a block down lands it after the one it's over (palette drops go before).
                  activeBlock && overId && design.blocks.findIndex((b) => b.id === overId) > design.blocks.findIndex((b) => b.id === activeId) ? "after" : "before"
                }
                dropAtEnd={!!activeId && overId === "canvas-end"}
                onSelect={select}
                onNudge={(id, d) => setBlocks((bs) => nudgeBlock(bs, id, d))}
                onDuplicate={duplicate}
                onRemove={remove}
                onHeaderClick={() => (setTab("theme"), narrow && setSheet(true))}
                onQuickAdd={() => add("text")}
              />
            ) : (
              <PreviewFrame html={previewHtml} device={device} />
            )}
          </main>
          {!narrow && <aside className="min-h-0 border-l border-white/10 bg-ink-2" aria-label="Settings">{panel}</aside>}
        </div>
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {activePalette ? (
              <div className="flex items-center gap-2 rounded-xl border border-cyan-400/70 bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-2xl">
                {(() => {
                  const I = BLOCK_ICONS[activePalette];
                  return <I className="h-4 w-4 text-cyan-300" aria-hidden="true" />;
                })()}
                {BLOCK_LABELS[activePalette]}
              </div>
            ) : activeBlock ? (
              <div className="rounded-xl border border-cyan-400/70 bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-2xl">{BLOCK_LABELS[activeBlock.type]}</div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>

      {narrow && sheet && (
        <div className="fixed inset-x-0 bottom-0 z-[70] flex max-h-[62vh] flex-col rounded-t-2xl border-t border-white/15 bg-ink-2 shadow-[0_-12px_40px_rgba(0,0,0,.5)]">
          <div className="flex items-center justify-between px-3 pt-2">
            <span className="mx-auto h-1 w-10 rounded-full bg-white/20" aria-hidden="true" />
            <button type="button" onClick={() => setSheet(false)} aria-label="Close settings" className="absolute right-2 top-1.5 grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:text-white">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {panel}
        </div>
      )}

      {confirmClose && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" data-dialog-open>
          <div role="alertdialog" aria-modal="true" aria-labelledby="ed-close-t" className="w-full max-w-sm rounded-2xl border border-white/10 bg-ink-2 p-5 shadow-2xl">
            <h2 id="ed-close-t" className="text-base font-bold text-white">
              Leave without saving?
            </h2>
            <p className="mt-1 text-sm text-slate-400">Your changes to this email{brand.dirty ? " and the theme" : ""} haven't been saved.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmClose(false)} className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:text-white">
                Keep editing
              </button>
              <button
                type="button"
                onClick={() => {
                  clearDraft(p.draftKey);
                  brand.resetDraft();
                  p.onClose();
                }}
                className="rounded-lg bg-red-500/90 px-3 py-2 text-sm font-bold text-white hover:bg-red-500"
              >
                Discard changes
              </button>
            </div>
          </div>
        </div>
      )}
    </section>,
    document.body,
  );
}

function IconBtn({ label, onClick, disabled, icon: Icon }: { label: string; onClick: () => void; disabled?: boolean; icon: typeof Undo2 }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="grid h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-white/5 hover:text-white disabled:opacity-30">
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

function Seg<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; icon: typeof Eye; text: string }[] }) {
  return (
    <fieldset className="flex rounded-lg border border-white/10 bg-ink p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          title={o.text}
          onClick={() => onChange(o.value)}
          className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold ${value === o.value ? "bg-brand/25 text-cyan-200" : "text-slate-400 hover:text-white"}`}
        >
          <o.icon className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{o.text}</span>
        </button>
      ))}
    </fieldset>
  );
}

/** How the email shows in an inbox list: sender, subject and preview text. */
function InboxLine({ company, subject, preheader, vars }: { company: string; subject: string; preheader: string; vars: object }) {
  const fill = (s: string) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => String((vars as Record<string, unknown>)[k] ?? ""));
  return (
    <div className="mx-auto max-w-[640px] px-3 pt-4">
      <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cyan-500/20 text-xs font-bold text-cyan-200" aria-hidden="true">
          {company.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1 text-[13px] leading-snug">
          <div className="font-semibold text-white">{company}</div>
          <div className="truncate text-slate-200">{fill(subject) || <span className="text-slate-500">No subject yet</span>}</div>
          <div className="truncate text-slate-500">{fill(preheader) || "Preview text: the first words of the email"}</div>
        </div>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-500">Inbox</span>
      </div>
    </div>
  );
}

function PreviewFrame({ html, device }: { html: string; device: "desktop" | "phone" }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(900);
  const fit = () => {
    const d = ref.current?.contentDocument;
    if (d?.body) setHeight(Math.max(400, d.documentElement.scrollHeight));
  };
  return (
    <div className="px-3 py-4">
      <div className={`mx-auto overflow-hidden rounded-xl border border-white/10 bg-white shadow-2xl transition-[max-width] ${device === "phone" ? "max-w-[375px]" : "max-w-[680px]"}`}>
        <iframe ref={ref} title="Exact preview of the email" srcDoc={html} onLoad={() => (fit(), setTimeout(fit, 400))} style={{ height }} className="block w-full border-0" sandbox="allow-same-origin" />
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-500">This is the exact email inboxes receive, with sample job details.</p>
    </div>
  );
}
