/**
 * Control Hub bars across the top of the dashboard:
 *  - ActAsBanner: orange, on every page while ArrivePing support is signed in
 *    as one of the company's people, with the time left and a one-click exit.
 *  - StaffBar: quiet, when NVC360 staff open another company as themselves,
 *    with the way back to the Control Hub.
 */
import { useEffect, useState } from "react";
import { LayoutGrid, LifeBuoy, LogOut } from "lucide-react";
import { leaveActAs } from "../lib/act-as";
import { useBrand } from "../lib/use-brand";
import { toast } from "./toast";

function left(expiresAt: string) {
  const ms = Date.parse(expiresAt) - Date.now();
  if (ms <= 0) return "time's up";
  const m = Math.ceil(ms / 60_000);
  return `${m} min left`;
}

export function ActAsBanner({ session }: { session: { targetName: string; actorName: string; reason: string; expiresAt: string } }) {
  const brand = useBrand();
  const [, tick] = useState(0);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div aria-live="polite" className="sticky top-0 z-40 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-orange-300/30 bg-orange-500 px-4 py-2 text-[13px] text-white shadow-lg md:top-0">
      <LifeBuoy className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <strong>Acting as {session.targetName}</strong> at {brand.name} · {left(session.expiresAt)}
        <span className="hidden text-orange-100 lg:inline"> · “{session.reason}” · billing, payouts, keys and passwords are locked</span>
      </span>
      <button
        type="button"
        disabled={leaving}
        onClick={() => {
          setLeaving(true);
          void leaveActAs();
        }}
        className="inline-flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1 text-[12px] font-bold text-orange-700 hover:bg-white"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        {leaving ? "Leaving…" : "Exit"}
      </button>
    </div>
  );
}

/** Show the notice left behind when act-as ended on its own (lib/act-as.ts). */
export function useActAsNotice() {
  useEffect(() => {
    try {
      const msg = sessionStorage.getItem("act_as_notice");
      if (msg) {
        sessionStorage.removeItem("act_as_notice");
        setTimeout(() => toast({ kind: "info", message: msg }), 300);
      }
    } catch {
      /* ignore */
    }
  }, []);
}

export function StaffBar() {
  const brand = useBrand();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-cyan-400/20 bg-cyan-500/10 px-4 py-2 text-[13px] text-cyan-100">
      <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        You're viewing <strong>{brand.name}</strong> as ArrivePing staff. Anything you change here is changed for them, under your name.
      </span>
      <button
        type="button"
        onClick={() => {
          localStorage.setItem("active_company", "default");
          window.location.assign("/admin/hub");
        }}
        title="Switch back to the ArrivePing account"
        className="rounded-lg border border-cyan-300/30 px-3 py-1 text-[12px] font-semibold text-cyan-100 hover:bg-cyan-400/10"
      >
        Back to Control Hub
      </button>
    </div>
  );
}
