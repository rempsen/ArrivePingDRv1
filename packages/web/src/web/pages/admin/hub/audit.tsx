/**
 * Control Hub → Audit: every hub action and every time staff opened a
 * company, across all companies, plus act-as sessions. Searchable and
 * exportable.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Download, Search } from "lucide-react";
import { Card, Segmented, Skeleton, downloadCsv, fmt, selectCls } from "../analytics-ui";
import { HubLayout, EmptyNote, useHubTenants } from "./hub-ui";
import { hub, type AuditEntry, type Session } from "./hub-data";

const ACTIONS: { value: string; label: string }[] = [
  { value: "", label: "Everything" },
  { value: "feature", label: "Feature switches" },
  { value: "tenant", label: "Company changes" },
  { value: "actas", label: "Act-as" },
  { value: "demo", label: "Demos" },
  { value: "lead", label: "Leads" },
  { value: "team", label: "Team" },
];

export default function HubAudit() {
  const [action, setAction] = useState("");
  const [company, setCompany] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"log" | "sessions">("log");
  const tenants = useHubTenants();
  const qs = new URLSearchParams({ ...(action ? { action } : {}), ...(company ? { company } : {}), ...(search.trim() ? { q: search.trim() } : {}), limit: "300" });
  const q = useQuery({ queryKey: ["hub", "audit", qs.toString()], queryFn: () => hub<{ entries: AuditEntry[]; sessions: Session[] }>(`/audit?${qs}`) });
  const name = new Map((tenants.data?.tenants ?? []).map((t) => [t.id, t.name]));
  return (
    <HubLayout
      title="Audit"
      subtitle="Who did what, where and when, across every company."
      actions={
        <button
          type="button"
          disabled={!q.data?.entries.length}
          onClick={() =>
            downloadCsv(
              `control-hub-audit-${new Date().toISOString().slice(0, 10)}.csv`,
              (q.data?.entries ?? []).map((e) => ({ when: e.createdAt, who: e.actorName, action: e.action, company: name.get(e.companyId) ?? e.companyId, what: e.summary })),
            )
          }
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-[13px] font-semibold text-slate-200 hover:bg-white/[0.05] disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          CSV
        </button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented ariaLabel="View" value={view} onChange={setView} options={[{ value: "log", label: "Activity" }, { value: "sessions", label: "Act-as sessions" }]} />
        {view === "log" && (
          <>
            <select aria-label="Kind of action" value={action} onChange={(e) => setAction(e.target.value)} className={selectCls}>
              {ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
            <select aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)} className={`${selectCls} max-w-[16rem]`}>
              <option value="">All companies</option>
              {(tenants.data?.tenants ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <label className="relative min-w-[12rem] flex-1">
              <span className="sr-only">Search</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              <input aria-label="Search the audit log" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className={`${selectCls} w-full pl-8`} />
            </label>
          </>
        )}
      </div>
      {q.isPending ? (
        <Skeleton className="h-80 w-full" />
      ) : view === "log" ? (
        (q.data?.entries.length ?? 0) === 0 ? (
          <EmptyNote>Nothing matches.</EmptyNote>
        ) : (
          <Card pad={false}>
            <ol className="divide-y divide-white/[0.05]">
              {q.data!.entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 text-[13px]">
                  <span className="w-28 shrink-0 text-[12px] text-slate-500">{fmt.ago(e.createdAt)}</span>
                  <span className="min-w-0 flex-1 text-slate-200">
                    <span className="font-semibold text-white">{e.actorName || "Someone"}</span> {e.summary}
                  </span>
                  {e.companyId && (
                    <Link href={`/admin/hub/tenants/${e.companyId}`} className="text-[12px] text-cyan-300 hover:text-cyan-200">
                      {name.get(e.companyId) ?? e.companyId}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        )
      ) : (q.data?.sessions.length ?? 0) === 0 ? (
        <EmptyNote>Nobody has signed in as anyone yet.</EmptyNote>
      ) : (
        <Card pad={false}>
          <ul className="divide-y divide-white/[0.05]">
            {q.data!.sessions.map((s) => (
              <li key={s.id} className="px-5 py-3 text-[13px]">
                <p className="text-slate-200">
                  <span className="font-semibold text-white">{s.actorName}</span> as {s.targetName} at{" "}
                  <Link href={`/admin/hub/tenants/${s.companyId}`} className="text-cyan-300 hover:text-cyan-200">
                    {name.get(s.companyId) ?? s.companyId}
                  </Link>
                </p>
                <p className="text-[12px] text-slate-500">
                  “{s.reason}” · {fmt.ago(s.startedAt)} · {s.endedAt ? `ended (${s.endedReason === "exit" ? "signed out" : s.endedReason})` : "open"}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </HubLayout>
  );
}
