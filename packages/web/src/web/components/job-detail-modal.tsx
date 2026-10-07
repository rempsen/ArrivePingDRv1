// ─── Job detail (read-only, landscape) ──────────────────────────────────────
// Opened by tapping a row on the Jobs list. Shows everything about a job at a
// glance in a wide, compact layout — customer, schedule/timeline, technician,
// pricing, notes — instead of dropping the dispatcher straight into the tall
// edit form. "Edit" hands off to the existing WorkOrderModal; "Report" goes to
// the completed-job report page.
import { useQuery } from "@tanstack/react-query";
import {
  Pencil, ClipboardList, UserPlus, Phone, Mail, MapPin, Clock, Receipt,
  User, Wrench, FileText, Loader2, DollarSign, Route as RouteIcon,
} from "lucide-react";
import { Modal, BtnPrimary, BtnGhost } from "./modal";
import { StatusBadge } from "./brand";
import { AutoBadge } from "./auto-badge";
import { TechAvatar } from "./tech-avatar";
import { apiHeaders } from "../lib/api";
import { fmtDate, money, PRIORITY_META } from "../lib/utils";
import { useWorkerNoun, useCustomerNoun, useJobNoun } from "../lib/use-brand";

type Report = {
  id: string;
  jobNumber: string;
  title: string | null;
  status: string;
  priority: string | null;
  service: string;
  address: string | null;
  region: string | null;
  notes: string | null;
  customer: { id: string; name: string | null; phone: string | null; email: string | null } | null;
  technician: { id: string; name: string | null; phone: string | null; photoUrl: string | null; vehicle: string | null } | null;
  timeline: Record<"scheduledAt" | "assignedAt" | "acceptedAt" | "enrouteAt" | "startedAt" | "finishedAt" | "createdAt", string | number | null>;
  transitMinutes: number | null;
  onSiteMinutes: number | null;
  mileageKm: number | null;
  photos: { id: string; url: string; caption: string | null }[];
  pricing: {
    /** `price` is the extended line total; `unitPrice` the per-unit figure */
    lineItems: { qty?: number; name?: string; price?: number; unitPrice?: number }[];
    subtotal: number | null;
    taxAmount: number | null;
    taxLabel: string | null;
    total: number | null;
    paymentStatus: string | null;
  };
  techPay: { total: number | null };
};

async function jget<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: apiHeaders() });
  if (!res.ok) throw new Error(`request failed (${res.status})`);
  return res.json();
}

function fmtMins(m: number | null | undefined): string {
  if (m == null) return "—";
  if (m < 60) return `${Math.round(m)} min`;
  return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
}

