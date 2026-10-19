/**
 * Control Hub → Demos: make a working, branded demo for any industry in a
 * couple of minutes, then reset, extend, open or turn it into the prospect's
 * real account. Demos never text or email anyone.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ExternalLink, RotateCcw, Sparkles, CalendarPlus, BadgeCheck } from "lucide-react";
import { Card, Skeleton, fmt } from "../analytics-ui";
import { Modal, Field, inputCls, BtnPrimary, BtnGhost } from "../../../components/modal";
import { toast } from "../../../components/toast";
import { switchCompany } from "../../../lib/tenant";
import { useConfirm } from "../../../components/confirm-dialog";
import { HubLayout, EmptyNote, StatusText, useHubMe } from "./hub-ui";
import { hub, type HubTenant } from "./hub-data";

interface DemosResp {
  demos: HubTenant[];
  industries: { id: string; label: string; group: string }[];
  defaultDays: number;
  maxDays: number;
}

const DAY = 86_400_000;

function endsText(iso: string | null) {
  if (!iso) return "No end date";
  const d = Math.ceil((Date.parse(iso) - Date.now()) / DAY);
  if (d < 0) return `Ended ${fmt.day(iso.slice(0, 10))}`;
  if (d === 0) return "Ends today";
  return `Ends in ${d} day${d === 1 ? "" : "s"}`;
}

export default function HubDemos() {
  const q = useQuery({ queryKey: ["hub", "demos"], queryFn: () => hub<DemosResp>("/demos") });
  const me = useHubMe();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [making, setMaking] = useState(() => new URLSearchParams(window.location.search).get("new") === "1");
  const act = useMutation({
    mutationFn: (a: { id: string; action: "reset" | "extend" | "convert"; body?: unknown }) => hub(`/demos/${a.id}/${a.action}`, { method: "POST", body: a.body ?? {} }),
    onSuccess: (_r, a) => {
      toast({ kind: "success", message: a.action === "reset" ? "Demo reset: a fresh day of jobs from now." : a.action === "extend" ? "Demo extended." : "It's a customer account now." });
      void qc.invalidateQueries({ queryKey: ["hub"] });
    },
  });
  const demos = q.data?.demos ?? [];
  return (
    <HubLayout
      title="Demos"
      subtitle="A real account with technicians on the move and a day of jobs, in the prospect's own city and colours."
      actions={
        <button type="button" onClick={() => setMaking(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold text-white hover:bg-brand-deep">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Make a demo
        </button>
      }
    >
      {q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : demos.length === 0 ? (
        <EmptyNote>No demos yet. Make one for your next call: pick the industry, the city and their website.</EmptyNote>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {demos.map((d) => {
            const ended = d.demoExpiresAt && Date.parse(d.demoExpiresAt) < Date.now();
            return (
              <Card
                key={d.id}
                title={
                  <Link href={`/admin/hub/tenants/${d.id}`} className="hover:text-white">
                    {d.name}
                  </Link>
                }
                caption={[d.industryLabel, d.city].filter(Boolean).join(" · ")}
              >
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className={ended ? "font-semibold text-amber-300" : "text-slate-400"}>{endsText(d.demoExpiresAt)}</span>
                  <StatusText status={d.status} />
                  {d.createdAt && <span className="text-slate-500">· made {fmt.ago(d.createdAt)}</span>}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => switchCompany(d.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-[12px] font-semibold text-slate-100 hover:bg-white/[0.1]">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    Open
                  </button>
                  <button type="button" disabled={act.isPending} onClick={() => act.mutate({ id: d.id, action: "reset" })} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] font-semibold text-slate-300 hover:bg-white/[0.05]">
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    Reset
                  </button>
                  <button type="button" disabled={act.isPending} onClick={() => act.mutate({ id: d.id, action: "extend", body: { days: 30 } })} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] font-semibold text-slate-300 hover:bg-white/[0.05]">
                    <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    +30 days
                  </button>
                  {me.data?.can.switchAnyTenant && (
                    <button
                      type="button"
                      disabled={act.isPending}
                      onClick={async () => {
                        if (await confirm({ title: `Turn ${d.name} into a customer account?`, message: "It starts counting in analytics, HubSpot and onboarding emails, and the sample data is cleared.", confirmLabel: "Turn into customer", danger: false }))
                          act.mutate({ id: d.id, action: "convert" });
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/30 px-2.5 py-1.5 text-[12px] font-semibold text-emerald-200 hover:bg-emerald-400/10"
                    >
                      <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      They signed
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {making && q.data && <MakeDemo data={q.data} onClose={() => setMaking(false)} />}
    </HubLayout>
  );
}

function MakeDemo({ data, onClose }: { data: DemosResp; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState(data.industries.find((i) => i.id === "hvac-plumbing")?.id ?? data.industries[0]?.id ?? "");
  const [city, setCity] = useState("");
  const [website, setWebsite] = useState("");
  const [days, setDays] = useState(data.defaultDays);
  const [elapsed, setElapsed] = useState(0);
  const make = useMutation({
    mutationFn: () => hub<{ demo: { id: string; name: string; located: boolean }; branded: boolean }>("/demos", { method: "POST", body: { name, industry, city: city || undefined, website: website || undefined, scoutBrand: Boolean(website), days } }),
    onSuccess: (r) => {
      toast({
        kind: "success",
        message: `${r.demo.name} is ready${r.branded ? " in their own colours" : ""}${city && !r.demo.located ? `. We couldn't find "${city}", so it's in Winnipeg.` : "."}`,
      });
      void qc.invalidateQueries({ queryKey: ["hub"] });
      onClose();
    },
  });
  useEffect(() => {
    if (!make.isPending) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [make.isPending]);
  const groups = [...new Set(data.industries.map((i) => i.group))];
  return (
    <Modal
      open
      onClose={make.isPending ? () => {} : onClose}
      title="Make a demo"
      subtitle="Takes a minute or two. Nothing in a demo ever texts or emails anyone."
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-slate-500">{make.isPending ? `Setting it up… ${elapsed}s` : `Ends after ${days} days unless extended`}</span>
          <div className="flex gap-2">
            <BtnGhost onClick={onClose} disabled={make.isPending}>
              Cancel
            </BtnGhost>
            <BtnPrimary onClick={() => make.mutate()} disabled={name.trim().length < 2 || !industry || make.isPending}>
              {make.isPending ? "Making it…" : "Make demo"}
            </BtnPrimary>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prospect's company name">
          <input aria-label="Prospect's company name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bow River Heating" maxLength={120} />
        </Field>
        <Field label="Industry">
          <select className={inputCls} value={industry} onChange={(e) => setIndustry(e.target.value)}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {data.industries
                  .filter((i) => i.group === g)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Their city" hint="Vans and jobs appear around it.">
          <input aria-label="Their city" className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Calgary, AB" maxLength={120} />
        </Field>
        <Field label="Their website (optional)" hint="We read it for their logo, colours and services.">
          <input aria-label="Their website" className={inputCls} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="bowriverheating.ca" maxLength={300} />
        </Field>
        <Field label="Runs for">
          <select className={inputCls} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 14, 30, 60, 90].filter((d) => d <= data.maxDays).map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
