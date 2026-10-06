import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Landmark,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Clock3,
} from "lucide-react";
import { api } from "../../lib/api";
import { BtnPrimary, Field, inputCls } from "../../components/modal";
import { useCustomerNoun } from "../../lib/use-brand";
import { useAuth } from "../../hooks/use-auth";
import { cn } from "../../lib/utils";

/**
 * Settings → Payments: connect the tenant's own Stripe account.
 *
 * Flow: "Connect with Stripe" → POST /payments/connect/start → full-page
 * redirect to Stripe-hosted onboarding → Stripe returns to
 * /admin/settings?section=payments&stripe=return → we refresh status.
 * Money model: card payments are charged on the tenant's connected account,
 * the tenant pays Stripe's processing fee, ArrivePing takes nothing.
 */

type Status = {
  enabled: boolean;
  countries: string[];
  /** ArrivePing tenant only: charges go to NVC360's own Stripe account */
  usePlatform: boolean;
  connected: boolean;
  accountId: string | null;
  country: string;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  ready: boolean;
  connectedAt: string | null;
  requirementsDue: string[];
  disabledReason: string | null;
};

const COUNTRY_LABEL: Record<string, string> = { CA: "Canada", US: "United States" };

function useStripeReturnFlag() {
  // Stripe sends the admin back with ?stripe=return (done / paused) or
  // ?stripe=refresh (link expired). Read once, then clean the URL.
  return useMemo(() => {
    if (typeof window === "undefined") return null;
    const u = new URL(window.location.href);
    const flag = u.searchParams.get("stripe");
    if (flag) {
      u.searchParams.delete("stripe");
      window.history.replaceState({}, "", u.toString());
    }
    return flag;
  }, []);
}

