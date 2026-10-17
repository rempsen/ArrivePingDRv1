import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Loader2,
  Minus,
  Plus,
  ShieldCheck,
  UserMinus,
  Users,
  XCircle,
} from "lucide-react";
import { apiHeaders } from "../../lib/api";
import { authClient } from "../../lib/auth";
import { inputCls } from "../../components/modal";
import { DialogPanel } from "../../components/dialog-panel";
import { DownsizePicker } from "../../components/downsize-picker";
import { useWorkerNoun } from "../../lib/use-brand";
import { cn, dismiss } from "../../lib/utils";

/**
 * Settings → Billing: the tenant's own ArrivePing subscription. What they pay,
 * when, on which card; change the user count; cancel; close the account.
 * Backed by /api/billing (routes/billing.ts).
 */

type Summary = {
  configured: boolean;
  status: "none" | "trialing" | "active" | "past_due" | "canceled" | "unpaid";
  seats: number;
  activeDrivers: number;
  excessActive: number;
  monthlyTotal: number;
  breakdown: string;
  plan: string;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  nextInvoiceAt: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  paymentMethod: { kind: string; brand: string; last4: string; expMonth: number | null; expYear: number | null; label: string } | null;
  stripeError?: string;
};

const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }) : "—";

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/billing/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...apiHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message || "Something went wrong");
  return data;
}

