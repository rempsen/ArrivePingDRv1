import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, CalendarCheck, Flag, ListChecks, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { Modal, Field, inputCls, BtnPrimary, BtnGhost, ConfirmModal } from "../../components/modal";
import { useWorkerNoun, useCustomerNoun } from "../../lib/use-brand";
import {
  MILESTONE_RECIPIENTS,
  STAGE_OPTIONS,
  describeTrigger,
  milestoneProblem,
  type MilestoneRecipient,
  type MilestoneTrigger,
} from "../../../shared/custom-milestones";

/**
 * New / edit a custom milestone (services/custom-milestones.ts): its name,
 * what sets it off, and what each recipient is told. Channels, branded email
 * and tests are in the notifications table, like every built-in milestone.
 */

type Unit = "minutes" | "hours" | "days";
const UNIT_MINUTES: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

function splitOffset(minutes: number): { value: number; unit: Unit } {
  if (minutes >= 1440 && minutes % 1440 === 0) return { value: minutes / 1440, unit: "days" };
  if (minutes >= 60 && minutes % 60 === 0) return { value: minutes / 60, unit: "hours" };
  return { value: minutes, unit: "minutes" };
}

const TRIGGERS: { key: MilestoneTrigger; title: string; sub: string; icon: typeof Flag }[] = [
  { key: "stage", title: "A stage", sub: "When the job reaches a step, like arrived or completed", icon: Flag },
  { key: "checklist", title: "A checklist item", sub: "When the tech ticks an item on the job", icon: ListChecks },
  { key: "before_start", title: "Before the appointment", sub: "A set time before it starts", icon: AlarmClock },
  { key: "after_complete", title: "After the job is done", sub: "A set time after it's completed", icon: CalendarCheck },
];

const PLACEHOLDER: Record<MilestoneRecipient, string> = {
  client: "e.g. Hi {{firstName}}, good news: the water is back on at {{address}}. — {{company}}",
  tech: "e.g. Reminder: take photos of the meter before you leave #{{shortId}}.",
  office: "e.g. #{{shortId}} at {{address}} reached this milestone.",
};

type Messages = Record<MilestoneRecipient, { on: boolean; text: string }>;

