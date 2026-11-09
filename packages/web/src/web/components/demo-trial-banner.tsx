import { Link } from "wouter";
import { Rocket } from "lucide-react";
import { useAccess } from "../hooks/use-access";

/**
 * The strip across a demo account (Control Hub demos): the prospect can make it
 * their real account by starting the 30-day free trial from Settings → Billing
 * (POST /api/billing/trial/confirm converts the demo). Only admins can start it.
 */
export function DemoTrialBanner() {
  const { access, isAdmin } = useAccess();
  if (access?.tenantKind !== "demo" || !isAdmin) return null;
  return (
    <section
      aria-label="Free trial"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-cyan-400/20 bg-cyan-400/[0.07] px-4 py-2.5 text-sm md:px-6"
    >
      <Rocket className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-slate-200">
        <span className="font-semibold text-white">Like what you see?</span>{" "}
        <span className="text-slate-300">Start your 30-day free trial to make this your own account. Nothing is charged for 30 days.</span>
      </p>
      <Link
        href="/admin/settings?section=billing"
        className="rounded-lg bg-cyan-400 px-3 py-1.5 font-semibold text-slate-900 hover:bg-cyan-300"
      >
        Start free trial
      </Link>
    </section>
  );
}
