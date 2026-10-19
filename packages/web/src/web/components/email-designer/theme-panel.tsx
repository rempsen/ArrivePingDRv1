/**
 * The company email theme: one look for every email the company sends.
 */
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { FONT_OPTIONS, HEADER_OPTIONS, type EmailTheme, type HeaderKey } from "../../../shared/email/design";
import { DEFAULT_LOGO_HEIGHT } from "../../../shared/email/render";
import type { BrandDraft } from "./use-email-brand";
import { ColorField, Field, Segmented, Toggle, UploadButton, inputBase, measureRatio } from "./fields";

const SOCIAL_PRESETS = ["Facebook", "Instagram", "LinkedIn", "Google reviews", "YouTube", "TikTok", "X", "Website"];
const SWATCHES = ["#0ea5e9", "#2563eb", "#4f46e5", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#16a34a", "#0f766e", "#111827"];

export function ThemePanel({ draft, setDraft, company, footer, onEditFooter, saveLabel = "Save & apply" }: { draft: BrandDraft; setDraft: (fn: (d: BrandDraft) => BrandDraft) => void; company: string; footer: string; onEditFooter?: () => void; saveLabel?: string }) {
  const t = draft.theme;
  const setTheme = (patch: Partial<EmailTheme>) => setDraft((d) => ({ ...d, theme: { ...d.theme, ...patch } }));
  const [err, setErr] = useState<string | null>(null);
  const colourHeader = t.header === "brand" || t.header === "gradient";

  return (
    <div>
      <p className="mb-4 rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-[12px] leading-snug text-cyan-100">
        The theme is the look of <strong>every</strong> email {company} sends. Changes are saved with <strong>{saveLabel}</strong>.
      </p>

      <Field label="Logo" hint="PNG or JPG with a transparent or white background works best.">
        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-ink p-2.5">
          <div className="grid h-14 w-24 shrink-0 place-items-center rounded-md bg-white p-1">
            {draft.logoUrl ? <img src={draft.logoUrl} alt="Current logo" className="max-h-12 max-w-full object-contain" /> : <span className="text-[10px] text-slate-400">No logo</span>}
          </div>
          <div className="flex flex-col items-start gap-1.5">
            <UploadButton
              label={draft.logoUrl ? "Replace" : "Upload logo"}
              onError={setErr}
              onUploaded={async (url) => {
                setErr(null);
                const ratio = await measureRatio(url);
                setDraft((d) => ({ ...d, logoUrl: url, theme: { ...d.theme, logoRatio: Math.round(ratio * 1000) / 1000 } }));
              }}
            />
            {draft.logoUrl && (
              <button type="button" onClick={() => setDraft((d) => ({ ...d, logoUrl: "", theme: { ...d.theme, logoRatio: 0 } }))} className="text-[11px] text-slate-400 hover:text-red-400">
                Remove logo
              </button>
            )}
          </div>
        </div>
        {err && <p className="mt-1 text-xs text-amber-300">{err}</p>}
      </Field>
      {draft.logoUrl && (
        <>
          <Field label={`Logo height: ${draft.logoHeight || DEFAULT_LOGO_HEIGHT}px`}>
            <input
              aria-label="Logo height"
              type="range"
              min={24}
              max={160}
              step={2}
              value={draft.logoHeight || DEFAULT_LOGO_HEIGHT}
              onChange={(e) => setDraft((d) => ({ ...d, logoHeight: Number(e.target.value) }))}
              className="w-full accent-cyan-400"
            />
          </Field>
          <Field label="Logo position">
            <Segmented label="Logo position" value={t.logoAlign} onChange={(logoAlign) => setTheme({ logoAlign })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }]} />
          </Field>
        </>
      )}

      <Field label="Header">
        <div className="grid grid-cols-2 gap-2">
          {HEADER_OPTIONS.map((h) => (
            <HeaderTile key={h.key} k={h.key} label={h.label} hint={h.hint} active={t.header === h.key} color={draft.brandColor} onPick={() => setTheme({ header: h.key })} />
          ))}
        </div>
      </Field>
      {colourHeader && draft.logoUrl && <Toggle label="White backing behind the logo" checked={t.logoBacking} onChange={(logoBacking) => setTheme({ logoBacking })} />}

      <Field label="Brand colour" hint="Buttons, the header and highlights. Pale colours switch to a dark button automatically.">
        <ColorField label="Brand colour" value={draft.brandColor} onChange={(brandColor) => setDraft((d) => ({ ...d, brandColor }))} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SWATCHES.map((c) => (
            <button key={c} type="button" aria-label={`Use ${c}`} title={c} onClick={() => setDraft((d) => ({ ...d, brandColor: c }))} className={`h-6 w-6 rounded-full border-2 ${draft.brandColor.toLowerCase() === c ? "border-white" : "border-transparent"}`} style={{ background: c }} />
          ))}
        </div>
      </Field>

      <Field label="Layout">
        <Segmented label="Layout" value={t.layout} onChange={(layout) => setTheme({ layout })} options={[{ value: "card", label: "Card on a background" }, { value: "flat", label: "Full white" }]} />
      </Field>
      {t.layout === "card" && (
        <Field label="Background colour">
          <ColorField label="Background colour" value={draft.bgColor} onChange={(bgColor) => setDraft((d) => ({ ...d, bgColor }))} />
        </Field>
      )}

      <Field label="Font" hint="Apple Mail and iPhone show the font; Gmail and Outlook use a close match.">
        <div className="space-y-1">
          {FONT_OPTIONS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={t.font === f.key}
              onClick={() => setTheme({ font: f.key })}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left ${t.font === f.key ? "border-brand/60 bg-brand/10" : "border-white/10 hover:border-white/25"}`}
            >
              <span className="text-[15px] text-white" style={{ fontFamily: f.stack }}>
                {f.label.split(" (")[0]}
              </span>
              <span className="text-[11px] text-slate-500">{f.label.includes("(") ? f.label.split("(")[1]!.replace(")", "") : "Device font"}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Headings">
        <Segmented label="Heading weight" value={t.headingWeight} onChange={(headingWeight) => setTheme({ headingWeight })} options={[{ value: "medium", label: "Light" }, { value: "bold", label: "Bold" }, { value: "heavy", label: "Heavy" }]} />
      </Field>
      <Field label="Corners">
        <Segmented label="Corners" value={t.corners} onChange={(corners) => setTheme({ corners })} options={[{ value: "sharp", label: "Square" }, { value: "soft", label: "Soft" }, { value: "round", label: "Round" }]} />
      </Field>
      <Field label="Buttons">
        <Segmented label="Button shape" value={t.buttonShape} onChange={(buttonShape) => setTheme({ buttonShape })} options={[{ value: "square", label: "Square" }, { value: "rounded", label: "Rounded" }, { value: "pill", label: "Pill" }]} />
      </Field>
      <Field label="Text colour">
        <Segmented label="Text colour" value={t.textColor ? "custom" : "default"} onChange={(v) => setTheme({ textColor: v === "default" ? "" : "#1f2937" })} options={[{ value: "default", label: "Default grey" }, { value: "custom", label: "Custom" }]} />
        {t.textColor && (
          <div className="mt-2">
            <ColorField label="Text colour" value={t.textColor} onChange={(textColor) => setTheme({ textColor })} />
          </div>
        )}
      </Field>

      <SocialLinks links={t.social} onChange={(social) => setTheme({ social })} />

      <Field label="Company footer">
        <Toggle label="Show your address and phone at the bottom" checked={t.showFooter} onChange={(showFooter) => setTheme({ showFooter })} />
        {t.showFooter && (
          <div className="mt-1.5 rounded-lg border border-white/10 bg-white/[0.02] p-2.5 text-[11px] leading-relaxed text-slate-400">
            {footer ? <span>{footer.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()}</span> : <span>No footer yet.</span>}
            {onEditFooter && (
              <button type="button" onClick={onEditFooter} className="ml-1 font-semibold text-cyan-300 hover:text-cyan-200">
                Change it on the Channels tab
              </button>
            )}
          </div>
        )}
      </Field>
    </div>
  );
}

function HeaderTile({ k, label, hint, active, color, onPick }: { k: HeaderKey; label: string; hint: string; active: boolean; color: string; onPick: () => void }) {
  const bar =
    k === "brand" ? { background: color } : k === "gradient" ? { background: `linear-gradient(135deg, ${color}, #0f172a)` } : k === "light" ? { background: "#fff", borderTop: `3px solid ${color}` } : { background: "transparent" };
  return (
    <button type="button" aria-pressed={active} aria-label={`${label} header: ${hint}`} title={hint} onClick={onPick} className={`overflow-hidden rounded-lg border text-left ${active ? "border-brand/70 ring-1 ring-brand/40" : "border-white/10 hover:border-white/25"}`}>
      <div className="bg-slate-100 p-1.5">
        {k === "none" && <div className="mx-auto mb-1 h-1.5 w-8 rounded bg-slate-500" />}
        <div className="overflow-hidden rounded bg-white">
          <div className="grid h-5 place-items-center" style={bar}>
            {k !== "none" && <div className={`h-1.5 w-8 rounded ${k === "light" ? "bg-slate-500" : "bg-white/90"}`} />}
          </div>
          <div className="space-y-1 p-1.5">
            <div className="h-1 w-3/4 rounded bg-slate-300" />
            <div className="h-1 w-1/2 rounded bg-slate-200" />
          </div>
        </div>
      </div>
      <div className="px-2 py-1.5 text-[11px] font-semibold text-slate-200">{label}</div>
    </button>
  );
}

function SocialLinks({ links, onChange }: { links: { label: string; url: string }[]; onChange: (l: { label: string; url: string }[]) => void }) {
  const unused = SOCIAL_PRESETS.filter((p) => !links.some((l) => l.label === p));
  return (
    <Field label="Social and web links" hint="Shown under every email. Each one needs a full address starting with https://.">
      <ul className="space-y-1.5">
        {links.map((l, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <input aria-label={`Link ${i + 1} name`} className={`${inputBase} w-28 shrink-0 px-2 text-xs`} value={l.label} onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input aria-label={`${l.label || "Link"} address`} className={`${inputBase} px-2 text-xs ${l.url && !/^https?:\/\//i.test(l.url) ? "border-amber-400/60" : ""}`} placeholder="https://" value={l.url} onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
            <button type="button" aria-label={`Remove ${l.label || "link"}`} onClick={() => onChange(links.filter((_, j) => j !== i))} className="grid h-8 w-8 shrink-0 place-items-center rounded text-slate-500 hover:text-red-400">
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {links.length < 8 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {unused.slice(0, 8).map((p) => (
            <button key={p} type="button" onClick={() => onChange([...links, { label: p, url: "https://" }])} className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-300 hover:border-brand/50 hover:text-white">
              <Plus className="h-3 w-3" aria-hidden="true" /> {p}
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}
