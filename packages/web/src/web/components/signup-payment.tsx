import { useEffect, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { CheckCircle2, Loader2, ShieldCheck, ArrowRight } from "lucide-react";
import { Loader } from "./loader";

/**
 * The card step on /get-started. Saves a card (SetupIntent, nothing charged)
 * so the 30-day trial can roll into a paid subscription. The page owns the
 * final signup call; this component hands back the Stripe ids it needs.
 *
 * When billing isn't configured on the server (local dev) the step is
 * skipped and `onSaved` is called with no ids.
 */

export type BillingIds = { customerId: string; setupIntentId: string } | null;

type Config = { enabled: boolean; publishableKey: string; trialDays: number };
type Setup = { customerId: string; setupIntentId: string; clientSecret: string; publishableKey: string };

const stripeCache = new Map<string, Promise<Stripe | null>>();
function stripeFor(pk: string) {
  if (!stripeCache.has(pk)) stripeCache.set(pk, loadStripe(pk));
  return stripeCache.get(pk)!;
}

export function SignupPayment({
  person,
  companyName,
  onSaved,
  onBack,
  submitting,
  submitError,
}: {
  person: { email: string; name: string; phone: string };
  companyName: string;
  /** Called with the saved card's ids (or null when billing is off). The page then creates the account. */
  onSaved: (ids: BillingIds) => Promise<void>;
  onBack: () => void;
  submitting: boolean;
  submitError: string;
}) {
  const [config, setConfig] = useState<Config | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = (await (await fetch("/api/public/onboarding/billing/config")).json()) as Config;
        if (cancelled) return;
        setConfig(cfg);
        if (!cfg.enabled) return;
        const r = await fetch("/api/public/onboarding/billing/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: person.email, name: person.name, companyName, phone: person.phone || undefined }),
        });
        const d = (await r.json()) as Setup & { message?: string };
        if (cancelled) return;
        if (!r.ok || !d.clientSecret) throw new Error(d.message || "We couldn't start the payment step.");
        setSetup(d);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "We couldn't start the payment step.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // one setup per visit to this step
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stripePromise = useMemo(() => (setup?.publishableKey ? stripeFor(setup.publishableKey) : null), [setup?.publishableKey]);
  const trialDays = config?.trialDays ?? 30;

  return (
    <div>
      <ul className="space-y-2 rounded-2xl border border-brand/20 bg-brand/[0.06] p-4 text-sm text-slate-200">
        {[
          `${trialDays} days free, with as many users as you like`,
          "Nothing is charged today",
          `Cancel any time in the first ${trialDays} days and you'll never be billed`,
          "After that: $49/month, plus your drivers at the published rates",
        ].map((t) => (
          <li key={t} className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-glow" /> {t}
          </li>
        ))}
      </ul>

      {config && !config.enabled && (
        <div className="mt-5">
          <p className="text-sm text-amber-300">Billing isn't switched on in this environment, so we'll skip the card.</p>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void onSaved(null)}
            className="nvc-btn-primary mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand font-semibold text-white"
          >
            {submitting ? <Loader className="h-5 w-5 border-white/40 border-t-white" /> : <>Create my account <ArrowRight className="h-4 w-4" /></>}
          </button>
        </div>
      )}

      {error && <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-400">{error}</div>}

      {!config || (config.enabled && !setup && !error) ? (
        <div className="mt-8 flex flex-col items-center gap-3 py-6">
          <Loader className="h-6 w-6 border-white/30 border-t-cyan-glow" />
          <p className="text-sm text-slate-500">Setting up secure card entry…</p>
        </div>
      ) : null}

      {setup?.clientSecret && stripePromise && (
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret: setup.clientSecret,
            appearance: { theme: "night", variables: { colorPrimary: "#06B6D4", colorBackground: "#0f1419", borderRadius: "12px" } },
          }}
        >
          <CardForm
            onConfirmed={() => onSaved({ customerId: setup.customerId, setupIntentId: setup.setupIntentId })}
            submitting={submitting}
            submitError={submitError}
            trialDays={trialDays}
          />
        </Elements>
      )}

      <div className="mt-4 flex items-center justify-between">
        <button type="button" onClick={onBack} disabled={submitting} className="text-xs text-slate-400 hover:text-white">
          ← Back
        </button>
        <p className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <ShieldCheck className="h-3.5 w-3.5" /> Card details go straight to Stripe
        </p>
      </div>
    </div>
  );
}

function CardForm({
  onConfirmed,
  submitting,
  submitError,
  trialDays,
}: {
  onConfirmed: () => Promise<void>;
  submitting: boolean;
  submitError: string;
  trialDays: number;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setConfirming(true);
    setErr("");
    const { error } = await stripe.confirmSetup({ elements, redirect: "if_required" });
    if (error) {
      setErr(error.message ?? "We couldn't save that card. Please check the details.");
      setConfirming(false);
      return;
    }
    await onConfirmed();
    setConfirming(false);
  }

  const busy = confirming || submitting;
  return (
    <form onSubmit={submit} className="mt-5 space-y-4">
      <PaymentElement options={{ layout: "tabs" }} />
      <div className="min-h-[20px]" role="alert" aria-live="polite">
        {(err || submitError) && <p className="text-sm font-medium text-red-400">{err || submitError}</p>}
      </div>
      <button
        type="submit"
        disabled={!stripe || busy}
        className="nvc-btn-primary flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand font-semibold text-white transition hover:bg-brand-deep disabled:opacity-60"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> {confirming ? "Saving your card…" : "Creating your account…"}
          </>
        ) : (
          <>
            Start my {trialDays}-day free trial <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  );
}
