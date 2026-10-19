/**
 * The form canvas: the questions as a drag-to-reorder list. Field types can
 * be dragged in from the palette and dropped exactly where the line shows.
 * Sections carry their questions with them.
 */
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, Flag, GitBranch, GripVertical, Lock, Plus, Trash2 } from "lucide-react";
import { ITEM_LABELS, type FormItem, type ItemType } from "../../../../shared/forms/form-model";
import { ITEM_ICONS } from "../../../components/forms/item-meta";
import { blockRange, sectionIndex } from "./form-ops";

export const PALETTE_PREFIX = "palette:";

export interface CanvasProps {
  items: FormItem[];
  selectedId: string | null;
  problems: Set<string>;
  onSelect: (id: string | null) => void;
  onMove: (fromId: string, toId: string) => void;
  onInsert: (type: ItemType, index: number) => void;
  onLabel: (id: string, label: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onQuickAdd: () => void;
  /** Rendered next to the canvas inside the same drag context (the palette). */
  palette: React.ReactNode;
  children?: React.ReactNode;
}

const announcements = {
  onDragStart: ({ active }: { active: { id: string | number } }) =>
    String(active.id).startsWith(PALETTE_PREFIX) ? "Picked up a new question type." : "Picked up a question. Use the arrow keys to move it, space to drop.",
  onDragOver: () => "",
  onDragEnd: ({ over }: { over: { id: string | number } | null }) => (over ? "Dropped." : "Cancelled."),
  onDragCancel: () => "Cancelled.",
};

export function Canvas(p: CanvasProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const ids = useMemo(() => p.items.map((i) => i.id), [p.items]);
  const inSection = useMemo(() => sectionIndex(p.items), [p.items]);

  const activeItem = activeId ? p.items.find((i) => i.id === activeId) : null;
  const activePalette = activeId?.startsWith(PALETTE_PREFIX) ? (activeId.slice(PALETTE_PREFIX.length) as ItemType) : null;
  // While a section is dragged, its questions travel with it.
  const carried = useMemo(() => {
    if (!activeItem || activeItem.type !== "section") return new Set<string>();
    const i = p.items.findIndex((x) => x.id === activeItem.id);
    const [s, e] = blockRange(p.items, i);
    return new Set(p.items.slice(s + 1, e).map((x) => x.id));
  }, [activeItem, p.items]);

  function onStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }
  function onOver(e: DragOverEvent) {
    setOverId(e.over ? String(e.over.id) : null);
  }
  function onEnd(e: DragEndEvent) {
    const a = String(e.active.id);
    const o = e.over ? String(e.over.id) : null;
    setActiveId(null);
    setOverId(null);
    if (!o) return;
    if (a.startsWith(PALETTE_PREFIX)) {
      const type = a.slice(PALETTE_PREFIX.length) as ItemType;
      const idx = o === "canvas-end" ? p.items.length : Math.max(0, p.items.findIndex((x) => x.id === o));
      p.onInsert(type, idx);
      return;
    }
    if (o !== "canvas-end" && o !== a) p.onMove(a, o);
    else if (o === "canvas-end" && p.items.length) p.onMove(a, p.items[p.items.length - 1]!.id);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onStart}
      onDragOver={onOver}
      onDragEnd={onEnd}
      onDragCancel={() => {
        setActiveId(null);
        setOverId(null);
      }}
      accessibility={{ announcements, screenReaderInstructions: { draggable: "To pick up a question, press space. Use the arrow keys to move it and space again to drop. Press escape to cancel." } }}
    >
      {p.palette}
      {/* the side panels are sized to fit above the page padding, so they stay in view down to the last question */}
      <div className="min-w-0 pb-16">
        {p.children}
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="space-y-1.5" aria-label="Form questions" data-tour="canvas">
            {p.items.map((it, idx) => (
              <SortableRow
                key={it.id}
                item={it}
                index={idx}
                nested={!!inSection[idx]}
                selected={p.selectedId === it.id}
                problem={p.problems.has(it.id)}
                dimmed={carried.has(it.id)}
                dropLine={!!activePalette && overId === it.id}
                logicLabel={it.showIf ? p.items.find((x) => x.id === it.showIf!.itemId)?.label : undefined}
                onSelect={() => p.onSelect(it.id)}
                onLabel={(l) => p.onLabel(it.id, l)}
                onDuplicate={() => p.onDuplicate(it.id)}
                onRemove={() => p.onRemove(it.id)}
              />
            ))}
          </ol>
        </SortableContext>
        <EndZone empty={p.items.length === 0} highlight={!!activeId && overId === "canvas-end"} onQuickAdd={p.onQuickAdd} />
      </div>
      {createPortal(
      <DragOverlay dropAnimation={null}>
        {activePalette ? (
          <div className="flex items-center gap-2 rounded-xl border border-brand/60 bg-ink-3 px-3 py-2.5 text-sm text-white shadow-2xl shadow-black/50">
            {(() => {
              const I = ITEM_ICONS[activePalette];
              return <I className="h-4 w-4 text-cyan-300" aria-hidden="true" />;
            })()}
            {ITEM_LABELS[activePalette]}
          </div>
        ) : activeItem ? (
          <div className="rounded-xl border border-brand/60 bg-ink-3 px-3 py-2.5 text-sm text-white shadow-2xl shadow-black/50">
            {activeItem.label}
            {activeItem.type === "section" && carried.size > 0 && <span className="ml-2 text-xs text-slate-400">+ {carried.size} questions</span>}
          </div>
        ) : null}
      </DragOverlay>,
      document.body,
      )}
    </DndContext>
  );
}

