import { useState } from "react";
import { Car, Clock, CreditCard, HandCoins } from "lucide-react";
import { DEFAULT_TECH_PAY_MODEL, type TechPayModel } from "../../shared/tech-pay";
import { DistanceInput, MileageRateInput } from "./distance-inputs";
import { MileageBasisPicker } from "./rate-model-editor";
import { useWorkerNoun } from "../lib/use-brand";

const inputCls =
  "w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-brand/40 focus:outline-none";

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{children}</span>;
}

/**
 * How a workflow (template or work order) pays the technician — kept apart
 * from what the customer is charged, so a company can pay one rate and bill
 * another. Blank hourly / mileage rates mean "use the technician's own rate"
 * from their profile; `null` model = the tech's own rates for everything.
 */
export function TechPayEditor({ value, onChange }: { value: TechPayModel | null; onChange: (m: TechPayModel | null) => void }) {
  const { noun } = useWorkerNoun();
  const m = value ?? DEFAULT_TECH_PAY_MODEL;
  const set = (patch: Partial<TechPayModel>) => onChange({ ...m, ...patch });
  const [hourDraft, setHourDraft] = useState<string | null>(null);
  const [flatDraft, setFlatDraft] = useState<string | null>(null);
  const tech = noun.toLowerCase();
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-ink-3/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <HandCoins className="h-4 w-4 shrink-0 text-amber-300" />
        <span className="text-xs font-bold text-slate-300">{noun} pay</span>
        <span className="text-[11px] text-slate-500">Internal — never shown to the customer. Separate from what the customer is charged.</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="block">
          <Label>Hourly (time on site)</Label>
          <div className="relative">
            <Clock className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              aria-label={`${noun} hourly pay rate`}
              type="number"
              min={0}
              step="0.5"
              className={`${inputCls} pl-8`}
              placeholder="Own rate"
              value={hourDraft ?? (m.hourlyRate === null ? "" : String(m.hourlyRate))}
              onChange={(e) => {
                setHourDraft(e.target.value);
                const raw = e.target.value.trim();
                const n = Number(raw);
                set({ hourlyRate: raw === "" ? null : Number.isFinite(n) && n >= 0 ? n : 0 });
              }}
              onBlur={() => setHourDraft(null)}
            />
          </div>
        </label>
        <div className="block">
          <Label>Mileage</Label>
          <MileageRateInput
            ariaLabel={`${noun} mileage pay rate`}
            className={inputCls}
            allowBlank
            perKm={m.perKmRate}
            placeholder="Own rate"
            onChange={(v) => set({ perKmRate: v })}
          />
        </div>
        <label className="block">
          <Label>Flat per job</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
            <input
              aria-label={`${noun} flat pay per job`}
              type="number"
              min={0}
              step="1"
              className={`${inputCls} pl-7`}
              placeholder="0.00"
              value={flatDraft ?? (m.flatPay ? String(m.flatPay) : "")}
              onChange={(e) => {
                setFlatDraft(e.target.value);
                const n = Number(e.target.value);
                set({ flatPay: Number.isFinite(n) && n > 0 ? n : 0 });
              }}
              onBlur={() => setFlatDraft(null)}
            />
          </div>
        </label>
      </div>
      <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_auto]">
        <div className="block">
          <Label>Unpaid distance per job</Label>
          <DistanceInput ariaLabel="Unpaid distance before mileage pay" className={inputCls} km={m.includedKm} onChange={(km) => set({ includedKm: km })} placeholder="0" />
        </div>
        <div>
          <Label>
            <span className="inline-flex items-center gap-1"><Car className="h-3 w-3" /> Mileage that counts</span>
          </Label>
          <MileageBasisPicker label={`${noun} mileage basis`} value={m.mileageBasis} onChange={(b) => set({ mileageBasis: b })} />
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        Leave a rate blank to use each {tech}'s own rate from their profile. Mileage is tracked and recorded on every job either way; a rate of $0 simply doesn't pay it.
      </p>
      {value && (
        <button type="button" className="text-[11px] font-semibold text-slate-400 underline-offset-2 hover:text-white hover:underline" onClick={() => onChange(null)}>
          Reset to each {tech}'s own rates
        </button>
      )}
    </div>
  );
}

/** Whether the technician takes payment in the field for this workflow. */
export function CollectPaymentToggle({ value, onChange }: { value: string; onChange: (v: "" | "on_site") => void }) {
  const on = value === "on_site";
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-ink-3/40 p-4">
      <input
        id="collect-payment-on-site"
        aria-label="Collect payment on site"
        type="checkbox"
        className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--brand,#0ea5e9)]"
        checked={on}
        onChange={(e) => onChange(e.target.checked ? "on_site" : "")}
      />
      <div>
        <label htmlFor="collect-payment-on-site" className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-white">
          <CreditCard className="h-4 w-4 text-brand" /> Collect payment on site
        </label>
        <p className="mt-0.5 text-xs text-slate-400">
          The technician gets a Take payment button with the job total. The customer pays by card, Apple Pay or Google Pay through your connected Stripe account, on the technician's phone or their own.
        </p>
      </div>
    </div>
  );
}
