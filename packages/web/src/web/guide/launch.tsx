import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight, Rocket } from "lucide-react";
import { useAuth } from "../hooks/use-auth";
import { apiFetch, apiHeaders } from "../lib/api";
import { useGuide } from "./GuideProvider";
import type { LaunchChecklist } from "../../shared/launch-items";

export { LAUNCH_ITEMS, SETUP_LABELS } from "../../shared/launch-items";
export type { LaunchChecklist, LaunchItemId, SetupItemId } from "../../shared/launch-items";

export const LAUNCH_KEY = ["launch-checklist"] as const;

/** Admins only (the endpoint is too). Refreshes on focus and every 15 s, so a tick lands soon after the real action. */
export function useLaunchChecklist() {
  const { role } = useAuth();
  const isAdmin = role === "admin" || role === "superadmin";
  return useQuery({
    queryKey: LAUNCH_KEY,
    queryFn: async () => {
      const res = await apiFetch("/api/onboarding/checklist", { headers: apiHeaders() });
      return (await res.json()) as LaunchChecklist;
    },
    enabled: isAdmin,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

export function ProgressRing({ done, total, size = 36 }: { done: number; total: number; size?: number }) {
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-white/10" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        className={pct >= 1 ? "text-emerald-live transition-[stroke-dashoffset]" : "text-brand transition-[stroke-dashoffset]"}
      />
    </svg>
  );
}

/** Sidebar card above Guide & help: the ring and "n of 5", linking to the full page. */
export function LaunchChecklistCard() {
  const q = useLaunchChecklist();
  const { state } = useGuide();
  const data = q.data;
  if (!data || state?.checklistHidden) return null;
  const done = data.items.filter((i) => i.done).length;
  return (
    <Link
      href="/admin/getting-started"
      data-tour="launch.card"
      className="mb-2 flex items-center gap-3 rounded-[0.75rem] bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.06]"
    >
      <span className="relative grid place-items-center">
        <ProgressRing done={done} total={data.items.length} />
        <Rocket className="absolute h-3.5 w-3.5 text-slate-300" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-100">{data.complete ? "You're ready to go live" : "Get ready to launch"}</span>
        <span className="block text-[11px] tabular-nums text-slate-500">
          {done} of {data.items.length} done
        </span>
      </span>
      <ChevronRight className="h-4 w-4 text-slate-600" aria-hidden="true" />
    </Link>
  );
}
