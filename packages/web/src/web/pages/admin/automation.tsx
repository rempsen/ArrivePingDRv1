import { useState } from "react";
import { DialogPanel } from "../../components/dialog-panel";
import { useConfirm } from "../../components/confirm-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { ok } from "../../lib/api-ok";
import { FullLoader } from "../../components/loader";
import { PageWrap } from "../../components/brand";
import { PageHead } from "./shell";
import {
  AutoAssignWarning,
  TemplateRuleDialog,
  type ExistingRule,
  useAutomationContext,
} from "../../components/automation-rule-dialog";
import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TEMPLATES,
  AUTOMATION_TRIGGERS,
  TEMPLATE_BY_KEY,
  actionAssigns,
  type AutomationTemplate,
  type RuleDraft,
} from "../../../shared/automation-templates";
import {
  Zap,
  Plus,
  Trash2,
  ArrowRight,
  X,
  Route,
  MapPinned,
  Scale,
  RefreshCw,
  Bell,
  AlarmClock,
  Coffee,
  MoonStar,
  MessageSquareWarning,
  MessageSquareHeart,
  Pencil,
  Sparkles,
} from "lucide-react";

const TRIGGER_LABEL: Record<string, string> = Object.fromEntries(
  AUTOMATION_TRIGGERS.map((t) => [t.key, t.label]),
);
const ACTION_LABEL: Record<string, string> = Object.fromEntries(
  AUTOMATION_ACTIONS.map((a) => [a.key, a.label]),
);

const labelize = (s: string) =>
  TRIGGER_LABEL[s] ??
  ACTION_LABEL[s] ??
  s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

const PRIORITIES = ["", "low", "normal", "high", "urgent"];

const TEMPLATE_ICON: Record<string, typeof Zap> = {
  nearest_tech: Route,
  round_robin: RefreshCw,
  zone_owner: MapPinned,
  least_loaded: Scale,
  urgent_alert: Bell,
  unassigned_alarm: AlarmClock,
  idle_backlog: Coffee,
  after_hours: MoonStar,
  running_late_sms: MessageSquareWarning,
  job_done_thanks: MessageSquareHeart,
};

const CATEGORIES: Array<{ key: AutomationTemplate["category"]; title: string; blurb: string }> = [
  { key: "assignment", title: "Assignment", blurb: "Who gets the job. Suggests by default — auto-assign is a separate switch." },
  { key: "office", title: "Office alerts", blurb: "Nudges to dispatch so nothing slips." },
  { key: "customer", title: "Customer messages", blurb: "Texts that go out on their own." },
];

