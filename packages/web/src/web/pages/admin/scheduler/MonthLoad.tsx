/**
 * The Month view: how full the team is each day (booked hours against an
 * 8-hour day per technician). A day opens its week.
 */
import { Loader2 } from "lucide-react";
import type { DayLoad } from "../../../features/dispatch/data/api";
import { loadLevel } from "../../../../shared/schedule-layout";
import { LOAD_COLOR, dayTitle } from "./calendar-utils";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthLoad(p: { load: DayLoad | undefined; month: string; today: string; loading: boolean; onOpenDay(day: string): void }) {
  const techs = Math.max(1, p.load?.techs ?? 1);
  return (
    <div className="nvc-card p-3.5">
      <div className="mb-1.5 grid grid-cols-7 gap-1.5">
        {DOW.map((d) => (
          <span key={d} className="px-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
            {d}
          </span>
        ))}
      </div>
      {!p.load ? (
        <div className="grid h-64 place-items-center text-slate-500">{p.loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Couldn't load the month."}</div>
      ) : (
        <div className="grid grid-cols-7 gap-1.5">
          {p.load.days.map((d) => {
            const inMonth = d.day.slice(0, 7) === p.month;
            const cap = techs * 480;
            const pctBooked = Math.round((d.bookedMins / cap) * 100);
            const isToday = d.day === p.today;
            return (
              <button
                key={d.day}
                type="button"
                onClick={() => p.onOpenDay(d.day)}
                aria-label={`${dayTitle(d.day, { weekday: "long", month: "long", day: "numeric" })}: ${d.jobs} jobs, ${pctBooked}% booked. Open the week.`}
                className={`flex min-h-[92px] flex-col gap-2 rounded-xl border p-2.5 text-left hover:brightness-125 ${inMonth ? "border-white/10 bg-ink-3/60" : "border-white/[0.05] bg-ink-2/60 opacity-60"}`}
              >
                <span className="flex w-full items-center justify-between">
                  <strong className={`text-[13px] ${isToday ? "rounded-md bg-brand px-1.5 text-white" : inMonth ? "text-white" : "text-slate-500"}`}>
                    {Number(d.day.slice(8))}
                  </strong>
                  {d.jobs > 0 && <span className="text-[11px] text-slate-400">{d.jobs} jobs</span>}
                </span>
                <span className="h-1.5 w-full overflow-hidden rounded bg-white/10">
                  <span className="block h-full" style={{ width: `${Math.min(100, pctBooked)}%`, background: LOAD_COLOR[loadLevel(d.bookedMins, cap)] }} />
                </span>
                <span className="text-[11px] text-slate-500">{d.jobs === 0 ? "Nothing booked" : `${pctBooked}% booked`}</span>
              </button>
            );
          })}
        </div>
      )}
      <p className="mt-3 px-1 text-xs text-slate-500">Booked hours against an 8-hour day for each technician. Click a day to open its week.</p>
    </div>
  );
}
