/**
 * Settings for the selected question: wording, required, who sees it, its
 * choices (drag to reorder, paste a list), flags and "show only if" logic.
 */
import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ClipboardPaste, GitBranch, GripVertical, Plus, Trash2, X } from "lucide-react";
import { ITEM_LABELS, ITEM_TYPES, LAYOUT_TYPES, type FormItem, type ItemType, type ShowIf } from "../../../../shared/forms/form-model";
import { ITEM_HINTS, ITEM_ICONS } from "../../../components/forms/item-meta";
import { logicTargets, retype } from "./form-ops";

const input =
  "w-full rounded-lg border border-white/10 bg-ink-3/60 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25";

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-slate-400">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; id: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-lg px-1 py-1.5">
      <input id={id} aria-label={label} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden="true"
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-white/15 transition peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand/50 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4"
      />
      <span className="min-w-0">
        <span className="block text-sm text-slate-200">{label}</span>
        {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

export function Inspector({
  item,
  items,
  onChange,
  onReplace,
  onRemove,
}: {
  item: FormItem;
  items: FormItem[];
  /** Patch the item; `key` coalesces typing into one undo step. */
  onChange: (patch: Partial<FormItem>, key?: string) => void;
  onReplace: (next: FormItem) => void;
  onRemove: () => void;
}) {
  const Icon = ITEM_ICONS[item.type];
  const isLayout = LAYOUT_TYPES.includes(item.type);
  const hasOptions = item.type === "single_choice" || item.type === "multi_choice" || item.type === "checklist";
  const id = (s: string) => `insp-${item.id}-${s}`;

  return (
    <div className="space-y-4" data-tour="inspector">
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cyan-400/10">
          <Icon className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <label htmlFor={id("type")} className="sr-only">
            Question type
          </label>
          <select id={id("type")} value={item.type} onChange={(e) => onReplace(retype(item, e.target.value as ItemType))} className={`${input} py-1.5`}>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {ITEM_LABELS[t]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-500">{ITEM_HINTS[item.type]}</p>
        </div>
      </div>

      <Field label={item.type === "section" ? "Section title" : item.type === "instructions" ? "Heading" : "Question"} htmlFor={id("label")}>
        <input id={id("label")} aria-label="Question wording" value={item.label} onChange={(e) => onChange({ label: e.target.value }, `label:${item.id}`)} className={input} />
      </Field>

      <Field
        label={item.type === "instructions" ? "Text the technician reads" : item.type === "section" ? "Short description (optional)" : "Help text (optional)"}
        htmlFor={id("help")}
        hint={item.type === "instructions" ? undefined : "Shown under the question, for when a tech might hesitate."}
      >
        <textarea
          id={id("help")}
          aria-label="Help text"
          rows={item.type === "instructions" ? 5 : 2}
          value={item.help ?? ""}
          onChange={(e) => onChange({ help: e.target.value || undefined }, `help:${item.id}`)}
          className={input}
        />
      </Field>

      {!isLayout && (
        <div className="rounded-xl border border-white/10 p-2">
          <Toggle id={id("req")} checked={!!item.required} onChange={(v) => onChange({ required: v || undefined })} label="Required" hint="The job can't be finished until it's answered." />
          <Toggle
            id={id("int")}
            checked={!!item.internal}
            onChange={(v) => onChange({ internal: v || undefined })}
            label="Office only"
            hint="Left out of the customer's copy and PDF."
          />
        </div>
      )}

      {hasOptions && <OptionsEditor item={item} onChange={onChange} />}

      {item.type === "single_choice" && (
        <Field label="Show as" htmlFor={id("display")}>
          <select id={id("display")} value={item.display ?? "buttons"} onChange={(e) => onChange({ display: e.target.value as "buttons" | "dropdown" })} className={input}>
            <option value="buttons">Buttons (best for a few choices)</option>
            <option value="dropdown">Dropdown (best for long lists)</option>
          </select>
        </Field>
      )}

      {item.type === "number" && (
        <div className="grid grid-cols-3 gap-2">
          <Field label="Unit" htmlFor={id("unit")}>
            <input id={id("unit")} aria-label="Unit" placeholder="psi" value={item.unit ?? ""} onChange={(e) => onChange({ unit: e.target.value || undefined }, `unit:${item.id}`)} className={input} />
          </Field>
          <Field label="Low" htmlFor={id("min")}>
            <input id={id("min")} aria-label="Lowest expected value" type="number" value={item.min ?? ""} onChange={(e) => onChange({ min: e.target.value === "" ? undefined : Number(e.target.value) }, `min:${item.id}`)} className={input} />
          </Field>
          <Field label="High" htmlFor={id("max")}>
            <input id={id("max")} aria-label="Highest expected value" type="number" value={item.max ?? ""} onChange={(e) => onChange({ max: e.target.value === "" ? undefined : Number(e.target.value) }, `max:${item.id}`)} className={input} />
          </Field>
        </div>
      )}

      {item.type === "photo" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="At least" htmlFor={id("minp")} hint="Photos needed to count as answered.">
            <input id={id("minp")} aria-label="Fewest photos" type="number" min={0} max={30} value={item.minPhotos ?? 0} onChange={(e) => onChange({ minPhotos: Number(e.target.value) || undefined })} className={input} />
          </Field>
          <Field label="At most" htmlFor={id("maxp")}>
            <input id={id("maxp")} aria-label="Most photos" type="number" min={1} max={30} value={item.maxPhotos ?? ""} placeholder="No limit" onChange={(e) => onChange({ maxPhotos: Number(e.target.value) || undefined })} className={input} />
          </Field>
        </div>
      )}

      {item.type === "signature" && (
        <Field label="Who signs" htmlFor={id("signer")}>
          <select id={id("signer")} value={item.signer ?? "customer"} onChange={(e) => onChange({ signer: e.target.value as "customer" | "technician" })} className={input}>
            <option value="customer">The customer</option>
            <option value="technician">The technician</option>
          </select>
        </Field>
      )}

      {!isLayout && item.type !== "photo" && item.type !== "signature" && <FlagEditor item={item} onChange={onChange} />}

      <LogicEditor item={item} items={items} onChange={onChange} />

      <button type="button" onClick={onRemove} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10">
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete {item.type === "section" ? "section" : "question"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function OptionsEditor({ item, onChange }: { item: FormItem; onChange: (patch: Partial<FormItem>, key?: string) => void }) {
  const opts = item.options ?? [];
  const [paste, setPaste] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  // Stable keys for sortable rows (options can repeat while being typed).
  const keys = opts.map((_, i) => `${item.id}-opt-${i}`);
  const noun = item.type === "checklist" ? "item" : "choice";
  const set = (next: string[], key?: string) => onChange({ options: next }, key);

  function onEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = keys.indexOf(String(e.active.id));
    const to = keys.indexOf(String(e.over.id));
    if (from >= 0 && to >= 0) set(arrayMove(opts, from, to));
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-medium text-slate-400">{item.type === "checklist" ? "Checklist items" : "Choices"}</p>
        <button type="button" onClick={() => setPaste(paste === null ? "" : null)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-300 hover:text-white">
          <ClipboardPaste className="h-3 w-3" aria-hidden="true" /> Paste a list
        </button>
      </div>
      {paste !== null && (
        <div className="mb-2 space-y-1.5 rounded-lg border border-white/10 p-2">
          <textarea
            aria-label={`Paste ${noun}s, one per line`}
            rows={4}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={"One per line\nFilter replaced\nCoils cleaned"}
            className={input}
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                const lines = paste.split(/\r?\n|,(?=\s)/).map((s) => s.trim()).filter(Boolean);
                const seen = new Set(opts.map((o) => o.toLowerCase()));
                set([...opts, ...lines.filter((l) => !seen.has(l.toLowerCase()) && (seen.add(l.toLowerCase()), true))]);
                setPaste(null);
              }}
              className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white"
            >
              Add {noun}s
            </button>
            <button type="button" onClick={() => setPaste(null)} className="rounded-md px-3 py-1 text-xs text-slate-400 hover:bg-white/5">
              Cancel
            </button>
          </div>
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
        <SortableContext items={keys} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1">
            {opts.map((o, i) => (
              <OptionRow
                key={keys[i]}
                sortId={keys[i]!}
                value={o}
                label={`${noun} ${i + 1}`}
                onChange={(v) => set(opts.map((x, j) => (j === i ? v : x)), `opt:${item.id}:${i}`)}
                onRemove={() => set(opts.filter((_, j) => j !== i))}
                onEnter={() => set([...opts.slice(0, i + 1), "", ...opts.slice(i + 1)])}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {opts.length === 0 && <p className="mb-1 text-[11px] text-amber-300">Add at least one {noun}.</p>}
      <button type="button" onClick={() => set([...opts, ""])} className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:border-brand/40 hover:text-cyan-300">
        <Plus className="h-3 w-3" aria-hidden="true" /> Add {noun}
      </button>
    </div>
  );
}

function OptionRow({ sortId, value, label, onChange, onRemove, onEnter }: { sortId: string; value: string; label: string; onChange: (v: string) => void; onRemove: () => void; onEnter: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: sortId });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex items-center gap-1 ${isDragging ? "opacity-50" : ""}`}>
      <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} aria-label={`Drag to move ${label}`} className="grid h-8 w-6 shrink-0 cursor-grab touch-none place-items-center text-slate-600 hover:text-slate-300">
        <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <input
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
            // focus the new row on the next paint
            const li = (e.currentTarget.closest("li") as HTMLElement | null)?.nextElementSibling;
            requestAnimationFrame(() => ((li ?? e.currentTarget.closest("li")?.nextElementSibling)?.querySelector("input") as HTMLInputElement | null)?.focus());
          }
        }}
        placeholder={label}
        className="h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-ink px-2 text-sm text-white placeholder:text-slate-600 focus:border-brand focus:outline-none"
      />
      <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-red-500/10 hover:text-red-400">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */

function answerChoices(item: FormItem): { value: string; label: string }[] {
  switch (item.type) {
    case "yes_no":
      return [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ];
    case "pass_fail":
      return [
        { value: "pass", label: "Pass" },
        { value: "fail", label: "Fail" },
        { value: "na", label: "N/A" },
      ];
    case "single_choice":
    case "multi_choice":
    case "checklist":
      return (item.options ?? []).filter(Boolean).map((o) => ({ value: o, label: o }));
    default:
      return [];
  }
}

function FlagEditor({ item, onChange }: { item: FormItem; onChange: (patch: Partial<FormItem>) => void }) {
  const choices = answerChoices(item);
  if (!choices.length) return null;
  const on = new Set(item.flagOn ?? []);
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-slate-400">Flag for the office when the answer is</p>
      <div className="flex flex-wrap gap-1.5">
        {choices.map((c) => {
          const active = on.has(c.value);
          return (
            <button
              key={c.value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                const next = new Set(on);
                if (active) next.delete(c.value);
                else next.add(c.value);
                onChange({ flagOn: next.size ? [...next] : undefined });
              }}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${active ? "border-amber-400 bg-amber-500/15 text-amber-200" : "border-white/10 text-slate-400 hover:border-white/25"}`}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LogicEditor({ item, items, onChange }: { item: FormItem; items: FormItem[]; onChange: (patch: Partial<FormItem>) => void }) {
  const targets = logicTargets(items, item.id);
  const rule = item.showIf;
  const target = rule ? items.find((x) => x.id === rule.itemId) : undefined;
  const choices = target ? answerChoices(target) : [];
  const id = (s: string) => `logic-${item.id}-${s}`;

  if (!rule) {
    return (
      <button
        type="button"
        disabled={!targets.length}
        title={targets.length ? undefined : "Add a question above this one first"}
        onClick={() => {
          const t = targets[targets.length - 1]!;
          const c = answerChoices(t);
          onChange({ showIf: c.length ? { itemId: t.id, op: "is", value: c[t.type === "pass_fail" ? 1 : 0]!.value } : { itemId: t.id, op: "answered" } });
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-violet-200 hover:border-violet-400/50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <GitBranch className="h-3.5 w-3.5" aria-hidden="true" /> Show only if…
      </button>
    );
  }

  const setRule = (r: ShowIf) => onChange({ showIf: r });
  return (
    <div className="space-y-2 rounded-xl border border-violet-400/30 bg-violet-500/5 p-2.5">
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-200">
          <GitBranch className="h-3.5 w-3.5" aria-hidden="true" /> Show only if
        </p>
        <button type="button" onClick={() => onChange({ showIf: undefined })} className="text-[11px] text-slate-400 hover:text-white">
          Remove rule
        </button>
      </div>
      <label htmlFor={id("q")} className="sr-only">
        Earlier question
      </label>
      <select
        id={id("q")}
        value={rule.itemId}
        onChange={(e) => {
          const t = items.find((x) => x.id === e.target.value)!;
          const c = answerChoices(t);
          setRule(c.length ? { itemId: t.id, op: "is", value: c[0]!.value } : { itemId: t.id, op: "answered" });
        }}
        className={input}
      >
        {targets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      <div className="flex gap-1.5">
        <label htmlFor={id("op")} className="sr-only">
          Condition
        </label>
        <select id={id("op")} value={rule.op} onChange={(e) => setRule({ ...rule, op: e.target.value as ShowIf["op"], value: ["is", "is_not"].includes(e.target.value) ? (rule.value ?? choices[0]?.value) : undefined })} className={`${input} w-auto`}>
          {choices.length > 0 && <option value="is">is</option>}
          {choices.length > 0 && <option value="is_not">is not</option>}
          <option value="answered">is answered</option>
          {target?.flagOn?.length ? <option value="flagged">is flagged</option> : null}
        </select>
        {(rule.op === "is" || rule.op === "is_not") && (
          <>
            <label htmlFor={id("v")} className="sr-only">
              Answer
            </label>
            <select id={id("v")} value={rule.value ?? ""} onChange={(e) => setRule({ ...rule, value: e.target.value })} className={`${input} min-w-0 flex-1`}>
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
    </div>
  );
}
