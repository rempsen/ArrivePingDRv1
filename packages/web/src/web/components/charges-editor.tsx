/**
 * ChargesEditor — unified line-item builder.
 *
 * Lets the user add any mix of:
 *   • Flat fee        — fixed dollar amount
 *   • Hourly          — tiered first-hour + subsequent-hour rates
 *   • Per unit        — qty × unit × rate
 *
 * Each charge is committed with an "Add" button and appears in a deletable list.
 * The committed list is the single source of truth for pricing.
 */

import { useState } from "react";
import { Clock, DollarSign, Hash, Trash2, CheckCircle } from "lucide-react";
import { money } from "../lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ChargeType = "flat_fee" | "hourly" | "per_unit";

export interface FlatCharge {
  id: string;
  type: "flat_fee";
  label: string;       // description
  amount: number;      // total fixed charge
  techPay: number;     // optional tech pay
}

export interface HourlyCharge {
  id: string;
  type: "hourly";
  label: string;
  freeMinutes: 0 | 30 | 60;
  firstHourRate: number;
  additionalHourRate: number;
  techPayRate: number; // per hour to tech
}

export interface PerUnitCharge {
  id: string;
  type: "per_unit";
  name: string;
  unit: string;        // e.g. "sq ft", "hrs"
  qty: number;
  unitPrice: number;   // charge to client
  unitPayRate: number; // pay to tech per unit
}

export type Charge = FlatCharge | HourlyCharge | PerUnitCharge;

// ── helpers ────────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2); }

function chargeClientTotal(c: Charge): number {
  if (c.type === "flat_fee") return c.amount;
  if (c.type === "hourly") return 0; // computed at job time
  return Math.round(c.qty * c.unitPrice * 100) / 100;
}

function chargeTechTotal(c: Charge): number {
  if (c.type === "flat_fee") return c.techPay;
  if (c.type === "hourly") return 0;
  return Math.round(c.qty * c.unitPayRate * 100) / 100;
}

export function chargesSummary(charges: Charge[]) {
  let clientTotal = 0;
  let techTotal = 0;
  for (const c of charges) {
    clientTotal += chargeClientTotal(c);
    techTotal += chargeTechTotal(c);
  }
  return { clientTotal, techTotal };
}

// ── shared UI primitives ───────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </span>
  );
}

const inputCls =
  "w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-brand/40 focus:outline-none";

