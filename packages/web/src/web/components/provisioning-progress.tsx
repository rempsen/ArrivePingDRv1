import { useEffect, useMemo, useState } from "react";
import {
  Globe,
  Sparkles,
  BellRing,
  ClipboardList,
  ListChecks,
  Smile,
  Package,
  Layers,
  KeyRound,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { provisioningJoke } from "../../services/provisioning-jokes";

/**
 * PROVISIONING PROGRESS — the staged narrative shown while a new tenant is
 * being built (~1-2 real minutes). Replaces a static "Provisioning…"
 * spinner with a sequential, scrolling list of what's actually happening,
 * one ICP-tailored aside included, ending with the real seeded counts the
 * moment the API responds.
 *
 * Deliberately CLIENT-SIDE SIMULATED, not driven by real backend progress
 * events: `provisionCompany()` is one long synchronous call with no
 * checkpoint-reporting today, so this times through a script that mirrors
 * its real step order and holds + pulses on the last step if the real call
 * is still running, then snaps straight to the real summary the instant
 * `done` flips true. Nothing here blocks or depends on actual timing.
 */

export type ProvisioningSeeded = {
  forms: number;
  templates: number;
  services: number;
  catalogItems: number;
  optionCategories: number;
  notificationCopyBranded?: number;
};

const STAGE_MS = 7_000;

function buildStages(website: string | undefined, industryId: string | null | undefined) {
  const domain = website?.trim() ? website.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "") : "";
  return [
    { Icon: Globe, text: domain ? `Visiting ${domain} for brand assets…` : "Spinning up your workspace…" },
    { Icon: Sparkles, text: domain ? "Found your logo and colors…" : "Building your brand profile…" },
    { Icon: BellRing, text: "Setting up branded email & SMS alerts…" },
    { Icon: ClipboardList, text: "Building your intake forms…" },
    { Icon: ListChecks, text: "Creating your work-order templates…" },
    { Icon: Smile, text: provisioningJoke(industryId) },
    { Icon: Package, text: "Stocking your service catalog…" },
    { Icon: Layers, text: "Setting up good, better, best pricing tiers…" },
    { Icon: KeyRound, text: "Creating your admin login…" },
  ];
}

function finalLine(result: ProvisioningSeeded | null): string {
  if (!result) return "All set — your workspace is ready.";
  const bits: string[] = [];
  if (result.forms) bits.push(`${result.forms} intake form${result.forms === 1 ? "" : "s"}`);
  if (result.templates) bits.push(`${result.templates} work-order template${result.templates === 1 ? "" : "s"}`);
  if (result.catalogItems) bits.push(`${result.catalogItems} catalog item${result.catalogItems === 1 ? "" : "s"}`);
  if (result.optionCategories) bits.push(`${result.optionCategories} pricing tier${result.optionCategories === 1 ? "" : "s"}`);
  if (result.notificationCopyBranded) bits.push("branded alerts");
  if (!bits.length) return "All set — your workspace is ready.";
  return `All set — seeded ${bits.join(", ")}.`;
}

export function ProvisioningProgress({
  website,
  industryId,
  done,
  result,
  error,
}: {
  website?: string;
  industryId?: string | null;
  done: boolean;
  result: ProvisioningSeeded | null;
  error?: string | null;
}) {
  const stages = useMemo(() => buildStages(website, industryId), [website, industryId]);
  const [visibleCount, setVisibleCount] = useState(1);

  useEffect(() => {
    if (error) return;
    if (done) {
      setVisibleCount(stages.length + 1);
      return;
    }
    const id = setInterval(() => {
      setVisibleCount((n) => Math.min(n + 1, stages.length));
    }, STAGE_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, error, stages.length]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-red-500/10 text-red-400">
          <Sparkles className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium text-red-400">{error}</p>
      </div>
    );
  }

  const rows = done ? [...stages, { Icon: CheckCircle2, text: finalLine(result), isFinal: true as const }] : stages;
  const shown = rows.slice(0, visibleCount);

  return (
    <div className="space-y-1.5 py-2">
      {shown.map((row, i) => {
        const isLast = i === shown.length - 1;
        const isFinal = "isFinal" in row && row.isFinal;
        const isActive = isLast && !isFinal && !done;
        const isComplete = !isLast || isFinal;
        return (
          <div
            key={i}
            className={
              "animate-in fade-in slide-in-from-bottom-2 flex items-center gap-3 rounded-xl px-3 py-2.5 duration-300 " +
              (isFinal
                ? "border border-emerald-500/20 bg-emerald-500/10"
                : isActive
                  ? "bg-brand/10"
                  : "")
            }
          >
            <span
              className={
                "grid h-8 w-8 shrink-0 place-items-center rounded-full " +
                (isFinal
                  ? "bg-emerald-500/20 text-emerald-300"
                  : isActive
                    ? "bg-brand/20 text-cyan-glow"
                    : isComplete
                      ? "bg-white/5 text-emerald-400"
                      : "bg-white/5 text-slate-500")
              }
            >
              {isComplete && !isFinal ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : isActive ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <row.Icon className="h-4 w-4" />
              )}
            </span>
            <p
              className={
                "text-sm " +
                (isFinal ? "font-semibold text-emerald-200" : isActive ? "font-medium text-white" : "text-slate-500")
              }
            >
              {row.text}
            </p>
          </div>
        );
      })}
      {!done && visibleCount >= stages.length && (
        <p className="px-3 pt-1 text-xs text-slate-600">Almost there — finishing touches…</p>
      )}
    </div>
  );
}
