/**
 * QuickBooks Sync — the tenant's settings, opened from the QuickBooks card on
 * the Integrations page. Talks to /api/integrations/quickbooks/* (gated by the
 * Control Hub switch `integrations.quickbooks`).
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Eye, RefreshCw } from "lucide-react";
import { apiHeaders } from "../../lib/api";
import { Modal } from "../../components/modal";

const BASE = "/api/integrations/quickbooks";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path, { headers: apiHeaders() });
  if (r.status === 403) {
    const j = await r.json().catch(() => ({}));
    throw Object.assign(new Error(j?.error?.message || "Not allowed"), { featureOff: j?.error?.code === "feature_off" });
  }
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || `HTTP ${r.status}`);
  return (await r.json()) as T;
}
async function send(path: string, method: string, body?: unknown) {
  const r = await fetch(BASE + path, { method, headers: { ...apiHeaders(), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || `HTTP ${r.status}`);
  return r.json();
}

export interface QboStatus {
  connected: boolean;
  status: string;
  companyName: string;
  realmId: string;
  lastSyncAt: string | null;
  openIssues: number;
  billMode: "arriveping" | "subtrade";
  taxCodeId: string;
  defaultItemId: string;
  parentCustomerId: string;
  shadow: boolean;
  syncSince: string;
}

/** The card's own view of the sync: null while loading, `featureOff` when the Control Hub has it off. */
export function useQboStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["qbo-status"],
    enabled,
    retry: false,
    queryFn: async () => {
      try {
        return { featureOff: false, status: await get<QboStatus>("/status") };
      } catch (e) {
        if ((e as { featureOff?: boolean }).featureOff) return { featureOff: true, status: null };
        throw e;
      }
    },
  });
}

type Option = { id: string; name: string };
type Options = { connected: boolean; taxCodes: Option[]; items: Option[]; customers: Option[]; vendors: Option[] };
type Mappings = {
  technicians: { riderId: string; name: string; qboId: string; qboName: string }[];
  templates: { templateId: string; name: string; qboId: string; qboName: string }[];
};
type Issue = { id: string; bookingId: string | null; kind: string; message: string; createdAt: string };

const ISSUE_LABEL: Record<string, string> = {
  vendor_ambiguous: "Which vendor?",
  customer_ambiguous: "Which customer?",
  item_unmapped: "No item mapped",
  sync_failed: "QuickBooks refused",
  po_cancel_review: "Cancelled job has a bill",
  bill_removed: "Bill removed in QuickBooks",
  po_reassign_review: "Reassigned job has a bill",
  no_pay: "Nothing to price yet",
  name_in_use: "Name already used in QuickBooks",
  customer_reactivated: "Customer reactivated",
  realm_changed: "Different QuickBooks company",
  sweep_failed: "Sweep skipped a record",
  shadow: "Shadow mode",
};

