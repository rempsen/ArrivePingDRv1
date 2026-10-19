/**
 * Small controls for the designer's side panels: labelled fields, segmented
 * choices, colour pickers, uploads, and text fields that insert {{tokens}}
 * where the cursor is.
 */
import { useId, useRef, useState } from "react";
import { Bold, Braces, Italic, Link as LinkIcon, List, Upload } from "lucide-react";
import { EMAIL_TOKENS } from "../../../shared/email/design";
import { useBrand } from "../../lib/use-brand";
import { apiHeaders } from "../../lib/api";

export const inputBase =
  "w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-brand/60 focus:ring-1 focus:ring-brand/30";

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="mb-4">
      <label htmlFor={htmlFor} className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-snug text-slate-500">{hint}</p>}
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: React.ReactNode; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <fieldset className="flex rounded-lg border border-white/10 bg-ink p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold transition ${value === o.value ? "bg-brand/25 text-cyan-200" : "text-slate-400 hover:text-white"}`}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-sm text-slate-300">
      <span>{label}</span>
      <input type="checkbox" aria-label={label} className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden="true" className={`relative h-5 w-9 shrink-0 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand/60 ${checked ? "bg-brand" : "bg-white/15"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${checked ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </label>
  );
}

export function ColorField({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <input aria-label={`${label} picker`} type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"} onChange={(e) => onChange(e.target.value)} className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-ink p-1" />
      <input
        aria-label={label}
        className={`${inputBase} font-mono text-xs`}
        value={draft ?? value}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = e.target.value.trim();
          if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toLowerCase());
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

/** Token labels in the company's own words. */
export function useTokenList() {
  const b = useBrand();
  return EMAIL_TOKENS.map((t) => ({
    key: t.key,
    label:
      t.key === "techName" ? `${b.noun || "Technician"} name`
      : t.key === "techPhoto" ? `${b.noun || "Technician"} photo`
      : t.key === "firstName" ? `${b.customerNoun || "Customer"} first name`
      : t.label,
  }));
}

function TokenMenu({ onPick, exclude = [] }: { onPick: (token: string) => void; exclude?: string[] }) {
  const [open, setOpen] = useState(false);
  const tokens = useTokenList().filter((t) => !exclude.includes(t.key));
  const id = useId();
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        title="Insert a fill-in, like the customer's name"
        className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-slate-400 hover:bg-white/5 hover:text-cyan-200"
      >
        <Braces className="h-3.5 w-3.5" aria-hidden="true" /> Insert
      </button>
      {open && (
        <ul id={id} aria-label="Fill-ins" className="absolute right-0 top-8 z-30 max-h-64 w-56 overflow-y-auto rounded-lg border border-white/10 bg-ink-3 p-1 shadow-2xl">
          {tokens.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(`{{${t.key}}}`);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-white/5"
              >
                <span>{t.label}</span>
                <span className="font-mono text-[10px] text-slate-500">{t.key}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type TextEl = HTMLInputElement | HTMLTextAreaElement;

function insertAtCursor(el: TextEl | null, value: string, text: string, onChange: (v: string) => void) {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  const next = value.slice(0, start) + text + value.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    if (!el) return;
    el.focus();
    el.selectionStart = el.selectionEnd = start + text.length;
  });
}

/** One-line text with a fill-in menu. */
export function TokenInput({ value, onChange, label, placeholder, id }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; id?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center rounded-lg border border-white/10 bg-ink focus-within:border-brand/60">
      <input id={id} ref={ref} aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none" />
      <TokenMenu onPick={(t) => insertAtCursor(ref.current, value, t, onChange)} />
    </div>
  );
}

/** Multi-line text with bold / italic / link / list and fill-ins. */
export function RichText({ value, onChange, label, rows = 5, id }: { value: string; onChange: (v: string) => void; label: string; rows?: number; id?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrap = (before: string, after: string, placeholder: string) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const sel = value.slice(start, end) || placeholder;
    onChange(value.slice(0, start) + before + sel + after + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = start + before.length;
      el.selectionEnd = start + before.length + sel.length;
    });
  };
  const list = () => {
    const el = ref.current;
    if (!el) return;
    const start = value.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const endIdx = value.indexOf("\n", el.selectionEnd);
    const end = endIdx < 0 ? value.length : endIdx;
    const lines = value.slice(start, end).split("\n");
    const allList = lines.every((l) => l.startsWith("- "));
    const next = lines.map((l) => (allList ? l.slice(2) : l.startsWith("- ") ? l : `- ${l}`)).join("\n");
    onChange(value.slice(0, start) + next + value.slice(end));
  };
  const tools = [
    { icon: Bold, label: "Bold", fn: () => wrap("**", "**", "bold text") },
    { icon: Italic, label: "Italic", fn: () => wrap("*", "*", "italic text") },
    { icon: LinkIcon, label: "Link", fn: () => wrap("[", "](https://)", "link text") },
    { icon: List, label: "Bullet list", fn: list },
  ];
  return (
    <div className="overflow-visible rounded-lg border border-white/10 bg-ink focus-within:border-brand/60">
      <div className="flex items-center gap-0.5 border-b border-white/5 px-1 py-0.5">
        {tools.map((t) => (
          <button key={t.label} type="button" aria-label={t.label} title={t.label} onMouseDown={(e) => e.preventDefault()} onClick={t.fn} className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-white/5 hover:text-cyan-200">
            <t.icon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ))}
        <span className="flex-1" />
        <TokenMenu onPick={(t) => insertAtCursor(ref.current, value, t, onChange)} exclude={["techPhoto"]} />
      </div>
      <textarea id={id} ref={ref} aria-label={label} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className="block w-full resize-y bg-transparent px-3 py-2 text-sm leading-relaxed text-white outline-none" />
    </div>
  );
}

/** Upload an image for the email (not saved as the logo unless asked). */
export async function uploadEmailImage(file: File, opts: { asLogo?: boolean } = {}): Promise<{ url?: string; error?: string }> {
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch(`/api/notif-config/email/logo${opts.asLogo ? "" : "?persist=0"}`, { method: "POST", body: fd, credentials: "include", headers: apiHeaders() });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return { error: d.message || "The upload didn't work. Try a PNG or JPG under 4 MB." };
    return { url: d.url };
  } catch {
    return { error: "The upload didn't work. Check your connection and try again." };
  }
}

export function UploadButton({ label, onUploaded, onError }: { label: string; onUploaded: (url: string, file: File) => void; onError: (msg: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" disabled={busy} onClick={() => ref.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-deep disabled:opacity-50">
        <Upload className="h-3.5 w-3.5" aria-hidden="true" /> {busy ? "Uploading…" : label}
      </button>
      <input
        ref={ref}
        aria-label={label}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          const r = await uploadEmailImage(f);
          setBusy(false);
          if (r.url) onUploaded(r.url, f);
          else onError(r.error || "Upload failed");
        }}
      />
    </>
  );
}

/** Width ÷ height of an image file, for sizing the logo in Outlook. */
export function measureRatio(src: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0);
    img.onerror = () => resolve(0);
    img.src = src;
  });
}
