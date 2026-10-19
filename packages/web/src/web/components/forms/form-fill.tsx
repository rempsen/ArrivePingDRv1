/**
 * The interactive Job forms v2 renderer for the web: the builder's phone
 * preview, the web tech page and (later) office corrections all use it, so
 * what the office designs is exactly what the technician gets.
 *
 * Logic, required checks and flags all come from the shared form model.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, Check, ChevronDown, Flag, Lock, Plus, X } from "lucide-react";
import {
  isAnswered,
  isFlagged,
  isInputItem,
  progress,
  sectionsOf,
  visibleItems,
  type Answer,
  type Answers,
  type FormDef,
  type FormItem,
} from "../../../shared/forms/form-model";
import { SignaturePad } from "../signature-pad";

export interface FormFillProps {
  form: FormDef;
  answers: Answers;
  onAnswer: (itemId: string, answer: Answer) => void;
  /** Upload a photo for a question. Without it (the builder preview) photos stay local. */
  uploadPhoto?: (itemId: string, file: File) => Promise<{ id: string; url: string }>;
  /** Known photo URLs by id. */
  photoUrls?: Record<string, string>;
  /** Question ids to call out (e.g. required ones still missing on Finish). */
  highlight?: string[];
  /** Who is filling in: the office sees "Office only" items normally; techs see them tagged. */
  disabled?: boolean;
  /** Name stamped on answers (preview: "Preview"). */
  by?: string;
}

const now = () => new Date().toISOString();

export function FormFill(p: FormFillProps) {
  const items = visibleItems(p.form, p.answers);
  const groups = sectionsOf(items);
  const prog = progress(p.form, p.answers);
  const flagged = items.filter((i) => isFlagged(i, p.answers[i.id])).length;
  const [localPhotos, setLocalPhotos] = useState<Record<string, string>>({});
  const urls = { ...p.photoUrls, ...localPhotos };

  if (!p.form.items.length) {
    return <p className="px-2 py-10 text-center text-sm text-slate-500">Add questions to see the form here.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 px-1">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div
            className="h-full rounded-full bg-cyan-400 transition-[width] duration-300"
            style={{ width: `${prog.total ? (prog.answered / prog.total) * 100 : 0}%` }}
          />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-slate-400">
          {prog.answered} of {prog.total}
        </span>
        {flagged > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
            <Flag className="h-3 w-3" aria-hidden="true" /> {flagged}
          </span>
        )}
      </div>
      {groups.map((g, gi) => (
        <Section key={g.section?.id ?? `lead-${gi}`} section={g.section} items={g.items} p={p} urls={urls} setLocalPhotos={setLocalPhotos} />
      ))}
    </div>
  );
}