export default function PaymentsSettingsTab() {
  const qc = useQueryClient();
  const { noun: customerNoun, nounPlural: customerPlural } = useCustomerNoun();
  const returnFlag = useStripeReturnFlag();
  const { role } = useAuth();
  const isSuper = role === "superadmin";
  const [country, setCountry] = useState("CA");
  const [err, setErr] = useState("");

  const status = useQuery({
    queryKey: ["stripe-connect-status", returnFlag],
    queryFn: async () => {
      const res = await (api as any).payments.connect.status.$get({
        query: returnFlag === "return" ? { refresh: "1" } : {},
      });
      return (await res.json()) as Status;
    },
    // While onboarding is unfinished keep polling: the webhook flips the
    // flags a few seconds after Stripe approves the account.
    refetchInterval: (q) => {
      const d = q.state.data as Status | undefined;
      return d?.connected && !d.ready ? 8000 : false;
    },
  });

  const start = useMutation({
    mutationFn: async () => {
      const res = await (api as any).payments.connect.start.$post({ json: { country } });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? data?.message ?? "Could not start Stripe onboarding");
      return data as { url: string };
    },
    onSuccess: (d) => {
      window.location.assign(d.url);
    },
    onError: (e: any) => setErr(e.message),
  });

  const dashboard = useMutation({
    mutationFn: async () => {
      const res = await (api as any).payments.connect.dashboard.$post();
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? data?.message ?? "Could not open Stripe dashboard");
      return data as { url: string };
    },
    onSuccess: (d) => window.open(d.url, "_blank", "noopener"),
    onError: (e: any) => setErr(e.message),
  });

  const platform = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await (api as any).payments.connect.platform.$post({ json: { enabled } });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? data?.message ?? "Could not update");
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stripe-connect-status"] }),
    onError: (e: any) => setErr(e.message),
  });

  useEffect(() => {
    if (status.data?.country) setCountry(status.data.country);
  }, [status.data?.country]);

  const s = status.data;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-white">Payments</h2>
        <p className="text-sm text-white/50">
          Let {customerPlural.toLowerCase()} pay by card. Money goes straight to your bank account through Stripe.
        </p>
      </div>

      {returnFlag === "refresh" && (
        <Banner tone="warn">Your Stripe setup link expired. Click “Continue setup” to pick up where you left off.</Banner>
      )}
      {err && <Banner tone="error">{err}</Banner>}
      {s && !s.enabled && (
        <Banner tone="warn">Card payments are not configured on this server yet (Stripe keys missing).</Banner>
      )}

      {/* ── Status card ────────────────────────────────────────────── */}
      <div className="nvc-card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 font-bold text-white">
            <CreditCard className="h-4 w-4 text-brand" /> Stripe account
          </h3>
          {s && <StatusPill s={s} />}
        </div>

        {status.isLoading && (
          <p className="flex items-center gap-2 text-sm text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking Stripe…
          </p>
        )}

        {/* ArrivePing tenant: using NVC360's own Stripe account */}
        {s && s.usePlatform && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat icon={CreditCard} label="Card payments" value="Active" ok />
              <Stat icon={Landmark} label="Paid to" value="ArrivePing (main account)" ok />
              <Stat icon={Banknote} label="Mode" value="Platform account" ok />
            </div>
            <p className="text-sm text-slate-300">
              Card payments for this company are charged on ArrivePing’s own Stripe account — no separate
              Stripe setup needed. {customerPlural} see a <span className="font-semibold text-white">Pay</span>{" "}
              button on their tracking page.
            </p>
          </div>
        )}

        {/* Not connected yet */}
        {s && !s.usePlatform && !s.connected && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              You’ll be taken to Stripe to create a free account. It takes about 5–10 minutes. Have your bank
              details handy. When you’re done you’ll land back here.
            </p>
            <Field label="Where is your business registered?">
              <select
                aria-label="Business country"
                className={cn(inputCls, "max-w-xs")}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              >
                {(s.countries ?? ["CA", "US"]).map((c) => (
                  <option key={c} value={c}>
                    {COUNTRY_LABEL[c] ?? c}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <BtnPrimary disabled={!s.enabled || start.isPending} onClick={() => { setErr(""); start.mutate(); }}>
                {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                {start.isPending ? "Opening Stripe…" : "Connect with Stripe"}
              </BtnPrimary>
              <span className="text-xs text-white/40">No monthly fee. Cancel any time from Stripe.</span>
            </div>
          </div>
        )}

        {/* Connected but Stripe still needs something */}
        {s && !s.usePlatform && s.connected && !s.ready && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              {s.detailsSubmitted
                ? "Stripe is reviewing your details. This usually takes a few minutes; we’ll update automatically."
                : "Your Stripe account was created but setup isn’t finished yet."}
            </p>
            {s.requirementsDue.length > 0 && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300">
                  <AlertTriangle className="h-4 w-4" /> Stripe still needs
                </p>
                <ul className="list-inside list-disc space-y-1 text-sm text-amber-100/80">
                  {s.requirementsDue.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {s.disabledReason && (
              <p className="text-xs text-white/40">Stripe status: {s.disabledReason.replace(/[._]/g, " ")}</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <BtnPrimary disabled={start.isPending} onClick={() => { setErr(""); start.mutate(); }}>
                {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                Continue setup on Stripe
              </BtnPrimary>
              <button
                type="button"
                onClick={() => status.refetch()}
                className="inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white/90"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", status.isFetching && "animate-spin")} /> Check again
              </button>
            </div>
          </div>
        )}

        {/* Fully connected */}
        {s && !s.usePlatform && s.ready && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat icon={CreditCard} label="Card payments" value="Active" ok />
              <Stat icon={Landmark} label="Bank payouts" value={s.payoutsEnabled ? "Active" : "Pending"} ok={s.payoutsEnabled} />
              <Stat icon={Banknote} label="Country" value={COUNTRY_LABEL[s.country] ?? (s.country || "—")} ok />
            </div>
            <p className="text-sm text-slate-300">
              {customerPlural} now see a <span className="font-semibold text-white">Pay</span> button on their
              tracking page. Payments, payouts, refunds and disputes are managed in your own Stripe dashboard —
              sign in with the email and password you created during setup.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <BtnPrimary disabled={dashboard.isPending} onClick={() => { setErr(""); dashboard.mutate(); }}>
                {dashboard.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                Open Stripe dashboard
              </BtnPrimary>
              {s.accountId && <span className="font-mono text-xs text-white/30">{s.accountId}</span>}
            </div>
          </div>
        )}
      </div>

      {/* ── Superadmin only: platform-account switch ───────────────── */}
      {isSuper && s && (
        <div className="nvc-card space-y-3 border border-amber-500/20 p-5">
          <h3 className="flex items-center gap-2 font-bold text-amber-200">
            <ShieldCheck className="h-4 w-4" /> Superadmin: payment routing
          </h3>
          <p className="text-sm text-slate-300">
            {s.usePlatform
              ? "This company’s card payments are charged on ArrivePing’s MAIN Stripe account (NVC360). Only use this for the ArrivePing tenant itself."
              : "This company must connect its own Stripe account (above). Switch on only for the ArrivePing tenant — it sends this company’s money to NVC360’s bank."}
          </p>
          <label className="inline-flex cursor-pointer items-center gap-3 text-sm text-white">
            {/* eslint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by the text inside the wrapping <label> */}
            <input
              type="checkbox"
              className="h-4 w-4 accent-amber-400"
              checked={s.usePlatform}
              disabled={platform.isPending}
              onChange={(e) => { setErr(""); platform.mutate(e.target.checked); }}
            />
            Use ArrivePing’s main Stripe account for this company
          </label>
        </div>
      )}

      {/* ── How it works / fees ────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="nvc-card space-y-3 p-5">
          <h3 className="flex items-center gap-2 font-bold text-white">
            <ShieldCheck className="h-4 w-4 text-brand" /> What Stripe will ask
          </h3>
          <ul className="space-y-1.5 text-sm text-slate-300">
            <li>• An email + password for your own Stripe login</li>
            <li>• Business type (individual, corporation…) and legal name</li>
            <li>• Business address, phone, and website or description</li>
            <li>• Business number / tax ID (companies only)</li>
            <li>• Owner’s name, date of birth, home address, last digits of SIN/SSN</li>
            <li>• Bank account for payouts (or log in to your bank)</li>
            <li>• Name shown on {customerNoun.toLowerCase()} card statements</li>
          </ul>
        </div>
        <div className="nvc-card space-y-3 p-5">
          <h3 className="flex items-center gap-2 font-bold text-white">
            <Clock3 className="h-4 w-4 text-brand" /> Fees &amp; payouts
          </h3>
          <ul className="space-y-1.5 text-sm text-slate-300">
            <li>• No monthly fee. ArrivePing takes no cut.</li>
            <li>• Stripe charges 2.9% + 30¢ per card payment (deducted automatically).</li>
            <li>• Payouts reach your bank on a 2-business-day rolling schedule by default; change it in Stripe.</li>
            <li>• Refunds and disputes come out of your Stripe balance.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ s }: { s: Status }) {
  if (s.usePlatform) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" /> Active · ArrivePing account
      </span>
    );
  }
  if (!s.connected) {
    return <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/60">Not connected</span>;
  }
  if (s.ready) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" /> Connected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300">
      <Clock3 className="h-3.5 w-3.5" /> Setup incomplete
    </span>
  );
}

function Stat({ icon: Icon, label, value, ok }: { icon: typeof CreditCard; label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-xl border border-white/5 bg-ink px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-white/50">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={cn("mt-1 text-sm font-semibold", ok ? "text-emerald-300" : "text-amber-300")}>{value}</div>
    </div>
  );
}

function Banner({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        tone === "error"
          ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
          : "border-amber-500/30 bg-amber-500/10 text-amber-100",
      )}
    >
      {children}
    </div>
  );
}
