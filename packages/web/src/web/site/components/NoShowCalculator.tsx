import { useId, useState, type ChangeEvent } from "react";
import { convertUnit, formulaLine, money, NO_SHOW_DEFAULTS, noShowCost, type DistanceUnit, type NoShowInput } from "../tools/no-show";

type NumKey = Exclude<keyof NoShowInput, "unit">;

/**
 * The no-show cost calculator. Runs in the browser only: no form, no network
 * request, nothing stored. The first render uses NO_SHOW_DEFAULTS, so the
 * prerendered HTML already shows a full worked result.
 */
export function NoShowCalculator() {
  const id = useId();
  const [input, setInput] = useState<NoShowInput>(NO_SHOW_DEFAULTS);
  // What's in each box as typed (so a field can be cleared mid-edit); the maths uses `input`.
  const [raw, setRaw] = useState<Record<NumKey, string>>(() => toRaw(NO_SHOW_DEFAULTS));
  const r = noShowCost(input);

  const onNum = (k: NumKey) => (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setRaw((p) => ({ ...p, [k]: v }));
    const n = Number(v);
    setInput((p) => ({ ...p, [k]: v.trim() === "" || !Number.isFinite(n) ? 0 : n }));
  };
  const onUnit = (u: DistanceUnit) => {
    const next = convertUnit(input, u);
    setInput(next);
    setRaw(toRaw(next));
  };
  const per = input.unit === "mi" ? "mile" : "km";

  const fields: { k: NumKey; label: string; hint: string; step: number; prefix?: string }[] = [
    { k: "hourlyRate", label: "Technician loaded rate ($ per hour)", hint: "Wage plus payroll taxes, benefits and overhead.", step: 1, prefix: "$" },
    { k: "driveMinutes", label: "Drive minutes for the wasted trip", hint: "There and on to the next stop.", step: 5 },
    { k: "onSiteMinutes", label: "Minutes lost at the door", hint: "Knocking, calling, waiting.", step: 5 },
    { k: "distance", label: `Distance driven (${input.unit === "mi" ? "miles" : "km"})`, hint: "For the same trip.", step: 1 },
    { k: "vehicleRate", label: `Vehicle cost ($ per ${per})`, hint: "Fuel, wear, insurance, depreciation.", step: 0.01, prefix: "$" },
    { k: "perMonth", label: "Customer-not-home trips per month", hint: "Your own count, across the team.", step: 1 },
  ];

  return (
    <div className="geo-tool geo-tool--calc">
      <fieldset className="geo-tool__inputs">
        <legend className="geo-tool__h">Your numbers</legend>
        <fieldset className="geo-field">
          <legend>Distance unit</legend>
          <div className="geo-seg geo-seg--two">
            {(["mi", "km"] as const).map((u) => (
              <label key={u} className="geo-seg__opt" id={`${id}-unit-${u}`}>
                <input type="radio" name={`${id}-unit`} value={u} checked={input.unit === u} onChange={() => onUnit(u)} aria-labelledby={`${id}-unit-${u}`} />
                <strong>{u === "mi" ? "Miles" : "Kilometres"}</strong>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="geo-calc-grid">
          {fields.map((f) => (
            <div key={f.k} className="geo-field">
              <label htmlFor={`${id}-${f.k}`} id={`${id}-${f.k}-l`}>
                {f.label}
              </label>
              <div className={f.prefix ? "geo-input geo-input--prefix" : "geo-input"}>
                {f.prefix && <span aria-hidden="true">{f.prefix}</span>}
                <input
                  id={`${id}-${f.k}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={f.step}
                  value={raw[f.k]}
                  onChange={onNum(f.k)}
                  aria-labelledby={`${id}-${f.k}-l`}
                  aria-describedby={`${id}-${f.k}-hint`}
                />
              </div>
              <small id={`${id}-${f.k}-hint`} className="geo-field__hint">
                {f.hint}
              </small>
            </div>
          ))}
        </div>
        <p className="geo-tool__fine">Runs in your browser. Nothing you type is saved or sent anywhere.</p>
      </fieldset>

      <div className="geo-tool__out" aria-live="polite">
        <div className="geo-result">
          <p className="geo-result__label">Each customer-not-home trip costs about</p>
          <p className="geo-result__big tnum">{money(r.perTrip)}</p>
          <dl className="geo-result__rows">
            <div>
              <dt>Technician time</dt>
              <dd className="tnum">{money(r.labour)}</dd>
            </div>
            <div>
              <dt>Vehicle</dt>
              <dd className="tnum">{money(r.vehicle)}</dd>
            </div>
            <div>
              <dt>Per month ({input.perMonth || 0} trips)</dt>
              <dd className="tnum">{money(r.monthly)}</dd>
            </div>
            <div>
              <dt>Per year</dt>
              <dd className="tnum">{money(r.yearly, 0)}</dd>
            </div>
            <div>
              <dt>Technician hours lost per year</dt>
              <dd className="tnum">{r.hoursPerYear.toLocaleString("en-US")}</dd>
            </div>
          </dl>
        </div>
        <div className="geo-formula">
          <p className="geo-formula__label">The formula, with your numbers</p>
          <p className="geo-formula__line">
            Loaded rate × (drive minutes + minutes at the door) ÷ 60 + vehicle cost per {per} × distance
          </p>
          <p className="geo-formula__line geo-formula__line--n tnum">{formulaLine(input)}</p>
          <p className="geo-formula__line">Per month = per trip × trips per month. Per year = per month × 12.</p>
        </div>
      </div>
    </div>
  );
}

function toRaw(i: NoShowInput): Record<NumKey, string> {
  return {
    hourlyRate: String(i.hourlyRate),
    driveMinutes: String(i.driveMinutes),
    onSiteMinutes: String(i.onSiteMinutes),
    distance: String(i.distance),
    vehicleRate: String(i.vehicleRate),
    perMonth: String(i.perMonth),
  };
}
