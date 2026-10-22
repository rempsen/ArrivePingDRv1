import { useRef, useState } from "react";
import { Plus, Send, X } from "lucide-react";
import {
  MAX_VEHICLE_ROWS,
  emptyVehicleRow,
  filledVehicleRows,
  vehicleRowProblems,
  vehicleRowsMessage,
  VEHICLES_SKIPPED_MESSAGE,
  type VehicleRow,
} from "../lib/vehicle-roster-form";

// `locked`: the row belongs to a named person, so its name isn't editable.
type KeyedRow = VehicleRow & { key: number; locked: boolean };

const inputCls =
  "w-full min-w-0 rounded-lg border border-white/10 bg-ink-3/60 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-brand";

/**
 * Shown in the onboarding chat when the concierge asks about vehicles: a row
 * of make & model / colour / license plate per vehicle, one row already waiting for
 * each field-staff person it names (with their name on it), a + at the end of
 * each row to add another, and one Submit that sends them all as one message.
 */
export function VehicleForm({
  people,
  busy,
  onSubmit,
  onCancel,
}: {
  /** Field staff just added, who each get a row to start. May be empty. */
  people: string[];
  /** The concierge is still replying; hold the submit until it's done. */
  busy: boolean;
  onSubmit: (message: string) => void;
  onCancel: () => void;
}) {
  const nextKey = useRef(people.length || 1);
  const [rows, setRows] = useState<KeyedRow[]>(() =>
    people.length ? people.map((p, i) => ({ ...emptyVehicleRow(p), key: i, locked: true })) : [{ ...emptyVehicleRow(), key: 0, locked: false }],
  );
  const [showProblems, setShowProblems] = useState(false);

  const problems = vehicleRowProblems(rows);
  const filled = filledVehicleRows(rows).length;

  function update(i: number, patch: Partial<VehicleRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function addAfter(i: number) {
    setRows((rs) => {
      if (rs.length >= MAX_VEHICLE_ROWS) return rs;
      const copy = rs.slice();
      copy.splice(i + 1, 0, { ...emptyVehicleRow(), key: nextKey.current++, locked: false });
      return copy;
    });
  }
  function remove(i: number) {
    setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));
  }
  function submit() {
    if (busy) return;
    if (!filled || Object.keys(problems).length) {
      setShowProblems(true);
      return;
    }
    onSubmit(vehicleRowsMessage(rows));
  }

  return (
    <div className="max-h-[45vh] overflow-y-auto border-t border-white/5 p-3">
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.key}>
            <div className="grid grid-cols-[1fr_auto] items-center gap-2">
              <div className="grid grid-cols-2 gap-2">
                {/* Named people keep their name; extra rows can say who it's for. */}
                {r.locked ? (
                  <p className="truncate rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-slate-200" title={r.who}>
                    {r.who}
                  </p>
                ) : (
                  <input
                    aria-label={`Driver, vehicle ${i + 1}`}
                    className={inputCls}
                    placeholder="Driver (optional)"
                    autoComplete="off"
                    value={r.who}
                    onChange={(e) => update(i, { who: e.target.value })}
                  />
                )}
                <input
                  aria-label={`Make and model, vehicle ${i + 1}`}
                  className={inputCls}
                  placeholder="Make & model"
                  autoComplete="off"
                  value={r.makeModel}
                  onChange={(e) => update(i, { makeModel: e.target.value })}
                />
                <input
                  aria-label={`Colour, vehicle ${i + 1}`}
                  className={inputCls}
                  placeholder="Colour"
                  autoComplete="off"
                  value={r.color}
                  onChange={(e) => update(i, { color: e.target.value })}
                />
                <input
                  aria-label={`License plate, vehicle ${i + 1}`}
                  className={inputCls + " uppercase placeholder:normal-case"}
                  placeholder="License plate"
                  autoComplete="off"
                  value={r.plate}
                  onChange={(e) => update(i, { plate: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-1">
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label={`Remove vehicle ${i + 1}`}
                    className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-slate-200"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => addAfter(i)}
                  disabled={rows.length >= MAX_VEHICLE_ROWS}
                  aria-label="Add another vehicle"
                  title="Add another vehicle"
                  className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-ink-3/60 text-slate-300 transition hover:border-brand hover:text-white disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
            {showProblems && problems[i] && <p className="mt-1 text-xs text-red-400">{problems[i]}</p>}
          </div>
        ))}
      </div>
      {showProblems && !filled && <p className="mt-2 text-xs text-red-400">Add at least one vehicle, or skip this.</p>}
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="nvc-btn nvc-btn-brand mt-3 w-full justify-center py-3 text-base"
      >
        <Send className="h-4 w-4" /> Submit vehicles{filled > 1 ? ` (${filled})` : ""}
      </button>
      <div className="mt-2 flex justify-center gap-4 text-xs font-medium text-slate-500">
        <button type="button" onClick={() => !busy && onSubmit(VEHICLES_SKIPPED_MESSAGE)} className="hover:text-slate-300">
          Skip for now
        </button>
        <button type="button" onClick={onCancel} className="hover:text-slate-300">
          Type instead
        </button>
      </div>
    </div>
  );
}