function Section({
  section,
  items,
  p,
  urls,
  setLocalPhotos,
}: {
  section: FormItem | null;
  items: FormItem[];
  p: FormFillProps;
  urls: Record<string, string>;
  setLocalPhotos: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const [open, setOpen] = useState(true);
  const inputs = items.filter(isInputItem);
  const done = inputs.filter((i) => isAnswered(i, p.answers[i.id])).length;
  const body = (
    <div className="space-y-4 p-3">
      {items.length === 0 && <p className="text-xs text-slate-500">Nothing in this section yet.</p>}
      {items.map((it) => (
        <Question key={it.id} item={it} p={p} urls={urls} setLocalPhotos={setLocalPhotos} />
      ))}
    </div>
  );
  if (!section) return <div className="rounded-xl border border-white/10 bg-ink-2/80">{body}</div>;
  return (
    <div className="rounded-xl border border-white/10 bg-ink-2/80">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 border-b border-white/5 px-3 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-white">{section.label}</span>
          {section.help && <span className="block truncate text-[11px] text-slate-500">{section.help}</span>}
        </span>
        {inputs.length > 0 && (
          <span className={`text-[11px] tabular-nums ${done === inputs.length ? "text-emerald-400" : "text-slate-500"}`}>
            {done}/{inputs.length}
          </span>
        )}
        <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden="true" />
      </button>
      {open && body}
    </div>
  );
}

function Question({
  item,
  p,
  urls,
  setLocalPhotos,
}: {
  item: FormItem;
  p: FormFillProps;
  urls: Record<string, string>;
  setLocalPhotos: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const a = p.answers[item.id];
  const set = (patch: Partial<Answer>) => p.onAnswer(item.id, { value: a?.value ?? null, photoIds: a?.photoIds, name: a?.name, ...patch, at: now(), by: p.by });
  const flagged = isFlagged(item, a);
  const hot = p.highlight?.includes(item.id);

  if (item.type === "instructions") {
    return (
      <div className="flex gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-cyan-100">{item.label}</p>
          {item.help && <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-slate-300">{item.help}</p>}
        </div>
      </div>
    );
  }

  const labelId = `ff-${item.id}`;
  return (
    <div
      id={`ff-item-${item.id}`}
      className={`rounded-lg transition ${hot ? "-m-2 bg-red-500/10 p-2 ring-1 ring-red-400/50" : ""}`}
    >
      <div className="mb-1.5 flex items-start gap-1.5">
        <p id={labelId} className="min-w-0 flex-1 text-sm font-medium text-slate-100">
          {item.label}
          {item.required && <span className="ml-0.5 text-red-400" aria-label="required">*</span>}
        </p>
        {item.internal && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
            <Lock className="h-2.5 w-2.5" aria-hidden="true" /> Office only
          </span>
        )}
        {flagged && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
            <Flag className="h-2.5 w-2.5" aria-hidden="true" /> Flagged
          </span>
        )}
      </div>
      {item.help && <p className="-mt-1 mb-2 text-xs text-slate-500">{item.help}</p>}
      <Input item={item} a={a} set={set} p={p} urls={urls} setLocalPhotos={setLocalPhotos} labelId={labelId} />
    </div>
  );
}

const field =
  "w-full rounded-lg border border-white/10 bg-ink-3/70 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:opacity-60";

function Segmented({
  options,
  value,
  onPick,
  labelId,
  tone,
  disabled,
}: {
  options: { value: string; label: string }[];
  value: string | null;
  onPick: (v: string | null) => void;
  labelId: string;
  tone?: (v: string) => string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-labelledby={labelId}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onPick(on ? null : o.value)}
            className={`min-h-11 min-w-[4.5rem] flex-1 rounded-lg border px-3 text-sm font-semibold transition ${
              on ? (tone?.(o.value) ?? "border-brand bg-brand/20 text-white") : "border-white/10 bg-ink-3/60 text-slate-300 hover:border-white/25"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function TextAnswer({
  value,
  multiline,
  onCommit,
  labelId,
  disabled,
  type = "text",
  suffix,
}: {
  value: string;
  multiline?: boolean;
  onCommit: (v: string) => void;
  labelId: string;
  disabled?: boolean;
  type?: string;
  suffix?: string;
}) {
  const [v, setV] = useState(value);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setV(value);
    }
  }, [value]);
  useEffect(() => {
    if (v === last.current) return;
    const t = setTimeout(() => {
      last.current = v;
      onCommit(v);
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  const commit = () => {
    if (v !== last.current) {
      last.current = v;
      onCommit(v);
    }
  };
  if (multiline)
    return (
      <textarea aria-labelledby={labelId} rows={3} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={commit} className={field} />
    );
  return (
    <div className="relative">
      <input
        aria-labelledby={labelId}
        type={type}
        inputMode={type === "number" ? "decimal" : undefined}
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        className={`${field} ${suffix ? "pr-14" : ""}`}
      />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">{suffix}</span>}
    </div>
  );
}

function Input({
  item,
  a,
  set,
  p,
  urls,
  setLocalPhotos,
  labelId,
}: {
  item: FormItem;
  a: Answer | undefined;
  set: (patch: Partial<Answer>) => void;
  p: FormFillProps;
  urls: Record<string, string>;
  setLocalPhotos: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  labelId: string;
}) {
  const v = a?.value ?? null;
  const dis = p.disabled;
  switch (item.type) {
    case "short_text":
    case "long_text":
      return <TextAnswer labelId={labelId} disabled={dis} multiline={item.type === "long_text"} value={typeof v === "string" ? v : ""} onCommit={(s) => set({ value: s || null })} />;
    case "number":
      return (
        <div>
          <TextAnswer
            labelId={labelId}
            disabled={dis}
            type="number"
            suffix={item.unit}
            value={v === null || v === undefined ? "" : String(v)}
            onCommit={(s) => set({ value: s === "" ? null : Number(s) })}
          />
          {(item.min !== undefined || item.max !== undefined) && (
            <p className="mt-1 text-[11px] text-slate-500">
              Expected {item.min ?? "…"} to {item.max ?? "…"}
              {item.unit ? ` ${item.unit}` : ""}
              {typeof v === "number" && ((item.min !== undefined && v < item.min) || (item.max !== undefined && v > item.max)) && (
                <span className="ml-1 font-semibold text-amber-300">Out of range</span>
              )}
            </p>
          )}
        </div>
      );
    case "date":
    case "time":
      return (
        <input
          aria-labelledby={labelId}
          type={item.type}
          disabled={dis}
          value={typeof v === "string" ? v : ""}
          onChange={(e) => set({ value: e.target.value || null })}
          className={`${field} [color-scheme:dark]`}
        />
      );
    case "yes_no":
      return (
        <Segmented
          labelId={labelId}
          disabled={dis}
          value={typeof v === "string" ? v : null}
          onPick={(x) => set({ value: x })}
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]}
          tone={(x) => (item.flagOn?.includes(x) ? "border-amber-400 bg-amber-500/20 text-amber-100" : "border-brand bg-brand/20 text-white")}
        />
      );
    case "pass_fail":
      return (
        <Segmented
          labelId={labelId}
          disabled={dis}
          value={typeof v === "string" ? v : null}
          onPick={(x) => set({ value: x })}
          options={[
            { value: "pass", label: "Pass" },
            { value: "fail", label: "Fail" },
            { value: "na", label: "N/A" },
          ]}
          tone={(x) =>
            x === "pass"
              ? "border-emerald-400 bg-emerald-500/20 text-emerald-100"
              : x === "fail"
                ? "border-red-400 bg-red-500/20 text-red-100"
                : "border-slate-400 bg-white/10 text-white"
          }
        />
      );
    case "single_choice": {
      const opts = item.options ?? [];
      if (item.display === "dropdown" && opts.length > 0)
        return (
          <select aria-labelledby={labelId} disabled={dis} value={typeof v === "string" ? v : ""} onChange={(e) => set({ value: e.target.value || null })} className={field}>
            <option value="">Choose…</option>
            {opts.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      return <Segmented labelId={labelId} disabled={dis} value={typeof v === "string" ? v : null} onPick={(x) => set({ value: x })} options={opts.map((o) => ({ value: o, label: o }))} />;
    }
    case "multi_choice":
    case "checklist": {
      const picked = Array.isArray(v) ? v : [];
      const toggle = (o: string) => {
        const next = picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o];
        set({ value: next.length ? (item.options ?? []).filter((x) => next.includes(x)) : null });
      };
      if (item.type === "multi_choice")
        return (
          <div className="flex flex-wrap gap-1.5" aria-labelledby={labelId}>
            {(item.options ?? []).map((o) => {
              const on = picked.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  disabled={dis}
                  aria-pressed={on}
                  onClick={() => toggle(o)}
                  className={`min-h-10 rounded-full border px-3 text-sm transition ${on ? "border-brand bg-brand/20 text-white" : "border-white/10 bg-ink-3/60 text-slate-300"}`}
                >
                  {on && <Check className="-ml-0.5 mr-1 inline h-3.5 w-3.5" aria-hidden="true" />}
                  {o}
                </button>
              );
            })}
          </div>
        );
      return (
        <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10 bg-ink-3/40" aria-labelledby={labelId}>
          {(item.options ?? []).map((o) => {
            const on = picked.includes(o);
            return (
              <li key={o}>
                <button type="button" disabled={dis} aria-pressed={on} onClick={() => toggle(o)} className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm">
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${on ? "border-emerald-400 bg-emerald-500 text-white" : "border-white/25"}`}>
                    {on && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                  </span>
                  <span className={on ? "text-slate-400 line-through decoration-slate-600" : "text-slate-100"}>{o}</span>
                </button>
              </li>
            );
          })}
        </ul>
      );
    }
    case "photo":
      return <PhotoAnswer item={item} a={a} set={set} p={p} urls={urls} setLocalPhotos={setLocalPhotos} />;
    case "signature":
      return <SignatureAnswer item={item} a={a} set={set} disabled={dis} />;
    default:
      return null;
  }
}