export default function BillingSettingsTab() {
  const qc = useQueryClient();
  const { noun, nounPlural } = useWorkerNoun();
  const [err, setErr] = useState("");
  const [changeCard, setChangeCard] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [picker, setPicker] = useState(false);

  const summary = useQuery({
    queryKey: ["billing", "summary"],
    queryFn: async () => {
      const res = await fetch("/api/billing/summary", { headers: apiHeaders() });
      return (await res.json()) as Summary;
    },
  });
  const s = summary.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["billing", "summary"] });

  const seats = useMutation({
    mutationFn: (n: number) => post<{ seats: number }>("seats", { seats: n }),
    onSuccess: refresh,
    onError: (e: Error) => setErr(e.message),
  });
  const cancel = useMutation({
    mutationFn: () => post<Summary>("cancel"),
    onSuccess: () => {
      setConfirmCancel(false);
      refresh();
    },
    onError: (e: Error) => setErr(e.message),
  });
  const resume = useMutation({ mutationFn: () => post<Summary>("resume"), onSuccess: refresh, onError: (e: Error) => setErr(e.message) });

  const [pendingSeats, setPendingSeats] = useState<number | null>(null);
  const shownSeats = pendingSeats ?? s?.seats ?? 1;
  const preview = useMemo(() => priceFor(shownSeats), [shownSeats]);
  const seatsDirty = s ? shownSeats !== s.seats : false;
  // Paying for fewer users than are active means choosing who comes off.
  const needed = s ? Math.max(0, s.activeDrivers - shownSeats) : 0;

  const inTrial = s?.status === "trialing";
  const ended = s?.status === "canceled";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-white">Billing</h2>
        <p className="text-sm text-white/50">Your ArrivePing plan: what you pay, when, and on which card.</p>
      </div>

      {err && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {err}{" "}
          <button type="button" className="ml-2 underline" onClick={() => setErr("")}>
            Dismiss
          </button>
        </div>
      )}

      {summary.isLoading && (
        <p className="flex items-center gap-2 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your plan…
        </p>
      )}

      {s && !s.configured && (
        <div className="nvc-card p-5 text-sm text-slate-300">
          This account isn't billed through ArrivePing's self-serve plan (it was set up by our team). Questions about your
          invoice? Email <a className="text-cyan-glow underline" href="mailto:contact@nvc360.com">contact@nvc360.com</a>.
        </div>
      )}

      {s?.stripeError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          We couldn't reach Stripe just now, so the plan and card details below may be out of date. Reload in a moment.
          <span className="mt-1 block text-xs text-amber-200/70">{s.stripeError}</span>
        </div>
      )}

      {s && s.configured && (
        <>
          {/* ── Plan ─────────────────────────────────────────────── */}
          <div className="nvc-card space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="flex items-center gap-2 font-bold text-white">
                <Users className="h-4 w-4 text-brand" /> Your plan
              </h3>
              <StatusPill s={s} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Users on your plan" value={`${s.seats} ${s.seats === 1 ? "user" : "users"}`} />
              <Stat
                label={inTrial ? "First month" : "Monthly cost"}
                value={inTrial ? "Free" : `${money(s.monthlyTotal)} / month`}
                sub={inTrial ? `then ${money(s.monthlyTotal)} / month` : s.breakdown}
              />
              <Stat
                label={s.cancelAtPeriodEnd ? "Access ends" : inTrial ? "Trial ends" : "Next bill"}
                value={fmtDate(s.cancelAtPeriodEnd ? s.cancelAt : inTrial ? s.trialEndsAt : s.nextInvoiceAt)}
                sub={inTrial && s.trialDaysLeft != null && !s.cancelAtPeriodEnd ? `${s.trialDaysLeft} days left, nothing charged yet` : undefined}
              />
            </div>

            {s.cancelAtPeriodEnd && !ended && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                <span>
                  Your plan is set to cancel on {fmtDate(s.cancelAt)}. You keep full access until then and won't be charged again.
                </span>
                <button
                  type="button"
                  onClick={() => resume.mutate()}
                  disabled={resume.isPending}
                  className="rounded-lg bg-amber-400/20 px-3 py-1.5 font-semibold text-amber-100 hover:bg-amber-400/30 disabled:opacity-50"
                >
                  {resume.isPending ? "Keeping…" : "Keep my plan"}
                </button>
              </div>
            )}
            {ended && (
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                This plan has ended. Email <a className="text-cyan-glow underline" href="mailto:contact@nvc360.com">contact@nvc360.com</a> to start again.
              </div>
            )}

            {/* seats */}
            {!ended && (
              <div className="rounded-xl border border-white/5 bg-ink p-4">
                <p className="text-sm font-semibold text-white">Change how many users you pay for</p>
                <p className="mt-0.5 text-xs text-white/50">
                  One user per {nounPlural.toLowerCase().replace(/s$/, "")} who uses the app. You currently have {s.activeDrivers} active. Changes
                  take effect on your next bill; nothing is charged in between.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <div className="inline-flex items-center rounded-lg border border-white/10 bg-ink-2">
                    <button
                      type="button"
                      aria-label="Fewer users"
                      onClick={() => setPendingSeats(Math.max(1, shownSeats - 1))}
                      className="grid h-10 w-10 place-items-center text-white hover:bg-white/5"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <input
                      aria-label="Users on your plan"
                      type="number"
                      min={1}
                      className="h-10 w-16 bg-transparent text-center text-lg font-bold text-white outline-none"
                      value={shownSeats}
                      onChange={(e) => setPendingSeats(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                    />
                    <button
                      type="button"
                      aria-label="More users"
                      onClick={() => setPendingSeats(shownSeats + 1)}
                      className="grid h-10 w-10 place-items-center text-white hover:bg-white/5"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <span className="text-sm text-slate-300">
                    = <span className="font-semibold text-white">{money(preview.total)} / month</span>
                    <span className="text-white/50"> · {preview.breakdown}</span>
                  </span>
                  {seatsDirty && needed === 0 && (
                    <button
                      type="button"
                      onClick={() => seats.mutate(shownSeats, { onSuccess: () => setPendingSeats(null) })}
                      disabled={seats.isPending}
                      className="nvc-btn-primary flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {seats.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Save
                    </button>
                  )}
                  {needed > 0 && (
                    <button
                      type="button"
                      onClick={() => setPicker(true)}
                      className="nvc-btn-primary flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white"
                    >
                      <UserMinus className="h-4 w-4" /> Choose {needed} {needed === 1 ? noun.toLowerCase() : nounPlural.toLowerCase()} to deactivate
                    </button>
                  )}
                </div>
                {needed > 0 && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-300" /> You have {s.activeDrivers} active {nounPlural.toLowerCase()}. To pay for {shownSeats}, choose
                    which {needed} to deactivate; they keep their history and can be reactivated later.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Card ─────────────────────────────────────────────── */}
          <div className="nvc-card space-y-3 p-5">
            <h3 className="flex items-center gap-2 font-bold text-white">
              <CreditCard className="h-4 w-4 text-brand" /> Payment method
            </h3>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {s.paymentMethod ? (
                <p className="text-sm text-slate-200">
                  <span className="font-semibold text-white">{s.paymentMethod.label}</span>
                  {s.paymentMethod.expMonth && s.paymentMethod.expYear
                    ? ` · expires ${String(s.paymentMethod.expMonth).padStart(2, "0")}/${s.paymentMethod.expYear}`
                    : ""}
                </p>
              ) : s.stripeError ? (
                <p className="text-sm text-slate-400">Card details unavailable right now.</p>
              ) : (
                <p className="text-sm text-amber-300">No card on file. Add one so your plan continues after the trial.</p>
              )}
              {!ended && (
                <button
                  type="button"
                  onClick={() => setChangeCard(true)}
                  className="rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold text-white hover:bg-white/5"
                >
                  {s.paymentMethod ? "Change card" : "Add card"}
                </button>
              )}
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-white/40">
              <ShieldCheck className="h-3.5 w-3.5" /> Card details go straight to Stripe; we never see the number.
            </p>
          </div>

          {/* ── Cancel / close ───────────────────────────────────── */}
          {!ended && (
            <div className="nvc-card space-y-4 p-5">
              <h3 className="flex items-center gap-2 font-bold text-white">
                <CalendarClock className="h-4 w-4 text-brand" /> Cancel or close
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-white/5 bg-ink p-4">
                  <p className="text-sm font-semibold text-white">Cancel my plan</p>
                  <p className="mt-1 text-xs text-white/50">
                    Stops future charges. You keep full access until {fmtDate(inTrial ? s.trialEndsAt : s.nextInvoiceAt)}, and you can change your
                    mind any time before then.
                  </p>
                  <button
                    type="button"
                    disabled={s.cancelAtPeriodEnd}
                    onClick={() => setConfirmCancel(true)}
                    className="mt-3 rounded-lg border border-amber-500/40 px-3 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/10 disabled:opacity-40"
                  >
                    {s.cancelAtPeriodEnd ? "Cancellation scheduled" : "Cancel plan"}
                  </button>
                </div>
                <div className="rounded-xl border border-rose-500/20 bg-ink p-4">
                  <p className="text-sm font-semibold text-white">Close my account</p>
                  <p className="mt-1 text-xs text-white/50">
                    Ends your plan today and locks the account for everyone on your team. Nothing more is charged. Your data is kept, and we can
                    reopen the account if you ask.
                  </p>
                  <button
                    type="button"
                    onClick={() => setConfirmClose(true)}
                    className="mt-3 rounded-lg border border-rose-500/40 px-3 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-500/10"
                  >
                    Close account
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {picker && s && (
        <DownsizePicker
          targetSeats={shownSeats}
          activeDrivers={s.activeDrivers}
          nextInvoiceAt={s.cancelAtPeriodEnd ? null : inTrial ? s.trialEndsAt : s.nextInvoiceAt}
          monthlyTotal={money(preview.total)}
          noun={noun}
          nounPlural={nounPlural}
          onClose={() => setPicker(false)}
          onDone={() => {
            setPicker(false);
            setPendingSeats(null);
            refresh();
          }}
        />
      )}
      {changeCard && (
        <ChangeCardModal
          onClose={() => setChangeCard(false)}
          onDone={() => {
            setChangeCard(false);
            refresh();
          }}
        />
      )}
      {confirmCancel && s && (
        <ConfirmModal
          title="Cancel your plan?"
          body={`You'll keep full access until ${fmtDate(inTrial ? s.trialEndsAt : s.nextInvoiceAt)} and won't be charged again. You can undo this any time before then.`}
          confirmLabel={cancel.isPending ? "Cancelling…" : "Yes, cancel my plan"}
          tone="warn"
          busy={cancel.isPending}
          onConfirm={() => cancel.mutate()}
          onClose={() => setConfirmCancel(false)}
        />
      )}
      {confirmClose && <CloseAccountModal onClose={() => setConfirmClose(false)} />}
    </div>
  );
}

/* ---- pricing preview (mirrors web/site/config.ts) ------------------------ */
function priceFor(n: number): { total: number; breakdown: string } {
  const drivers = Math.max(1, Math.floor(n));
  let total = 49;
  const parts = ["Starter $49"];
  const bands = [
    { from: 3, to: 29, rate: 30 },
    { from: 30, to: Infinity, rate: 25 },
  ];
  for (const b of bands) {
    const count = Math.max(0, Math.min(drivers, b.to) - b.from + 1);
    if (count > 0) {
      total += count * b.rate;
      parts.push(`${count} × $${b.rate}`);
    }
  }
  return { total, breakdown: drivers <= 2 ? "Starter: 1 dispatcher + 2 drivers" : parts.join(" + ") };
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-ink px-4 py-3">
      <div className="text-xs text-white/50">{label}</div>
      <div className="mt-1 text-lg font-bold text-white">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-white/50">{sub}</div>}
    </div>
  );
}

function StatusPill({ s }: { s: Summary }) {
  const map: Record<Summary["status"], { label: string; cls: string }> = {
    trialing: { label: "Free trial", cls: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200" },
    active: { label: "Active", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
    past_due: { label: "Payment failed", cls: "border-rose-500/30 bg-rose-500/10 text-rose-200" },
    unpaid: { label: "Unpaid", cls: "border-rose-500/30 bg-rose-500/10 text-rose-200" },
    canceled: { label: "Ended", cls: "border-white/10 bg-white/5 text-white/60" },
    none: { label: "No plan", cls: "border-white/10 bg-white/5 text-white/60" },
  };
  const m = map[s.status];
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", m.cls)}>{m.label}</span>;
}

/* ---- change card ------------------------------------------------------- */
const stripeCache = new Map<string, Promise<Stripe | null>>();
function stripeFor(pk: string) {
  if (!stripeCache.has(pk)) stripeCache.set(pk, loadStripe(pk));
  return stripeCache.get(pk)!;
}

function ChangeCardModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [setup, setSetup] = useState<{ clientSecret: string; setupIntentId: string; publishableKey: string } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    post<{ clientSecret: string; setupIntentId: string; publishableKey: string }>("payment-method")
      .then(setSetup)
      .catch((e: Error) => setErr(e.message));
  }, []);
  const stripePromise = useMemo(() => (setup ? stripeFor(setup.publishableKey) : null), [setup]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" {...dismiss(onClose)}>
      <DialogPanel onClose={onClose} label="Change payment card" className="w-full max-w-md rounded-2xl bg-ink-2 p-6 shadow-2xl">
        <h3 className="text-lg font-extrabold text-white">Change card</h3>
        <p className="text-sm text-slate-500">The new card replaces the old one for all future bills.</p>
        {err && <div className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">{err}</div>}
        {!setup && !err && (
          <div className="mt-8 flex flex-col items-center gap-3 py-6">
            <Loader2 className="h-6 w-6 animate-spin text-cyan-glow" />
            <p className="text-sm text-slate-500">Setting up secure card entry…</p>
          </div>
        )}
        {setup && stripePromise && (
          <Elements
            stripe={stripePromise}
            options={{ clientSecret: setup.clientSecret, appearance: { theme: "night", variables: { colorPrimary: "#06B6D4", colorBackground: "#0f1419", borderRadius: "12px" } } }}
          >
            <CardForm setupIntentId={setup.setupIntentId} onDone={onDone} />
          </Elements>
        )}
        <button type="button" onClick={onClose} className="mt-4 text-xs text-slate-400 hover:text-white">
          Cancel
        </button>
      </DialogPanel>
    </div>
  );
}

function CardForm({ setupIntentId, onDone }: { setupIntentId: string; onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setErr("");
    const { error } = await stripe.confirmSetup({ elements, redirect: "if_required" });
    if (error) {
      setErr(error.message ?? "We couldn't save that card.");
      setBusy(false);
      return;
    }
    try {
      await post("payment-method/confirm", { setupIntentId });
      onDone();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <PaymentElement options={{ layout: "tabs" }} />
      {err && <p className="text-sm text-red-400">{err}</p>}
      <button
        type="submit"
        disabled={!stripe || busy}
        className="nvc-btn-primary flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand font-semibold text-white disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Use this card
      </button>
    </form>
  );
}

/* ---- confirms ----------------------------------------------------------- */
function ConfirmModal({
  title,
  body,
  confirmLabel,
  tone,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  tone: "warn" | "danger";
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" {...dismiss(onClose)}>
      <DialogPanel onClose={onClose} label={title} className="w-full max-w-md rounded-2xl bg-ink-2 p-6 shadow-2xl">
        <h3 className="text-lg font-extrabold text-white">{title}</h3>
        <p className="mt-2 text-sm text-slate-300">{body}</p>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-white/15 py-2.5 text-sm font-semibold text-white hover:bg-white/5">
            Keep my plan
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "flex-1 rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-60",
              tone === "danger" ? "bg-rose-600 hover:bg-rose-500" : "bg-amber-600 hover:bg-amber-500",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </DialogPanel>
    </div>
  );
}

function CloseAccountModal({ onClose }: { onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true);
    setErr("");
    try {
      await post("close", { confirmName: typed });
      try {
        await authClient.signOut();
      } catch {}
      window.location.assign("/sign-in?closed=1");
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" {...dismiss(onClose)}>
      <DialogPanel onClose={onClose} label="Close account" className="w-full max-w-md rounded-2xl bg-ink-2 p-6 shadow-2xl">
        <h3 className="flex items-center gap-2 text-lg font-extrabold text-white">
          <XCircle className="h-5 w-5 text-rose-400" /> Close your account
        </h3>
        <p className="mt-2 text-sm text-slate-300">
          This ends your plan today, signs everyone out and locks the account. Nothing more is charged. To confirm, type your company
          name exactly as it appears at the top left.
        </p>
        <input aria-label="Company name" className={cn(inputCls, "mt-4")} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Company name" />
        {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-white/15 py-2.5 text-sm font-semibold text-white hover:bg-white/5">
            Never mind
          </button>
          <button
            type="button"
            onClick={go}
            disabled={busy || !typed.trim()}
            className="flex-1 rounded-lg bg-rose-600 py-2.5 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
          >
            {busy ? "Closing…" : "Close my account"}
          </button>
        </div>
      </DialogPanel>
    </div>
  );
}
