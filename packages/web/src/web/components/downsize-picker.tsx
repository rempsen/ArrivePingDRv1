import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Briefcase, CheckCircle2, Loader2, UserMinus } from "lucide-react";
import { apiHeaders } from "../lib/api";
import { DialogPanel } from "./dialog-panel";
import { cn, dismiss } from "../lib/utils";

/**
 * Settings → Billing → "Choose N users to deactivate".
 *
 * The tenant wants to pay for fewer users than count towards their plan, so
 * they pick exactly who comes off: field staff, or extra office users (one
 * dispatcher license is included, so at most `officeRemovable` of those).
 * Anyone with open jobs must have them moved or unassigned in the same step;
 * the confirm button stays off until the count is right and every selected
 * person is clear. One request does it all, and the confirm text says exactly
 * what will happen.
 */

export type SeatCandidate = {
  userId: string;
  /** null = an office user with no rider profile (can't take over jobs). */
  riderId: string | null;
  name: string;
  email: string;
  staffType: "driver" | "technician" | "office";
  /** Office users: "Dispatcher", "Manager"… */
  roleLabel: string | null;
  lastActiveAt: string | null;
  openJobs: number;
};

type ReassignChoice = string | null | undefined; // userId | unassign | not chosen

export function DownsizePicker({
  targetSeats,
  activeDrivers,
  activeOffice,
  includedOffice,
  billableUsers,
  nextInvoiceAt,
  monthlyTotal,
  noun,
  nounPlural,
  onClose,
  onDone,
}: {
  targetSeats: number;
  activeDrivers: number;
  activeOffice: number;
  includedOffice: number;
  /** activeDrivers + extra office users: what counts towards the plan now. */
  billableUsers: number;
  nextInvoiceAt: string | null;
  /** Monthly total at targetSeats, formatted by the caller. */
  monthlyTotal: string;
  noun: string;
  nounPlural: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const needed = Math.max(0, billableUsers - targetSeats);
  const [selected, setSelected] = useState<string[]>([]);
  const [reassign, setReassign] = useState<Record<string, ReassignChoice>>({});
  const [err, setErr] = useState("");

  const candidates = useQuery({
    queryKey: ["billing", "seat-candidates"],
    queryFn: async () => {
      const res = await fetch("/api/billing/seat-candidates", { headers: apiHeaders() });
      if (!res.ok) throw new Error("Couldn't load your team.");
      return (await res.json()) as { candidates: SeatCandidate[]; officeRemovable?: number };
    },
  });
  const list = useMemo(() => candidates.data?.candidates ?? [], [candidates.data]);
  const byId = useMemo(() => new Map(list.map((c) => [c.userId, c])), [list]);
  // One office user always stays (the included dispatcher license).
  const officeCap = candidates.data?.officeRemovable ?? 0;
  const officeCount = list.filter((c) => c.staffType === "office").length;
  const selectable = list.length - officeCount + Math.min(officeCount, officeCap);
  const officeSelected = selected.filter((id) => byId.get(id)?.staffType === "office").length;

  // If the roster changed under us, drop selections that no longer exist.
  useEffect(() => {
    setSelected((prev) => prev.filter((id) => byId.has(id)));
  }, [byId]);

  const toggle = (id: string) => {
    setErr("");
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= needed) return prev;
      if (byId.get(id)?.staffType === "office" && prev.filter((x) => byId.get(x)?.staffType === "office").length >= officeCap) return prev;
      return [...prev, id];
    });
    // Someone who is now being deactivated can't take over anyone's jobs.
    setReassign((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v === id ? undefined : v])));
  };

  const unresolved = selected.filter((id) => (byId.get(id)?.openJobs ?? 0) > 0 && reassign[id] === undefined);
  const ready = selected.length === needed && needed > 0 && unresolved.length === 0;
  const names = selected.map((id) => byId.get(id)?.name ?? id);
  const nameList = names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const unit = (n: number) => (n === 1 ? noun.toLowerCase() : nounPlural.toLowerCase());
  // With an extra office user on the plan, the people (and the plan) are "users".
  const extraOffice = activeOffice > includedOffice;
  const who = (n: number) => (extraOffice ? (n === 1 ? "user" : "users") : unit(n));
  const billDate = nextInvoiceAt ? ` on ${new Date(nextInvoiceAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}` : "";

  const confirm = useMutation({
    mutationFn: async () => {
      const body = {
        seats: targetSeats,
        deactivate: selected,
        reassign: Object.fromEntries(selected.filter((id) => reassign[id] !== undefined).map((id) => [id, reassign[id] ?? null])),
      };
      const res = await fetch("/api/billing/downsize", { method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      if (!res.ok) {
        if (data.code === "stale") {
          // The parent's `activeDrivers` (and so `needed`) comes from the billing
          // summary; refresh both so the next attempt sends current numbers.
          await Promise.all([candidates.refetch(), qc.invalidateQueries({ queryKey: ["billing", "summary"] })]);
          setSelected([]);
          setReassign({});
          throw new Error("Your team changed since this opened — the list has been refreshed, please choose again.");
        }
        throw new Error(data.message || "Something went wrong");
      }
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["billing"] }),
        qc.invalidateQueries({ queryKey: ["team"] }),
        qc.invalidateQueries({ queryKey: ["riders"] }),
      ]);
      onDone();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" {...dismiss(onClose)}>
      <DialogPanel onClose={onClose} label={`Choose ${needed} ${who(needed)} to deactivate`} className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-ink-2 shadow-2xl">
        <div className="border-b border-white/5 p-6">
          <h3 className="flex items-center gap-2 text-lg font-extrabold text-white">
            <UserMinus className="h-5 w-5 text-brand" /> Choose {needed} {who(needed)} to deactivate
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            You have {activeDrivers} active {unit(activeDrivers)}
            {activeOffice > 0 ? ` and ${activeOffice} office ${activeOffice === 1 ? "user" : "users"} (${includedOffice} included),` : ""} and want to pay
            for {targetSeats}. Deactivated {extraOffice ? "users" : nounPlural.toLowerCase()} keep their history and can be reactivated later; they
            can't sign in and don't count towards your bill.
          </p>
          <p className={cn("mt-3 text-sm font-semibold", selected.length === needed ? "text-emerald-live" : "text-white")}>
            {selected.length} of {needed} selected
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {candidates.isLoading && (
            <p className="flex items-center gap-2 p-3 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your team…
            </p>
          )}
          {candidates.isError && <p className="p-3 text-sm text-rose-300">Couldn't load your team. Close and try again.</p>}
          {list.map((c) => {
            const on = selected.includes(c.userId);
            const full = !on && (selected.length >= needed || (c.staffType === "office" && officeSelected >= officeCap));
            // Only someone with a rider profile can take over jobs.
            const others = list.filter((o) => o.userId !== c.userId && o.riderId && !selected.includes(o.userId));
            return (
              <div key={c.userId} className={cn("mb-2 rounded-xl border p-3 transition", on ? "border-brand/40 bg-brand/5" : "border-white/5 bg-ink", full && "opacity-50")}>
                <label className="flex cursor-pointer items-start gap-3" aria-label={`Deactivate ${c.name}`}>
                  <input type="checkbox" aria-label={`Deactivate ${c.name}`} checked={on} disabled={full} onChange={() => toggle(c.userId)} className="mt-1 h-4 w-4 accent-brand" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-white">{c.name}</span>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] capitalize text-slate-300">
                        {c.staffType === "office" ? (c.roleLabel ?? "Office") : c.staffType}
                      </span>
                      {c.openJobs > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-warn/30 bg-amber-warn/10 px-2 py-0.5 text-[11px] font-semibold text-amber-warn">
                          <Briefcase className="h-3 w-3" /> {c.openJobs} open {c.openJobs === 1 ? "job" : "jobs"}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      {/* Office users only have a "last active" if they take jobs on the app. */}
                      {c.staffType === "office" && !c.lastActiveAt ? c.email : `${c.email} · Last active ${relative(c.lastActiveAt)}`}
                    </p>
                  </div>
                </label>
                {on && c.openJobs > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3 text-sm">
                    <span className="text-slate-300">
                      Their {c.openJobs} open {c.openJobs === 1 ? "job" : "jobs"}:
                    </span>
                    <select
                      aria-label={`What happens to ${c.name}'s open jobs`}
                      className="h-9 rounded-lg border border-white/10 bg-ink-2 px-2 text-sm text-white"
                      value={reassign[c.userId] === undefined ? "" : reassign[c.userId] === null ? "__unassign" : (reassign[c.userId] as string)}
                      onChange={(e) => {
                        const v = e.target.value;
                        setReassign((prev) => ({ ...prev, [c.userId]: v === "" ? undefined : v === "__unassign" ? null : v }));
                      }}
                    >
                      <option value="">Choose…</option>
                      <option value="__unassign">Unassign (back to the board)</option>
                      {others.length > 0 && (
                        <optgroup label="Reassign all to…">
                          {others.map((o) => (
                            <option key={o.userId} value={o.userId}>
                              {o.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                )}
              </div>
            );
          })}
          {!candidates.isLoading && list.length === 0 && <p className="p-3 text-sm text-slate-400">No {nounPlural.toLowerCase()} to choose from.</p>}
          {officeCount > officeCap && (
            <p className="p-3 text-xs text-slate-500">
              One office user always stays on your plan (the included dispatcher license), so you can choose up to {officeCap} office{" "}
              {officeCap === 1 ? "user" : "users"} here.
            </p>
          )}
          {candidates.isSuccess && selectable < needed && (
            <p className="p-3 text-sm text-amber-warn">
              Only {selectable} {selectable === 1 ? "person" : "people"} can be chosen here: you and admin accounts aren't listed. To remove an
              admin, contact ArrivePing support.
            </p>
          )}
        </div>

        <div className="space-y-3 border-t border-white/5 p-6">
          {err && (
            <p className="flex items-center gap-2 text-sm text-rose-300">
              <AlertTriangle className="h-4 w-4" /> {err}
            </p>
          )}
          {ready && (
            <p className="text-sm text-slate-200">
              Deactivate <span className="font-semibold text-white">{nameList}</span> now. Your plan becomes {targetSeats} {who(targetSeats)}:{" "}
              <span className="font-semibold text-white">{monthlyTotal}/month</span> from your next bill{billDate}. Nothing is charged before then.
            </p>
          )}
          {!ready && selected.length === needed && unresolved.length > 0 && (
            <p className="text-sm text-amber-warn">Choose what happens to the open jobs above before confirming.</p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm text-slate-300 hover:text-white">
              Cancel
            </button>
            <button
              type="button"
              disabled={!ready || confirm.isPending}
              onClick={() => confirm.mutate()}
              className="nvc-btn-primary flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {confirm.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Deactivate {selected.length || needed} and update plan
            </button>
          </div>
        </div>
      </DialogPanel>
    </div>
  );
}

function relative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  const m = Math.floor(d / 30);
  return m === 1 ? "a month ago" : `${m} months ago`;
}
