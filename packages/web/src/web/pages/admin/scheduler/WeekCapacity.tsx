/**
 * The Week view: technicians down, days across. Each cell is a technician's
 * day at a glance (the first few jobs and how full the day is), never a
 * squeezed time grid. A cell opens that day; a job opens its work order.
 */
import type { BoardJob, BoardTech } from "../../../features/dispatch/data/types";
import { TechAvatar } from "../../../components/tech-avatar";
import { addDays, bookedMinutes, jobMinutes, loadLevel } from "../../../../shared/schedule-layout";
import { LOAD_COLOR, PHASE_STYLE, clock, dayTitle, hours, matches, phaseOf, techDayJobs } from "./calendar-utils";

export function WeekCapacity(p: {
  techs: BoardTech[];
  jobs: BoardJob[];
  monday: string;
  today: string;
  tz: string;
  compact: boolean;
  query: string;
  onOpenDay(day: string): void;
  onOpenJob(job: BoardJob): void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(p.monday, i));
  const max = p.compact ? 2 : 3;
  const cols = `200px repeat(7, minmax(0, 1fr))`;
  return (
    <div className="nvc-card overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[1000px]">
          <div className="grid border-b border-white/10 bg-ink-2" style={{ gridTemplateColumns: cols }}>
            <div className="flex items-center px-4 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Technicians</div>
            {days.map((d) => {
              const booked = p.techs.reduce((s, t) => s + bookedMinutes(techDayJobs(p.jobs, t.id, d, p.tz)), 0);
              const cap = Math.max(1, p.techs.length) * 480;
              const pctBooked = Math.round((booked / cap) * 100);
              const isToday = d === p.today;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => p.onOpenDay(d)}
                  className={`flex flex-col gap-1.5 border-l border-white/10 px-3 py-2.5 text-left hover:bg-white/[0.03] ${isToday ? "bg-brand/[0.08] shadow-[inset_0_2px_0_var(--color-brand)]" : ""}`}
                >
                  <span className="flex items-baseline gap-1.5">
                    <strong className="text-sm text-white">{dayTitle(d, { weekday: "short" })}</strong>
                    <span className="text-[13px] text-slate-500">{dayTitle(d, { month: "short", day: "numeric" })}</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <span className="h-1 flex-1 overflow-hidden rounded bg-white/10">
                      <span className="block h-full" style={{ width: `${Math.min(100, pctBooked)}%`, background: LOAD_COLOR[loadLevel(booked, cap)] }} />
                    </span>
                    {pctBooked}%
                  </span>
                </button>
              );
            })}
          </div>

          {p.techs.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">No technicians match this filter.</p>}
          {p.techs.map((t) => (
            <div key={t.id} className="grid border-b border-white/[0.06]" style={{ gridTemplateColumns: cols }}>
              <div className="flex min-w-0 items-center gap-2.5 border-r border-white/10 px-3.5 py-2.5">
                <TechAvatar name={t.name} photoUrl={t.photoUrl} color={t.color} className="h-8 w-8 ring-2" textClassName="text-[11px] font-bold" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-white">{t.name}</span>
                  <span className="block truncate text-[11.5px] text-slate-500">{t.skillClass || "General"}</span>
                </span>
              </div>
              {days.map((d) => {
                const list = techDayJobs(p.jobs, t.id, d, p.tz);
                const booked = bookedMinutes(list);
                return (
                  <div
                    key={d}
                    className={`flex min-w-0 flex-col gap-1 border-l border-white/[0.06] p-2 ${d === p.today ? "bg-brand/[0.03]" : ""}`}
                    style={{ minHeight: p.compact ? 72 : 108 }}
                  >
                    <button
                      type="button"
                      onClick={() => p.onOpenDay(d)}
                      aria-label={`${t.name}, ${dayTitle(d, { weekday: "long", month: "long", day: "numeric" })}: ${list.length} jobs, ${hours(booked)} booked. Open the day.`}
                      className="flex w-full items-center gap-1.5 rounded px-0.5 hover:bg-white/5"
                    >
                      <span className="h-1 flex-1 overflow-hidden rounded bg-white/10">
                        <span className="block h-full" style={{ width: `${Math.min(100, (booked / 480) * 100)}%`, background: LOAD_COLOR[loadLevel(booked)] }} />
                      </span>
                      <span className="font-mono text-[10.5px] text-slate-400">{hours(booked)}</span>
                    </button>
                    {list.slice(0, max).map((j) => {
                      const look = PHASE_STYLE[phaseOf(j.status)];
                      return (
                        <button
                          key={j.id}
                          type="button"
                          onClick={() => p.onOpenJob(j)}
                          className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs hover:brightness-125"
                          style={{ background: look.bg, color: look.text, opacity: matches(p.query, j.title, j.service, j.customerName, j.address, t.name) ? 1 : 0.3 }}
                        >
                          <span className="shrink-0 font-mono text-[10.5px] text-slate-400">{clock(jobMinutes(j.scheduledAt, p.tz), true)}</span>
                          <span className="truncate">{j.title || j.service}</span>
                        </button>
                      );
                    })}
                    {list.length > max && (
                      <button type="button" onClick={() => p.onOpenDay(d)} className="self-start rounded px-1 text-[11.5px] font-bold text-brand hover:bg-brand/10">
                        +{list.length - max} more
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