function EndZone({ empty, highlight, onQuickAdd }: { empty: boolean; highlight: boolean; onQuickAdd: () => void }) {
  const { setNodeRef } = useDroppable({ id: "canvas-end" });
  return (
    <div
      ref={setNodeRef}
      className={`mt-2 rounded-xl border-2 border-dashed transition ${highlight ? "border-brand/70 bg-brand/5" : "border-white/10"} ${empty ? "py-14" : "py-3"}`}
    >
      <button type="button" onClick={onQuickAdd} className="mx-auto flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-white/5 hover:text-white">
        <Plus className="h-4 w-4" aria-hidden="true" />
        {empty ? "Drag a question type here, or click to add one" : "Add a question"}
        <kbd className="rounded border border-white/15 px-1.5 text-[11px] text-slate-500">/</kbd>
      </button>
    </div>
  );
}

function SortableRow(p: {
  item: FormItem;
  index: number;
  nested: boolean;
  selected: boolean;
  problem: boolean;
  dimmed: boolean;
  dropLine: boolean;
  logicLabel?: string;
  onSelect: () => void;
  onLabel: (l: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: p.item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const it = p.item;
  const Icon = ITEM_ICONS[it.type];
  const isSection = it.type === "section";
  const opts = it.options ?? [];

  return (
    <li ref={setNodeRef} style={style} className={`relative ${p.nested ? "ml-4 md:ml-6" : ""} ${isDragging || p.dimmed ? "opacity-40" : ""}`}>
      {p.dropLine && <div className="absolute -top-1 left-0 right-0 h-0.5 rounded bg-cyan-400 shadow-[0_0_8px] shadow-cyan-400" aria-hidden="true" />}
      <div
        onClick={p.onSelect}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            p.onSelect();
          }
        }}
        // A row is a selectable surface holding its own inputs and buttons.
        // eslint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="button"
        tabIndex={0}
        aria-pressed={p.selected}
        aria-label={`${ITEM_LABELS[it.type]}: ${it.label}`}
        data-item-id={it.id}
        className={`group flex items-start gap-2 rounded-xl border px-2 py-2 outline-none transition focus-visible:ring-2 focus-visible:ring-brand/50 ${
          isSection ? "border-white/10 bg-white/[0.04]" : "border-white/10 bg-ink-3/60"
        } ${p.selected ? "border-brand/70 ring-1 ring-brand/40" : "hover:border-white/25"} ${p.problem ? "border-amber-400/60" : ""}`}
      >
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag to move ${it.label}`}
          className="mt-0.5 grid h-7 w-6 shrink-0 cursor-grab touch-none place-items-center rounded text-slate-500 hover:bg-white/5 hover:text-slate-200 active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
        <Icon className={`mt-1.5 h-4 w-4 shrink-0 ${isSection ? "text-slate-300" : "text-cyan-300"}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <input
              aria-label="Question"
              value={it.label}
              onChange={(e) => p.onLabel(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onFocus={p.onSelect}
              className={`min-w-0 flex-1 rounded bg-transparent px-1 py-1 text-white outline-none focus:bg-white/5 ${isSection ? "text-[15px] font-semibold" : "text-sm"}`}
            />
            {it.required && <span className="text-red-400" aria-label="required">*</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11px] text-slate-500">
            <span>{ITEM_LABELS[it.type]}</span>
            {opts.length > 0 && (
              <span className="truncate">
                {opts.slice(0, 4).join(" · ")}
                {opts.length > 4 ? ` +${opts.length - 4}` : ""}
              </span>
            )}
            {it.type === "photo" && it.minPhotos ? <span>min {it.minPhotos}</span> : null}
            {it.type === "number" && it.unit ? <span>{it.unit}</span> : null}
            {p.logicLabel && (
              <span className="inline-flex items-center gap-1 text-violet-300">
                <GitBranch className="h-3 w-3" aria-hidden="true" /> if “{p.logicLabel}” {it.showIf?.op === "is" ? `is ${it.showIf.value}` : it.showIf?.op === "is_not" ? `isn't ${it.showIf.value}` : it.showIf?.op === "flagged" ? "is flagged" : "is answered"}
              </span>
            )}
            {it.flagOn?.length ? (
              <span className="inline-flex items-center gap-1 text-amber-300">
                <Flag className="h-3 w-3" aria-hidden="true" /> flags {it.flagOn.join(", ")}
              </span>
            ) : null}
            {it.internal && (
              <span className="inline-flex items-center gap-1">
                <Lock className="h-3 w-3" aria-hidden="true" /> office only
              </span>
            )}
          </div>
        </div>
        <div className={`flex shrink-0 items-center gap-0.5 ${p.selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}>
          <button
            type="button"
            title="Duplicate (Ctrl+D)"
            aria-label={`Duplicate ${it.label}`}
            onClick={(e) => {
              e.stopPropagation();
              p.onDuplicate();
            }}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white"
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            title="Delete (Del)"
            aria-label={`Delete ${it.label}`}
            onClick={(e) => {
              e.stopPropagation();
              p.onRemove();
            }}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </li>
  );
}
