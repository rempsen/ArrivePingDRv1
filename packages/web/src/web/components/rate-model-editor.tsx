import { useState } from "react";
import { money } from "../lib/utils";
import { EMPTY_RATE_MODEL, type MileageBasis, type RateModel } from "../../shared/pricing";
import { Car, Clock, DollarSign, Hash, Plus, Trash2 } from "lucide-react";
import { DistanceInput, MileageRateInput } from "./distance-inputs";
import { useDistanceUnit } from "../lib/use-brand";
import { fmtDistance, perKmToUnit, distanceLabel } from "../../shared/units";

export type PricingMode = "per_hour" | "per_unit" | "flat_fee";

function detectMode(rm: RateModel): PricingMode {
  if ((rm.firstHourRate || 0) > 0 || (rm.additionalHourRate || 0) > 0 || (rm.timeRate > 0 && rm.flatRate === 0))
    return "per_hour";
  return "flat_fee";
}

// ── shared input primitives ───────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </span>
  );
}

function MoneyInput({ label, val, onSet, placeholder }: {
  label: string; val: number; onSet: (n: number) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">$</span>
        <input
          aria-label={label}
          type="number" min={0} step="0.01"
          value={val || ""}
          onChange={(e) => onSet(parseFloat(e.target.value) || 0)}
          placeholder={placeholder ?? "0.00"}
          className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 pl-6 text-sm text-white placeholder:text-slate-600 focus:border-brand/40 focus:outline-none"
        />
      </div>
    </label>
  );
}