function MoneyInput({
  label, val, onSet, placeholder, amber,
}: {
  label: string; val: number; onSet: (n: number) => void; placeholder?: string; amber?: boolean;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <div className="relative">
        <span className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs ${amber ? "text-amber-500/70" : "text-slate-500"}`}>$</span>
        <input
          aria-label={label}
          type="number" min={0} step="0.01"
          value={val || ""}
          onChange={(e) => onSet(Math.max(0, parseFloat(e.target.value) || 0))}
          placeholder={placeholder ?? "0.00"}
          className={`${inputCls} pl-6 ${amber ? "text-amber-300" : ""}`}
        />
      </div>
    </label>
  );
}

// ── committed charge list item ─────────────────────────────────────────────────

function ChargeRow({ charge, onRemove }: { charge: Charge; onRemove: () => void }) {
  const clientAmt = chargeClientTotal(charge);
  const techAmt = chargeTechTotal(charge);

  let icon = <DollarSign className="h-3.5 w-3.5 text-cyan-400 shrink-0" />;
  let title = "";
  let detail = "";

  if (charge.type === "flat_fee") {
    title = charge.label || "Flat fee";
    detail = `${money(charge.amount)} fixed`;
  } else if (charge.type === "hourly") {
    icon = <Clock className="h-3.5 w-3.5 text-cyan-400 shrink-0" />;
    title = charge.label || "Hourly";
    const parts: string[] = [];
    if (charge.freeMinutes) parts.push(`${charge.freeMinutes} min free`);
    if (charge.firstHourRate) parts.push(`${money(charge.firstHourRate)}/1st hr`);
    if (charge.additionalHourRate) parts.push(`${money(charge.additionalHourRate)}/hr after`);
    detail = parts.join(" · ") || "Hourly";
  } else {
    icon = <Hash className="h-3.5 w-3.5 text-cyan-400 shrink-0" />;
    title = charge.name || "Per unit";
    detail = `${charge.qty} ${charge.unit} × ${money(charge.unitPrice)}`;
  }

  return (
    <div className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2.5">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium text-white">{title}</div>
        <div className="text-xs text-slate-400">{detail}</div>
      </div>
      <div className="text-right shrink-0">
        {clientAmt > 0 && (
          <div className="text-sm font-semibold text-white">{money(clientAmt)}</div>
        )}
        {charge.type === "hourly" && (
          <div className="text-xs text-slate-400">billed at job time</div>
        )}
        {techAmt > 0 && (
          <div className="text-xs text-amber-400">pay {money(techAmt)}</div>
        )}
      </div>
      <button
        type="button"
        aria-label="Remove charge"
        onClick={onRemove}
        className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-colors"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── input forms per charge type ────────────────────────────────────────────────

const UNIT_OPTS = ["sq ft", "sq yd", "linear ft", "piece", "each", "hour", "custom…"];

function FlatFeeForm({ onAdd }: { onAdd: (c: FlatCharge) => void }) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState(0);
  const [techPay, setTechPay] = useState(0);

  function submit() {
    if (amount <= 0) return;
    onAdd({ id: uid(), type: "flat_fee", label, amount, techPay });
    setLabel(""); setAmount(0); setTechPay(0);
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>Description (optional)</Label>
        <input
          aria-label="Flat fee description"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Call-out fee, Service charge…"
          className={inputCls}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <MoneyInput label="Charge amount" val={amount} onSet={setAmount} placeholder="150.00" />
        <MoneyInput label="Tech pay (optional)" val={techPay} onSet={setTechPay} amber />
      </div>
      {amount > 0 && (
        <div className="rounded-lg bg-brand/10 px-3 py-2 text-xs text-cyan-400">
          Fixed charge of <span className="font-semibold text-white">{money(amount)}</span>
          {techPay > 0 && <> · tech pay <span className="font-semibold text-amber-300">{money(techPay)}</span></>}
        </div>
      )}
      <AddBtn onClick={submit} disabled={amount <= 0} />
    </div>
  );
}

function HourlyForm({ onAdd }: { onAdd: (c: HourlyCharge) => void }) {
  const [label, setLabel] = useState("");
  const [freeMin, setFreeMin] = useState<0 | 30 | 60>(0);
  const [firstRate, setFirstRate] = useState(0);
  const [addlRate, setAddlRate] = useState(0);
  const [techRate, setTechRate] = useState(0);

  function submit() {
    if (firstRate <= 0 && addlRate <= 0) return;
    onAdd({
      id: uid(), type: "hourly",
      label, freeMinutes: freeMin,
      firstHourRate: firstRate, additionalHourRate: addlRate, techPayRate: techRate,
    });
    setLabel(""); setFreeMin(0); setFirstRate(0); setAddlRate(0); setTechRate(0);
  }

  const ready = firstRate > 0 || addlRate > 0;

  return (
    <div className="space-y-3">
      <div>
        <Label>Description (optional)</Label>
        <input
          aria-label="Hourly description"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Labour, Installation…"
          className={inputCls}
        />
      </div>
      <div>
        <Label>Included free time</Label>
        <div className="flex gap-2">
          {([0, 30, 60] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setFreeMin(m)}
              className={[
                "flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-all",
                freeMin === m
                  ? "border-brand/60 bg-brand/20 text-brand"
                  : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10",
              ].join(" ")}
            >
              {m === 0 ? "None" : m === 30 ? "30 min free" : "First hr free"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <MoneyInput label="First hour" val={firstRate} onSet={setFirstRate} placeholder="150.00" />
        <MoneyInput label="Each hour after" val={addlRate} onSet={setAddlRate} placeholder="100.00" />
      </div>
      <MoneyInput label="Tech pay / hr (optional)" val={techRate} onSet={setTechRate} amber />
      {ready && (
        <div className="rounded-lg bg-brand/10 px-3 py-2 text-xs text-cyan-400 space-y-0.5">
          {freeMin > 0 && <div>First {freeMin} min: <span className="font-semibold text-white">free</span></div>}
          {firstRate > 0 && <div>First hour: <span className="font-semibold text-white">{money(firstRate)}</span></div>}
          {addlRate > 0 && <div>Each hour after: <span className="font-semibold text-white">{money(addlRate)}</span></div>}
        </div>
      )}
      <AddBtn onClick={submit} disabled={!ready} />
    </div>
  );
}

function PerUnitForm({ onAdd }: { onAdd: (c: PerUnitCharge) => void }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("sq ft");
  const [customUnit, setCustomUnit] = useState("");
  const [qty, setQty] = useState<number>(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [unitPay, setUnitPay] = useState(0);

  const resolvedUnit = unit === "custom…" ? customUnit : unit;
  const lineTotal = Math.round(qty * unitPrice * 100) / 100;
  const ready = qty > 0 && unitPrice > 0;

  function submit() {
    if (!ready) return;
    onAdd({
      id: uid(), type: "per_unit",
      name, unit: resolvedUnit || "each",
      qty, unitPrice, unitPayRate: unitPay,
    });
    setName(""); setUnit("sq ft"); setCustomUnit(""); setQty(1); setUnitPrice(0); setUnitPay(0);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <div>
          <Label>Item description</Label>
          <input
            aria-label="Item description"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. LVP install, Carpet supply…"
            className={inputCls}
          />
        </div>
        <div>
          <Label>Unit of measure</Label>
          <select
            aria-label="Unit of measure"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className={inputCls}
          >
            {UNIT_OPTS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>
      {unit === "custom…" && (
        <div>
          <Label>Custom unit</Label>
          <input
            aria-label="Custom unit"
            type="text"
            value={customUnit}
            onChange={(e) => setCustomUnit(e.target.value)}
            placeholder="e.g. panel, bag, load…"
            className={inputCls}
          />
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>Quantity</Label>
          <input
            aria-label="Quantity"
            type="number" min={0} step="any"
            value={qty || ""}
            onChange={(e) => setQty(Math.max(0, parseFloat(e.target.value) || 0))}
            placeholder="0"
            className={inputCls}
          />
        </div>
        <MoneyInput label="Charge / unit" val={unitPrice} onSet={setUnitPrice} placeholder="0.00" />
        <MoneyInput label="Tech pay / unit" val={unitPay} onSet={setUnitPay} amber />
      </div>
      {ready && (
        <div className="rounded-lg bg-brand/10 px-3 py-2 text-xs text-cyan-400 flex justify-between">
          <span>
            {qty} {resolvedUnit || "unit"}{name ? ` · ${name}` : ""} × {money(unitPrice)}
          </span>
          <span className="font-semibold text-white">{money(lineTotal)}</span>
        </div>
      )}
      <AddBtn onClick={submit} disabled={!ready} />
    </div>
  );
}

function AddBtn({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-all",
        disabled
          ? "cursor-not-allowed bg-white/5 text-slate-600"
          : "bg-brand text-white shadow-md shadow-brand/30 hover:bg-brand/90 active:scale-[0.98]",
      ].join(" ")}
    >
      <CheckCircle className="h-4 w-4" />
      Add to work order
    </button>
  );
}

// ── main export ────────────────────────────────────────────────────────────────

const TYPE_TABS: { id: ChargeType; label: string; icon: React.ReactNode }[] = [
  { id: "flat_fee", label: "Flat fee",  icon: <DollarSign className="h-3.5 w-3.5" /> },
  { id: "hourly",   label: "Per hour",  icon: <Clock className="h-3.5 w-3.5" /> },
  { id: "per_unit", label: "Per unit",  icon: <Hash className="h-3.5 w-3.5" /> },
];

export function ChargesEditor({
  charges,
  onChange,
}: {
  charges: Charge[];
  onChange: (charges: Charge[]) => void;
}) {
  const [activeType, setActiveType] = useState<ChargeType>("flat_fee");

  function add(c: Charge) {
    onChange([...charges, c]);
  }

  function remove(id: string) {
    onChange(charges.filter((c) => c.id !== id));
  }

  const { clientTotal, techTotal } = chargesSummary(charges);

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <DollarSign className="h-4 w-4 text-brand shrink-0" />
        <span className="text-sm font-semibold text-white">Charges</span>
        {charges.length > 0 && (
          <span className="ml-auto text-xs text-slate-400">
            {charges.length} item{charges.length !== 1 ? "s" : ""} · client{" "}
            <span className="font-semibold text-white">{money(clientTotal)}</span>
            {techTotal > 0 && (
              <> · pay <span className="font-semibold text-amber-300">{money(techTotal)}</span></>
            )}
          </span>
        )}
      </div>

      {/* committed list */}
      {charges.length > 0 && (
        <div className="space-y-1.5 px-4 pt-3">
          {charges.map((c) => (
            <ChargeRow key={c.id} charge={c} onRemove={() => remove(c.id)} />
          ))}
          <div className="border-t border-white/10 mt-2" />
        </div>
      )}

      {/* add-a-charge form */}
      <div className="px-4 pb-4 pt-3 space-y-3">
        <div>
          <Label>Add a charge</Label>
          {/* type pills */}
          <div className="flex gap-1.5">
            {TYPE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveType(t.id)}
                className={[
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all",
                  activeType === t.id
                    ? "bg-brand text-white shadow-md shadow-brand/30"
                    : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white",
                ].join(" ")}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {activeType === "flat_fee" && <FlatFeeForm onAdd={add} />}
        {activeType === "hourly"   && <HourlyForm onAdd={add} />}
        {activeType === "per_unit" && <PerUnitForm onAdd={add} />}
      </div>
    </div>
  );
}
