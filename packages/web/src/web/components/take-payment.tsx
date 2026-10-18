import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, CreditCard, ExternalLink, MessageSquare, X } from "lucide-react";
import { apiHeaders } from "../lib/api";
import { money } from "../lib/utils";
import { DialogPanel } from "./dialog-panel";

type LinkResp = { url: string; qr: string; total: number; paid: boolean; cardPayments: boolean; canText: boolean; sent: boolean };

async function fetchLink(bookingId: string, send = false): Promise<LinkResp> {
  const r = await fetch(`/api/payments/link/${encodeURIComponent(bookingId)}`, {
    method: "POST",
    credentials: "include",
    headers: { ...apiHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ send }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || j?.message || "Couldn't start the payment");
  return j as LinkResp;
}

/**
 * The technician's "Take payment" for a job set to collect payment on site:
 * the total, a QR code for the customer's phone, "Pay on this phone", and a
 * text with the link. Watches for the payment so the tech sees it land.
 */
export function TakePayment({ bookingId, total }: { bookingId: string; total?: number }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["pay-link", bookingId],
    queryFn: () => fetchLink(bookingId),
    enabled: open,
    refetchInterval: (query) => (open && !query.state.data?.paid ? 4000 : false),
  });
  const text = useMutation({ mutationFn: () => fetchLink(bookingId, true) });
  const d = q.data;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/10 py-3.5 text-base font-bold text-emerald-300 transition hover:bg-emerald-500/20"
      >
        <CreditCard className="h-5 w-5" /> Take payment{total ? ` · ${money(total)}` : ""}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center">
          <DialogPanel onClose={() => setOpen(false)} label="Take payment" className="w-full max-w-sm rounded-t-3xl bg-ink-2 p-6 shadow-2xl sm:rounded-2xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Take payment</h3>
                <p className="text-xs text-slate-500">Card, Apple Pay or Google Pay, through Stripe</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="rounded-full p-1 text-slate-500 hover:bg-white/5 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            {q.isLoading && <p className="py-10 text-center text-sm text-slate-400">Getting the payment ready…</p>}
            {q.isError && <p className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{(q.error as Error).message}</p>}
            {d && d.paid && (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <CheckCircle2 className="h-12 w-12 text-emerald-400" />
                <p className="text-lg font-bold text-white">Paid {money(d.total)}</p>
                <p className="text-sm text-slate-400">The customer's receipt is on its way.</p>
              </div>
            )}
            {d && !d.paid && !d.cardPayments && (
              <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                Card payments aren't switched on for this company yet. Ask the office to connect Stripe in Settings → Payments.
              </p>
            )}
            {d && !d.paid && d.cardPayments && (
              <div className="space-y-4">
                <div className="flex items-baseline justify-between rounded-xl bg-ink px-4 py-3">
                  <span className="text-sm text-slate-400">Total</span>
                  <span className="text-2xl font-extrabold text-white">{money(d.total)}</span>
                </div>
                <div className="rounded-2xl bg-white p-3">
                  <img src={d.qr} alt="QR code: scan with a phone camera to pay" className="mx-auto aspect-square w-full max-w-[240px]" />
                </div>
                <p className="text-center text-xs text-slate-400">The customer scans this with their phone camera to pay.</p>
                <div className="grid grid-cols-2 gap-2">
                  <a href={d.url} target="_blank" rel="noopener" className="flex items-center justify-center gap-1.5 rounded-xl bg-brand py-3 text-sm font-semibold text-white hover:bg-brand-deep">
                    <ExternalLink className="h-4 w-4" /> Pay on this phone
                  </a>
                  <button
                    type="button"
                    disabled={!d.canText || text.isPending || text.data?.sent}
                    onClick={() => text.mutate()}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 py-3 text-sm font-semibold text-slate-200 hover:border-white/20 disabled:opacity-50"
                  >
                    <MessageSquare className="h-4 w-4" /> {text.data?.sent ? "Link sent" : "Text the link"}
                  </button>
                </div>
                {!d.canText && <p className="text-center text-[11px] text-slate-500">No phone number on this job to text.</p>}
                {text.data && !text.data.sent && <p className="text-center text-[11px] text-amber-300">The text couldn't be sent. Use the QR code instead.</p>}
                <p className="text-center text-[11px] text-slate-500">This screen updates by itself when the payment goes through.</p>
              </div>
            )}
          </DialogPanel>
        </div>
      )}
    </>
  );
}
