import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";
import { DialogPanel } from "./dialog-panel";
import { api } from "../lib/api";
import { ok } from "../lib/api-ok";
import {
  PRIORITY_OPTIONS,
  actionAssigns,
  coerceKnobValue,
  draftFromTemplate,
  getPath,
  setPath,
  type AutomationTemplate,
  type Knob,
  type RuleDraft,
  type RuleMode,
} from "../../shared/automation-templates";

/** Dropdown data for the dynamic knobs (techs, skill classes, zones). */
export function useAutomationContext() {
  return useQuery({
    queryKey: ["automation", "context"],
    queryFn: async () => ok(await api.automation.context.$get()),
    staleTime: 60_000,
  });
}
type Ctx = NonNullable<ReturnType<typeof useAutomationContext>["data"]>;

const inputCls =
  "w-full rounded-lg border border-white/10 bg-ink-3/60 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-brand focus:outline-none";

/**
 * The one place that explains what "Auto-assign" really means before it is
 * switched on. Dan's rule: suggesting is the default; dispatching without a
 * human is opt-in, per rule, behind this explicit warning.
 */
export function AutoAssignWarning({
  ruleName,
  onCancel,
  onConfirm,
}: {
  ruleName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <DialogPanel
        onClose={onCancel}
        label="Turn on auto-assign"
        className="w-full max-w-md rounded-2xl border border-amber-warn/30 bg-ink-2 p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-warn/15 text-amber-warn">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-display text-lg font-bold text-white">Turn on auto-assign?</h3>
            <p className="mt-0.5 text-sm text-slate-400">
              "{ruleName}" will stop suggesting and start dispatching.
            </p>
          </div>
        </div>
        <ul className="mb-4 space-y-2 text-sm text-slate-300">
          <li className="flex gap-2">
            <span className="text-amber-warn">•</span>
            <span>
              Jobs that match this rule will be assigned to a technician{" "}
              <b className="text-white">without anyone in the office approving it first</b>.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-amber-warn">•</span>
            <span>
              Every job it assigns is marked with an{" "}
              <span className="inline-grid h-4 w-4 place-items-center rounded-full bg-violet-500 align-middle text-[10px] font-bold text-white">
                A
              </span>{" "}
              badge on the scheduler, calendar, bookings list and job details, so you can always tell what the
              automation did.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-amber-warn">•</span>
            <span>
              The technician still has to accept the job on their phone, and you can reassign it by hand at any time.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-amber-warn">•</span>
            <span>You can switch back to Suggest mode whenever you like.</span>
          </li>
        </ul>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-white/10 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/5"
          >
            Keep suggesting
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-amber-warn py-2.5 text-sm font-semibold text-ink hover:bg-amber-300"
          >
            Yes, auto-assign
          </button>
        </div>
      </DialogPanel>
    </div>
  );
}

// ── Knob fields ──────────────────────────────────────────────────────────────

function optionsFor(knob: Knob, ctx: Ctx | undefined): Array<{ value: string; label: string }> {
  if (knob.options) return knob.options;
  switch (knob.source) {
    case "priorities":
      return PRIORITY_OPTIONS.filter((p) => p.value !== "");
    case "skillClasses":
      return (ctx?.skillClasses ?? []).map((s) => ({ value: s, label: s }));
    case "zones":
      return (ctx?.zones ?? []).map((z) => ({ value: z.id, label: z.name }));
    case "techs":
      return (ctx?.techs ?? []).map((t) => ({ value: t.id, label: `${t.name} · ${t.skillClass}` }));
    default:
      return [];
  }
}