export function QuickBooksSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"settings" | "mappings" | "issues">("settings");
  const status = useQuery({ queryKey: ["qbo-status-modal"], enabled: open, queryFn: () => get<QboStatus>("/status") });
  const options = useQuery({ queryKey: ["qbo-options"], enabled: open, staleTime: 10 * 60_000, queryFn: () => get<Options>("/options") });
  const mappings = useQuery({ queryKey: ["qbo-mappings"], enabled: open && tab === "mappings", queryFn: () => get<Mappings>("/mappings") });
  const issues = useQuery({ queryKey: ["qbo-issues"], enabled: open && tab === "issues", queryFn: () => get<{ issues: Issue[] }>("/issues") });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["qbo-status"] });
    qc.invalidateQueries({ queryKey: ["qbo-status-modal"] });
    qc.invalidateQueries({ queryKey: ["qbo-issues"] });
  };
  const save = useMutation({ mutationFn: (patch: Partial<QboStatus>) => send("/settings", "PUT", patch), onSuccess: refreshAll });
  const map = useMutation({
    mutationFn: (m: { kind: "vendor" | "item"; localId: string; qboId: string }) => send("/mappings", "PUT", m),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["qbo-mappings"] }),
  });
  const resolve = useMutation({ mutationFn: (id: string) => send(`/issues/${id}/resolve`, "POST"), onSuccess: refreshAll });

  useEffect(() => {
    if (open) setTab("settings");
  }, [open]);

  const s = status.data;
  const o = options.data;

  return (
    <Modal open={open} onClose={onClose} title="QuickBooks sync" subtitle={s ? `${s.companyName || "QuickBooks"} · ${s.connected ? "connected" : s.status}` : "Loading…"} size="lg">
      <div className="mb-4 flex gap-1 rounded-xl bg-white/5 p-1 text-xs font-semibold">
        {(["settings", "mappings", "issues"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-lg px-3 py-1.5 capitalize ${tab === t ? "bg-ink-2 text-white" : "text-slate-400 hover:text-slate-200"}`}>
            {t}
            {t === "issues" && s && s.openIssues > 0 && <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-300">{s.openIssues}</span>}
          </button>
        ))}
      </div>

      {tab === "settings" && s && (
        <div className="space-y-5 text-sm">
          <fieldset>
            <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Who creates the subcontractor's bill</legend>
            <div className="space-y-2">
              <Radio
                checked={s.billMode === "arriveping"}
                onChange={() => save.mutate({ billMode: "arriveping" })}
                label="ArrivePing creates the bill when the job completes"
                hint="A bill for the technician's pay is linked to the purchase order. Your bookkeeper reviews and pays it in QuickBooks."
              />
              <Radio
                checked={s.billMode === "subtrade"}
                onChange={() => save.mutate({ billMode: "subtrade" })}
                label="Subcontractors send their own invoices; we only track them"
                hint="ArrivePing sends the purchase order. When the bookkeeper enters the subcontractor's bill against it, the job follows that bill."
              />
            </div>
          </fieldset>

          <label className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3" aria-label="Shadow mode">
            <input type="checkbox" className="mt-1" aria-label="Shadow mode" checked={s.shadow} onChange={(e) => save.mutate({ shadow: e.target.checked })} />
            <span>
              <span className="font-semibold text-white">Shadow mode</span>
              <span className="block text-xs text-slate-400">Log what would be sent to QuickBooks without writing anything. Turn this off to go live.</span>
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Purchase tax code" hint="Applied to every line (e.g. GST)" value={s.taxCodeId} options={o?.taxCodes ?? []} onChange={(v) => save.mutate({ taxCodeId: v })} />
            <Select label="Default item" hint="For templates with no mapping" value={s.defaultItemId} options={o?.items ?? []} onChange={(v) => save.mutate({ defaultItemId: v })} />
            <Select label="Parent customer" hint="New customers are filed under it" value={s.parentCustomerId} options={o?.customers ?? []} onChange={(v) => save.mutate({ parentCustomerId: v })} allowNone />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Sync jobs scheduled from</span>
            <input
              type="date"
              aria-label="Sync jobs scheduled from"
              className="w-full min-h-10 rounded-lg border border-white/10 bg-ink-3/60 px-3 py-2 text-sm text-white sm:max-w-xs"
              value={s.syncSince}
              onChange={(e) => e.target.value && save.mutate({ syncSince: e.target.value })}
            />
            <span className="mt-1.5 block text-xs text-slate-500">Set to the day QuickBooks was connected. Jobs scheduled before it stay with the bookkeeper and are never sent.</span>
          </label>
          {s.lastSyncAt && <p className="text-xs text-slate-500">Last checked QuickBooks {new Date(s.lastSyncAt).toLocaleString()}</p>}
          {save.isError && <p className="text-xs text-red-400">{(save.error as Error).message}</p>}
        </div>
      )}

      {tab === "mappings" && (
        <div className="space-y-5 text-sm">
          <MappingTable
            title="Technicians → QuickBooks vendors"
            hint="Unmapped technicians are matched by exact name, then created as vendors."
            rows={(mappings.data?.technicians ?? []).map((t) => ({ id: t.riderId, name: t.name, qboId: t.qboId, qboName: t.qboName }))}
            options={o?.vendors ?? []}
            onPick={(localId, qboId) => map.mutate({ kind: "vendor", localId, qboId })}
          />
          <MappingTable
            title="Job templates → QuickBooks items"
            hint="The cost code each kind of job is billed under. Unmapped templates use the default item."
            rows={(mappings.data?.templates ?? []).map((t) => ({ id: t.templateId, name: t.name, qboId: t.qboId, qboName: t.qboName }))}
            options={o?.items ?? []}
            onPick={(localId, qboId) => map.mutate({ kind: "item", localId, qboId })}
          />
        </div>
      )}

      {tab === "issues" && (
        <div className="space-y-2 text-sm">
          {issues.isLoading && <p className="text-xs text-slate-500">Loading…</p>}
          {issues.data && issues.data.issues.length === 0 && (
            <p className="flex items-center gap-2 text-xs text-emerald-live"><Check className="h-4 w-4" /> Nothing needs attention.</p>
          )}
          {(issues.data?.issues ?? []).map((i) => (
            <div key={i.id} className="flex items-start gap-3 rounded-xl border border-white/5 bg-ink-2 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white">{ISSUE_LABEL[i.kind] ?? i.kind}</p>
                <p className="text-xs text-slate-400">{i.message}</p>
                <p className="text-[11px] text-slate-600">
                  {i.createdAt ? new Date(i.createdAt).toLocaleString() : ""}
                  {i.bookingId && (
                    <>
                      {" · "}
                      <a className="text-cyan-glow hover:underline" href={`/admin/jobs/${i.bookingId}`}><Eye className="inline h-3 w-3" /> job</a>
                    </>
                  )}
                </p>
              </div>
              <button onClick={() => resolve.mutate(i.id)} className="nvc-btn nvc-btn-sm bg-white/5 text-slate-200 hover:bg-white/10">Resolve</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function Radio({ checked, onChange, label, hint }: { checked: boolean; onChange: () => void; label: string; hint: string }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${checked ? "border-cyan-glow/40 bg-cyan-glow/5" : "border-white/5 bg-ink-2"}`} aria-label={label}>
      <input type="radio" className="mt-1" aria-label={label} checked={checked} onChange={onChange} />
      <span>
        <span className="font-semibold text-white">{label}</span>
        <span className="block text-xs text-slate-400">{hint}</span>
      </span>
    </label>
  );
}

function Select({ label, hint, value, options, onChange, allowNone }: { label: string; hint: string; value: string; options: Option[]; onChange: (v: string) => void; allowNone?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-300">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-2 px-2 py-1.5 text-sm text-white">
        <option value="">{allowNone ? "None (top level)" : "Choose…"}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      <span className="text-[11px] text-slate-500">{hint}</span>
    </label>
  );
}

function MappingTable({ title, hint, rows, options, onPick }: { title: string; hint: string; rows: { id: string; name: string; qboId: string; qboName: string }[]; options: Option[]; onPick: (localId: string, qboId: string) => void }) {
  const [filter, setFilter] = useState("");
  const shown = rows.filter((r) => !filter || r.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</h3>
          <p className="text-[11px] text-slate-500">{hint}</p>
        </div>
        <input aria-label={`Search ${title}`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search" className="w-36 rounded-lg border border-white/10 bg-ink-2 px-2 py-1 text-xs text-white" />
      </div>
      <div className="divide-y divide-white/5 rounded-xl border border-white/5">
        {shown.length === 0 && <p className="p-3 text-xs text-slate-500">Nothing here yet.</p>}
        {shown.map((r) => (
          <div key={r.id} className="flex items-center gap-3 p-2.5">
            <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{r.name || "(unnamed)"}</span>
            <select aria-label={`QuickBooks record for ${r.name || "unnamed"}`} value={r.qboId} onChange={(e) => e.target.value && onPick(r.id, e.target.value)} className="w-56 rounded-lg border border-white/10 bg-ink-2 px-2 py-1 text-xs text-white">
              <option value="">{r.qboId ? r.qboName || `#${r.qboId}` : "Not mapped"}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            {r.qboId ? <Check className="h-4 w-4 text-emerald-live" /> : <RefreshCw className="h-4 w-4 text-slate-600" />}
          </div>
        ))}
      </div>
    </div>
  );
}
