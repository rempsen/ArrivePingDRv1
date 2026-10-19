/**
 * The "Add" palette: question types grouped, searchable, always in view.
 * Click adds below the selected question; drag drops it exactly where the
 * line shows on the canvas.
 */
import { useDraggable } from "@dnd-kit/core";
import { Search } from "lucide-react";
import { useState } from "react";
import { ITEM_LABELS, type ItemType } from "../../../../shared/forms/form-model";
import { ITEM_HINTS, ITEM_ICONS, PALETTE_GROUPS } from "../../../components/forms/item-meta";
import { PALETTE_PREFIX } from "./canvas";

export function Palette({ onAdd, searchRef }: { onAdd: (t: ItemType) => void; searchRef?: React.Ref<HTMLInputElement> }) {
  const [q, setQ] = useState("");
  const match = (t: ItemType) => !q || `${ITEM_LABELS[t]} ${ITEM_HINTS[t]}`.toLowerCase().includes(q.toLowerCase());
  const groups = PALETTE_GROUPS.map((g) => ({ ...g, types: g.types.filter(match) })).filter((g) => g.types.length);
  return (
    <aside aria-label="Add a question" data-tour="palette" className="nvc-card flex max-h-[calc(100vh-14rem)] flex-col p-2.5">
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
        <input
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && groups[0]?.types[0]) {
              e.preventDefault();
              onAdd(groups[0].types[0]);
              setQ("");
            }
            if (e.key === "Escape") setQ("");
          }}
          placeholder="Find a type…"
          aria-label="Find a question type"
          className="h-9 w-full rounded-lg border border-white/10 bg-ink-3/60 pl-8 pr-2 text-sm text-white placeholder:text-slate-500 focus:border-brand focus:outline-none"
        />
      </div>
      <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1 pb-1">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="mb-1 px-1 text-[11px] font-semibold text-slate-500">{g.label}</p>
            <div className="space-y-1">
              {g.types.map((t) => (
                <PaletteItem key={t} type={t} onAdd={() => onAdd(t)} />
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && <p className="px-1 py-4 text-xs text-slate-500">No type matches “{q}”.</p>}
      </div>
    </aside>
  );
}

function PaletteItem({ type, onAdd }: { type: ItemType; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `${PALETTE_PREFIX}${type}` });
  const Icon = ITEM_ICONS[type];
  // Pointer drags only: from the keyboard, Enter/Space simply adds the type
  // (the canvas has its own keyboard reordering).
  const { onKeyDown: _keyboardDrag, ...pointer } = (listeners ?? {}) as Record<string, unknown>;
  const { role: _role, tabIndex: _tab, ...aria } = attributes;
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...(pointer as object)}
      {...aria}
      onClick={onAdd}
      title={ITEM_HINTS[type]}
      aria-label={`Add ${ITEM_LABELS[type]}: ${ITEM_HINTS[type]}`}
      className={`flex w-full cursor-grab items-center gap-2.5 rounded-lg border border-transparent px-2 py-1 text-left text-sm text-slate-300 transition hover:border-white/10 hover:bg-white/5 hover:text-white active:cursor-grabbing ${isDragging ? "opacity-40" : ""}`}
    >
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-cyan-400/10">
        <Icon className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate">{ITEM_LABELS[type]}</span>
        <span className="block truncate text-[11px] text-slate-500">{ITEM_HINTS[type]}</span>
      </span>
    </button>
  );
}
