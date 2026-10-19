/**
 * Settings for the selected block. Changes show on the canvas as you type.
 */
import { useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, ChevronLeft, Plus, Trash2 } from "lucide-react";
import { BLOCK_LABELS, COLUMN_CHILD_TYPES, type Align, type Block, type BlockType } from "../../../shared/email/design";
import { BLOCK_ICONS } from "./block-meta";
import { Field, RichText, Segmented, Toggle, TokenInput, UploadButton, inputBase } from "./fields";
import type { Found } from "./ops";

export interface InspectorProps {
  found: Found;
  onChange: (id: string, patch: Partial<Block>) => void;
  onSelect: (id: string | null) => void;
  onAddToColumn: (columnsId: string, col: 0 | 1, type: BlockType) => void;
  onNudge: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onOpenTheme: () => void;
}

const alignOpts = [
  { value: "left" as Align, label: <AlignLeft className="h-3.5 w-3.5" aria-label="Left" />, title: "Left" },
  { value: "center" as Align, label: <AlignCenter className="h-3.5 w-3.5" aria-label="Centre" />, title: "Centre" },
  { value: "right" as Align, label: <AlignRight className="h-3.5 w-3.5" aria-label="Right" />, title: "Right" },
];

const LINK_PRESETS = [
  { value: "{{trackUrl}}", label: "Tracking page" },
  { value: "{{propertyUrl}}", label: "Property history" },
  { value: "custom", label: "Other link" },
];

