/**
 * Control Hub → Operations: buttons for the platform jobs that used to need a
 * developer (they existed only as API endpoints), plus links to the older
 * super-admin pages that still do their one job well.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Activity, Building2, KeyRound, Loader2, MailCheck, Play, RefreshCw, Rocket, ScanSearch, ShieldCheck } from "lucide-react";
import { Card } from "../analytics-ui";
import { HubLayout } from "./hub-ui";
import { hub } from "./hub-data";

interface Job {
  id: string;
  title: string;
  text: string;
  icon: typeof Play;
  method: "GET" | "POST";
  path: string;
  button: string;
  /** Turn the JSON answer into one plain sentence. */
  summarize: (r: any) => string;
}

const JOBS: Job[] = [
  {
    id: "demo",
    title: "Refresh the sales demo",
    text: "Move Prairie Comfort's jobs and vans to today now, instead of waiting for the next tick.",
    icon: RefreshCw,
    method: "POST",
    path: "/api/superadmin/demo-refresh",
    button: "Refresh now",
    summarize: (r) => (r?.health ? `Done. ${r.health.jobsToday ?? r.health.today ?? "Today's"} jobs ready.` : "Done."),
  },
  {
    id: "hubspot",
    title: "Check HubSpot",
    text: "Read-only: is the key valid, which scopes it has, and can it read each object we sync.",
    icon: ShieldCheck,
    method: "GET",
    path: "/api/superadmin/hubspot-check",
    button: "Run check",
    summarize: (r) => (r?.ok === false ? `Problem: ${r.error ?? "see details"}` : `OK${r?.portalId ? `, portal ${r.portalId}` : ""}.`),
  },
  {
    id: "google",
    title: "Check Google Maps",
    text: "One live call to each Maps API on the current key. The key itself is never shown.",
    icon: Activity,
    method: "GET",
    path: "/api/superadmin/google-smoke?key=current",
    button: "Run check",
    summarize: (r) => {
      const results = Array.isArray(r?.results) ? r.results : [];
      const bad = results.filter((x: any) => !x.ok).length;
      return results.length ? (bad ? `${bad} of ${results.length} APIs failed.` : `All ${results.length} APIs answered.`) : "Done.";
    },
  },
  {
    id: "rescan",
    title: "Re-read every company's website",
    text: "Refresh logos, colours and services from each company's own site. Takes a few minutes.",
    icon: ScanSearch,
    method: "POST",
    path: "/api/superadmin/companies/rescan-all",
    button: "Start",
    summarize: (r) => (typeof r?.scanned === "number" ? `Re-read ${r.scanned} sites.` : "Started."),
  },
  {
    id: "keys",
    title: "Fill in missing API keys",
    text: "Give every company that lacks one its default API key and public form key.",
    icon: KeyRound,
    method: "POST",
    path: "/api/superadmin/companies/backfill-keys",
    button: "Run",
    summarize: (r) => (typeof r?.created === "number" ? `Made ${r.created} keys.` : "Done."),
  },
];

export default function HubOps() {
  return (
    <HubLayout title="Operations" subtitle="Platform jobs you can run yourself. Each one is logged.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {JOBS.map((j) => (
          <JobCard key={j.id} job={j} />
        ))}
      </div>
      <h2 className="mb-3 mt-8 text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-500">Other tools</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <ToolLink href="/admin/companies" icon={Building2} title="Create a company by hand" text="With brand scouting, plus email-domain approvals." />
        <ToolLink href="/admin/mobile-release" icon={Rocket} title="Release iOS app" text="Build the iPhone and iPad app and submit it to the App Store." />
        <ToolLink href="/admin/analytics" icon={MailCheck} title="Analytics" text="Trials, conversion and churn, week by week." />
      </div>
    </HubLayout>
  );
}

function JobCard({ job }: { job: Job }) {
  const [out, setOut] = useState<{ ok: boolean; text: string; raw?: unknown } | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const run = useMutation({
    mutationFn: () => hub<unknown>(job.path, { method: job.method, body: job.method === "POST" ? {} : undefined }),
    onSuccess: (r) => setOut({ ok: true, text: job.summarize(r), raw: r }),
    onError: (e) => setOut({ ok: false, text: (e as Error).message }),
  });
  return (
    <Card title={job.title}>
      <p className="text-[13px] text-slate-400">{job.text}</p>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" disabled={run.isPending} onClick={() => run.mutate()} className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-[12px] font-semibold text-slate-100 hover:bg-white/[0.1] disabled:opacity-50">
          {run.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <job.icon className="h-3.5 w-3.5" aria-hidden="true" />}
          {run.isPending ? "Running…" : job.button}
        </button>
        {out && (
          <output className={`text-[12px] ${out.ok ? "text-emerald-300" : "text-rose-300"}`}>{out.text}</output>
        )}
      </div>
      {out?.raw !== undefined && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowRaw((v) => !v)} className="text-[11px] font-semibold text-slate-500 hover:text-slate-300">
            {showRaw ? "Hide details" : "Details"}
          </button>
          {showRaw && <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-black/30 p-3 text-[11px] text-slate-400">{JSON.stringify(out.raw, null, 2)}</pre>}
        </div>
      )}
    </Card>
  );
}

function ToolLink({ href, icon: Icon, title, text }: { href: string; icon: typeof Play; title: string; text: string }) {
  return (
    <Link href={href} className="flex gap-3 rounded-[20px] border border-white/[0.06] bg-white/[0.025] p-4 transition hover:border-white/[0.12]">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
      <span>
        <span className="block text-[14px] font-semibold text-slate-100">{title}</span>
        <span className="block text-[12px] text-slate-500">{text}</span>
      </span>
    </Link>
  );
}
