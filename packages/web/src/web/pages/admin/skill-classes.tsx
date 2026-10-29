import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X, Wrench, Save } from "lucide-react";
import { apiHeaders } from "../../lib/api";
import { BtnGhost, BtnPrimary, inputCls } from "../../components/modal";
import { useConfirm } from "../../components/confirm-dialog";
import { useWorkerNoun } from "../../lib/use-brand";
import { MAX_SKILL_CLASS_LEN } from "../../../shared/skill-classes";

type Row = { name: string; techs: number; jobs: number };
type Resp = { classes: Row[]; unlisted: Row[]; custom: boolean };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { ...apiHeaders(), "Content-Type": "application/json" } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { message?: string }).message ?? `Request failed (${r.status})`);
  return body as T;
}

/**
 * Settings → Skill Classes: the trades this company files its technicians
 * under (the "Skill class" on a technician, and the class a job can
 * require). Add, rename, reorder, remove. Removing never changes anyone's
 * record; renaming carries technicians and open jobs across.
 */
export default function SkillClassesTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const worker = useWorkerNoun();
  const workers = worker.nounPlural.toLowerCase();
  const q = useQuery({ queryKey: ["skill-classes"], queryFn: () => call<Resp>("/api/skill-classes") });

  // The editable list; saved as a whole with "Save changes".
  const [list, setList] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);
  const [add, setAdd] = useState("");
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (q.data && !dirty) setList(q.data.classes);
  }, [q.data, dirty]);

  const refresh = async () => {
    setDirty(false);
    await Promise.all([qc.invalidateQueries({ queryKey: ["skill-classes"] }), qc.invalidateQueries({ queryKey: ["msg-skill-classes"] }), qc.invalidateQueries({ queryKey: ["riders"] })]);
  };

  const has = (n: string) => list.some((r) => r.name.toLowerCase() === n.trim().toLowerCase());

  function addOne() {
    const n = add.replace(/\s+/g, " ").trim();
    if (!n) return;
    if (has(n)) return setError(`"${n}" is already in the list.`);
    setError(null);
    setList((l) => [...l, { name: n, techs: 0, jobs: 0 }]);
    setAdd("");
    setDirty(true);
  }

  function move(i: number, d: -1 | 1) {
    setList((l) => {
      const j = i + d;
      if (j < 0 || j >= l.length) return l;
      const next = [...l];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
    setDirty(true);
  }

  async function remove(r: Row) {
    if (list.length === 1) return setError("Keep at least one skill class.");
    if (r.techs || r.jobs) {
      const ok = await confirm({
        title: `Remove "${r.name}"?`,
        message: `${r.techs} ${r.techs === 1 ? worker.noun.toLowerCase() : workers} and ${r.jobs} open ${r.jobs === 1 ? "job" : "jobs"} use it. They keep it until someone picks another; it just won't be offered for new ones. To move them to another class, rename it instead.`,
        confirmLabel: "Remove",
      });
      if (!ok) return;
    }
    setList((l) => l.filter((x) => x !== r));
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await call("/api/skill-classes", { method: "PUT", body: JSON.stringify({ classes: list.map((r) => r.name) }) });
      setNote("Saved.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rename(from: string, to: string) {
    const target = to.replace(/\s+/g, " ").trim();
    if (!target || target === from) return setEditing(null);
    if (dirty) return setError("Save or discard your other changes first, then rename.");
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ techs: number; jobs: number }>("/api/skill-classes/rename", { method: "POST", body: JSON.stringify({ from, to: target }) });
      setNote(`Renamed "${from}" to "${target}" · moved ${r.techs} ${r.techs === 1 ? worker.noun.toLowerCase() : workers} and ${r.jobs} ${r.jobs === 1 ? "job" : "jobs"}.`);
      setEditing(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (q.isLoading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;
  if (q.isError) return <div className="p-6 text-sm text-red-300">{(q.error as Error).message}</div>;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <div className="mb-1 flex items-center gap-2 text-base font-semibold text-white">
          <Wrench className="h-4 w-4 text-brand" /> Skill classes
        </div>
        <p className="mb-4 text-sm text-slate-400">
          The trade each of your {workers} is filed under, and the class a job can require. Dispatch, the scheduler and automation rules use this list. Skills (the finer tags like
          "hardwood") are separate and stay on each {worker.noun.toLowerCase()}'s profile.
          {!q.data?.custom ? " You're using the built-in list; change it to suit your company." : ""}
        </p>

        <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
          {list.map((r, i) => (
            <li key={r.name} className="flex items-center gap-3 px-3 py-2.5">
              <div className="flex flex-col">
                <button type="button" aria-label={`Move ${r.name} up`} disabled={i === 0} onClick={() => move(i, -1)} className="text-slate-500 hover:text-white disabled:opacity-20">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label={`Move ${r.name} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)} className="text-slate-500 hover:text-white disabled:opacity-20">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
              {editing?.from === r.name ? (
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename(r.name, editing.to);
                  }}
                >
                  <input aria-label={`New name for ${r.name}`} className={inputCls} maxLength={MAX_SKILL_CLASS_LEN} value={editing.to} onChange={(e) => setEditing({ from: r.name, to: e.target.value })} />
                  <button type="submit" disabled={busy} aria-label="Save name" className="rounded-md p-1.5 text-emerald-400 hover:bg-white/5">
                    <Check className="h-4 w-4" />
                  </button>
                  <button type="button" aria-label="Cancel rename" onClick={() => setEditing(null)} className="rounded-md p-1.5 text-slate-400 hover:bg-white/5">
                    <X className="h-4 w-4" />
                  </button>
                </form>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium text-slate-100">{r.name}</span>
                  <span className="text-xs text-slate-500">
                    {r.techs} {r.techs === 1 ? worker.noun.toLowerCase() : workers}
                    {r.jobs ? ` · ${r.jobs} open ${r.jobs === 1 ? "job" : "jobs"}` : ""}
                  </span>
                  <button type="button" aria-label={`Rename ${r.name}`} title="Rename (moves its people and jobs too)" onClick={() => setEditing({ from: r.name, to: r.name })} className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-white">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" aria-label={`Remove ${r.name}`} onClick={() => remove(r)} className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-red-300">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>

        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addOne();
          }}
        >
          <input className={inputCls} placeholder="Add a skill class, e.g. Tile Installation" aria-label="New skill class" maxLength={MAX_SKILL_CLASS_LEN} value={add} onChange={(e) => setAdd(e.target.value)} />
          <BtnGhost type="submit">
            <Plus className="mr-1 h-4 w-4" /> Add
          </BtnGhost>
        </form>

        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
        {note && !error ? <p className="mt-3 text-sm text-emerald-300">{note}</p> : null}

        <div className="mt-4 flex items-center gap-2">
          <BtnPrimary onClick={save} disabled={!dirty || busy}>
            <Save className="h-4 w-4" /> Save changes
          </BtnPrimary>
          {dirty ? (
            <BtnGhost
              onClick={() => {
                setDirty(false);
                setError(null);
                if (q.data) setList(q.data.classes);
              }}
            >
              Discard
            </BtnGhost>
          ) : null}
        </div>
      </div>

      {q.data && q.data.unlisted.length > 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <div className="mb-1 text-sm font-semibold text-white">Still in use, not in the list</div>
          <p className="mb-3 text-sm text-slate-400">
            These are on {workers} or open jobs but aren't offered any more. Rename one to an existing class to move everyone across, or add it back.
          </p>
          <ul className="space-y-2">
            {q.data.unlisted.map((r) => (
              <li key={r.name} className="flex items-center gap-3 text-sm">
                <span className="flex-1 text-slate-200">{r.name}</span>
                <span className="text-xs text-slate-500">
                  {r.techs} {r.techs === 1 ? worker.noun.toLowerCase() : workers}
                  {r.jobs ? ` · ${r.jobs} open ${r.jobs === 1 ? "job" : "jobs"}` : ""}
                </span>
                {editing?.from === r.name ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      rename(r.name, editing.to);
                    }}
                  >
                    <input aria-label={`New name for ${r.name}`} className={inputCls} value={editing.to} onChange={(e) => setEditing({ from: r.name, to: e.target.value })} />
                    <button type="submit" disabled={busy} aria-label="Save name" className="rounded-md p-1.5 text-emerald-400 hover:bg-white/5">
                      <Check className="h-4 w-4" />
                    </button>
                  </form>
                ) : (
                  <button type="button" onClick={() => setEditing({ from: r.name, to: list[0]?.name ?? r.name })} className="text-xs font-medium text-brand hover:underline">
                    Rename / move
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
