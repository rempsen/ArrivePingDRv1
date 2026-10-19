/**
 * Control Hub → Leads & sales: people who asked to be contacted, and the way
 * we book them. "Book" opens ArrivePing's own New Job form with the lead
 * filled in, so a sales meeting or lunch lands on our map like any job and
 * the prospect gets the live ETA text when the rep heads over.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Mail, Phone, Settings2 } from "lucide-react";
import { Card, Segmented, Skeleton, fmt } from "../analytics-ui";
import { toast } from "../../../components/toast";
import { WorkOrderModal } from "../../../components/work-order-modal";
import { switchCompany, activeCompany } from "../../../lib/tenant";
import { HubLayout, EmptyNote } from "./hub-ui";
import { hub, type Lead } from "./hub-data";

interface LeadsResp {
  salesPack: boolean;
  leads: Lead[];
  services: { id: string; name: string; durationMins: number }[];
  reps: { id: string; name: string; status: string }[];
  statuses: string[];
  missing: string[];
}

const STATUS_LABEL: Record<string, string> = { new: "New", contacted: "Contacted", booked: "Booked", closed: "Closed" };
const STATUS_CLS: Record<string, string> = {
  new: "bg-cyan-400/10 text-cyan-200",
  contacted: "bg-amber-400/10 text-amber-200",
  booked: "bg-emerald-400/10 text-emerald-200",
  closed: "bg-white/[0.06] text-slate-400",
};

export default function HubLeads() {
  const q = useQuery({ queryKey: ["hub", "leads"], queryFn: () => hub<LeadsResp>("/leads") });
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("open");
  const [booking, setBooking] = useState<{ lead: Lead; serviceId: string } | null>(null);
  const inOwnTenant = (activeCompany() ?? "default") === "default";
  const setStatus = useMutation({
    mutationFn: (a: { id: string; status: string }) => hub(`/leads/${a.id}`, { method: "PATCH", body: { status: a.status } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["hub"] }),
  });
  const install = useMutation({
    mutationFn: () => hub<{ added: string[] }>("/leads/install", { method: "POST" }),
    onSuccess: (r) => {
      toast({ kind: "success", message: r.added.length ? `Added: ${r.added.join(", ")}.` : "Meeting types are already set up." });
      void qc.invalidateQueries({ queryKey: ["hub", "leads"] });
    },
  });
  const leads = useMemo(() => (q.data?.leads ?? []).filter((l) => (filter === "open" ? l.status === "new" || l.status === "contacted" : filter === "all" || l.status === filter)), [q.data, filter]);
  const d = q.data;
  return (
    <HubLayout title="Leads & sales" subtitle="Reply fast, then book the meeting, lunch or call on our own map. Reps are technicians in the ArrivePing account.">
      {q.isPending || !d ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            <div className="mb-4">
              <Segmented
                ariaLabel="Which leads"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "open", label: "To do" },
                  { value: "booked", label: "Booked" },
                  { value: "closed", label: "Closed" },
                  { value: "all", label: "All" },
                ]}
              />
            </div>
            {leads.length === 0 ? (
              <EmptyNote>No leads here. New ones arrive from the “contact me” card on arriveping.com.</EmptyNote>
            ) : (
              <ul className="space-y-3">
                {leads.map((l) => (
                  <li key={l.id} className="rounded-[20px] border border-white/[0.06] bg-white/[0.025] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-100">
                          {l.name}
                          {l.company && <span className="font-normal text-slate-400"> · {l.company}</span>}
                        </p>
                        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-400">
                          {l.email && (
                            <a href={`mailto:${l.email}`} className="inline-flex items-center gap-1 hover:text-slate-200">
                              <Mail className="h-3 w-3" aria-hidden="true" />
                              {l.email}
                            </a>
                          )}
                          {l.phone && (
                            <a href={`tel:${l.phone}`} className="inline-flex items-center gap-1 hover:text-slate-200">
                              <Phone className="h-3 w-3" aria-hidden="true" />
                              {l.phone}
                            </a>
                          )}
                          <span>
                            {fmt.ago(l.createdAt)} · from {l.source}
                          </span>
                        </p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLS[l.status] ?? STATUS_CLS.closed}`}>{STATUS_LABEL[l.status] ?? l.status}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {d.salesPack && d.services.length > 0 && (
                        <>
                          {d.services.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => (inOwnTenant ? setBooking({ lead: l, serviceId: s.id }) : switchCompany("default"))}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] font-semibold text-slate-200 hover:bg-white/[0.05]"
                            >
                              <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
                              {s.name}
                            </button>
                          ))}
                        </>
                      )}
                      <select
                        aria-label={`Status for ${l.name}`}
                        value={l.status}
                        onChange={(e) => setStatus.mutate({ id: l.id, status: e.target.value })}
                        className="ml-auto h-8 rounded-lg border border-white/10 bg-white/[0.03] px-2 text-[12px] text-slate-200"
                      >
                        {d.statuses.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s] ?? s}
                          </option>
                        ))}
                      </select>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-4">
            <Card title="Reps" caption="Technicians in the ArrivePing account.">
              {d.reps.length === 0 ? (
                <p className="text-[13px] text-slate-500">No reps yet. Add the people who take meetings under Workers & Managers in the ArrivePing account.</p>
              ) : (
                <ul className="space-y-1.5 text-[13px]">
                  {d.reps.map((r) => (
                    <li key={r.id} className="flex justify-between gap-2">
                      <span className="text-slate-200">{r.name}</span>
                      <span className="capitalize text-slate-500">{r.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Meeting types">
              {!d.salesPack ? (
                <p className="text-[13px] text-slate-500">The Sales pack is off for ArrivePing. Switch it on under Companies → ArrivePing → Features.</p>
              ) : d.missing.length ? (
                <div className="space-y-3">
                  <p className="text-[13px] text-slate-400">Add {d.missing.join(", ")} as services in the ArrivePing account so they can be booked.</p>
                  <button type="button" disabled={install.isPending} onClick={() => install.mutate()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-deep">
                    <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Set them up
                  </button>
                </div>
              ) : (
                <ul className="space-y-1 text-[13px] text-slate-300">
                  {d.services.map((s) => (
                    <li key={s.id} className="flex justify-between">
                      {s.name}
                      <span className="text-slate-500">{s.durationMins} min</span>
                    </li>
                  ))}
                </ul>
              )}
              {!inOwnTenant && <p className="mt-3 text-[12px] text-amber-300">You're looking at another company. Booking switches you back to ArrivePing first.</p>}
            </Card>
          </div>
        </div>
      )}
      {booking && (
        <WorkOrderModal
          open
          onClose={() => setBooking(null)}
          prefill={{
            customerName: booking.lead.name,
            customerEmail: booking.lead.email || undefined,
            phone: booking.lead.phone || undefined,
            serviceId: booking.serviceId,
            title: `${d?.services.find((s) => s.id === booking.serviceId)?.name ?? "Meeting"} with ${booking.lead.company || booking.lead.name}`,
            notes: booking.lead.company ? `Lead from arriveping.com (${booking.lead.company}).` : "Lead from arriveping.com.",
          }}
          onCreated={() => {
            setStatus.mutate({ id: booking.lead.id, status: "booked" });
            toast({ kind: "success", message: `Booked. ${booking.lead.name} gets a confirmation and a live ETA when the rep heads over.` });
          }}
        />
      )}
    </HubLayout>
  );
}
