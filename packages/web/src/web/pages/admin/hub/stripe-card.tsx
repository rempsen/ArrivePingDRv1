/**
 * Control Hub → Overview → Stripe: how our own Stripe account is wired and
 * which companies are failing to pay. Staff and owners only (GET /api/hub/stripe).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CheckCircle2, CreditCard, TriangleAlert } from "lucide-react";
import { Card, Skeleton } from "../analytics-ui";
import { EmptyNote } from "./hub-ui";
import { hub, type StripeStatus } from "./hub-data";

function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) {
  const Icon = ok ? CheckCircle2 : TriangleAlert;
  const tone = ok ? "text-emerald-400" : ok === null ? "text-slate-500" : "text-amber-300";
  return (
    <li className="flex items-start gap-2 text-[13px]">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} aria-hidden="true" />
      <span className="text-slate-200">
        {label}
        {detail && <span className="block text-[12px] text-slate-500">{detail}</span>}
      </span>
    </li>
  );
}

const MODE_LABEL: Record<StripeStatus["mode"], string> = { live: "Live mode", test: "Test mode", off: "Not configured" };

export function StripeCard() {
  const q = useQuery({ queryKey: ["hub", "stripe"], queryFn: () => hub<StripeStatus>("/stripe"), staleTime: 60_000 });
  const s = q.data;
  const price = s?.price;
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          Stripe
          {s && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${s.mode === "live" ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-200"}`}>{MODE_LABEL[s.mode]}</span>
          )}
        </span>
      }
      caption="Our own account for charging companies, not the ones companies connect for their customers."
    >
      {q.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : q.isError || !s ? (
        <EmptyNote>Couldn&apos;t load Stripe status.</EmptyNote>
      ) : (
        <div className="space-y-5">
          {s.stripeError && <p className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-100">Stripe didn&apos;t answer: {s.stripeError}</p>}
          <ul className="space-y-2">
            <Check ok={s.configured} label="Secret key set" detail={s.configured ? undefined : "Nobody can be billed until STRIPE_SECRET_KEY is set."} />
            <Check
              ok={s.publishableKeyMatchesMode}
              label="Publishable key matches the secret key"
              detail={s.publishableKeyMatchesMode === false ? "One is live and the other is test, so the card form will fail." : undefined}
            />
            <Check ok={s.webhookSecretSet} label="Platform webhook secret set" detail={s.webhookSecretSet ? undefined : "Subscription and failed-payment events can't be verified."} />
            <Check ok={s.connectWebhookSecretSet} label="Connected-accounts webhook secret set" detail={s.connectWebhookSecretSet ? undefined : "Card payments to companies' own Stripe accounts won't update."} />
            <Check ok={!!price?.active} label={price ? `Subscription price ${price.id}${s.priceOverride ? " (set by hand)" : ""}` : "Subscription price"} detail={price ? (price.active ? undefined : "This price is archived in Stripe.") : "None yet. It's created when the first company signs up."} />
          </ul>

          {price && price.tiers.length > 0 && (
            <p className="text-[12px] text-slate-400">
              {price.tiers
                .map((t, i) => {
                  const from = i === 0 ? 1 : (price.tiers[i - 1]!.upTo ?? 0) + 1;
                  const range = t.upTo == null ? `${from}+` : `${from}–${t.upTo}`;
                  return `${range}: ${t.flat ? `$${t.flat} flat` : `$${t.unit} each`}`;
                })
                .join(" · ")}
            </p>
          )}

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Webhook endpoints in Stripe</p>
            {s.webhooks.length === 0 ? (
              <p className="text-[13px] text-slate-500">{s.configured && !s.stripeError ? "None registered. Stripe can't tell us about renewals or failures." : "—"}</p>
            ) : (
              <ul className="space-y-1">
                {s.webhooks.map((w) => (
                  <li key={w.url} className="truncate text-[12px] text-slate-300">
                    <span className={w.status === "enabled" ? "text-emerald-400" : "text-amber-300"}>{w.status}</span> · {w.url} · {w.events} events
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Payments failing · {s.pastDue.length}</p>
            {s.pastDue.length === 0 ? (
              <p className="text-[13px] text-slate-500">Every billed company is paid up ({s.customersBilled} on a subscription).</p>
            ) : (
              <ul className="divide-y divide-white/[0.05]">
                {s.pastDue.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                    <Link href={`/admin/hub/tenants/${c.id}`} className="truncate font-semibold text-slate-200 hover:text-white">
                      {c.name}
                    </Link>
                    <span className="shrink-0 text-[12px] text-slate-500">
                      {c.billingStatus === "unpaid" ? "Unpaid" : "Past due"} · {c.seats} seats
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