export function BlockInspector(p: InspectorProps) {
  const b = p.found.block;
  const set = (patch: Partial<Block>) => p.onChange(b.id, patch);
  const Icon = BLOCK_ICONS[b.type];
  const [err, setErr] = useState<string | null>(null);

  return (
    <div>
      {p.found.parent && (
        <button type="button" onClick={() => p.onSelect(p.found.parent!.id)} className="mb-3 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to the two columns
        </button>
      )}
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-400/10">
          <Icon className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-white">{BLOCK_LABELS[b.type]}</h3>
          {p.found.parent && <p className="text-[11px] text-slate-500">In the {p.found.col === 0 ? "left" : "right"} column</p>}
        </div>
        <button type="button" onClick={() => p.onRemove(b.id)} aria-label={`Delete this ${BLOCK_LABELS[b.type]} block`} title="Delete" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-400">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {b.type === "heading" && (
        <>
          <Field label="Text" htmlFor="ib-text">
            <TokenInput id="ib-text" label="Heading text" value={b.text} onChange={(text) => set({ text })} />
          </Field>
          <Field label="Size">
            <Segmented label="Heading size" value={b.level ?? 1} onChange={(level) => set({ level })} options={[{ value: 1, label: "Large" }, { value: 2, label: "Medium" }, { value: 3, label: "Small" }]} />
          </Field>
          <Field label="Align">
            <Segmented label="Align" value={b.align ?? "left"} onChange={(align) => set({ align })} options={alignOpts} />
          </Field>
        </>
      )}

      {b.type === "text" && (
        <>
          <Field label="Text" htmlFor="ib-body" hint="A blank line starts a new paragraph. Lines starting with “- ” become a list.">
            <RichText id="ib-body" label="Text" value={b.text} onChange={(text) => set({ text })} rows={6} />
          </Field>
          <Field label="Style">
            <Segmented label="Text style" value={b.tone ?? "normal"} onChange={(tone) => set({ tone: tone === "normal" ? undefined : tone })} options={[{ value: "normal", label: "Normal" }, { value: "muted", label: "Soft" }, { value: "small", label: "Small print" }]} />
          </Field>
          <Field label="Align">
            <Segmented label="Align" value={b.align ?? "left"} onChange={(align) => set({ align })} options={alignOpts} />
          </Field>
        </>
      )}

      {b.type === "button" && (
        <>
          <Field label="Label" htmlFor="ib-label">
            <TokenInput id="ib-label" label="Button label" value={b.label} onChange={(label) => set({ label })} />
          </Field>
          <Field label="Opens" hint={b.url === "{{trackUrl}}" ? "The customer's live tracking page for this job." : undefined}>
            <select
              aria-label="Where the button goes"
              className={inputBase}
              value={LINK_PRESETS.some((l) => l.value === b.url) ? b.url : "custom"}
              onChange={(e) => set({ url: e.target.value === "custom" ? "https://" : e.target.value })}
            >
              {LINK_PRESETS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
            {!LINK_PRESETS.slice(0, 2).some((l) => l.value === b.url) && (
              <input aria-label="Button link" className={`${inputBase} mt-1.5`} value={b.url} placeholder="https://…" onChange={(e) => set({ url: e.target.value })} />
            )}
          </Field>
          <Field label="Style">
            <Segmented label="Button style" value={b.variant ?? "solid"} onChange={(variant) => set({ variant })} options={[{ value: "solid", label: "Filled" }, { value: "outline", label: "Outline" }, { value: "link", label: "Text link" }]} />
          </Field>
          {b.variant !== "link" && <Toggle label="Full width" checked={!!b.full} onChange={(full) => set({ full: full || undefined })} />}
          {!b.full && (
            <Field label="Align">
              <Segmented label="Align" value={b.align ?? "left"} onChange={(align) => set({ align })} options={alignOpts} />
            </Field>
          )}
        </>
      )}

      {b.type === "image" && (
        <>
          <Field label="Picture" hint="PNG or JPG. Wide pictures look best at 1200 px across.">
            {b.url && <img src={b.url} alt="" className="mb-2 max-h-32 w-full rounded-lg border border-white/10 bg-white object-contain" />}
            <div className="flex items-center gap-2">
              <UploadButton label={b.url ? "Replace" : "Upload"} onUploaded={(url) => (setErr(null), set({ url }))} onError={setErr} />
              {b.url && (
                <button type="button" onClick={() => set({ url: "" })} className="text-xs text-slate-400 hover:text-red-400">
                  Remove
                </button>
              )}
            </div>
            <input aria-label="Image address" className={`${inputBase} mt-1.5 text-xs`} value={b.url} placeholder="…or paste an image address" onChange={(e) => set({ url: e.target.value })} />
            {err && <p className="mt-1 text-xs text-amber-300">{err}</p>}
          </Field>
          <Field label="Description" hint="Read aloud by screen readers, and shown when pictures are turned off.">
            <input aria-label="Image description" className={inputBase} value={b.alt || ""} onChange={(e) => set({ alt: e.target.value })} />
          </Field>
          <Field label={`Width: ${b.width ? `${b.width}px` : "full"}`}>
            <input aria-label="Image width" type="range" min={60} max={520} step={10} value={b.width || 520} onChange={(e) => set({ width: Number(e.target.value) >= 520 ? undefined : Number(e.target.value) })} className="w-full accent-cyan-400" />
          </Field>
          <Field label="Align">
            <Segmented label="Align" value={b.align ?? "center"} onChange={(align) => set({ align })} options={alignOpts} />
          </Field>
          <Field label="Link (optional)">
            <input aria-label="Image link" className={inputBase} value={b.href || ""} placeholder="https://…" onChange={(e) => set({ href: e.target.value || undefined })} />
          </Field>
        </>
      )}

      {b.type === "details" && <DetailsFields block={b} set={set} />}

      {b.type === "callout" && (
        <>
          <Field label="Text" htmlFor="ib-callout">
            <RichText id="ib-callout" label="Callout text" value={b.text} onChange={(text) => set({ text })} rows={3} />
          </Field>
          <Field label="Colour">
            <Segmented
              label="Callout colour"
              value={b.tone ?? "info"}
              onChange={(tone) => set({ tone })}
              options={[
                { value: "info", label: <Dot c="#2563eb" t="Info" /> },
                { value: "success", label: <Dot c="#16a34a" t="Good" /> },
                { value: "warning", label: <Dot c="#d97706" t="Heads-up" /> },
                { value: "brand", label: <Dot c="#06b6d4" t="Brand" /> },
              ]}
            />
          </Field>
        </>
      )}

      {b.type === "eta" && (
        <>
          <Field label="Small label" htmlFor="ib-eta-l">
            <TokenInput id="ib-eta-l" label="ETA label" value={b.label} onChange={(label) => set({ label })} />
          </Field>
          <Field label="Big value" htmlFor="ib-eta-v" hint="Usually {{eta}} min, {{newWhen}} or {{when}}.">
            <TokenInput id="ib-eta-v" label="ETA value" value={b.value} onChange={(value) => set({ value })} />
          </Field>
          <Field label="When there's no time yet, show" htmlFor="ib-eta-f">
            <TokenInput id="ib-eta-f" label="ETA fallback" value={b.fallback || ""} onChange={(fallback) => set({ fallback })} placeholder="On the way" />
          </Field>
          <Field label="Note under it" htmlFor="ib-eta-n">
            <TokenInput id="ib-eta-n" label="ETA note" value={b.note || ""} onChange={(note) => set({ note })} />
          </Field>
        </>
      )}

      {b.type === "tech" && (
        <>
          <Field label="Name" htmlFor="ib-tech-n">
            <TokenInput id="ib-tech-n" label="Name" value={b.name} onChange={(name) => set({ name })} />
          </Field>
          <Field label="Under the name" htmlFor="ib-tech-r">
            <TokenInput id="ib-tech-r" label="Role" value={b.role || ""} onChange={(role) => set({ role })} />
          </Field>
          <Field label="Note (optional)" htmlFor="ib-tech-note">
            <TokenInput id="ib-tech-note" label="Note" value={b.note || ""} onChange={(note) => set({ note })} placeholder="e.g. 8 years with us" />
          </Field>
          <Toggle label="Show their photo" checked={!!b.photo} onChange={(on) => set({ photo: on ? "{{techPhoto}}" : "" })} />
          <p className="mt-1 text-[11px] text-slate-500">Uses the headshot on their profile; initials when there isn't one.</p>
        </>
      )}

      {b.type === "columns" && <ColumnsFields block={b} set={set} {...p} />}

      {b.type === "social" && (
        <>
          <Field label="Align">
            <Segmented label="Align" value={b.align ?? "center"} onChange={(align) => set({ align })} options={alignOpts} />
          </Field>
          <p className="mb-2 text-xs text-slate-400">The links come from your company theme, so they stay the same in every email.</p>
          <button type="button" onClick={p.onOpenTheme} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-brand/50">
            Edit social links
          </button>
        </>
      )}

      {b.type === "spacer" && (
        <Field label="Height">
          <Segmented label="Spacer height" value={b.size ?? "md"} onChange={(size) => set({ size })} options={[{ value: "sm", label: "Small" }, { value: "md", label: "Medium" }, { value: "lg", label: "Large" }]} />
        </Field>
      )}

      {b.type === "divider" && <p className="text-xs text-slate-400">A thin line to separate sections. No settings.</p>}

      {p.found.parent && (
        <div className="mt-4 flex gap-2 border-t border-white/10 pt-3">
          <button type="button" onClick={() => p.onNudge(b.id, -1)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white">
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> Up
          </button>
          <button type="button" onClick={() => p.onNudge(b.id, 1)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white">
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /> Down
          </button>
        </div>
      )}
    </div>
  );
}

function Dot({ c, t }: { c: string; t: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} aria-hidden="true" />
      {t}
    </span>
  );
}

