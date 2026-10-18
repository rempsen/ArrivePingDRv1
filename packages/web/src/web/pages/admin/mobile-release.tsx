import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiHeaders } from "../../lib/api";
import { PageWrap } from "../../components/brand";
import { PageHead } from "./shell";
import { BtnPrimary } from "../../components/modal";
import { Rocket, Loader2, CheckCircle2, XCircle, Circle, ExternalLink } from "lucide-react";

type Step = { name: string; status: string; conclusion: string | null };
type ReleaseStatus = {
  status: "idle" | "running" | "success" | "failed";
  steps: Step[];
  startedAt: number | null;
  finishedAt: number | null;
  startedBy: string | null;
  htmlUrl: string | null;
};

const authHeaders = () => ({ ...apiHeaders(), "Content-Type": "application/json" });

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function jpost<T>(url: string): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: authHeaders() });
  if (!r.ok) {
    const text = await r.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      /* not JSON: show it as is */
    }
    throw new Error(message);
  }
  return r.json();
}

function fmtTime(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_META: Record<ReleaseStatus["status"], { label: string; color: string; icon: typeof Circle }> = {
  idle: { label: "Idle", color: "text-slate-400", icon: Circle },
  running: { label: "Building & submitting…", color: "text-sky-400", icon: Loader2 },
  success: { label: "Submitted to App Store Connect", color: "text-emerald-400", icon: CheckCircle2 },
  failed: { label: "Failed", color: "text-red-400", icon: XCircle },
};

function StepRow({ step }: { step: Step }) {
  const done = step.status === "completed";
  const ok = done && step.conclusion === "success";
  const failed = done && step.conclusion && step.conclusion !== "success" && step.conclusion !== "skipped";
  const Icon = failed ? XCircle : ok ? CheckCircle2 : step.status === "in_progress" ? Loader2 : Circle;
  const color = failed ? "text-red-400" : ok ? "text-emerald-400" : step.status === "in_progress" ? "text-sky-400" : "text-slate-500";
  return (
    <div className="flex items-center gap-2 py-1.5 text-sm">
      <Icon className={`h-4 w-4 shrink-0 ${color} ${step.status === "in_progress" ? "animate-spin" : ""}`} />
      <span className={color === "text-slate-500" ? "text-slate-500" : "text-slate-200"}>{step.name}</span>
    </div>
  );
}

export default function AdminMobileRelease() {
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const statusQ = useQuery({
    queryKey: ["mobile-release-status"],
    queryFn: () => jget<ReleaseStatus>("/api/mobile-release/status"),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 5000 : 20000),
  });

  const data = statusQ.data;
  const meta = STATUS_META[data?.status ?? "idle"];
  const Icon = meta.icon;
  const running = data?.status === "running";

  async function handleStart() {
    setError(null);
    setStarting(true);
    try {
      await jpost("/api/mobile-release/start");
      await statusQ.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the release.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <PageWrap>
      <PageHead
        title="Push to TestFlight"
        subtitle="Build the iOS app and submit it to App Store Connect — no laptop, no terminal."
        actions={
          <BtnPrimary onClick={handleStart} disabled={running || starting}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            {running ? "Running…" : "Push to TestFlight"}
          </BtnPrimary>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className={`flex items-center gap-2 text-sm font-semibold ${meta.color}`}>
            <Icon className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
            {meta.label}
          </div>
          <div className="flex flex-wrap gap-5 text-xs text-slate-500">
            <span>Started: {fmtTime(data?.startedAt ?? null)}</span>
            <span>Finished: {fmtTime(data?.finishedAt ?? null)}</span>
            {data?.startedBy && <span>By: {data.startedBy}</span>}
          </div>
        </div>

        <p className="mt-3 text-sm text-slate-400">
          This takes 10–20 minutes end to end: the build runs on Expo's servers, then the finished
          build is uploaded to App Store Connect automatically. Once it's done, finish on Apple's
          side: appstoreconnect.apple.com → ArrivePing → TestFlight → add yourself as a tester
          with the Apple ID signed into TestFlight on your iPhone, then install.
        </p>

        {data?.steps && data.steps.length > 0 && (
          <div className="mt-4 divide-y divide-white/5 rounded-lg border border-white/10 bg-black/20 px-3">
            {data.steps.map((s) => (
              <StepRow key={s.name} step={s} />
            ))}
          </div>
        )}

        {!data?.steps?.length && data?.status === "idle" && (
          <p className="mt-4 text-sm text-slate-500">No release has run yet. Click "Push to TestFlight" to start one.</p>
        )}

        {data?.htmlUrl && (
          <a
            href={data.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-sky-400 hover:text-sky-300"
          >
            View full output on GitHub <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </PageWrap>
  );
}
