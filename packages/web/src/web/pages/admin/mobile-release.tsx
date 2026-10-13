import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiHeaders } from "../../lib/api";
import { PageWrap } from "../../components/brand";
import { PageHead } from "./shell";
import { BtnPrimary } from "../../components/modal";
import { Rocket, Loader2, CheckCircle2, XCircle, Circle } from "lucide-react";

type ReleaseStatus = {
  status: "idle" | "running" | "success" | "failed";
  startedAt: number | null;
  finishedAt: number | null;
  startedBy: string | null;
  exitCode: number | null;
  log: string;
};

const authHeaders = () => ({ ...apiHeaders(), "Content-Type": "application/json" });

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function jpost<T>(url: string): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: authHeaders() });
  if (!r.ok) throw new Error(await r.text());
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

export default function AdminMobileRelease() {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const statusQ = useQuery({
    queryKey: ["mobile-release-status"],
    queryFn: () => jget<ReleaseStatus>("/api/mobile-release/status"),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 4000 : 15000),
  });

  const data = statusQ.data;
  const meta = STATUS_META[data?.status ?? "idle"];
  const Icon = meta.icon;
  const running = data?.status === "running";

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [data?.log]);

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
          <div className="flex gap-5 text-xs text-slate-500">
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

        <pre
          ref={logRef}
          className="mt-4 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-slate-300"
        >
          {data?.log || "No release has run yet. Click \"Push to TestFlight\" to start one."}
        </pre>
      </div>
    </PageWrap>
  );
}