function DetailsFields({ block: b, set }: { block: Extract<Block, { type: "details" }>; set: (p: Partial<Block>) => void }) {
  const rows = b.rows;
  const put = (i: number, k: "label" | "value", v: string) => set({ rows: rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) } as Partial<Block>);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set({ rows: next } as Partial<Block>);
  };
  return (
    <>
      <Field label="Title (optional)">
        <input aria-label="Details title" className={inputBase} value={b.title || ""} placeholder="e.g. Your appointment" onChange={(e) => set({ title: e.target.value || undefined } as Partial<Block>)} />
      </Field>
      <Field label="Style">
        <Segmented label="Details style" value={b.style ?? "boxed"} onChange={(style) => set({ style } as Partial<Block>)} options={[{ value: "boxed", label: "Boxed" }, { value: "lines", label: "Lines" }]} />
      </Field>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Rows</div>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
            <div className="mb-1.5 flex items-center gap-1">
              <input aria-label={`Row ${i + 1} label`} className={`${inputBase} h-8 py-1 text-xs`} value={r.label} placeholder="Label" onChange={(e) => put(i, "label", e.target.value)} />
              <button type="button" aria-label="Move row up" onClick={() => move(i, -1)} className="grid h-8 w-7 place-items-center rounded text-slate-500 hover:text-white">
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button type="button" aria-label="Move row down" onClick={() => move(i, 1)} className="grid h-8 w-7 place-items-center rounded text-slate-500 hover:text-white">
                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button type="button" aria-label="Delete row" onClick={() => set({ rows: rows.filter((_, j) => j !== i) } as Partial<Block>)} className="grid h-8 w-7 place-items-center rounded text-slate-500 hover:text-red-400">
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <TokenInput label={`Row ${i + 1} value`} value={r.value} onChange={(v) => put(i, "value", v)} placeholder="Value or fill-in" />
          </li>
        ))}
      </ul>
      {rows.length < 20 && (
        <button type="button" onClick={() => set({ rows: [...rows, { label: "", value: "" }] } as Partial<Block>)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add a row
        </button>
      )}
    </>
  );
}

