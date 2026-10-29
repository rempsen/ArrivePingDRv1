/**
 * Control Hub → Features: every switch, how many companies have it on, and
 * each company that differs from its default (with who changed it, why and
 * until when). Owners can switch one feature for a whole filtered group, or
 * for specific companies ticked by name.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, Skeleton, fmt } from "../analytics-ui";
import { Modal, Field, inputCls, BtnPrimary, BtnGhost } from "../../../components/modal";
import { toast } from "../../../components/toast";
import { HubLayout, EmptyNote, useHubMe, useHubTenants } from "./hub-ui";
import { hub, KIND_LABEL, type FeatureSummary, type TenantKind } from "./hub-data";
import { pickCompanies, searchCompanies, type BulkWho } from "../../../lib/hub-bulk-pick";

const KIND_TEXT: Record<FeatureSummary["kind"], string> = {
  entitlement: "Part of a plan",
  rollout: "New version being phased in",
  ops: "Behind the scenes",
};

export default function HubFeatures() {
  const q = useQuery({ queryKey: ["hub", "features"], queryFn: () => hub<{ features: FeatureSummary[] }>("/features") });
  const me = useHubMe();
  const [bulk, setBulk] = useState<FeatureSummary | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, FeatureSummary[]>();
    for (const f of q.data?.features ?? []) m.set(f.group, [...(m.get(f.group) ?? []), f]);
    return [...m.entries()];
  }, [q.data]);
  return (
    <HubLayout title="Features" subtitle="What each switch does, who has it, and every company set differently from its default.">
      {q.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-6">
          {groups.map(([group, rows]) => (
            <section key={group}>
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-500">{group}</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {rows.map((f) => (
                  <Card
                    key={f.key}
                    title={f.label}
                    caption={`${KIND_TEXT[f.kind]}${f.removeBy ? ` · switch goes away by ${fmt.day(f.removeBy)}` : ""}`}
                    action={
                      me.data?.can.editPlans ? (
                        <button type="button" onClick={() => setBulk(f)} className="rounded-lg border border-white/10 px-2.5 py-1 text-[12px] font-semibold text-slate-300 hover:bg-white/[0.05]">
                          Switch for many…
                        </button>
                      ) : null
                    }
                  >
                    <p className="text-[13px] text-slate-400">{f.description}</p>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                        <div className="h-full rounded-full bg-emerald-live" style={{ width: `${f.total ? (f.onCount / f.total) * 100 : 0}%` }} />
                      </div>
                      <span className="shrink-0 text-[12px] tabular-nums text-slate-300">
                        On for {fmt.int(f.onCount)} of {fmt.int(f.total)}
                      </span>
                    </div>
                    {f.kindDefaults && (
                      <p className="mt-2 text-[12px] text-slate-500">
                        Default:{" "}
                        {(Object.entries(f.kindDefaults) as [TenantKind, boolean][])
                          .map(([k, v]) => `${KIND_LABEL[k]} ${v ? "on" : "off"}`)
                          .join(" · ")}
                      </p>
                    )}
                    {f.overrides.length > 0 && (
                      <ul className="mt-3 space-y-1.5 border-t border-white/[0.05] pt-3 text-[12px]">
                        {f.overrides.map((o) => (
                          <li key={o.companyId} className="flex flex-wrap items-center justify-between gap-2">
                            <Link href={`/admin/hub/tenants/${o.companyId}?tab=features`} className="font-semibold text-slate-200 hover:text-white">
                              {o.companyName}
                            </Link>
                            <span className={o.enabled ? "text-emerald-300" : "text-rose-300"}>
                              {o.enabled ? "On" : "Off"}
                              <span className="text-slate-500">
                                {o.expiresAt ? ` until ${fmt.day(o.expiresAt.slice(0, 10))}` : ""}
                                {o.reason ? ` · “${o.reason}”` : ""}
                                {o.setByName ? ` · ${o.setByName}` : ""}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {bulk && <BulkDialog feature={bulk} onClose={() => setBulk(null)} />}
    </HubLayout>
  );
}

function BulkDialog({ feature, onClose }: { feature: FeatureSummary; onClose: () => void }) {
  const tenants = useHubTenants();
  const qc = useQueryClient();
  // Features are sold tenant by tenant, so picking companies by name is the
  // primary path; the group choices stay for demos, tests and roll-outs.
  const [who, setWho] = useState<BulkWho>("pick");
  const [industry, setIndustry] = useState("");
  const [query, setQuery] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [value, setValue] = useState<"on" | "off" | "default">("on");
  const [reason, setReason] = useState("");
  const rows = useMemo(() => tenants.data?.tenants ?? [], [tenants.data]);
  const pick = useMemo(() => pickCompanies(rows, { who, industry, ids: ticked }), [rows, who, industry, ticked]);
  const shown = useMemo(() => searchCompanies(rows, query).filter((t) => !industry || t.industry === industry), [rows, query, industry]);
  const industries = useMemo(() => [...new Map(rows.filter((t) => t.industry).map((t) => [t.industry, t.industryLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const tickedSet = new Set(ticked);
  const toggle = (id: string, on: boolean) => setTicked((cur) => (on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id)));
  const run = useMutation({
    mutationFn: () => hub<{ changed: number }>(`/features/${feature.key}/bulk`, { method: "POST", body: { companyIds: pick.map((t) => t.id), enabled: value === "default" ? null : value === "on", reason: reason.trim() || undefined } }),
    onSuccess: (r) => {
      toast({ kind: "success", message: `${feature.label}: ${value === "default" ? "back to default" : value} for ${r.changed} compan${r.changed === 1 ? "y" : "ies"}.` });
      void qc.invalidateQueries({ queryKey: ["hub"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Switch ${feature.label.toLowerCase()} for many`}
      subtitle="Pick who, check the count, then apply. Each company is logged."
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-slate-400">
            This changes <strong className="text-white">{pick.length}</strong> compan{pick.length === 1 ? "y" : "ies"}
          </span>
          <div className="flex gap-2">
            <BtnGhost onClick={onClose}>Cancel</BtnGhost>
            <BtnPrimary disabled={!pick.length || run.isPending} onClick={() => run.mutate()}>
              {run.isPending ? "Applying…" : "Apply"}
            </BtnPrimary>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Which companies">
          <select className={inputCls} value={who} onChange={(e) => setWho(e.target.value as BulkWho)}>
            <option value="pick">Specific companies (search by name)</option>
            <option value="customer">All customers</option>
            <option value="demo">All demos</option>
            <option value="test">All test accounts</option>
            <option value="all">Everyone</option>
          </select>
        </Field>
        {who === "pick" && (
          <Field label="Find a company">
            <input
              type="search"
              aria-label="Find a company"
              className={inputCls}
              placeholder="Type a letter or part of the name, e.g. B for BMD Materials"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="mt-2 flex items-center justify-between text-[12px] text-slate-500">
              <span>
                {ticked.length} ticked · {shown.length} shown
              </span>
              <span className="flex gap-3">
                <button type="button" className="text-cyan-glow hover:underline" onClick={() => setTicked((cur) => [...new Set([...cur, ...shown.map((t) => t.id)])])}>
                  Tick all shown
                </button>
                <button type="button" className="text-slate-400 hover:underline" onClick={() => setTicked([])}>
                  Clear
                </button>
              </span>
            </div>
            <ul className="mt-2 max-h-56 divide-y divide-white/[0.05] overflow-y-auto rounded-xl border border-white/10 bg-ink-2" aria-label="Companies">
              {shown.map((t) => (
                <li key={t.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px] hover:bg-white/[0.04]">
                    <input type="checkbox" aria-label={t.name} className="h-4 w-4 accent-cyan-500" checked={tickedSet.has(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} />
                    <span className="flex-1 truncate text-slate-200">{t.name}</span>
                    <span className="shrink-0 text-[11px] text-slate-500">
                      {KIND_LABEL[t.kind]}
                      {t.industryLabel ? ` · ${t.industryLabel}` : ""}
                    </span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="px-3 py-3 text-[13px] text-slate-500">No company matches "{query.trim()}".</li>}
            </ul>
          </Field>
        )}
        <Field label="Industry (optional)">
          <select className={inputCls} value={industry} onChange={(e) => setIndustry(e.target.value)}>
            <option value="">Any industry</option>
            {industries.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Set to">
          <select className={inputCls} value={value} onChange={(e) => setValue(e.target.value as typeof value)}>
            <option value="on">On</option>
            <option value="off">Off</option>
            <option value="default">Back to each company's default</option>
          </select>
        </Field>
        <Field label="Why (optional)">
          <input aria-label="Why" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </Field>
        {pick.length === 0 && <EmptyNote>{who === "pick" ? "Tick at least one company." : "No companies match."}</EmptyNote>}
      </div>
    </Modal>
  );
}
