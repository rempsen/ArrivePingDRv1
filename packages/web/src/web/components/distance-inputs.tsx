import { useState } from "react";
import { useDistanceUnit } from "../lib/use-brand";
import { distanceLabel, kmToUnit, perKmToUnit, unitRateToPerKm, unitToKm } from "../../shared/units";

/**
 * Inputs for distances and mileage rates in the company's unit. Values are
 * always stored metric (km, money per km); what a person types and sees is km
 * or mi, $/km or $/mi, following Settings → Distance units.
 */

const trim = (n: number, digits: number) => {
  const v = Math.round(n * 10 ** digits) / 10 ** digits;
  return Number.isFinite(v) ? String(v) : "0";
};

type Common = { className?: string; ariaLabel: string; placeholder?: string; disabled?: boolean };

/** A money-per-distance rate. `perKm === null` renders blank (e.g. "use the tech's rate"). */
export function MileageRateInput({
  perKm,
  onChange,
  allowBlank = false,
  className,
  ariaLabel,
  placeholder,
  disabled,
}: Common & { perKm: number | null; onChange: (perKm: number | null) => void; allowBlank?: boolean }) {
  const unit = useDistanceUnit();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (perKm === null ? "" : trim(perKmToUnit(perKm, unit), 3));
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
      <input
        aria-label={ariaLabel}
        className={`${className ?? ""} pl-7 pr-12`}
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        value={shown}
        onChange={(e) => {
          setDraft(e.target.value);
          const raw = e.target.value.trim();
          if (raw === "" && allowBlank) return onChange(null);
          const n = Number(raw);
          onChange(Number.isFinite(n) && n >= 0 ? unitRateToPerKm(n, unit) : 0);
        }}
        onBlur={() => setDraft(null)}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">/{distanceLabel(unit)}</span>
    </div>
  );
}

/** A distance in km or mi, stored as km. */
export function DistanceInput({ km, onChange, className, ariaLabel, placeholder, disabled }: Common & { km: number; onChange: (km: number) => void }) {
  const unit = useDistanceUnit();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (km ? trim(kmToUnit(km, unit), 2) : "");
  return (
    <div className="relative">
      <input
        aria-label={ariaLabel}
        className={`${className ?? ""} pr-10`}
        type="number"
        min={0}
        step="0.1"
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        value={shown}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) && n > 0 ? unitToKm(n, unit) : 0);
        }}
        onBlur={() => setDraft(null)}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">{distanceLabel(unit)}</span>
    </div>
  );
}
