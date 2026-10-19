/**
 * Control Hub → Companies: every account, searchable, with saved views for the
 * questions that come up every day (trials ending, payments failing, gone
 * quiet). A row opens the company's page.
 */
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Plus, Search } from "lucide-react";
import { Card, HealthPill, BillingText, Segmented, Skeleton, fmt, selectCls } from "../analytics-ui";
import { HubLayout, KindBadge, StatusText, EmptyNote, useHubTenants } from "./hub-ui";
import { PLAN_LABEL, type HubTenant, type TenantKind } from "./hub-data";

type KindFilter = "all" | TenantKind;
type View = "all" | "trials" | "pastdue" | "quiet" | "suspended" | "overrides";

const DAY = 86_400_000;
const VIEWS: { id: View; label: string; test: (t: HubTenant) => boolean }[] = [
  { id: "all", label: "Everyone", test: () => true },
  { id: "trials", label: "Trials ending this week", test: (t) => t.billingStatus === "trialing" && !!t.trialEndsAt && Date.parse(t.trialEndsAt) - Date.now() <= 7 * DAY && Date.parse(t.trialEndsAt) >= Date.now() },
  { id: "pastdue", label: "Payment failed", test: (t) => t.billingStatus === "past_due" || t.billingStatus === "unpaid" },
  { id: "quiet", label: "Gone quiet", test: (t) => t.health === "dormant" || t.health === "quiet" },
  { id: "suspended", label: "Suspended or closed", test: (t) => t.status !== "active" },
  { id: "overrides", label: "Has custom switches", test: (t) => t.overrides > 0 },
];

export default function HubTenants() {
  const q = useHubTenants();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [view, setView] = useState<View>("all");
  const [sort, setSort] = useState<"newest" | "name" | "jobs" | "active">("newest");

  const rows = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const test = VIEWS.find((v) => v.id === view)!.test;
    const out = (q.data?.tenants ?? []).filter(
      (t) => (kind === "all" || t.kind === kind) && test(t) && words.every((w) => `${t.name} ${t.id} ${t.city} ${t.industryLabel}`.toLowerCase().includes(w)),
    );
    const by: Record<typeof sort, (a: HubTenant, b: HubTenant) => number> = {
      newest: (a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
      name: (a, b) => a.name.localeCompare(b.name),
      jobs: (a, b) => b.jobs30 - a.jobs30,
      active: (a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""),
    };
    return out.sort(by[sort]);
  }, [q.data, search, kind, view, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, customer: 0, demo: 0, test: 0, internal: 0 };
    for (const t of q.data?.tenants ?? []) {
      c.all!++;
      c[t.kind] = (c[t.kind] ?? 0) + 1;
    }
    return c;
  }, [q.data]);

  return (
    <HubLayout
      title="Companies"
      subtitle="Search by name, city or industry. Open one to switch features, tune settings or step in as someone there."
      actions={
        <Link href="/admin/companies" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-[13px] font-semibold text-slate-200 hover:border-white/20 hover:bg-white/[0.05]">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          New company
        </Link>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">Search companies</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input aria-label="Search companies" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search companies…" className={`${selectCls} w-full pl-8`} />
        </label>
        <Segmented<KindFilter>
          ariaLabel="Kind of account"
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: `All ${counts.all ?? 0}` },
            { value: "customer", label: `Customers ${counts.customer ?? 0}` },
            { value: "demo", label: `Demos ${counts.demo ?? 0}` },
            { value: "test", label: `Test ${counts.test ?? 0}` },
          ]}
        />
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={selectCls}>
          <option value="newest">Newest first</option>
          <option value="name">Name</option>
          <option value="jobs">Most jobs (30 days)</option>
          <option value="active">Last active</option>
        </select>
      </div>
      <fieldset className="m-0 mb-4 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
        <legend className="sr-only">Saved views</legend>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => setView(v.id)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${view === v.id ? "bg-cyan-400/15 text-cyan-200" : "bg-white/[0.04] text-slate-400 hover:text-slate-200"}`}
          >
            {v.label}
          </button>
        ))}
      </fieldset>

      {q.isPending ? (
        <Skeleton className="h-72 w-full" />
      ) : rows.length === 0 ? (
        <EmptyNote>No companies match. Try another view or clear the search.</EmptyNote>
      ) : (
        <>
          <Card pad={false} className="hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-[13px]">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-3">Company</th>
                    <th className="px-3 py-3">Health</th>
                    <th className="px-3 py-3">Plan</th>
                    <th className="px-3 py-3 text-right">Techs</th>
                    <th className="px-3 py-3 text-right">Jobs 30d</th>
                    <th className="px-3 py-3">Last active</th>
                    <th className="px-3 py-3 text-right">Switches</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id} onClick={() => navigate(`/admin/hub/tenants/${t.id}`)} className="cursor-pointer border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03]">
                      <td className="px-5 py-3">
                        <Link href={`/admin/hub/tenants/${t.id}`} className="font-semibold text-slate-100 hover:text-white" onClick={(e) => e.stopPropagation()}>
                          {t.name}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                          <KindBadge kind={t.kind} />
                          <StatusText status={t.status} />
                          <span>{[t.industryLabel, t.city].filter(Boolean).join(" · ")}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <HealthPill health={t.health === "unknown" ? "dormant" : t.health} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-slate-200">{PLAN_LABEL[t.plan] ?? t.plan}</div>
                        <BillingText status={t.billingStatus} />
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-300">{fmt.int(t.techs)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-300">{fmt.int(t.jobs30)}</td>
                      <td className="px-3 py-3 text-slate-400">{fmt.ago(t.lastActive)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{t.overrides ? <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-200">{t.overrides}</span> : <span className="text-slate-600">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <ul className="space-y-2 md:hidden">
            {rows.map((t) => (
              <li key={t.id}>
                <Link href={`/admin/hub/tenants/${t.id}`} className="block rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-slate-100">{t.name}</p>
                    <HealthPill health={t.health === "unknown" ? "dormant" : t.health} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-slate-500">
                    <KindBadge kind={t.kind} />
                    <StatusText status={t.status} />
                    {t.city && <span>{t.city}</span>}
                    <span>· {fmt.int(t.techs)} techs · {fmt.int(t.jobs30)} jobs</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </HubLayout>
  );
}
