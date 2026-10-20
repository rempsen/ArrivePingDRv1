import { useEffect, useMemo, useState } from "react";
import { TenantLogo } from "../components/brand";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
// "/pure" defers loading Stripe.js until a payment actually starts (see stripe-pay.tsx).
import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { CheckCircle2, Loader2, Lock, ShieldCheck } from "lucide-react";
import { money } from "../lib/utils";

/**
 * /pay/:token — the on-site payment page. Opened on the technician's phone
 * for the customer, from the QR code, or from the texted link. No login: the
 * token is the same unguessable one as the customer's tracking link, and the
 * page shows only what a receipt would.
 */

type PayInfo = {
  company: { name: string; logo: string; brandColor: string };
  job: { title: string; status: string; number: string };
  items: { label: string; qty: number; unit: string; amount: number }[];
  subtotal: number;
  tax: number;
  taxLabel: string;
  total: number;
  currency: string;
  paid: boolean;
  invoiceNumber: string | null;
  cardPayments: boolean;
};

type Intent = { clientSecret: string; publishableKey: string; stripeAccount?: string; total: number; currency: string };

const stripeCache = new Map<string, Promise<Stripe | null>>();
const stripeFor = (pk: string, acct?: string) => {
  const k = `${pk}|${acct ?? ""}`;
  if (!stripeCache.has(k)) stripeCache.set(k, loadStripe(pk, acct ? { stripeAccount: acct } : undefined));
  return stripeCache.get(k)!;
};

export default function PayPublic() {
  const { token = "" } = useParams<{ token: string }>();
  const q = useQuery({
    queryKey: ["pay", token],
    queryFn: async () => {
      const r = await fetch(`/api/pay/${encodeURIComponent(token)}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || "This payment link isn't available.");
      return (await r.json()) as PayInfo;
    },
    retry: false,
  });
  const [paidNow, setPaidNow] = useState(false);
  const info = q.data;
  const paid = paidNow || !!info?.paid;

  useEffect(() => {
    document.title = info?.company.name ? `Pay ${info.company.name}` : "Pay securely";
  }, [info?.company.name]);

  return (
    <div className="min-h-dvh bg-[#070b12] px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-md">
        {q.isLoading && (
          <div className="grid place-items-center py-24 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        )}
        {q.isError && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
            <p className="font-semibold">This payment link isn't available.</p>
            <p className="mt-1 text-sm text-slate-400">Ask your technician for a new one.</p>
          </div>
        )}
        {info && (
          <>
            <header className="mb-6 flex items-center gap-3">
              {info.company.logo ? (
                <TenantLogo src={info.company.logo} name={info.company.name} variant="plate" className="h-11 w-11 px-1 py-1" fallbackClassName="h-11 w-11 text-sm" />
              ) : (
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-sky-500/15 font-bold text-sky-300">
                  {info.company.name.slice(0, 1) || "·"}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-base font-bold">{info.company.name || "Payment"}</p>
                <p className="truncate text-xs text-slate-400">{info.job.title} · #{info.job.number}</p>
              </div>
            </header>

            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              {info.items.length > 0 && (
                <ul className="mb-3 space-y-1.5 border-b border-white/10 pb-3 text-sm">
                  {info.items.map((it, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="text-slate-300">
                        {it.label}
                        {it.unit && it.unit !== "job" && it.unit !== "each" && <span className="text-slate-500"> · {it.qty} {it.unit}</span>}
                        {(it.unit === "each" || it.unit === "job") && it.qty > 1 && <span className="text-slate-500"> · {it.qty} ×</span>}
                      </span>
                      <span className="shrink-0 text-slate-200">{money(it.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="space-y-1 text-sm text-slate-400">
                <div className="flex justify-between"><span>Subtotal</span><span>{money(info.subtotal)}</span></div>
                <div className="flex justify-between"><span>{info.taxLabel}</span><span>{money(info.tax)}</span></div>
              </div>
              <div className="mt-2 flex items-baseline justify-between border-t border-white/10 pt-3">
                <span className="font-semibold">Total</span>
                <span className="text-3xl font-extrabold tracking-tight">{money(info.total)}</span>
              </div>
            </section>

            <div className="mt-5">
              {paid ? (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                  <p className="text-lg font-bold">Paid. Thank you!</p>
                  <p className="text-sm text-slate-300">A receipt is on its way{info.invoiceNumber ? ` for invoice ${info.invoiceNumber}` : ""}.</p>
                </div>
              ) : !info.cardPayments ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-sm text-slate-300">
                  Card payments aren't switched on for {info.company.name || "this business"} yet. Please pay your technician another way.
                </div>
              ) : info.total <= 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-sm text-slate-300">There's no balance to pay on this job.</div>
              ) : (
                <CardPayment token={token} onPaid={() => setPaidNow(true)} />
              )}
            </div>

            <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
              <ShieldCheck className="h-3.5 w-3.5" /> Payments are processed securely by Stripe. {info.company.name || "The business"} never sees your card number.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function CardPayment({ token, onPaid }: { token: string; onPaid: () => void }) {
  const [intent, setIntent] = useState<Intent | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const r = await fetch(`/api/pay/${encodeURIComponent(token)}/intent`, { method: "POST" });
        const j = await r.json().catch(() => ({}));
        if (off) return;
        if (j.alreadyPaid) return onPaid();
        if (!r.ok || !j.clientSecret) return setErr(j?.error?.message || j?.message || "Card payment isn't available right now.");
        setIntent(j as Intent);
      } catch {
        if (!off) setErr("Card payment isn't available right now.");
      }
    })();
    return () => {
      off = true;
    };
  }, [token, onPaid]);
  const stripe = useMemo(() => (intent ? stripeFor(intent.publishableKey, intent.stripeAccount) : null), [intent]);
  if (err) return <p className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{err}</p>;
  if (!intent || !stripe)
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Setting up secure checkout…
      </div>
    );
  return (
    <Elements
      stripe={stripe}
      options={{
        clientSecret: intent.clientSecret,
        appearance: { theme: "night", variables: { colorPrimary: "#0ea5e9", colorBackground: "#0d131d", borderRadius: "12px" } },
      }}
    >
      <PayForm token={token} total={intent.total} onPaid={onPaid} />
    </Elements>
  );
}

function PayForm({ token, total, onPaid }: { token: string; total: number; onPaid: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setErr(null);
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: window.location.href },
    });
    if (error) {
      setErr(error.message ?? "The payment didn't go through. Please check the card details.");
      setBusy(false);
      return;
    }
    if (paymentIntent && ["succeeded", "processing"].includes(paymentIntent.status)) {
      await fetch(`/api/pay/${encodeURIComponent(token)}/sync`, { method: "POST" }).catch(() => {});
      onPaid();
      return;
    }
    setErr("The payment couldn't be completed. Please try again.");
    setBusy(false);
  }
  return (
    <form onSubmit={submit} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <PaymentElement options={{ layout: "tabs", wallets: { applePay: "auto", googlePay: "auto" } }} />
      {err && <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{err}</p>}
      <button
        type="submit"
        disabled={!stripe || busy}
        className="nvc-btn nvc-btn-lg mt-5 w-full bg-sky-500 text-white hover:bg-sky-400"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
        Pay {money(total)}
      </button>
    </form>
  );
}