function PhotoAnswer({
  item,
  a,
  set,
  p,
  urls,
  setLocalPhotos,
}: {
  item: FormItem;
  a: Answer | undefined;
  set: (patch: Partial<Answer>) => void;
  p: FormFillProps;
  urls: Record<string, string>;
  setLocalPhotos: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const ids = a?.photoIds ?? [];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const max = item.maxPhotos ?? 30;
  async function add(files: FileList | null) {
    if (!files?.length) return;
    setErr("");
    setBusy(true);
    const next = [...ids];
    try {
      for (const f of Array.from(files).slice(0, max - ids.length)) {
        if (p.uploadPhoto) {
          const up = await p.uploadPhoto(item.id, f);
          setLocalPhotos((m) => ({ ...m, [up.id]: up.url }));
          next.push(up.id);
        } else {
          const id = `local_${Math.random().toString(36).slice(2, 9)}`;
          setLocalPhotos((m) => ({ ...m, [id]: URL.createObjectURL(f) }));
          next.push(id);
        }
      }
    } catch (e) {
      setErr((e as Error).message || "Couldn't upload that photo. Try again.");
    } finally {
      // Photos that did upload are kept, even if a later one failed.
      if (next.length !== ids.length) set({ photoIds: next });
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {ids.map((id) => (
          <div key={id} className="relative h-20 w-20 overflow-hidden rounded-lg border border-white/10 bg-ink-3">
            {urls[id] ? <img src={urls[id]} alt="" className="h-full w-full object-cover" /> : <Camera className="m-auto mt-7 h-5 w-5 text-slate-600" aria-hidden="true" />}
            {!p.disabled && (
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => set({ photoIds: ids.filter((x) => x !== id) })}
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        {!p.disabled && ids.length < max && (
          <label className="grid h-20 w-20 cursor-pointer place-items-center rounded-lg border border-dashed border-white/20 text-slate-400 hover:border-brand/60 hover:text-cyan-300">
            <span className="flex flex-col items-center gap-1 text-[11px]">
              {busy ? "Uploading…" : <><Plus className="h-5 w-5" aria-hidden="true" /> Add photo</>}
            </span>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              multiple
              className="sr-only"
              disabled={busy}
              aria-label={`Add photo for ${item.label}`}
              onChange={(e) => add(e.target.files)}
            />
          </label>
        )}
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        {item.minPhotos ? `At least ${item.minPhotos} · ` : ""}
        {ids.length} added
      </p>
      {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
    </div>
  );
}

function SignatureAnswer({ item, a, set, disabled }: { item: FormItem; a: Answer | undefined; set: (patch: Partial<Answer>) => void; disabled?: boolean }) {
  const [name, setName] = useState(a?.name ?? "");
  const [signing, setSigning] = useState(!a?.value);
  const [ink, setInk] = useState("");
  const who = item.signer === "technician" ? "Technician" : "Customer";
  if (a?.value && !signing) {
    return (
      <div className="rounded-lg border border-white/10 bg-white p-2">
        <img src={String(a.value)} alt={`${who} signature`} className="h-20 w-full object-contain" />
        <div className="mt-1 flex items-center justify-between text-xs text-slate-600">
          <span>{a.name ? `Signed by ${a.name}` : "Signed"}</span>
          {!disabled && (
            <button type="button" className="font-semibold text-sky-700 underline" onClick={() => setSigning(true)}>
              Sign again
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <input aria-label={`${who} printed name`} placeholder={`${who} name`} value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} className={field} />
      <SignaturePad value={ink} onChange={setInk} />
      <button
        type="button"
        disabled={disabled || !ink}
        onClick={() => {
          set({ value: ink, name: name.trim() || undefined });
          setSigning(false);
        }}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-40"
      >
        <Check className="h-4 w-4" aria-hidden="true" /> Save signature
      </button>
    </div>
  );
}