function ColumnsFields(p: InspectorProps & { block: Extract<Block, { type: "columns" }>; set: (x: Partial<Block>) => void }) {
  const b = p.block;
  const [adding, setAdding] = useState<0 | 1 | null>(null);
  return (
    <>
      <Field label="Widths" hint="On phones the columns stack, left one first.">
        <Segmented label="Column widths" value={b.ratio ?? "1:1"} onChange={(ratio) => p.set({ ratio } as Partial<Block>)} options={[{ value: "1:1", label: "Half / half" }, { value: "1:2", label: "⅓ / ⅔" }, { value: "2:1", label: "⅔ / ⅓" }]} />
      </Field>
      {([0, 1] as const).map((c) => (
        <div key={c} className="mb-4">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{c === 0 ? "Left" : "Right"} column</div>
          <ul className="space-y-1">
            {b.cols[c].map((x) => {
              const I = BLOCK_ICONS[x.type];
              return (
                <li key={x.id}>
                  <button type="button" onClick={() => p.onSelect(x.id)} className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2 text-left text-xs text-slate-200 hover:border-brand/50">
                    <I className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
                    <span className="flex-1 truncate">{summary(x)}</span>
                    <span className="text-slate-500">Edit</span>
                  </button>
                </li>
              );
            })}
            {!b.cols[c].length && <li className="rounded-lg border border-dashed border-white/10 px-2.5 py-2 text-xs text-slate-500">Empty</li>}
          </ul>
          {adding === c ? (
            <div className="mt-1.5 grid grid-cols-2 gap-1">
              {COLUMN_CHILD_TYPES.map((t) => {
                const I = BLOCK_ICONS[t];
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      p.onAddToColumn(b.id, c, t);
                      setAdding(null);
                    }}
                    className="flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1.5 text-[11px] text-slate-300 hover:border-brand/50 hover:text-white"
                  >
                    <I className="h-3 w-3 text-cyan-300" aria-hidden="true" /> {BLOCK_LABELS[t]}
                  </button>
                );
              })}
            </div>
          ) : (
            <button type="button" onClick={() => setAdding(c)} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-cyan-300 hover:text-cyan-200">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add to the {c === 0 ? "left" : "right"}
            </button>
          )}
        </div>
      ))}
    </>
  );
}

function summary(b: Block): string {
  switch (b.type) {
    case "heading":
    case "text":
    case "callout":
      return b.text.replace(/\*\*|\*/g, "").split("\n")[0] || BLOCK_LABELS[b.type];
    case "button":
      return b.label || "Button";
    case "image":
      return b.alt || (b.url ? "Picture" : "Picture (empty)");
    case "tech":
      return b.name;
    default:
      return BLOCK_LABELS[b.type];
  }
}