function Section({ title, icon, children, className = "" }: { title: string; icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-white/[0.06] bg-white/[0.03] p-3.5 ${className}`}>
      <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        <span className="text-brand">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={`min-w-0 truncate text-right text-slate-200 ${mono ? "font-mono tabular-nums text-[13px]" : ""}`}>
        {children}
      </span>
    </div>
  );
}

const PAY_META: Record<string, { label: string; cls: string }> = {
  paid: { label: "Paid", cls: "bg-emerald-500/15 text-emerald-300" },
  unpaid: { label: "Unpaid", cls: "bg-amber-500/15 text-amber-300" },
  pending: { label: "Pending", cls: "bg-amber-500/15 text-amber-300" },
  refunded: { label: "Refunded", cls: "bg-slate-500/20 text-slate-300" },
  invoiced: { label: "Invoiced", cls: "bg-sky-500/15 text-sky-300" },
};

export function JobDetailModal({
  job,
  open,
  onClose,
  onEdit,
  onAssign,
  onReport,
  editLoading = false,
}: {
  /** the row object from the Jobs list (`/api/jobs/search`) */
  job: any | null;
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
  onAssign?: () => void;
  onReport?: () => void;
  /** true while the parent fetches the full booking for the editor */
  editLoading?: boolean;
}) {
  const { noun: workerNoun } = useWorkerNoun();
  const { noun: customerNoun } = useCustomerNoun();
  const { noun: jobNoun } = useJobNoun();

  const id: string | undefined = job?.id;
  const rq = useQuery({
    queryKey: ["job-report", id],
    queryFn: () => jget<Report>(`/api/jobs/${id}/report`),
    enabled: open && !!id,
    staleTime: 15_000,
  });
  const r = rq.data;

  if (!job) return null;

  // The list row already carries most of it; the report fills in line items,
  // timeline, and the technician's phone/photo/vehicle once it lands.
  const status: string = r?.status ?? job.status;
  const priority: string | null = r?.priority ?? job.priority ?? null;
  const pm = priority ? PRIORITY_META[priority] : undefined;
  const title: string = r?.title || job.title || job.service || job.jobNumber;
  const service: string = r?.service || job.service || "";
  const address: string = r?.address ?? job.address ?? "";
  const region: string = r?.region ?? job.region ?? "";
  const notes: string = r?.notes ?? job.notes ?? "";
  const cust = r?.customer ?? {
    name: job.customerName,
    phone: job.customerPhone,
    email: job.customerEmail,
  };
  const tech = r?.technician ?? (job.riderId
    ? { name: job.technician, phone: null, photoUrl: null, vehicle: null }
    : null);
  const tl = r?.timeline;
  const scheduledAt = tl?.scheduledAt ?? job.scheduledAt;
  const startedAt = tl?.startedAt ?? job.startedAt;
  const finishedAt = tl?.finishedAt ?? job.completedAt;
  const createdAt = tl?.createdAt ?? job.createdAt;

  const lineItems = r?.pricing.lineItems ?? [];
  const subtotal = r?.pricing.subtotal ?? job.subtotal;
  const taxAmount = r?.pricing.taxAmount ?? job.taxAmount;
  const taxLabel = r?.pricing.taxLabel ?? job.taxLabel;
  const total = r?.pricing.total ?? job.total;
  const paymentStatus: string | null = r?.pricing.paymentStatus ?? job.paymentStatus ?? null;
  const techPay = r?.techPay.total ?? job.techPay;
  const pay = paymentStatus ? PAY_META[paymentStatus] ?? { label: paymentStatus, cls: "bg-white/10 text-slate-300" } : null;

  const transit = r?.transitMinutes ?? job.transitMinutes;
  const onSite = r?.onSiteMinutes ?? job.onSiteMinutes;
  const mileage = r?.mileageKm ?? job.mileageKm;
  const started = !!startedAt || status === "in_progress" || status === "onsite" || status === "completed";
  const hasActuals = started || Number(transit) > 0 || Number(onSite) > 0 || Number(mileage) > 0;

  const canAssign = !!onAssign && (status === "pending" || status === "confirmed" || status === "unassigned");
  const isDone = status === "completed";
  const isCancelled = status === "cancelled";

  const mapsHref = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={title}
      subtitle={[job.jobNumber, service].filter(Boolean).join(" · ")}
      footer={
        <>
          {rq.isFetching && (
            <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading details…
            </span>
          )}
          <BtnGhost onClick={onClose}>Close</BtnGhost>
          {canAssign && (
            <button
              type="button"
              onClick={onAssign}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-brand/40 px-4 text-sm font-semibold text-brand hover:bg-brand/10"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" /> Assign {workerNoun.toLowerCase()}
            </button>
          )}
          {isDone && onReport && (
            <BtnGhost onClick={onReport}>
              <ClipboardList className="mr-1.5 h-4 w-4" aria-hidden="true" /> Report
            </BtnGhost>
          )}
          <BtnPrimary onClick={onEdit} disabled={editLoading}>
            {editLoading
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <Pencil className="h-4 w-4" aria-hidden="true" />}{" "}
            {editLoading ? "Opening…" : `Edit ${jobNoun.toLowerCase()}`}
          </BtnPrimary>
        </>
      }
    >
      {/* status strip */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={status} />
        {(job.autoAssignedRuleId || (r as any)?.autoAssignedRuleId) && (
          <span className="flex items-center gap-1.5 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-bold text-violet-300">
            <AutoBadge booking={{ autoAssignedRuleId: "1" }} size="xs" /> Auto-assigned
          </span>
        )}
        {pm && (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-bold"
            style={{ color: pm.color, background: `${pm.color}22` }}
          >
            {pm.label} priority
          </span>
        )}
        {pay && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${pay.cls}`}>{pay.label}</span>
        )}
        {scheduledAt && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-sm text-slate-300">
            <Clock className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            {fmtDate(scheduledAt)}
          </span>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {/* Customer */}
        <Section title={customerNoun} icon={<User className="h-3.5 w-3.5" />}>
          <p className="truncate text-base font-semibold text-white">{cust?.name || "—"}</p>
          <div className="mt-2 space-y-1.5 text-sm">
            {cust?.phone && (
              <a href={`tel:${cust.phone}`} className="flex items-center gap-2 text-slate-300 hover:text-white">
                <Phone className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                <span className="truncate">{cust.phone}</span>
              </a>
            )}
            {cust?.email && (
              <a href={`mailto:${cust.email}`} className="flex items-center gap-2 text-slate-300 hover:text-white">
                <Mail className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                <span className="truncate">{cust.email}</span>
              </a>
            )}
            {address && (
              <a
                href={mapsHref ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-2 text-slate-300 hover:text-white"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                <span className="leading-snug">
                  {address}
                  {region && <span className="block text-xs text-slate-500">{region}</span>}
                </span>
              </a>
            )}
          </div>
        </Section>

        {/* Technician */}
        <Section title={workerNoun} icon={<Wrench className="h-3.5 w-3.5" />}>
          {tech ? (
            <div className="flex items-center gap-3">
              <TechAvatar name={tech.name} photoUrl={tech.photoUrl} className="h-11 w-11 rounded-full" textClassName="text-sm" />
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-white">{tech.name || "—"}</p>
                {tech.phone && (
                  <a href={`tel:${tech.phone}`} className="block truncate text-sm text-slate-300 hover:text-white">{tech.phone}</a>
                )}
                {tech.vehicle && <p className="truncate text-xs text-slate-500">{tech.vehicle}</p>}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-slate-500">Unassigned</p>
              {canAssign && (
                <button
                  type="button"
                  onClick={onAssign}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-deep"
                >
                  <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> Assign
                </button>
              )}
            </div>
          )}
          {hasActuals && (
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/5 pt-3 text-center">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Transit</p>
                <p className="text-sm font-semibold text-slate-200">{fmtMins(transit)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">On site</p>
                <p className="text-sm font-semibold text-slate-200">{fmtMins(onSite)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Mileage</p>
                <p className="text-sm font-semibold text-slate-200">{mileage != null ? `${Number(mileage).toFixed(1)} km` : "—"}</p>
              </div>
            </div>
          )}
        </Section>

        {/* Timeline */}
        <Section title="Timeline" icon={<RouteIcon className="h-3.5 w-3.5" />}>
          <Row label="Created" mono>{createdAt ? fmtDate(createdAt) : "—"}</Row>
          <Row label="Scheduled" mono>{scheduledAt ? fmtDate(scheduledAt) : "—"}</Row>
          {tl?.assignedAt && <Row label="Assigned" mono>{fmtDate(tl.assignedAt)}</Row>}
          {tl?.acceptedAt && <Row label="Accepted" mono>{fmtDate(tl.acceptedAt)}</Row>}
          {tl?.enrouteAt && <Row label="En route" mono>{fmtDate(tl.enrouteAt)}</Row>}
          {startedAt && <Row label="Started" mono>{fmtDate(startedAt)}</Row>}
          {finishedAt && <Row label={isCancelled ? "Cancelled" : "Completed"} mono>{fmtDate(finishedAt)}</Row>}
        </Section>

        {/* Pricing */}
        <Section title="Pricing" icon={<Receipt className="h-3.5 w-3.5" />} className="md:col-span-2 xl:col-span-2">
          {lineItems.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="pb-1.5 font-semibold">Item</th>
                  <th className="pb-1.5 text-right font-semibold">Qty</th>
                  <th className="pb-1.5 text-right font-semibold">Price</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="py-1.5 text-slate-200">{li.name || "—"}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-slate-400">{li.qty ?? 1}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-slate-200">
                      {li.price != null
                        ? money(Number(li.price))
                        : li.unitPrice != null
                          ? money(Number(li.unitPrice) * Number(li.qty ?? 1))
                          : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-slate-500">
              {rq.isLoading ? "Loading line items…" : job.lineItemsText || "No line items."}
            </p>
          )}
          <div className="mt-2 border-t border-white/5 pt-2">
            {subtotal != null && <Row label="Subtotal" mono>{money(Number(subtotal))}</Row>}
            {taxAmount != null && Number(taxAmount) > 0 && (
              <Row label={taxLabel || "Tax"} mono>{money(Number(taxAmount))}</Row>
            )}
            <div className="flex items-baseline justify-between pt-1">
              <span className="text-sm font-semibold text-slate-300">Total</span>
              <span className="font-mono text-lg font-bold tabular-nums text-white">
                {total != null ? money(Number(total)) : "—"}
              </span>
            </div>
          </div>
        </Section>

        {/* Internal: tech pay + notes */}
        <div className="grid gap-3">
          <Section title={`${workerNoun} pay`} icon={<DollarSign className="h-3.5 w-3.5" />}>
            <p className="font-mono text-lg font-bold tabular-nums text-white">
              {techPay != null ? money(Number(techPay)) : "—"}
            </p>
            <p className="text-xs text-slate-500">Internal — not shown to the {customerNoun.toLowerCase()}.</p>
          </Section>
          <Section title="Notes" icon={<FileText className="h-3.5 w-3.5" />} className="flex-1">
            {notes ? (
              <p className="whitespace-pre-wrap text-sm leading-snug text-slate-300">{notes}</p>
            ) : (
              <p className="text-sm text-slate-500">No notes.</p>
            )}
          </Section>
        </div>
      </div>

      {r && r.photos.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Photos ({r.photos.length})
          </h3>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {r.photos.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="shrink-0">
                <img src={p.url} alt={p.caption || "Job photo"} className="h-20 w-20 rounded-lg object-cover" loading="lazy" />
              </a>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