export function CustomMilestoneDialog({
  milestoneId,
  onClose,
}: {
  /** null = new milestone */
  milestoneId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { noun: workerNoun } = useWorkerNoun();
  const { noun: customerNoun } = useCustomerNoun();
  const data = useQuery({
    queryKey: ["notif-custom"],
    queryFn: async (): Promise<CustomData> => {
      const res = await api["notif-config"].custom.$get();
      if (!res.ok) throw new Error("Couldn't load your milestones.");
      return (await res.json()) as CustomData;
    },
  });
  const existing = (data.data?.milestones ?? []).find((m) => m.id === milestoneId);

  if (data.isLoading || (milestoneId && !existing && !data.isError)) {
    return (
      <Modal open onClose={onClose} title={milestoneId ? "Edit milestone" : "New milestone"}>
        <p className="py-6 text-center text-sm text-slate-400">Loading…</p>
      </Modal>
    );
  }
  return (
    <MilestoneForm
      key={existing?.id ?? "new"}
      existing={existing ?? null}
      checklistLabels={data.data?.checklistLabels ?? []}
      vars={data.data?.vars ?? []}
      recipientLabel={(r) => (r === "client" ? customerNoun : r === "tech" ? workerNoun : "Office")}
      customerNoun={customerNoun}
      onClose={onClose}
      onSaved={() => {
        qc.invalidateQueries({ queryKey: ["notif-custom"] });
        qc.invalidateQueries({ queryKey: ["notif-rules"] });
        qc.invalidateQueries({ queryKey: ["notif-event"] });
      }}
    />
  );
}

interface CustomData {
  milestones: ExistingMilestone[];
  checklistLabels: string[];
  vars: { key: string; label: string }[];
}

interface ExistingMilestone {
  id: string;
  name: string;
  trigger: string;
  triggerEvent: string;
  checklistLabel: string;
  offsetMinutes: number;
  customerTimeline: boolean;
  enabled: boolean;
  /** `designed`: a branded email is designed for them, so the text may be empty. */
  messages: Record<string, { on: boolean; text: string; designed?: boolean }>;
}

function MilestoneForm({
  existing,
  checklistLabels,
  vars,
  recipientLabel,
  customerNoun,
  onClose,
  onSaved,
}: {
  existing: ExistingMilestone | null;
  checklistLabels: string[];
  vars: { key: string; label: string }[];
  recipientLabel: (r: MilestoneRecipient) => string;
  customerNoun: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const start = splitOffset(existing?.offsetMinutes || 120);
  const [name, setName] = useState(existing?.name ?? "");
  const [trigger, setTrigger] = useState<MilestoneTrigger>((existing?.trigger as MilestoneTrigger) ?? "stage");
  const [triggerEvent, setTriggerEvent] = useState(existing?.triggerEvent || "completed");
  const [checklistLabel, setChecklistLabel] = useState(existing?.checklistLabel ?? "");
  const [offsetValue, setOffsetValue] = useState(String(start.value));
  const [offsetUnit, setOffsetUnit] = useState<Unit>(start.unit);
  const [customerTimeline, setCustomerTimeline] = useState(existing?.customerTimeline ?? true);
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [messages, setMessages] = useState<Messages>(() => {
    const m = existing?.messages ?? {};
    return {
      client: { on: m.client?.on ?? !existing, text: m.client?.text ?? "" },
      tech: { on: m.tech?.on ?? false, text: m.tech?.text ?? "" },
      office: { on: m.office?.on ?? false, text: m.office?.text ?? "" },
    };
  });
  const designed = new Set<MilestoneRecipient>(MILESTONE_RECIPIENTS.filter((r) => existing?.messages?.[r]?.designed));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lastFocused = useRef<{ r: MilestoneRecipient; el: HTMLTextAreaElement } | null>(null);

  const offsetMinutes = Math.round(Number(offsetValue) * UNIT_MINUTES[offsetUnit]);
  const fields = { name, trigger, triggerEvent, checklistLabel, offsetMinutes };
  const summary = describeTrigger(fields);

  const problem = (): string | null => {
    const p = milestoneProblem(fields);
    if (p) return p;
    for (const r of MILESTONE_RECIPIENTS) {
      if (messages[r].on && !messages[r].text.trim() && !designed.has(r)) return `Write the message for the ${recipientLabel(r).toLowerCase()}, or untick them.`;
    }
    return null;
  };

  const body = () => ({
    name: name.trim(),
    trigger,
    triggerEvent: trigger === "stage" ? triggerEvent : undefined,
    checklistLabel: trigger === "checklist" ? checklistLabel.trim() : undefined,
    offsetMinutes: trigger === "before_start" || trigger === "after_complete" ? offsetMinutes : undefined,
    customerTimeline,
    messages,
  });

  const save = useMutation({
    mutationFn: async () => {
      const res = existing
        ? await api["notif-config"].custom[":id"].$patch({ param: { id: existing.id }, json: { ...body(), enabled } })
        : await api["notif-config"].custom.$post({ json: body() });
      const out = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(out.message || "Couldn't save the milestone.");
      return out;
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!existing) return;
      const res = await api["notif-config"].custom[":id"].$delete({ param: { id: existing.id } });
      if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message || "Couldn't delete the milestone.");
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e: Error) => {
      setConfirmDelete(false);
      setError(e.message);
    },
  });

  const submit = () => {
    const p = problem();
    setError(p);
    if (!p) save.mutate();
  };

  const setMsg = (r: MilestoneRecipient, patch: Partial<{ on: boolean; text: string }>) =>
    setMessages((m) => ({ ...m, [r]: { ...m[r], ...patch } }));

  // Into the message box last typed in (or the first one open), at the cursor.
  const insertVar = (key: string) => {
    const focused = lastFocused.current && messages[lastFocused.current.r].on ? lastFocused.current : null;
    const r = focused?.r ?? MILESTONE_RECIPIENTS.find((x) => messages[x].on);
    if (!r) return;
    const text = messages[r].text;
    const pos = focused?.el.selectionStart ?? text.length;
    const token = `{{${key}}}`;
    const next = text.slice(0, pos) + (pos > 0 && text[pos - 1] !== " " ? " " : "") + token + text.slice(pos);
    setMsg(r, { text: next });
    if (focused) requestAnimationFrame(() => focused.el.focus());
  };

  const anyMessage = MILESTONE_RECIPIENTS.some((r) => messages[r].on);

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={existing ? "Edit milestone" : "New milestone"}
        subtitle="A moment of your own, next to the built-in ones. It goes out once per job."
        footer={
          <div className="flex w-full flex-wrap items-center gap-2">
            {existing && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="mr-auto inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-slate-400 hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
              </button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <BtnGhost type="button" onClick={onClose}>Cancel</BtnGhost>
              <BtnPrimary type="button" onClick={submit} disabled={save.isPending}>
                {save.isPending ? "Saving…" : existing ? "Save changes" : "Add milestone"}
              </BtnPrimary>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          <Field label="Name" hint="Say it the way your customers would.">
            <input
              aria-label="Milestone name"
              className={inputCls}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Water restored, Day-before reminder"
            />
          </Field>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-300">What sets it off</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {TRIGGERS.map((t) => {
                const on = trigger === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-label={`${t.title}: ${t.sub}`}
                    aria-pressed={on}
                    onClick={() => {
                      setTrigger(t.key);
                      if (!existing && t.key === "after_complete" && offsetUnit === "hours" && offsetValue === "2") {
                        setOffsetValue("3");
                        setOffsetUnit("days");
                      }
                      if (!existing && t.key === "before_start" && offsetUnit === "days" && offsetValue === "3") {
                        setOffsetValue("1");
                      }
                    }}
                    className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                      on ? "border-brand/60 bg-brand/15" : "border-white/10 bg-ink/60 hover:border-white/20"
                    }`}
                  >
                    <t.icon className={`mt-0.5 h-4 w-4 shrink-0 ${on ? "text-cyan-glow" : "text-slate-500"}`} aria-hidden="true" />
                    <span>
                      <span className={`block text-sm font-semibold ${on ? "text-white" : "text-slate-200"}`}>{t.title}</span>
                      <span className="block text-xs text-slate-400">{t.sub}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3">
              {trigger === "stage" && (
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-400">When</span>
                  <select className={inputCls} value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)}>
                    {STAGE_OPTIONS.map((o) => (
                      <option key={o.event} value={o.event}>{o.label}</option>
                    ))}
                  </select>
                </label>
              )}
              {trigger === "checklist" && (
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-400">The checklist item, worded as on your job templates</span>
                  <input
                    aria-label="Checklist item"
                    className={inputCls}
                    list="milestone-checklist-items"
                    value={checklistLabel}
                    maxLength={200}
                    onChange={(e) => setChecklistLabel(e.target.value)}
                    placeholder="e.g. Water restored"
                  />
                  <datalist id="milestone-checklist-items">
                    {checklistLabels.map((l) => <option key={l} value={l} label={l} aria-label={l} />)}
                  </datalist>
                  <span className="mt-1 block text-[11px] text-slate-500">Capitals and extra spaces don't matter.</span>
                </label>
              )}
              {(trigger === "before_start" || trigger === "after_complete") && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${inputCls} !w-24`}
                    type="number"
                    min={1}
                    inputMode="numeric"
                    aria-label="How long"
                    value={offsetValue}
                    onChange={(e) => setOffsetValue(e.target.value)}
                  />
                  <select
                    className={`${inputCls} !w-32`}
                    aria-label="Unit"
                    value={offsetUnit}
                    onChange={(e) => setOffsetUnit(e.target.value as Unit)}
                  >
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                  </select>
                  <span className="text-sm text-slate-300">
                    {trigger === "before_start" ? "before the appointment" : "after the job is completed"}
                  </span>
                </div>
              )}
            </div>
            {summary && !milestoneProblem({ ...fields, name: name || "x" }) && (
              <p className="mt-2 text-xs text-slate-400">
                Goes off: <span className="font-semibold text-cyan-glow">{summary}</span>
              </p>
            )}
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-300">Who hears about it</legend>
            <div className="space-y-2">
              {MILESTONE_RECIPIENTS.map((r) => {
                const m = messages[r];
                const label = recipientLabel(r);
                return (
                  <div key={r} className={`rounded-xl border p-3 ${m.on ? "border-brand/40 bg-brand/5" : "border-white/10 bg-ink/40"}`}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-white">
                      <input type="checkbox" aria-label={`Send to the ${label.toLowerCase()}`} className="h-4 w-4 accent-cyan-500" checked={m.on} onChange={(e) => setMsg(r, { on: e.target.checked })} />
                      {label}
                      <span className="text-xs font-normal text-slate-500">
                        {r === "client" ? "by text and in the app" : r === "tech" ? "in the app" : "office admins, in the app"}
                      </span>
                    </label>
                    {m.on && (
                      <textarea
                        aria-label={`Message to the ${label.toLowerCase()}`}
                        className={`${inputCls} mt-2 min-h-[72px] resize-y text-sm`}
                        value={m.text}
                        maxLength={1000}
                        placeholder={PLACEHOLDER[r]}
                        onFocus={(e) => (lastFocused.current = { r, el: e.currentTarget })}
                        onChange={(e) => setMsg(r, { text: e.target.value })}
                      />
                    )}
                    {m.on && designed.has(r) && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        A branded email is designed for them, so this can stay empty. Text here also goes by text message and in the app.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {anyMessage && vars.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Insert:</span>
                {vars.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    title={v.label}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertVar(v.key)}
                    className="rounded-md border border-white/10 bg-ink px-2 py-0.5 font-mono text-[11px] text-slate-300 hover:border-brand/40 hover:text-cyan-glow"
                  >
                    {`{{${v.key}}}`}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] text-slate-500">
              After saving, switch text, email or app alerts per person in the table, design a branded email, or send a test.
            </p>
          </fieldset>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-200">
              <input type="checkbox" aria-label="Show on the tracking page" className="mt-0.5 h-4 w-4 accent-cyan-500" checked={customerTimeline} onChange={(e) => setCustomerTimeline(e.target.checked)} />
              <span>
                Show it on the {customerNoun.toLowerCase()}'s tracking page
                <span className="block text-xs text-slate-500">As a line on the job's timeline, under its name.</span>
              </span>
            </label>
            {existing && (
              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-200">
                <input type="checkbox" aria-label="Milestone on" className="mt-0.5 h-4 w-4 accent-cyan-500" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                <span>
                  On
                  <span className="block text-xs text-slate-500">Untick to pause it without losing the messages.</span>
                </span>
              </label>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
        </div>
      </Modal>
      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        pending={remove.isPending}
        title="Delete this milestone?"
        message={`"${existing?.name ?? ""}" and its messages will be deleted. Lines it already added to job timelines stay.`}
      />
    </>
  );
}