/** Small "A in a circle" — the same mark that lands on auto-assigned jobs. */
function ABadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-grid h-4 w-4 place-items-center rounded-full bg-violet-500 text-[10px] font-bold leading-none text-white ${className}`}
    >
      A
    </span>
  );
}

export default function AutomationPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [showNew, setShowNew] = useState(false);
  const [setup, setSetup] = useState<{ template: AutomationTemplate; existing?: ExistingRule } | null>(null);
  // Warm the techs/skills/zones lookup so a template dialog opens populated.
  useAutomationContext();
  const [warnFor, setWarnFor] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState({
    name: "",
    trigger: AUTOMATION_TRIGGERS[0].key as string,
    action: AUTOMATION_ACTIONS[0].key as string,
    description: "",
    priority: "",
    minMinutes: "",
    message: "",
  });

  const rules = useQuery({
    queryKey: ["automation"],
    queryFn: async () => ok(await api.automation.$get()),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["automation"] });

  const isTimeTrigger = form.trigger === "tech_idle" || form.trigger === "sla_risk";

  const create = useMutation({
    mutationFn: async () =>
      ok(
        await api.automation.$post({
          json: {
            name: form.name,
            description: form.description,
            trigger: form.trigger,
            action: form.action,
            enabled: true,
            mode: "suggest",
            conditions: {
              ...(form.priority ? { priority: form.priority } : {}),
              ...(isTimeTrigger && form.minMinutes ? { minMinutes: Number(form.minMinutes) } : {}),
            },
            actionConfig: {
              title: form.name,
              message: form.message || form.description,
            },
          },
        }),
      ),
    onSuccess: () => {
      invalidate();
      setShowNew(false);
      setForm({
        name: "",
        trigger: AUTOMATION_TRIGGERS[0].key,
        action: AUTOMATION_ACTIONS[0].key,
        description: "",
        priority: "",
        minMinutes: "",
        message: "",
      });
    },
  });

  const saveTemplate = useMutation({
    mutationFn: async ({ draft, id }: { draft: RuleDraft; id?: string }) => {
      const json = {
        name: draft.name,
        description: draft.description,
        trigger: draft.trigger,
        action: draft.action,
        conditions: draft.conditions,
        actionConfig: draft.actionConfig,
        mode: draft.mode,
        templateKey: draft.templateKey,
        enabled: draft.enabled,
      };
      return id
        ? ok(await api.automation[":id"].$patch({ param: { id }, json }))
        : ok(await api.automation.$post({ json }));
    },
    onSuccess: () => {
      invalidate();
      setSetup(null);
    },
  });

  const patch = useMutation({
    mutationFn: async ({ id, ...json }: { id: string; enabled?: boolean; mode?: "suggest" | "assign" }) =>
      ok(await api.automation[":id"].$patch({ param: { id }, json })),
    onSuccess: invalidate,
  });

  const del = useMutation({
    mutationFn: async (id: string) => ok(await api.automation[":id"].$delete({ param: { id } })),
    onSuccess: invalidate,
  });

  if (rules.isLoading) return <FullLoader label="Loading automations…" />;
  const list = rules.data?.rules ?? [];
  const usedTemplates = new Set(list.map((r) => r.templateKey).filter(Boolean));

  return (
    <PageWrap>
      <PageHead
        title="Automation"
        subtitle="Pick a template, turn a couple of knobs, done. Rules suggest by default — nothing is dispatched without your say-so."
        actions={
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5"
          >
            <Plus className="h-4 w-4" /> Custom rule
          </button>
        }
      />

      {/* ── Your rules ─────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 font-display text-base font-bold text-white">
          <Zap className="h-4 w-4 text-emerald-live" /> Your rules
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs font-medium text-slate-400">{list.length}</span>
        </h2>
        <div className="space-y-2.5">
          {list.map((r) => {
            const assigning = actionAssigns(r.action);
            const auto = assigning && r.mode === "assign";
            const tpl = r.templateKey ? TEMPLATE_BY_KEY[r.templateKey] : undefined;
            return (
              <div key={r.id} data-testid="automation-rule" className="nvc-card flex items-center gap-4 p-4">
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                    r.enabled ? "bg-emerald-live/15 text-emerald-live" : "bg-white/5 text-slate-600"
                  }`}
                >
                  <Zap className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold text-white">
                    <span className="truncate">{r.name}</span>
                    {!r.enabled && <span className="text-xs font-normal text-slate-500">(off)</span>}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded-md bg-amber-warn/10 px-2 py-0.5 font-medium text-amber-warn">
                      {labelize(r.trigger)}
                    </span>
                    <ArrowRight className="h-3 w-3 text-slate-600" />
                    <span className="rounded-md bg-brand/10 px-2 py-0.5 font-medium text-cyan-glow">
                      {labelize(r.action)}
                    </span>
                    {assigning && (
                      <button
                        type="button"
                        title={auto ? "Switch back to suggesting" : "Switch to auto-assign (asks first)"}
                        onClick={() =>
                          auto ? patch.mutate({ id: r.id, mode: "suggest" }) : setWarnFor({ id: r.id, name: r.name })
                        }
                        className={`flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold transition ${
                          auto
                            ? "bg-violet-500/20 text-violet-300 hover:bg-violet-500/30"
                            : "bg-white/5 text-slate-300 hover:bg-white/10"
                        }`}
                      >
                        {auto ? (
                          <>
                            <ABadge className="h-3.5 w-3.5 text-[9px]" /> Auto-assigns
                          </>
                        ) : (
                          "Suggests only"
                        )}
                      </button>
                    )}
                    <span className="text-slate-500">
                      · ran {r.runsCount} {r.runsCount === 1 ? "time" : "times"}
                    </span>
                  </div>
                </div>
                {tpl && (
                  <button
                    type="button"
                    aria-label={`Edit ${r.name}`}
                    title="Edit settings"
                    onClick={() => setSetup({ template: tpl, existing: r })}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={r.enabled ? "Disable automation" : "Enable automation"}
                  onClick={() => patch.mutate({ id: r.id, enabled: !r.enabled })}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${r.enabled ? "bg-emerald-live" : "bg-white/10"}`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                      r.enabled ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </button>
                <button
                  type="button"
                  aria-label={`Delete automation ${r.name}`}
                  title={`Delete automation ${r.name}`}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: `Delete "${r.name}"?`,
                        message: "This automation will stop running immediately. This can't be undone.",
                        confirmLabel: "Delete",
                      })
                    )
                      del.mutate(r.id);
                  }}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
          {list.length === 0 && (
            <p className="nvc-card py-8 text-center text-sm text-slate-500">
              No rules yet. Pick a template below to get started — it takes about thirty seconds.
            </p>
          )}
        </div>
      </section>

      {/* ── Template gallery ───────────────────────────────────────────── */}
      <section>
        <h2 className="mb-1 flex items-center gap-2 font-display text-base font-bold text-white">
          <Sparkles className="h-4 w-4 text-cyan-glow" /> Templates
        </h2>
        <p className="mb-4 text-sm text-slate-400">
          Ready-made rules. Each one is created <b className="text-slate-200">off</b> and in <b className="text-slate-200">Suggest</b> mode until you say otherwise.
        </p>
        <div className="space-y-6">
          {CATEGORIES.map((cat) => (
            <div key={cat.key}>
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-slate-200">{cat.title}</h3>
                <span className="text-xs text-slate-500">{cat.blurb}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {AUTOMATION_TEMPLATES.filter((t) => t.category === cat.key).map((t) => {
                  const Icon = TEMPLATE_ICON[t.key] ?? Zap;
                  const inUse = usedTemplates.has(t.key);
                  return (
                    <button
                      key={t.key}
                      type="button"
                      data-testid={`template-${t.key}`}
                      onClick={() => setSetup({ template: t })}
                      className="nvc-card group flex flex-col items-start gap-2 p-4 text-left transition hover:border-brand/40 hover:bg-brand/5"
                    >
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 text-cyan-glow group-hover:bg-brand/15">
                        <Icon className="h-4.5 w-4.5" />
                      </span>
                      <span className="flex items-center gap-1.5 font-semibold text-white">
                        {t.name}
                        {actionAssigns(t.action) && <ABadge className="opacity-70" />}
                      </span>
                      <span className="text-xs leading-relaxed text-slate-400">{t.tagline}</span>
                      <span className="mt-auto pt-1 text-xs font-semibold text-cyan-glow">
                        {inUse ? "Add another →" : "Use this template →"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Dialogs ────────────────────────────────────────────────────── */}
      {setup && (
        <TemplateRuleDialog
          key={setup.existing?.id ?? setup.template.key}
          template={setup.template}
          existing={setup.existing}
          onClose={() => setSetup(null)}
          saving={saveTemplate.isPending}
          onSave={(draft) => saveTemplate.mutate({ draft, id: setup.existing?.id })}
        />
      )}

      {warnFor && (
        <AutoAssignWarning
          ruleName={warnFor.name}
          onCancel={() => setWarnFor(null)}
          onConfirm={() => {
            patch.mutate({ id: warnFor.id, mode: "assign" });
            setWarnFor(null);
          }}
        />
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <DialogPanel
            onClose={() => setShowNew(false)}
            label="New custom rule"
            className="w-full max-w-3xl rounded-2xl border border-white/10 bg-ink-2 p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-white">New custom rule</h3>
              <button
                onClick={() => setShowNew(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <input
                aria-label="Rule name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Rule name"
                className="w-full rounded-lg border border-white/10 bg-ink-3/60 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-brand focus:outline-none"
              />
              <div>
                <span className="mb-1 block text-xs text-slate-500">When (trigger)</span>
                <select
                  aria-label="When (trigger)"
                  value={form.trigger}
                  onChange={(e) => setForm({ ...form, trigger: e.target.value })}
                  className="w-full rounded-lg border border-white/10 bg-ink-3/60 px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
                >
                  {AUTOMATION_TRIGGERS.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="mb-1 block text-xs text-slate-500">Then (action)</span>
                <select
                  aria-label="Then (action)"
                  value={form.action}
                  onChange={(e) => setForm({ ...form, action: e.target.value })}
                  className="w-full rounded-lg border border-white/10 bg-ink-3/60 px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
                >
                  {AUTOMATION_ACTIONS.filter((a) => a.key !== "auto_assign").map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </select>
                {actionAssigns(form.action) && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    Created in Suggest mode. You can switch it to auto-assign from the rule card afterwards.
                  </p>
                )}
              </div>

              <div>
                <span className="mb-1 block text-xs text-slate-500">Only when priority is</span>
                <select
                  aria-label="Priority filter"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  className="w-full rounded-lg border border-white/10 bg-ink-3/60 px-3 py-2 text-sm text-white focus:border-brand focus:outline-none"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p === "" ? "Any priority" : labelize(p)}
                    </option>
                  ))}
                </select>
              </div>

              {isTimeTrigger && (
                <div>
                  <span className="mb-1 block text-xs text-slate-500">After how many minutes?</span>
                  <input
                    aria-label="Minutes threshold"
                    type="number"
                    min={5}
                    value={form.minMinutes}
                    onChange={(e) => setForm({ ...form, minMinutes: e.target.value })}
                    placeholder={form.trigger === "tech_idle" ? "30" : "60"}
                    className="w-full rounded-lg border border-white/10 bg-ink-3/60 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-brand focus:outline-none"
                  />
                </div>
              )}

              <div>
                <span className="mb-1 block text-xs text-slate-500">
                  Message {form.action === "send_sms" ? "(sent to the customer)" : "(shown to dispatch)"}
                </span>
                <textarea
                  aria-label="Message"
                  rows={2}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  placeholder="Use {{customerName}}, {{techName}}, {{address}}, {{shortId}}, {{trackUrl}}"
                  className="w-full resize-none rounded-lg border border-white/10 bg-ink-3/60 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-brand focus:outline-none"
                />
              </div>
              <button
                disabled={!form.name || create.isPending}
                onClick={() => create.mutate()}
                className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-deep disabled:opacity-50"
              >
                {create.isPending ? "Creating…" : "Create rule"}
              </button>
            </div>
          </DialogPanel>
        </div>
      )}
    </PageWrap>
  );
}
