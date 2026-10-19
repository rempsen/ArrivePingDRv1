/**
 * The editing canvas: the real email, rendered in the page from the same
 * HTML the inbox gets, block by block. Click any block (or a block inside two
 * columns) to edit it; drag the handle to reorder; drop palette blocks where
 * the line shows. Links inside the email don't navigate while editing.
 *
 * A container query stands in for the email's phone media query, so the
 * Phone view stacks columns exactly as an iPhone would.
 */
import { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { BLOCK_LABELS, type Block, type EmailDesign } from "../../../shared/email/design";
import { googleFontHref, makeCtx, renderAboveCard, renderBelowCard, renderBlock, renderCardFooter, renderHeader, shellStyle, type EmailBrand } from "../../../shared/email/render";

export interface CanvasProps {
  design: EmailDesign;
  brand: EmailBrand;
  vars: object;
  device: "desktop" | "phone";
  selectedId: string | null;
  /** id of the block being dragged over, and which side the dragged block will land. */
  dropBefore: string | null;
  dropSide: "before" | "after";
  dropAtEnd: boolean;
  onSelect: (id: string | null) => void;
  onNudge: (id: string, dir: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onHeaderClick: () => void;
  onQuickAdd: () => void;
}

const CANVAS_CSS = `
.email-canvas{container-type:inline-size}
.email-canvas a{cursor:default}
@container (max-width:480px){
.email-canvas .ap-col{max-width:100%!important}
.email-canvas .ap-colin{padding:0!important}
.email-canvas .ap-h1{font-size:24px!important}
.email-canvas .ap-eta{font-size:34px!important}
.email-canvas .ap-pad{padding-left:24px!important;padding-right:24px!important}
}`;

export function EmailCanvas(p: CanvasProps) {
  const ctx = useMemo(() => makeCtx(p.brand, p.vars, { editor: true }), [p.brand, p.vars]);
  const s = shellStyle(ctx);
  const ids = useMemo(() => p.design.blocks.map((b) => b.id), [p.design.blocks]);
  const phone = p.device === "phone";
  const padX = phone ? 24 : ctx.padX;
  const topSelected = p.selectedId && ids.includes(p.selectedId);
  const nestedCss = p.selectedId && !topSelected ? `.email-canvas [data-bid="${CSS_escape(p.selectedId)}"]{outline:2px solid #06b6d4;outline-offset:3px;border-radius:4px}` : "";
  const fontHref = googleFontHref(s.googleFont);

  return (
    <div className="min-h-full" style={{ background: s.pageBg }}>
      <style>{CANVAS_CSS + nestedCss}</style>
      {fontHref && <link rel="stylesheet" href={fontHref} />}
      <div
        className="email-canvas mx-auto transition-[max-width] duration-200"
        // Links in the email (footer, social links, text) never navigate while editing.
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest("a")) e.preventDefault();
        }}
        style={{ maxWidth: phone ? 375 : 600, padding: s.flat ? "24px 0 40px" : phone ? "20px 8px 40px" : "32px 12px 48px", fontFamily: s.font }}>
        <div dangerouslySetInnerHTML={{ __html: renderAboveCard(ctx) }} />
        <div style={{ background: s.cardBg, border: s.cardBorder, borderRadius: s.cardRadius, overflow: "hidden", boxShadow: s.flat ? "none" : "0 1px 2px rgba(15,23,42,.04)" }}>
          {ctx.header !== "none" && (
            <div
              // The header is the email's own HTML (tables), so it can't sit inside a <button>.
              // eslint-disable-next-line jsx-a11y/prefer-tag-over-role
              role="button"
              tabIndex={0}
              onClick={p.onHeaderClick}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  p.onHeaderClick();
                }
              }}
              title="The header comes from your company theme"
              aria-label="Edit the header in Theme"
              className="cursor-pointer outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-cyan-400"
              dangerouslySetInnerHTML={{ __html: renderHeader(ctx) }}
            />
          )}
          <div style={{ padding: `${phone ? 28 : 36}px ${padX}px 16px` }}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {p.design.blocks.map((b, i) => (
                <SortableBlock
                  key={b.id}
                  block={b}
                  html={renderBlock(ctx, b, phone ? 375 - 16 - padX * 2 : undefined)}
                  first={i === 0}
                  last={i === p.design.blocks.length - 1}
                  selected={p.selectedId === b.id}
                  dropLine={p.dropBefore === b.id ? p.dropSide : null}
                  onSelect={p.onSelect}
                  onNudge={(d) => p.onNudge(b.id, d)}
                  onDuplicate={() => p.onDuplicate(b.id)}
                  onRemove={() => p.onRemove(b.id)}
                />
              ))}
            </SortableContext>
            <EndZone empty={!p.design.blocks.length} highlight={p.dropAtEnd} onQuickAdd={p.onQuickAdd} />
          </div>
          <div dangerouslySetInnerHTML={{ __html: renderCardFooter(ctx) }} />
        </div>
        <div dangerouslySetInnerHTML={{ __html: renderBelowCard(ctx) }} />
      </div>
    </div>
  );
}