// kept for the upcoming free-text rate field; not wired up yet (exported so it
// is not an unused local under noUnusedLocals)
export function _TextInput({ label, val, onSet, placeholder }: {
  label: string; val: string; onSet: (s: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input
        aria-label={label}
        type="text"
        value={val}
        onChange={(e) => onSet(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-brand/40 focus:outline-none"
      />
    </label>
  );
}

function NumberInput({ label, val, onSet, suffix, step }: {
  label: string; val: number; onSet: (n: number) => void; suffix?: string; step?: string;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <div className="relative">
        <input
          aria-label={label}
          type="number" min={0} step={step ?? "1"}
          value={val || ""}
          onChange={(e) => onSet(parseFloat(e.target.value) || 0)}
          className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-brand/40 focus:outline-none"
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

// ── per-unit line ─────────────────────────────────────────────────────────────

export interface PerUnitLine {
  id: string;
  qty: number;
  unitLabel: string;  // unit of measure e.g. "sq ft", "hours"
  name: string;       // item name e.g. "Installation", "Labour"
  unitPrice: number;  // cost per unit (customer charge)
}

export type { PerUnitLine as PricingUnitLine };

function newLine(): PerUnitLine {
  return { id: Math.random().toString(36).slice(2), qty: 1, unitLabel: "", name: "", unitPrice: 0 };
}

export const EMPTY_UNIT_LINE: PerUnitLine = { id: "default", qty: 1, unitLabel: "", name: "", unitPrice: 0 };

// ── pill selector ─────────────────────────────────────────────────────────────

const MODES: { id: PricingMode; label: string; icon: React.ReactNode }[] = [
  { id: "per_hour", label: "Per hour", icon: <Clock className="h-3.5 w-3.5" /> },
  { id: "per_unit", label: "Per unit", icon: <Hash className="h-3.5 w-3.5" /> },
  { id: "flat_fee", label: "Flat fee", icon: <DollarSign className="h-3.5 w-3.5" /> },
];

// ── main component ────────────────────────────────────────────────────────────

export function RateModelEditor({
  value,
  onChange,
  onUnitLinesChange,
  /** @deprecated use onUnitLinesChange */ onUnitLineChange,
}: {
  value: RateModel;
  onChange: (rm: RateModel) => void;
  onUnitLinesChange?: (lines: PerUnitLine[]) => void;
  onUnitLineChange?: (line: PerUnitLine | null) => void;
}) {
  const rm = { ...EMPTY_RATE_MODEL, ...value };
  const set = (patch: Partial<RateModel>) => onChange({ ...rm, ...patch });

  const [mode, setMode] = useState<PricingMode>(() => detectMode(rm));
  const [unitLines, setUnitLines] = useState<PerUnitLine[]>([newLine()]);

  function pushUnitLines(next: PerUnitLine[]) {
    setUnitLines(next);
    onUnitLinesChange?.(next.filter((l) => l.qty > 0 && l.unitPrice > 0));
    // legacy compat
    const valid = next.filter((l) => l.qty > 0 && l.unitPrice > 0);
    onUnitLineChange?.(valid[0] ?? null);
  }

  function updateLine(id: string, patch: Partial<PerUnitLine>) {
    const next = unitLines.map((l) => (l.id === id ? { ...l, ...patch } : l));
    pushUnitLines(next);
  }

  function addLine() {
    pushUnitLines([...unitLines, newLine()]);
  }

  function removeLine(id: string) {
    const next = unitLines.filter((l) => l.id !== id);
    pushUnitLines(next.length > 0 ? next : [newLine()]);
  }

  function switchMode(next: PricingMode) {
    setMode(next);
    // The mileage charge is its own component and survives a mode switch.
    const mileage = { kmRate: rm.kmRate, includedKm: rm.includedKm, kmBasis: rm.kmBasis };
    if (next === "per_hour") {
      onChange({ ...EMPTY_RATE_MODEL, ...mileage, freeMinutes: rm.freeMinutes, firstHourRate: rm.firstHourRate, additionalHourRate: rm.additionalHourRate });
    } else if (next === "per_unit") {
      onChange({ ...EMPTY_RATE_MODEL, ...mileage });
    } else {
      onChange({ ...EMPTY_RATE_MODEL, ...mileage, flatRate: rm.flatRate, includedMinutes: rm.includedMinutes, timeRate: rm.flatRate ? rm.timeRate : 0, timeUnit: "hour" });
    }
    onUnitLinesChange?.([]);
    onUnitLineChange?.(null);
  }

  // ── derived totals for per-unit preview ──
  const unitTotal = unitLines.reduce((s, l) => s + (l.qty || 0) * (l.unitPrice || 0), 0);

  return (
    <div className="rounded-xl border border-white/10 bg-ink-3/40 p-4 space-y-4">

      {/* header + pills */}
      <div className="flex flex-wrap items-center gap-3">
        <DollarSign className="h-4 w-4 text-cyan-glow shrink-0" />
        <span className="text-xs font-bold text-slate-300 shrink-0">Pricing</span>
        <div className="flex gap-1.5 ml-auto flex-wrap">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => switchMode(m.id)}
              className={[
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all",
                mode === m.id
                  ? "bg-brand text-white shadow-md shadow-brand/30"
                  : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white",
              ].join(" ")}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── PER HOUR ── */}
      {mode === "per_hour" && (
        <div className="space-y-3">
          {/* Free time selector */}
          <div>
            <Label>Included free time</Label>
            <div className="flex gap-2">
              {([0, 30, 60] as const).map((min) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => set({ freeMinutes: min })}
                  className={[
                    "nvc-btn nvc-btn-xs flex-1 border",
                    (rm.freeMinutes || 0) === min
                      ? "border-brand/60 bg-brand/20 text-brand"
                      : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10",
                  ].join(" ")}
                >
                  {min === 0 ? "None" : min === 30 ? "30 min free" : "First hr free"}
                </button>
              ))}
            </div>
          </div>

          {/* Tiered rates */}
          <div className="grid grid-cols-2 gap-2">
            <MoneyInput
              label="First hour"
              val={rm.firstHourRate}
              onSet={(n) => set({ firstHourRate: n })}
              placeholder="e.g. 150.00"
            />
            <MoneyInput
              label="Each hour after"
              val={rm.additionalHourRate}
              onSet={(n) => set({ additionalHourRate: n })}
              placeholder="e.g. 100.00"
            />
          </div>

          {/* Live summary */}
          {(rm.firstHourRate > 0 || rm.additionalHourRate > 0) && (
            <div className="rounded-lg bg-brand/10 px-3 py-2 text-xs text-cyan-glow space-y-0.5">
              {(rm.freeMinutes || 0) > 0 && (
                <div>First {rm.freeMinutes} min: <span className="font-semibold text-white">free</span></div>
              )}
              {rm.firstHourRate > 0 && (
                <div>First hour: <span className="font-semibold text-white">{money(rm.firstHourRate)}</span></div>
              )}
              {rm.additionalHourRate > 0 && (
                <div>Each hour after: <span className="font-semibold text-white">{money(rm.additionalHourRate)}</span></div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── PER UNIT (multi-line) ── */}
      {mode === "per_unit" && (
        <div className="space-y-2">
          {/* Column headers */}
          <div className="grid grid-cols-[80px_1fr_1fr_90px_32px] gap-2 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Qty</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Unit of measure</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Item name</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Cost / unit</span>
            <span />
          </div>

          {/* Lines */}
          {unitLines.map((line, i) => (
            <div key={line.id} className="grid grid-cols-[80px_1fr_1fr_90px_32px] gap-2 items-start">
              {/* Qty */}
              <div className="relative">
                <input
                  aria-label={`Qty line ${i + 1}`}
                  type="number" min={0} step="1"
                  value={line.qty || ""}
                  onChange={(e) => updateLine(line.id, { qty: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                  className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-brand/40 focus:outline-none"
                />
              </div>

              {/* Unit of measure */}
              <input
                aria-label={`Unit ${i + 1}`}
                type="text"
                value={line.unitLabel}
                onChange={(e) => updateLine(line.id, { unitLabel: e.target.value })}
                placeholder="sq ft, hrs, pieces…"
                className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-brand/40 focus:outline-none"
              />

              {/* Item name */}
              <input
                aria-label={`Name ${i + 1}`}
                type="text"
                value={line.name}
                onChange={(e) => updateLine(line.id, { name: e.target.value })}
                placeholder="Installation, Labour…"
                className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-brand/40 focus:outline-none"
              />

              {/* Cost per unit */}
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">$</span>
                <input
                  aria-label={`Cost ${i + 1}`}
                  type="number" min={0} step="0.01"
                  value={line.unitPrice || ""}
                  onChange={(e) => updateLine(line.id, { unitPrice: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 pl-6 text-sm text-white placeholder:text-slate-600 focus:border-brand/40 focus:outline-none"
                />
              </div>

              {/* Remove */}
              <button
                type="button"
                onClick={() => removeLine(line.id)}
                className="mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                aria-label="Remove line"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {/* Line totals per row */}
          {unitLines.some((l) => l.qty > 0 && l.unitPrice > 0) && (
            <div className="space-y-0.5 pt-1">
              {unitLines.filter((l) => l.qty > 0 && l.unitPrice > 0).map((l) => (
                <div key={l.id} className="flex justify-between text-xs text-slate-400 px-1">
                  <span>
                    {l.qty} {l.unitLabel || "unit"}{l.name ? ` · ${l.name}` : ""} × {money(l.unitPrice)}
                  </span>
                  <span className="text-cyan-glow font-semibold">{money(l.qty * l.unitPrice)}</span>
                </div>
              ))}
              {unitLines.filter((l) => l.qty > 0 && l.unitPrice > 0).length > 1 && (
                <div className="flex justify-between border-t border-white/10 pt-1 text-xs font-bold text-white px-1">
                  <span>Total</span>
                  <span>{money(unitTotal)}</span>
                </div>
              )}
            </div>
          )}

          {/* Add line button */}
          <button
            type="button"
            onClick={addLine}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs text-slate-400 hover:border-brand/40 hover:text-brand transition-colors w-full justify-center"
          >
            <Plus className="h-3.5 w-3.5" />
            Add another item
          </button>
        </div>
      )}

      {/* ── FLAT FEE ── */}
      {mode === "flat_fee" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <MoneyInput
              label="Flat $"
              val={rm.flatRate}
              onSet={(n) => set({ flatRate: n })}
              placeholder="0.00"
            />
            <NumberInput
              label="Incl. minutes"
              val={rm.includedMinutes}
              onSet={(n) => set({ includedMinutes: n })}
              suffix="min"
            />
          </div>
          <MoneyInput
            label="Then per hour (optional)"
            val={rm.timeRate}
            onSet={(n) => set({ timeRate: n, timeUnit: "hour" })}
            placeholder="0.00"
          />
          {rm.flatRate > 0 && (
            <div className="rounded-lg bg-brand/10 px-3 py-2 text-xs text-cyan-glow">
              Fixed charge of <span className="font-semibold text-white">{money(rm.flatRate)}</span>
              {rm.includedMinutes > 0 && ` · includes ${rm.includedMinutes} min`}
              {rm.timeRate > 0 && rm.timeUnit === "hour" && ` · then ${money(rm.timeRate)}/hr`}
            </div>
          )}
        </div>
      )}

      <MileageCharge rm={rm} set={set} />
    </div>
  );
}

/** Round trip vs drive-to-the-job, shared by the customer and technician editors. */
export function MileageBasisPicker({ value, onChange, label }: { value: MileageBasis | undefined; onChange: (b: MileageBasis) => void; label: string }) {
  return (
    <fieldset aria-label={label} className="m-0 inline-flex min-w-0 rounded-lg border border-white/10 bg-white/5 p-0.5">
      {([["round_trip", "Round trip"], ["to_job", "Drive to the job only"]] as const).map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={(value ?? "round_trip") === v}
          onClick={() => onChange(v)}
          className={[
            "rounded-md px-2.5 py-1 text-[11px] font-semibold transition",
            (value ?? "round_trip") === v ? "bg-brand/25 text-brand" : "text-slate-400 hover:text-white",
          ].join(" ")}
        >
          {text}
        </button>
      ))}
    </fieldset>
  );
}

/** Charging the customer for distance driven — works with every pricing mode. */
export function MileageCharge({ rm, set }: { rm: RateModel; set: (p: Partial<RateModel>) => void }) {
  const unit = useDistanceUnit();
  return (
    <div className="space-y-2 border-t border-white/10 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Car className="h-3.5 w-3.5 text-cyan-glow" />
        <span className="text-xs font-bold text-slate-300">Mileage charge</span>
        <span className="text-[11px] text-slate-500">Mileage is always tracked and recorded; charge for it only if you want to.</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="block">
          <Label>{`Charge per ${distanceLabel(unit)}`}</Label>
          <MileageRateInput
            ariaLabel="Customer mileage charge rate"
            className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-brand/40 focus:outline-none"
            perKm={rm.kmRate || 0}
            onChange={(v) => set({ kmRate: v ?? 0 })}
            placeholder="0.00"
          />
        </div>
        <div className="block">
          <Label>Free distance per job</Label>
          <DistanceInput
            ariaLabel="Free distance before the mileage charge"
            className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-brand/40 focus:outline-none"
            km={rm.includedKm || 0}
            onChange={(km) => set({ includedKm: km })}
            placeholder="0"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Label>Distance that counts</Label>
        <MileageBasisPicker label="Customer mileage basis" value={rm.kmBasis} onChange={(b) => set({ kmBasis: b })} />
      </div>
      {rm.kmRate > 0 && (
        <div className="rounded-lg bg-brand/10 px-3 py-2 text-xs text-cyan-glow">
          {money(perKmToUnit(rm.kmRate, unit))} per {distanceLabel(unit)}
          {rm.kmBasis === "to_job" ? " for the drive to the job" : " for the round trip"}
          {rm.includedKm > 0 && `, after the first ${fmtDistance(rm.includedKm, unit)}`}
        </div>
      )}
    </div>
  );
}
