/**
 * The block palette: always in view. Click adds after the selected block;
 * drag drops it exactly where the line shows on the email.
 */
import { useDraggable } from "@dnd-kit/core";
import { BLOCK_HINTS, BLOCK_LABELS, type BlockType } from "../../../shared/email/design";
import { BLOCK_ICONS, PALETTE_GROUPS, PALETTE_PREFIX } from "./block-meta";

export function Palette({ onAdd, compact }: { onAdd: (t: BlockType) => void; compact?: boolean }) {
  if (compact) {
    // Phones and narrow tablets: one scrolling row.
    return (
      <fieldset className="flex gap-1.5 overflow-x-auto border-b border-white/10 bg-ink-2 px-3 py-2">
        <legend className="sr-only">Add a block</legend>
        {PALETTE_GROUPS.flatMap((g) => g.types).map((t) => {
          const Icon = BLOCK_ICONS[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => onAdd(t)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-ink px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:border-brand/40 hover:text-white"
            >
              <Icon className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" /> {BLOCK_LABELS[t]}
            </button>
          );
        })}
      </fieldset>
    );
  }
  return (
    <aside aria-label="Add a block" className="flex h-full flex-col overflow-y-auto border-r border-white/10 bg-ink-2 p-3">
      <p className="px-1 pb-2 text-[11px] leading-snug text-slate-500">Click to add below the selected block, or drag onto the email.</p>
      {PALETTE_GROUPS.map((g) => (
        <div key={g.label} className="mb-3">
          <div className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{g.label}</div>
          <div className="space-y-1">
            {g.types.map((t) => (
              <PaletteItem key={t} type={t} onAdd={() => onAdd(t)} />
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}

function PaletteItem({ type, onAdd }: { type: BlockType; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `${PALETTE_PREFIX}${type}` });
  const Icon = BLOCK_ICONS[type];
  // Pointer drags only; from the keyboard Enter/Space adds the block.
  const { onKeyDown: _k, ...pointer } = (listeners ?? {}) as Record<string, unknown>;
  const { role: _r, tabIndex: _t, ...aria } = attributes;
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...(pointer as object)}
      {...aria}
      onClick={onAdd}
      title={BLOCK_HINTS[type]}
      aria-label={`Add ${BLOCK_LABELS[type]}: ${BLOCK_HINTS[type]}`}
      className={`flex w-full cursor-grab touch-none items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left text-sm text-slate-300 transition hover:border-white/10 hover:bg-white/5 hover:text-white active:cursor-grabbing ${isDragging ? "opacity-40" : ""}`}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-cyan-400/10">
        <Icon className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{BLOCK_LABELS[type]}</span>
        <span className="block truncate text-[11px] text-slate-500">{BLOCK_HINTS[type]}</span>
      </span>
    </button>
  );
}
