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
  /** Active field staff: each one is a user on the plan. */
  activeDrivers: number;
  /** Active office users (admins, managers, dispatchers), the included one among them. */
  activeOffice: number;
  /** Office licenses included in every plan (1). */
  includedOffice: number;
  /** activeDrivers + max(0, activeOffice - includedOffice): what the plan has to cover. */
  billableUsers: number;
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
  activatable?: boolean;
  /** A demo account: Billing offers the 30-day free trial instead of activation. */
  trialAvailable?: boolean;
  /** Taken off the plan, still working until the paid period ends. */
  leaving?: { userId: string; name: string; leavesAt: string }[];
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
  const [activate, setActivate] = useState(false);
  const [trial, setTrial] = useState(false);
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
  const billing = summary.data;
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
  const shownSeats = pendingSeats ?? billing?.seats ?? 1;
  const preview = useMemo(() => priceFor(shownSeats), [shownSeats]);
  const seatsDirty = billing ? shownSeats !== billing.seats : false;
  // Paying for fewer users than are billable means choosing who comes off.
  const needed = billing ? Math.max(0, billing.billableUsers - shownSeats) : 0;
  // Once there's an extra office user, the people who come off may be office
  // staff too, so say "users" rather than the field-staff noun.
  const extraOffice = billing ? Math.max(0, billing.activeOffice - billing.includedOffice) : 0;
  const who = (n: number) => (extraOffice > 0 ? (n === 1 ? "user" : "users") : (n === 1 ? noun : nounPlural).toLowerCase());

  // Activating: the plan starts with everyone who counts now; fewer means choosing who comes off first.
  const actBillable = Math.max(1, billing?.billableUsers ?? 1);
  const actSeats = Math.min(actBillable, pendingSeats ?? actBillable);
  const actNeeded = billing && !billing.configured ? Math.max(0, billing.billableUsers - actSeats) : 0;
  const inTrial = billing?.status === "trialing";
  const ended = billing?.status === "canceled";
  // A paid period: adding users is charged now (by the day), removals wait for the period end.
  const paidPeriod = !!billing?.configured && (billing.status === "active" || billing.status === "past_due");
  const adding = billing ? shownSeats > billing.seats : false;
  const keep = useMutation({ mutationFn: (userId: string) => post<Summary>("keep", { userId }), onSuccess: refresh, onError: (e: Error) => setErr(e.message) });

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

      {billing && !billing.configured && !billing.activatable && (
        <div className="nvc-card p-5 text-sm text-slate-300">
          This account isn't billed through ArrivePing's self-serve plan (it was set up by our team). Questions about your
          invoice? Email <a className="text-cyan-glow underline" href="mailto:contact@nvc360.com">contact@nvc360.com</a>.
        </div>
      )}

      {billing && !billing.configured && billing.activatable && (
        <div className="nvc-card space-y-4 p-5 text-sm text-slate-300">
          <div>
            <h3 className="text-base font-bold text-white">Activate your plan</h3>
            <p className="mt-1">
              Your account was set up by our team before self-serve billing. Activate the plan to pay by card each month.
              Everything in your account stays exactly as it is.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Users on the plan" value={String(actSeats)} sub={`${billing.activeDrivers} field · ${billing.activeOffice} office (1 included)`} />
            <Stat label="Monthly total" value={`${money(priceFor(actSeats).total)} USD`} sub={priceFor(actSeats).breakdown} />
            <Stat label="First charge" value="Today" sub="Then monthly on this date" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-300">Users on the plan:</span>
            <div className="inline-flex items-center rounded-lg border border-white/10 bg-ink-2">
              <button
                type="button"
                aria-label="Fewer users"
                onClick={() => setPendingSeats(Math.max(1, actSeats - 1))}
                className="grid h-9 w-9 place-items-center text-white hover:bg-white/5"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-10 text-center font-bold text-white">{actSeats}</span>
              <button
                type="button"
                aria-label="More users"
                onClick={() => setPendingSeats(Math.min(Math.max(1, billing.billableUsers), actSeats + 1))}
                className="grid h-9 w-9 place-items-center text-white hover:bg-white/5"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {actNeeded > 0 && (
              <button
                type="button"
                onClick={() => setPicker(true)}
                className="flex h-9 items-center gap-2 rounded-lg bg-white/10 px-3 text-sm font-semibold text-white hover:bg-white/15"
              >
                <UserMinus className="h-4 w-4" /> Choose {actNeeded} {actNeeded === 1 ? "user" : "users"} to deactivate
              </button>
            )}
          </div>
          {actNeeded > 0 && (
            <p className="text-xs text-white/50">
              {billing.billableUsers} people count towards the plan now. Choose who comes off first; admins are changed from the People page.
            </p>
          )}
          <button
            type="button"
            onClick={() => setActivate(true)}
            disabled={actNeeded > 0}
            className="nvc-btn nvc-btn-lg nvc-btn-brand disabled:opacity-50"
          >
            <CreditCard className="h-4 w-4" /> Activate plan
          </button>
          <p className="text-xs text-white/50">
            Questions? Email <a className="text-cyan-glow underline" href="mailto:contact@nvc360.com">contact@nvc360.com</a>.
          </p>
        </div>
      )}

      {billing && !billing.configured && billing.trialAvailable && (
        <div className="nvc-card space-y-4 p-5 text-sm text-slate-300">
          <div>
            <h3 className="text-base font-bold text-white">Start your 30-day free trial</h3>
            <p className="mt-1">Demo mode</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Free trial" value="30 days" sub="No charge today" />
            <Stat label="Then, per month" value={`${money(priceFor(Math.max(1, billing.billableUsers)).total)} USD`} sub={priceFor(Math.max(1, billing.billableUsers)).breakdown} />
            <Stat label="First charge" value="After 30 days" sub="Then monthly on that date" />
          </div>
          <button type="button" onClick={() => setTrial(true)} className="nvc-btn nvc-btn-lg nvc-btn-brand">
            <CreditCard className="h-4 w-4" /> Start free trial
          </button>
          <p className="text-xs text-white/50">
            Questions? Email <a className="text-cyan-glow underline" href="mailto:contact@nvc360.com">contact@nvc360.com</a>.
          </p>
        </div>
      )}

      {trial && (
        <CardModal
          title="Start your free trial"
          intro="We save your card now and charge nothing for 30 days. You can change the card or cancel from this page."
          setupPath="trial"
          confirmPath="trial/confirm"
          buttonLabel="Start free trial"
          onClose={() => setTrial(false)}
          onDone={() => {
            setTrial(false);
            // The account is now a customer: access, the demo banner and every sample row on screen change.
            void qc.invalidateQueries();
          }}
        />
      )}

      {activate && (
        <CardModal
          title="Activate your plan"
          intro="Your card is charged today for the first month, then monthly on this date. You can change the card or cancel from this page."
          setupPath="activate"
          confirmPath="activate/confirm"
          buttonLabel="Activate and pay"
          onClose={() => setActivate(false)}
          onDone={() => {
            setActivate(false);
            refresh();
          }}
        />
      )}

      {billing?.stripeError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          We couldn't reach Stripe just now, so the plan and card details below may be out of date. Reload in a moment.
          <span className="mt-1 block text-xs text-amber-200/70">{billing.stripeError}</span>
        </div>
      )}

      {billing && billing.configured && (
        <>
          {/* ── Plan ─────────────────────────────────────────────── */}
          <div className="nvc-card space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="flex items-center gap-2 font-bold text-white">
                <Users className="h-4 w-4 text-brand" /> Your plan
              </h3>
              <StatusPill billing={billing} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Users on your plan" value={`${billing.seats} ${billing.seats === 1 ? "user" : "users"}`} />
              <Stat
                label={inTrial ? "First month" : "Monthly cost"}
                value={inTrial ? "Free" : `${money(billing.monthlyTotal)} / month`}
                sub={inTrial ? `then ${money(billing.monthlyTotal)} / month` : billing.breakdown}
              />
              <Stat
                label={billing.cancelAtPeriodEnd ? "Access ends" : inTrial ? "Trial ends" : "Next bill"}
                value={fmtDate(billing.cancelAtPeriodEnd ? billing.cancelAt : inTrial ? billing.trialEndsAt : billing.nextInvoiceAt)}
                sub={inTrial && billing.trialDaysLeft != null && !billing.cancelAtPeriodEnd ? `${billing.trialDaysLeft} days left, nothing charged yet` : undefined}
              />
            </div>

            {billing.cancelAtPeriodEnd && !ended && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                <span>
                  Your plan is set to cancel on {fmtDate(billing.cancelAt)}. You keep full access until then and won't be charged again.
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
                  One user per {noun.toLowerCase()} who uses the app. One dispatcher license is included; each extra dispatcher or manager is one
                  more user, priced like a {noun.toLowerCase()}. You have {billing.activeDrivers} active{" "}
                  {(billing.activeDrivers === 1 ? noun : nounPlural).toLowerCase()}
                  {billing.activeOffice > 0 && (
                    <>
                      {" "}
                      and {billing.activeOffice} office {billing.activeOffice === 1 ? "user" : "users"} ({billing.includedOffice} included)
                    </>
                  )}
                  .{" "}
                  {paidPeriod ? (
                    <>
                      Adding users is charged today for the rest of this billing period, by the day. Taking users off takes effect at the end of the
                      period you've paid for ({fmtDate(billing.nextInvoiceAt)}): they keep working until then, and the lower price starts on that bill.
                    </>
                  ) : inTrial ? (
                    <>Nothing is charged during your trial; your first bill covers the users on your plan when it ends.</>
                  ) : (
                    <>Changes take effect on your next bill.</>
                  )}
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
                  {seatsDirty && needed === 0 && paidPeriod && adding && (
                    <span className="w-full text-xs text-white/50 sm:w-auto">
                      Charged today: {money(Math.max(0, preview.total - billing.monthlyTotal))}/month prorated to {fmtDate(billing.nextInvoiceAt)}.
                    </span>
                  )}
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
                      <UserMinus className="h-4 w-4" /> Choose {needed} {who(needed)} to deactivate
                    </button>
                  )}
                </div>
                {needed > 0 && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-300" /> {billing.billableUsers} {billing.billableUsers === 1 ? "user counts" : "users count"} towards
                    your plan. To pay for {shownSeats}, choose which {needed} {paidPeriod ? "to take off at the end of this period" : "to deactivate"}; they keep
                    their history and can be reactivated later.
                  </p>
                )}
                {!!billing.leaving?.length && (
                  <div className="mt-3 space-y-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                    <p className="text-xs font-semibold text-amber-100">Leaving your plan</p>
                    {billing.leaving.map((l) => (
                      <div key={l.userId} className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-200">
                        <span>
                          <span className="font-semibold text-white">{l.name}</span> keeps working until {fmtDate(l.leavesAt)}, then comes off.
                        </span>
                        <button
                          type="button"
                          onClick={() => keep.mutate(l.userId)}
                          disabled={keep.isPending}
                          className="rounded-lg bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-50"
                        >
                          Keep on plan
                        </button>
                      </div>
                    ))}
                  </div>
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
              {billing.paymentMethod ? (
                <p className="text-sm text-slate-200">
                  <span className="font-semibold text-white">{billing.paymentMethod.label}</span>
                  {billing.paymentMethod.expMonth && billing.paymentMethod.expYear
                    ? ` · expires ${String(billing.paymentMethod.expMonth).padStart(2, "0")}/${billing.paymentMethod.expYear}`
                    : ""}
                </p>
              ) : billing.stripeError ? (
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
                  {billing.paymentMethod ? "Change card" : "Add card"}
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
                    Stops future charges. You keep full access until {fmtDate(inTrial ? billing.trialEndsAt : billing.nextInvoiceAt)}, and you can change your
                    mind any time before then.
                  </p>
                  <button
                    type="button"
                    disabled={billing.cancelAtPeriodEnd}
                    onClick={() => setConfirmCancel(true)}
                    className="mt-3 rounded-lg border border-amber-500/40 px-3 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/10 disabled:opacity-40"
                  >
                    {billing.cancelAtPeriodEnd ? "Cancellation scheduled" : "Cancel plan"}
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

      {picker && billing && (
        <DownsizePicker
          targetSeats={shownSeats}
          activeDrivers={billing.activeDrivers}
          activeOffice={billing.activeOffice}
          includedOffice={billing.includedOffice}
          billableUsers={billing.billableUsers}
          nextInvoiceAt={billing.cancelAtPeriodEnd ? null : inTrial ? billing.trialEndsAt : billing.nextInvoiceAt}
          monthlyTotal={money(preview.total)}
          noun={noun}
          nounPlural={nounPlural}
          atPeriodEnd={paidPeriod}
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
      {confirmCancel && billing && (
        <ConfirmModal
          title="Cancel your plan?"
          body={`You'll keep full access until ${fmtDate(inTrial ? billing.trialEndsAt : billing.nextInvoiceAt)} and won't be charged again. You can undo this any time before then.`}
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

function StatusPill({ billing }: { billing: Summary }) {
  const map: Record<Summary["status"], { label: string; cls: string }> = {
    trialing: { label: "Free trial", cls: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200" },
    active: { label: "Active", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
    past_due: { label: "Payment failed", cls: "border-rose-500/30 bg-rose-500/10 text-rose-200" },
    unpaid: { label: "Unpaid", cls: "border-rose-500/30 bg-rose-500/10 text-rose-200" },
    canceled: { label: "Ended", cls: "border-white/10 bg-white/5 text-white/60" },
    none: { label: "No plan", cls: "border-white/10 bg-white/5 text-white/60" },
  };
  const m = map[billing.status];
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", m.cls)}>{m.label}</span>;
}

/* ---- change card ------------------------------------------------------- */
const stripeCache = new Map<string, Promise<Stripe | null>>();
function stripeFor(pk: string) {
  if (!stripeCache.has(pk)) stripeCache.set(pk, loadStripe(pk));
  return stripeCache.get(pk)!;
}

function ChangeCardModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  return (
    <CardModal
      title="Change card"
      intro="The new card replaces the old one for all future bills."
      setupPath="payment-method"
      confirmPath="payment-method/confirm"
      buttonLabel="Use this card"
      onClose={onClose}
      onDone={onDone}
    />
  );
}

/** Stripe's card form in a dialog: `setupPath` returns a SetupIntent, `confirmPath` finishes the job. */
function CardModal({
  title,
  intro,
  setupPath,
  confirmPath,
  buttonLabel,
  onClose,
  onDone,
}: {
  title: string;
  intro: string;
  setupPath: string;
  confirmPath: string;
  buttonLabel: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [setup, setSetup] = useState<{ clientSecret: string; setupIntentId: string; publishableKey: string } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    post<{ clientSecret: string; setupIntentId: string; publishableKey: string }>(setupPath)
      .then(setSetup)
      .catch((e: Error) => setErr(e.message));
  }, [setupPath]);
  const stripePromise = useMemo(() => (setup ? stripeFor(setup.publishableKey) : null), [setup]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" {...dismiss(onClose)}>
      <DialogPanel onClose={onClose} label={title} className="w-full max-w-md rounded-2xl bg-ink-2 p-6 shadow-2xl">
        <h3 className="text-lg font-extrabold text-white">{title}</h3>
        <p className="text-sm text-slate-500">{intro}</p>
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
            <CardForm setupIntentId={setup.setupIntentId} confirmPath={confirmPath} buttonLabel={buttonLabel} onDone={onDone} />
          </Elements>
        )}
        <button type="button" onClick={onClose} className="mt-4 text-xs text-slate-400 hover:text-white">
          Cancel
        </button>
      </DialogPanel>
    </div>
  );
}

function CardForm({
  setupIntentId,
  confirmPath,
  buttonLabel,
  onDone,
}: {
  setupIntentId: string;
  confirmPath: string;
  buttonLabel: string;
  onDone: () => void;
}) {
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
      await post(confirmPath, { setupIntentId });
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
        className="nvc-btn nvc-btn-lg nvc-btn-brand w-full"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} {buttonLabel}
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
          <button type="button" onClick={onClose} className="nvc-btn flex-1 border border-white/15 text-white hover:bg-white/5">
            Keep my plan
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "nvc-btn flex-1 text-white",
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
          <button type="button" onClick={onClose} className="nvc-btn flex-1 border border-white/15 text-white hover:bg-white/5">
            Never mind
          </button>
          <button
            type="button"
            onClick={go}
            disabled={busy || !typed.trim()}
            className="nvc-btn flex-1 bg-rose-600 text-white hover:bg-rose-500"
          >
            {busy ? "Closing…" : "Close my account"}
          </button>
        </div>
      </DialogPanel>
    </div>
  );
}
