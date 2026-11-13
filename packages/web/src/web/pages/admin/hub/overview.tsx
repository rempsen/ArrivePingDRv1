/**
 * Control Hub → Overview: the command center. Headline numbers across real
 * customers, then a "needs attention" queue where every row has the button
 * that starts the fix, then what staff did lately.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, Clock, Inbox, Sparkles } from "lucide-react";
import { Card, Skeleton, Tile, fmt } from "../analytics-ui";
import { HubLayout, EmptyNote, useHubMe } from "./hub-ui";
import { StripeCard } from "./stripe-card";
import { hub, type AttentionItem, type Overview } from "./hub-data";

const SEV: Record<AttentionItem["severity"], { dot: string; label: string }> = {
  high: { dot: "bg-rose-400", label: "Urgent" },
  medium: { dot: "bg-amber-400", label: "Soon" },
  low: { dot: "bg-slate-500", label: "When you can" },
};

export default function HubOverview() {
  const q = useQuery({ queryKey: ["hub", "overview"], queryFn: () => hub<Overview>("/overview"), refetchInterval: 60_000 });
  const me = useHubMe();
  const k = q.data?.kpis;
  const loading = q.isPending;
  return (
    <HubLayout
      title="Every company, one place"
      subtitle="Customers, demos and our own account. Open any of them, switch what they get, or step in to help."
      actions={
        <Link href="/admin/hub/demos?new=1" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold text-white hover:bg-brand-deep">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Make a demo
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Monthly recurring revenue" value={fmt.money(k?.mrr)} sub={k ? `${fmt.int(k.paying)} paying · ${fmt.int(k.trialing)} on trial` : undefined} loading={loading} />
        <Tile label="Active customers" value={fmt.int(k?.activeTenants)} sub={k ? `of ${fmt.int(k.customers)} open accounts` : undefined} loading={loading} />
        <Tile label="Trials ending this week" value={fmt.int(k?.trialsEndingSoon)} sub={k ? `${fmt.int(k.signupsToday)} signed up today` : undefined} loading={loading} />
        <Tile label="Leads waiting" value={fmt.int(k?.openLeads)} sub={k ? `${fmt.int(k.demos)} demos running` : undefined} loading={loading} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden="true" />
              Needs attention
            </span>
          }
          caption="Most urgent first. Each one opens where you fix it."
          pad={false}
        >
          {loading ? (
            <div className="space-y-2 px-5 pb-5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (q.data?.attention.length ?? 0) === 0 ? (
            <div className="px-5 pb-5">
              <EmptyNote>Nothing needs you right now. Trials, payments, quiet accounts, leads and demos are all fine.</EmptyNote>
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {q.data!.attention.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${SEV[a.severity].dot}`} title={SEV[a.severity].label} aria-label={SEV[a.severity].label} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-slate-100">{a.title}</p>
                    <p className="truncate text-[12px] text-slate-500">{a.detail}</p>
                  </div>
                  <Link href={a.action.href} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] font-semibold text-slate-200 hover:border-white/20 hover:bg-white/[0.05]">
                    {a.action.label}
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <Clock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              Lately in the hub
            </span>
          }
          caption="Switches, settings, demos and act-as, by everyone on the team."
          action={
            <Link href="/admin/hub/audit" className="text-[12px] font-semibold text-cyan-300 hover:text-cyan-200">
              All activity
            </Link>
          }
        >
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : (q.data?.activity.length ?? 0) === 0 ? (
            <EmptyNote>
              <Inbox className="mx-auto mb-2 h-5 w-5 text-slate-600" aria-hidden="true" />
              No hub activity yet.
            </EmptyNote>
          ) : (
            <ol className="space-y-3">
              {q.data!.activity.map((e) => (
                <li key={e.id} className="text-[13px]">
                  <p className="text-slate-200">
                    <span className="font-semibold text-white">{e.actorName || "Someone"}</span> {e.summary}
                  </p>
                  <p className="text-[11px] text-slate-500">{fmt.ago(e.createdAt)}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {me.data?.can.seeAudit && (
        <div className="mt-6">
          <StripeCard />
        </div>
      )}

      {q.data?.scans && q.data.scans.total > 0 && <ScanHealthCard s={q.data.scans} />}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Shortcut href="/admin/hub/tenants" title="Companies" text="Search, filter and open any account." />
        <Shortcut href="/admin/hub/features" title="Feature Flags" text="Who has what switched on, and why." />
        <Shortcut href="/admin/analytics" title="Analytics" text="Growth, trials and churn week by week." />
      </div>
    </HubLayout>
  );
}

function Shortcut({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <Link href={href} className="group rounded-[20px] border border-white/[0.06] bg-white/[0.025] p-5 transition hover:border-white/[0.12] hover:bg-white/[0.04]">
      <p className="flex items-center justify-between text-[15px] font-semibold text-slate-100">
        {title}
        <ArrowRight className="h-4 w-4 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-slate-300" aria-hidden="true" />
      </p>
      <p className="mt-1 text-[13px] text-slate-500">{text}</p>
    </Link>
  );
}

const FAIL_WORDS: Record<string, string> = { blocked: "refused our visit", unreachable: "could not be reached", timeout: "too slow to answer", invalid_url: "not a web address" };

/** How often the website scan reads the site it is given, and which sites it could not. */
function ScanHealthCard({ s }: { s: NonNullable<Overview["scans"]> }) {
  const read = s.ok + s.partial;
  return (
    <div className="mt-6">
      <Card title="Website scans" caption={`Last ${s.days} days, every scan: signup, re-reads and checks.`}>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="text-3xl font-semibold tabular-nums tracking-tight text-white">{s.readPct ?? 0}%</p>
            <p className="text-[12px] text-slate-500">
              read the site ({read} of {s.total})
            </p>
          </div>
          <p className="text-[13px] text-slate-300">
            {s.viaRender} needed the hosted browser. {s.partial} had little on them. {s.failed} could not be read
            {s.failed
              ? `: ${Object.entries(s.byReason)
                  .map(([k, n]) => `${n} ${FAIL_WORDS[k] ?? k}`)
                  .join(", ")}.`
              : "."}
          </p>
        </div>
        {s.recentFailures.length > 0 && (
          <ul className="mt-4 divide-y divide-white/[0.05] border-t border-white/[0.05] text-[12px]">
            {s.recentFailures.map((f) => (
              <li key={f.host} className="flex items-center gap-3 py-1.5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-slate-200">{f.host}</span>
                <span className="shrink-0 text-slate-500">{FAIL_WORDS[f.status] ?? f.status}</span>
                <span className="w-20 shrink-0 text-right tabular-nums text-slate-500">{fmt.ago(f.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
