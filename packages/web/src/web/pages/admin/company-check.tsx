import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ScanSearch, Check, AlertTriangle, Info, RefreshCw } from "lucide-react";
import { api } from "../../lib/api";
import { BtnPrimary } from "../../components/modal";
import { cn } from "../../lib/utils";

/* Company data check — Settings → Company.
 * Runs the server-side check (website + any enabled second source), shows a
 * line-by-line diff against the current profile, and applies only the rows
 * the admin ticks. Mirrors the BMD Materials dry run that set the standard. */

type Item = {
  key: string;
  group: "profile" | "socials" | "services" | "team";
  kind: "fill" | "conflict" | "add";
  label: string;
  current: string | null;
  proposed: string;
  source: string;
  note?: string;
};
type Result = {
  website: string;
  checkedAt: string;
  sources: string[];
  bookableCount: number;
  items: Item[];
  notes: string[];
  warnings: string[];
};

const GROUP_LABEL: Record<Item["group"], string> = {
  profile: "Business profile",
  socials: "Social links",
  services: "Bookable services",
  team: "Team",
};
const KIND: Record<Item["kind"], { label: string; cls: string; defaultOn: boolean }> = {
  fill: { label: "Missing", cls: "bg-emerald-500/15 text-emerald-300", defaultOn: true },
  add: { label: "New", cls: "bg-brand/15 text-brand", defaultOn: true },
  conflict: { label: "Differs", cls: "bg-amber-500/15 text-amber-300", defaultOn: false },
};

function short(s: string | null, n = 90) {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function CompanyCheckCard() {
  const qc = useQueryClient();
  const [result, setResult] = useState<Result | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<{ applied: string[]; skipped: { key: string; reason: string }[] } | null>(null);

  const run = useMutation({
    mutationFn: async () => {
      const res = await (api.settings as any).check.$post();
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Check failed");
      return (await res.json()) as Result;
    },
    onSuccess: (r) => {
      setResult(r);
      setDone(null);
      // Pre-tick the safe rows: fills always; new services only when the
      // tenant has none yet (otherwise near-duplicates sneak in). Conflicts
      // always need a human.
      setPicked(new Set(r.items.filter((i) => (i.kind === "add" ? r.bookableCount === 0 : KIND[i.kind].defaultOn)).map((i) => i.key)));
    },
  });

  const apply = useMutation({
    mutationFn: async () => {
      const picks = (result?.items ?? []).filter((i) => picked.has(i.key)).map((i) => ({ key: i.key, value: i.proposed }));
      const res = await (api.settings as any).check.apply.$post({ json: { picks } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Apply failed");
      return (await res.json()) as { applied: string[]; skipped: { key: string; reason: string }[] };
    },
    onSuccess: (r) => {
      setDone(r);
      const appliedSet = new Set(r.applied);
      setResult((prev) => (prev ? { ...prev, items: prev.items.filter((i) => !appliedSet.has(i.key)) } : prev));
      setPicked(new Set());
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["tenant-brand"] });
      qc.invalidateQueries({ queryKey: ["services"] });
    },
  });

  const toggle = (k: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const groups = (["profile", "socials", "services", "team"] as Item["group"][])
    .map((g) => ({ g, items: (result?.items ?? []).filter((i) => i.group === g) }))
    .filter((x) => x.items.length > 0);

  return (
    <div className="nvc-card space-y-4 p-5" data-testid="company-check">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-bold text-white">
            <ScanSearch className="h-4 w-4 text-brand" /> Company data check
          </h3>
          <p className="mt-1 text-xs text-white/50">
            Re-reads your website{result?.sources.length ? ` (${result.sources.join(" + ")})` : ""} and compares it with what's here — phone, address, socials, services. You pick what to apply; nothing changes on its own.
          </p>
        </div>
        <button
          type="button"
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/[0.08] disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", run.isPending && "animate-spin")} />
          {run.isPending ? "Checking… (30–60 s)" : result ? "Run again" : "Run check"}
        </button>
      </div>

      {run.isError && (
        <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {(run.error as Error).message}
        </p>
      )}

      {result && (
        <div className="space-y-4">
          {result.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
            </p>
          ))}

          {result.items.length === 0 && !done && (
            <p className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
              <Check className="h-4 w-4" /> Everything we could find already matches your profile.
            </p>
          )}

          {groups.map(({ g, items }) => (
            <div key={g} className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-white/40">{GROUP_LABEL[g]}</div>
              <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10">
                {items.map((it) => (
                  <li key={it.key} className={cn("flex gap-3 px-3 py-2.5", picked.has(it.key) && "bg-brand/[0.05]")}>
                    <input
                      type="checkbox"
                      aria-label={`Apply ${it.label}: ${it.proposed}`}
                      checked={picked.has(it.key)}
                      onChange={() => toggle(it.key)}
                      className="mt-1 h-4 w-4 shrink-0 accent-brand"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-white">{it.label}</span>
                        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", KIND[it.kind].cls)}>{KIND[it.kind].label}</span>
                        <span className="text-[11px] text-white/40">via {it.source}</span>
                      </div>
                      <div className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                        {it.kind !== "add" && (
                          <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-wide text-white/35">ArrivePing has</div>
                            <div className="break-words text-white/60" title={it.current ?? ""}>{short(it.current, 140)}</div>
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="text-[10px] uppercase tracking-wide text-white/35">Found</div>
                          {it.key === "settings.logo" ? (
                            <img src={it.proposed} alt="Found logo" className="mt-1 h-8 max-w-[140px] rounded bg-white/90 object-contain p-1" />
                          ) : (
                            <div className="break-words text-white" title={it.proposed}>{short(it.proposed, 140)}</div>
                          )}
                        </div>
                      </div>
                      {it.note && <div className="text-xs text-white/45">{it.note}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {result.items.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-white/50">
                {picked.size} of {result.items.length} selected · “Differs” rows are unticked on purpose — check which value is right before applying.
                {result.bookableCount > 0 && result.items.some((i) => i.group === "services") && " New services are unticked too — tick the ones you actually offer."}
                {result.items.some((i) => i.group === "services") && (
                  <> New services land at $0 / 60 min — set prices under <Link href="/admin/services" className="text-brand hover:underline">Services</Link>.</>
                )}
              </div>
              <BtnPrimary disabled={apply.isPending || picked.size === 0} onClick={() => apply.mutate()}>
                <Check className="h-4 w-4" /> {apply.isPending ? "Applying…" : `Apply ${picked.size || ""}`.trim()}
              </BtnPrimary>
            </div>
          )}
          {apply.isError && (
            <p className="text-xs text-red-300">{(apply.error as Error).message}</p>
          )}
          {done && (
            <p className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Applied {done.applied.length} change{done.applied.length === 1 ? "" : "s"}.
              {done.skipped.length > 0 && <> Skipped {done.skipped.length}: {done.skipped.map((s) => `${s.key} (${s.reason})`).join(", ")}.</>}
            </p>
          )}

          {result.notes.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-white/40">Notes</div>
              {result.notes.map((n, i) => (
                <p key={i} className="flex items-start gap-2 text-xs text-white/60">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/40" /> {n}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