function CheckList({
  options,
  value,
  onChange,
  emptyText,
}: {
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (next: string[]) => void;
  emptyText: string;
}) {
  if (!options.length) return <p className="text-xs text-slate-500">{emptyText}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
              on
                ? "border-brand bg-brand/20 text-cyan-glow"
                : "border-white/10 bg-ink-3/40 text-slate-400 hover:border-white/20 hover:text-white"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function KnobField({
  knob,
  draft,
  ctx,
  onChange,
}: {
  knob: Knob;
  draft: RuleDraft;
  ctx: Ctx | undefined;
  onChange: (path: string, value: unknown) => void;
}) {
  const raw = getPath(draft, knob.path);
  const label = <span className="mb-1 block text-xs font-medium text-slate-400">{knob.label}</span>;
  const help = knob.help ? <p className="mt-1 text-[11px] text-slate-500">{knob.help}</p> : null;
  const techs = ctx?.techs ?? [];
  const zones = ctx?.zones ?? [];
  // Before the context request lands, say so instead of "nothing to choose".
  const loading = ctx === undefined;
  const noneYet = (msg: string) => (loading ? "Loading…" : msg);

  switch (knob.type) {
    case "number":
      return (
        <div>
          {label}
          <input
            aria-label={knob.label}
            type="number"
            min={knob.min}
            max={knob.max}
            value={raw == null ? "" : String(raw)}
            placeholder={knob.placeholder}
            onChange={(e) => onChange(knob.path, coerceKnobValue(knob, e.target.value))}
            className={inputCls}
          />
          {help}
        </div>
      );
    case "text":
      return (
        <div>
          {label}
          <input
            aria-label={knob.label}
            value={typeof raw === "string" ? raw : ""}
            placeholder={knob.placeholder}
            onChange={(e) => onChange(knob.path, e.target.value)}
            className={inputCls}
          />
          {help}
        </div>
      );
    case "textarea":
      return (
        <div>
          {label}
          <textarea
            aria-label={knob.label}
            rows={3}
            value={typeof raw === "string" ? raw : ""}
            placeholder={knob.placeholder}
            onChange={(e) => onChange(knob.path, e.target.value)}
            className={`${inputCls} resize-none`}
          />
          {help}
        </div>
      );
    case "select": {
      const opts = optionsFor(knob, ctx);
      const cur = raw == null ? "" : String(raw);
      return (
        <div>
          {label}
          <select
            aria-label={knob.label}
            value={cur}
            onChange={(e) => onChange(knob.path, coerceKnobValue(knob, e.target.value))}
            className={inputCls}
          >
            {opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {help}
        </div>
      );
    }
    case "multiselect": {
      const opts = optionsFor(knob, ctx);
      const cur = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" && raw ? [raw] : [];
      return (
        <div>
          {label}
          <CheckList
            options={opts}
            value={cur}
            onChange={(next) => onChange(knob.path, coerceKnobValue(knob, next))}
            emptyText={noneYet("Nothing to choose from yet.")}
          />
          {help}
        </div>
      );
    }
    case "tech": {
      const cur = typeof raw === "string" ? raw : "";
      return (
        <div>
          {label}
          <select aria-label={knob.label} value={cur} onChange={(e) => onChange(knob.path, e.target.value)} className={inputCls}>
            <option value="">— pick a technician —</option>
            {techs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.skillClass}
              </option>
            ))}
          </select>
          {help}
        </div>
      );
    }
    case "tech_pool": {
      const cur = Array.isArray(raw) ? raw.map(String) : [];
      return (
        <div>
          {label}
          <CheckList
            options={techs.map((t) => ({ value: t.id, label: `${t.name} · ${t.skillClass}` }))}
            value={cur}
            onChange={(next) => onChange(knob.path, next)}
            emptyText={noneYet("Add technicians under Team first.")}
          />
          {help}
        </div>
      );
    }
    case "zone_owners": {
      const cur = (raw && typeof raw === "object" ? raw : {}) as Record<string, string>;
      return (
        <div>
          {label}
          {zones.length === 0 ? (
            <p className="text-xs text-slate-500">No service zones yet — draw them under Settings → Service zones.</p>
          ) : (
            <div className="space-y-1.5">
              {zones.map((z) => (
                <div key={z.id} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: z.color }} />
                  <span className="w-32 shrink-0 truncate text-sm text-slate-300" title={z.name}>
                    {z.name}
                  </span>
                  <select
                    aria-label={`Owner of ${z.name}`}
                    value={cur[z.id] ?? ""}
                    onChange={(e) => {
                      const next = { ...cur };
                      if (e.target.value) next[z.id] = e.target.value;
                      else delete next[z.id];
                      onChange(knob.path, next);
                    }}
                    className={inputCls}
                  >
                    <option value="">— nobody —</option>
                    {techs.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.skillClass}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
          {help}
        </div>
      );
    }
    case "zone_roster": {
      const cur = (raw && typeof raw === "object" ? raw : {}) as Record<string, string[]>;
      return (
        <div>
          {label}
          {zones.length === 0 ? (
            <p className="text-xs text-slate-500">No service zones yet — draw them under Settings → Service zones.</p>
          ) : (
            <div className="space-y-2">
              {zones.map((z) => (
                <div key={z.id}>
                  <div className="mb-1 flex items-center gap-2 text-sm text-slate-300">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: z.color }} />
                    {z.name}
                  </div>
                  <CheckList
                    options={techs.map((t) => ({ value: t.id, label: t.name }))}
                    value={Array.isArray(cur[z.id]) ? cur[z.id] : []}
                    onChange={(next) => onChange(knob.path, { ...cur, [z.id]: next })}
                    emptyText={noneYet("Add technicians under Team first.")}
                  />
                </div>
              ))}
            </div>
          )}
          {help}
        </div>
      );
    }
    default:
      return null;
  }
}

// ── Setup dialog ─────────────────────────────────────────────────────────────

export interface ExistingRule {
  id: string;
  name: string;
  description: string;
  trigger: string;
  action: string;
  conditions: string;
  actionConfig: string;
  mode: string;
  templateKey: string;
  enabled: boolean;
}

function parseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function draftFromRule(t: AutomationTemplate, r: ExistingRule): RuleDraft {
  const base = draftFromTemplate(t);
  return {
    ...base,
    name: r.name,
    description: r.description,
    conditions: { ...base.conditions, ...parseJson<Record<string, unknown>>(r.conditions, {}) },
    actionConfig: { ...base.actionConfig, ...parseJson<Record<string, unknown>>(r.actionConfig, {}) },
    mode: r.mode === "assign" ? "assign" : "suggest",
    enabled: r.enabled,
  };
}

/**
 * Create a rule from a template, or edit a template-based rule. The knobs
 * write straight into the draft; "Save" ships the whole draft to the API.
 */
export function TemplateRuleDialog({
  template,
  existing,
  onClose,
  onSave,
  saving,
}: {
  template: AutomationTemplate;
  existing?: ExistingRule;
  onClose: () => void;
  onSave: (draft: RuleDraft) => void;
  saving: boolean;
}) {
  const ctx = useAutomationContext();
  const [draft, setDraft] = useState<RuleDraft>(() =>
    existing ? draftFromRule(template, existing) : draftFromTemplate(template),
  );
  const [warn, setWarn] = useState(false);
  const assigning = actionAssigns(template.action);

  // Hide knobs that don't apply to the chosen round-robin scope.
  const scope = String(getPath(draft, "actionConfig.scope") ?? "");
  const visibleKnobs = template.knobs.filter((k) => {
    if (k.key === "zoneTechs") return scope === "zone";
    if (k.key === "pool") return scope === "custom";
    return true;
  });

  useEffect(() => {
    if (!assigning && draft.mode === "assign") setDraft((d) => ({ ...d, mode: "suggest" }));
  }, [assigning, draft.mode]);

  const update = (path: string, value: unknown) => setDraft((d) => setPath(d, path, value));
  const pickMode = (m: RuleMode) => {
    if (m === "assign" && draft.mode !== "assign") setWarn(true);
    else setDraft((d) => ({ ...d, mode: m }));
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <DialogPanel
        onClose={onClose}
        label={existing ? `Edit ${template.name}` : `Set up ${template.name}`}
        className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-2xl border border-white/10 bg-ink-2 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/5 p-5 pb-4">
          <div>
            <h3 className="font-display text-lg font-bold text-white">{existing ? "Edit rule" : template.name}</h3>
            <p className="mt-1 text-sm text-slate-400">{template.description}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-400">Rule name</span>
            <input
              aria-label="Rule name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className={inputCls}
            />
          </div>

          {visibleKnobs.map((k) => (
            <KnobField key={k.key} knob={k} draft={draft} ctx={ctx.data} onChange={update} />
          ))}

          {assigning && (
            <div className="rounded-xl border border-white/10 bg-ink-3/40 p-3">
              <span className="mb-2 block text-xs font-medium text-slate-400">What should this rule do?</span>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  aria-pressed={draft.mode === "suggest"}
                  onClick={() => pickMode("suggest")}
                  className={`rounded-lg border p-3 text-left transition ${
                    draft.mode === "suggest" ? "border-brand bg-brand/15" : "border-white/10 hover:border-white/20"
                  }`}
                >
                  <p className="text-sm font-semibold text-white">Suggest</p>
                  <p className="mt-0.5 text-xs text-slate-400">Tell the office who it would pick. A person assigns.</p>
                </button>
                <button
                  type="button"
                  aria-pressed={draft.mode === "assign"}
                  onClick={() => pickMode("assign")}
                  className={`rounded-lg border p-3 text-left transition ${
                    draft.mode === "assign" ? "border-violet-500 bg-violet-500/15" : "border-white/10 hover:border-white/20"
                  }`}
                >
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
                    Auto-assign
                    <span className="inline-grid h-4 w-4 place-items-center rounded-full bg-violet-500 text-[10px] font-bold text-white">
                      A
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">Dispatch the job itself and mark it with an A.</p>
                </button>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              aria-label="Turn this rule on right away"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              className="h-4 w-4 rounded border-white/20 bg-ink-3 accent-brand"
            />
            Turn this rule on right away
          </label>
        </div>

        <div className="border-t border-white/5 p-5 pt-4">
          <button
            type="button"
            disabled={!draft.name.trim() || saving}
            onClick={() => onSave(draft)}
            className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-deep disabled:opacity-50"
          >
            {saving ? "Saving…" : existing ? "Save changes" : "Create rule"}
          </button>
        </div>
      </DialogPanel>

      {warn && (
        <AutoAssignWarning
          ruleName={draft.name || template.name}
          onCancel={() => setWarn(false)}
          onConfirm={() => {
            setDraft((d) => ({ ...d, mode: "assign" }));
            setWarn(false);
          }}
        />
      )}
    </div>
  );
}