function CSS_escape(s: string) {
  return s.replace(/["\\]/g, "");
}

function EndZone({ empty, highlight, onQuickAdd }: { empty: boolean; highlight: boolean; onQuickAdd: () => void }) {
  const { setNodeRef } = useDroppable({ id: "canvas-end" });
  return (
    <div ref={setNodeRef} className={`mb-2 rounded-lg border-2 border-dashed transition ${highlight ? "border-cyan-500 bg-cyan-50" : "border-slate-200"} ${empty ? "py-12" : "py-2"}`}>
      <button type="button" onClick={onQuickAdd} className="mx-auto flex items-center gap-1.5 rounded-md px-3 py-1 text-[13px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800">
        <Plus className="h-4 w-4" aria-hidden="true" /> {empty ? "Drag a block here, or click to add text" : "Add a block"}
      </button>
    </div>
  );
}

function SortableBlock(p: {
  block: Block;
  html: string;
  first: boolean;
  last: boolean;
  selected: boolean;
  dropLine: "before" | "after" | null;
  onSelect: (id: string) => void;
  onNudge: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: p.block.id });
  const label = BLOCK_LABELS[p.block.type];
  const pick = (target: EventTarget | null) => {
    const el = (target as HTMLElement | null)?.closest?.("[data-bid]") as HTMLElement | null;
    p.onSelect(el?.dataset.bid || p.block.id);
  };
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`group relative ${isDragging ? "z-10 opacity-50" : ""}`}>
      {p.dropLine && <div className={`absolute left-0 right-0 z-10 h-[3px] rounded bg-cyan-500 shadow-[0_0_8px] shadow-cyan-400 ${p.dropLine === "after" ? "-bottom-1" : "-top-1"}`} aria-hidden="true" />}
      <div
        // A block is a selectable surface whose content is the email's own HTML.
        // eslint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="button"
        tabIndex={0}
        aria-pressed={p.selected}
        aria-label={`${label} block. Press Enter to edit.`}
        onClickCapture={(e) => {
          // Links in the email never navigate while editing.
          if ((e.target as HTMLElement).closest("a")) e.preventDefault();
        }}
        onClick={(e) => pick(e.target)}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            p.onSelect(p.block.id);
          }
        }}
        className={`relative cursor-pointer rounded-md outline-none transition-[outline-color] ${
          p.selected ? "outline outline-2 outline-offset-4 outline-cyan-500" : "outline-1 outline-offset-4 hover:outline hover:outline-cyan-400/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-500"
        }`}
      >
        <div dangerouslySetInnerHTML={{ __html: p.html }} />
      </div>
      <div
        className={`absolute -right-3 -top-4 z-20 items-center gap-0.5 rounded-lg bg-slate-900 p-0.5 text-white shadow-lg ${p.selected ? "flex" : "hidden group-hover:flex group-focus-within:flex"}`}
      >
        <span className="whitespace-nowrap px-1.5 text-[11px] font-semibold text-slate-300">{label}</span>
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag to move the ${label} block`}
          title="Drag to move"
          className="grid h-7 w-7 cursor-grab touch-none place-items-center rounded-md hover:bg-white/10 active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <ToolBtn label="Move up" disabled={p.first} onClick={() => p.onNudge(-1)} icon={ArrowUp} />
        <ToolBtn label="Move down" disabled={p.last} onClick={() => p.onNudge(1)} icon={ArrowDown} />
        <ToolBtn label="Duplicate (Ctrl+D)" onClick={p.onDuplicate} icon={Copy} />
        <ToolBtn label="Delete (Del)" onClick={p.onRemove} icon={Trash2} danger />
      </div>
    </div>
  );
}

function ToolBtn({ label, onClick, icon: Icon, disabled, danger }: { label: string; onClick: () => void; icon: typeof Copy; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`grid h-7 w-7 place-items-center rounded-md disabled:opacity-30 ${danger ? "hover:bg-red-500/80" : "hover:bg-white/10"}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}
