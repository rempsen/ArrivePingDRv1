import { useRef, useState } from "react";
import { Plus, Send, X } from "lucide-react";
import {
  MAX_TEAM_ROWS,
  emptyTeamRow,
  filledTeamRows,
  teamRowProblems,
  teamRowsMessage,
  type TeamRow,
} from "../lib/team-roster-form";

type KeyedRow = TeamRow & { key: number };

const inputCls =
  "w-full min-w-0 rounded-lg border border-white/10 bg-ink-3/60 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-brand";

/**
 * Shown in the onboarding chat when the concierge asks for the team: a row of
 * name / phone / email per person, a + at the end of each row to add another,
 * and one Submit that sends the whole roster as a single message.
 */
export function TeamForm({
  busy,
  onSubmit,
  onCancel,
}: {
  /** The concierge is still replying; hold the submit until it's done. */
  busy: boolean;
  onSubmit: (message: string) => void;
  onCancel: () => void;
}) {
  const nextKey = useRef(1);
  const [rows, setRows] = useState<KeyedRow[]>([{ ...emptyTeamRow(), key: 0 }]);
  const [showProblems, setShowProblems] = useState(false);

  const problems = teamRowProblems(rows);
  const filled = filledTeamRows(rows).length;

  function update(i: number, patch: Partial<TeamRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function addAfter(i: number) {
    setRows((rs) => {
      if (rs.length >= MAX_TEAM_ROWS) return rs;
      const copy = rs.slice();
      copy.splice(i + 1, 0, { ...emptyTeamRow(), key: nextKey.current++ });
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
    onSubmit(teamRowsMessage(rows));
  }

  return (
    <div className="max-h-[45vh] overflow-y-auto border-t border-white/5 p-3">
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.key}>
            <div className="grid grid-cols-[1fr_auto] items-center gap-2">
              <div className="grid gap-2 sm:grid-cols-3">
                <input
                  aria-label={`Name, person ${i + 1}`}
                  className={inputCls}
                  placeholder="Name"
                  autoComplete="off"
                  value={r.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
                <input
                  aria-label={`Phone, person ${i + 1}`}
                  className={inputCls}
                  placeholder="Phone"
                  type="tel"
                  autoComplete="off"
                  value={r.phone}
                  onChange={(e) => update(i, { phone: e.target.value })}
                />
                <input
                  aria-label={`Email, person ${i + 1}`}
                  className={inputCls}
                  placeholder="Email"
                  type="email"
                  autoComplete="off"
                  value={r.email}
                  onChange={(e) => update(i, { email: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-1">
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label={`Remove person ${i + 1}`}
                    className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-slate-200"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => addAfter(i)}
                  disabled={rows.length >= MAX_TEAM_ROWS}
                  aria-label="Add another person"
                  title="Add another person"
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
      {showProblems && !filled && <p className="mt-2 text-xs text-red-400">Add at least one person.</p>}
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="nvc-btn nvc-btn-brand mt-3 w-full justify-center py-3 text-base"
      >
        <Send className="h-4 w-4" /> Submit team{filled > 1 ? ` (${filled})` : ""}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="mt-2 w-full text-center text-xs font-medium text-slate-500 hover:text-slate-300"
      >
        Type or send a photo instead
      </button>
    </div>
  );
}
