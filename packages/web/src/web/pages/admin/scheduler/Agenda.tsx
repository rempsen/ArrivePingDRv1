/**
 * Phones: the Day view as a list (a 12-hour row doesn't fit 390 px), grouped by
 * technician, soonest first. Tapping a job opens it.
 */
import { Plus } from "lucide-react";
import type { BoardJob, BoardTech } from "../../../features/dispatch/data/types";
import { TechAvatar } from "../../../components/tech-avatar";
import { AutoBadge } from "../../../components/auto-badge";
import { durationOf, jobMinutes } from "../../../../shared/schedule-layout";
import { PHASE_STYLE, clock, matches, phaseOf } from "./calendar-utils";

export function Agenda(p: { techs: BoardTech[]; jobsByTech: Map<string, BoardJob[]>; tz: string; query: string; onOpenJob(job: BoardJob): void; onNewJob(): void }) {
  const rows = p.techs.map((t) => ({ t, jobs: (p.jobsByTech.get(t.id) ?? []).filter((j) => matches(p.query, j.title, j.service, j.customerName, j.address, t.name)) }));
  const any = rows.some((r) => r.jobs.length > 0);
  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={p.onNewJob} className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/5">
        <Plus className="h-4 w-4" /> New job on this day
      </button>
      {!any && <p className="nvc-card px-4 py-8 text-center text-sm text-slate-500">Nothing booked this day.</p>}
      {rows
        .filter((r) => r.jobs.length > 0)
        .map(({ t, jobs }) => (
          <section key={t.id} className="nvc-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <TechAvatar name={t.name} photoUrl={t.photoUrl} color={t.color} className="h-7 w-7 ring-2" textClassName="text-[10px] font-bold" />
              <span className="text-sm font-semibold text-white">{t.name}</span>
              <span className="ml-auto text-xs text-slate-500">{jobs.length} jobs</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {jobs.map((j) => {
                const start = jobMinutes(j.scheduledAt, p.tz);
                const look = PHASE_STYLE[phaseOf(j.status)];
                return (
                  <button
                    key={j.id}
                    type="button"
                    onClick={() => p.onOpenJob(j)}
                    className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 rounded-lg border px-2.5 py-2 text-left"
                    style={{ background: look.bg, borderColor: look.border }}
                  >
                    <span className="font-mono text-[11.5px] text-slate-300">{clock(start, true)}–{clock(start + durationOf(j), true)}</span>
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold text-white">{j.title || j.service}</span>
                        <AutoBadge booking={j} size="xs" />
                      </span>
                      <span className="block truncate text-[11.5px] text-slate-400">
                        {look.label}
                        {j.customerName ? ` · ${j.customerName}` : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
    </div>
  );
}
