/**
 * The scheduler's calendar: Day (technicians as rows), Week (technicians by
 * day) and Month (how full each day is), with the "To schedule" queue beside
 * them. Built for a dispatcher placing work across 10–30 technicians, not for
 * one person's meetings: see blueprints/2026-10-18-arriveping-dispatch-calendar.
 */
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { BoardJob, BoardTech } from "../../../features/dispatch/data/types";
import { useBrand } from "../../../lib/use-brand";
import { tourAttr } from "../../../guide/anchors";
import type { ConfirmFn } from "../../../lib/force-confirm";
import { addDays, clampStart, durationOf, instantFor, mondayOf, rankSlots, snapMinutes, timelineRange, type Slot } from "../../../../shared/schedule-layout";
import { safeTimeZone, zonedDayKey, zonedMinutesOfDay } from "../../../../shared/tz";
import { isTerminalStatus } from "../../../../shared/job-status";
import { Agenda } from "./Agenda";
import { DayTimeline, type DropPreview } from "./DayTimeline";
import { MonthLoad } from "./MonthLoad";
import { Queue, SlotList } from "./Queue";
import { WeekCapacity } from "./WeekCapacity";
import { clock, dayOf, dayTitle, hours, isWaiting, qualifiedFor, spanOf, type View } from "./calendar-utils";
import { useDayLoad, usePlace, useScheduleBoard } from "./use-schedule";

const VIEWS: Array<{ key: View; label: string }> = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];
const DENSITY_KEY = "ap_sched_compact";

function readCompact(): boolean {
  try {
    return localStorage.getItem(DENSITY_KEY) === "1";
  } catch {
    return false;
  }
}

/** Where the pointer is, from a drag event (mouse, pen or touch). */
function pointerX(e: DragMoveEvent | DragEndEvent): number | null {
  const a = e.activatorEvent as (PointerEvent & TouchEvent) | null;
  const start = a?.touches?.[0]?.clientX ?? a?.clientX;
  return typeof start === "number" ? start + e.delta.x : null;
}

export function DispatchCalendar(p: {
  confirm: ConfirmFn;
  onOpenJob(jobId: string): void;
  /** Open the new-job form at this time, for this technician when one was picked. */
  onNewJob(at: Date, riderId?: string): void;
}) {
  const brand = useBrand();
  const [view, setView] = useState<View>("day");
  const [compact, setCompact] = useState(readCompact);
  const [skill, setSkill] = useState("");
  const [query, setQuery] = useState("");
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const fallbackTz = safeTimeZone(brand.timezone);
  const [day, setDay] = useState(() => zonedDayKey(new Date(), fallbackTz));
  const boardDay = view === "week" ? mondayOf(day) : day;
  const sb = useScheduleBoard(boardDay, view === "week" ? 7 : 1);
  const tz = sb.board?.tz ?? fallbackTz;
  const today = zonedDayKey(now, tz);
  const monthStart = mondayOf(`${day.slice(0, 7)}-01`);
  const load = useDayLoad(monthStart, 42, view === "month");
  const placer = usePlace({ overlay: sb.overlay, refresh: sb.refresh, tz }, p.confirm);

  const allTechs: BoardTech[] = useMemo(() => sb.board?.techs ?? [], [sb.board]);
  const skills = useMemo(() => [...new Set(allTechs.map((t) => t.skillClass).filter(Boolean))].sort(), [allTechs]);
  const techs = skill ? allTechs.filter((t) => t.skillClass === skill) : allTechs;
  const jobs = useMemo(() => sb.board?.jobs ?? [], [sb.board]);
  const waiting = jobs
    .filter(isWaiting)
    .sort((a, b) => (a.priority === "urgent" ? -1 : 0) - (b.priority === "urgent" ? -1 : 0) || new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const placing = waiting.find((j) => j.id === placingId) ?? null;

  const jobsByTech = useMemo(() => {
    const m = new Map<string, BoardJob[]>();
    if (view !== "day") return m;
    for (const j of jobs) {
      if (!j.riderId || dayOf(j, tz) !== day) continue;
      const list = m.get(j.riderId) ?? [];
      list.push(j);
      m.set(j.riderId, list);
    }
    for (const list of m.values()) list.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    return m;
  }, [jobs, view, day, tz]);

  const range = useMemo(() => timelineRange([...jobsByTech.values()].flat().map((j) => spanOf(j, tz))), [jobsByTech, tz]);
  const nowMin = day === today ? zonedMinutesOfDay(now, tz) : null;

  const offToday = useMemo(() => new Set((sb.board?.timeOff ?? []).filter((o) => o.day === day).map((o) => o.techId)), [sb.board, day]);
  const ghosts: Slot[] = useMemo(() => {
    if (!placing || view !== "day" || day < today) return [];
    return rankSlots({
      job: { durationMins: durationOf(placing), lat: placing.lat, lng: placing.lng },
      techs: techs.map((t) => {
        // Today, someone on a job that's running long is free when it really ends.
        const free = day === today && t.freeAt ? new Date(t.freeAt) : null;
        const freeLater = free != null && zonedDayKey(free, tz) > day;
        // Where they set out from: today, where they are now (from when they're
        // free); another day, the office at the start of the day.
        const office = sb.board?.office ?? null;
        const origin =
          day === today && t.lat != null && t.lng != null
            ? { lat: t.lat, lng: t.lng, atMin: free && !freeLater ? zonedMinutesOfDay(free, tz) : zonedMinutesOfDay(now, tz) }
            : day !== today && office
              ? { ...office, atMin: range.startMin }
              : undefined;
        return {
          id: t.id,
          qualified: qualifiedFor(t, placing),
          // Off, on a break or off for the day: not a same-day suggestion.
          available: !(day === today && (t.status === "offline" || t.status === "break")) && !offToday.has(t.id) && !freeLater,
          ...(free && !freeLater ? { earliestMin: Math.ceil((zonedMinutesOfDay(free, tz) + 15) / 15) * 15 } : {}),
          ...(origin ? { origin } : {}),
          // Finished and cancelled jobs stay on the calendar but don't hold time.
          dayJobs: (jobsByTech.get(t.id) ?? []).filter((j) => !isTerminalStatus(j.status)).map((j) => ({ ...spanOf(j, tz), lat: j.lat, lng: j.lng })),
        };
      }),
      earliestMin: day === today ? Math.ceil((zonedMinutesOfDay(now, tz) + 30) / 15) * 15 : 0,
      range,
    });
  }, [placing, view, day, today, techs, jobsByTech, tz, now, range, offToday, sb.board]);
  const dimmed = useMemo(() => new Set(placing ? techs.filter((t) => !qualifiedFor(t, placing)).map((t) => t.id) : []), [placing, techs]);

  // ---- drag and drop ----
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const [dragging, setDragging] = useState<BoardJob | null>(null);
  const [preview, setPreview] = useState<DropPreview | null>(null);

  const dropAt = (e: DragMoveEvent | DragEndEvent): DropPreview | null => {
    const job = e.active.data.current?.job as BoardJob | undefined;
    const techId = e.over?.data.current?.techId as string | undefined;
    if (!job || !techId || !e.over) return null;
    const rect = e.over.rect;
    const fromBlock = String(e.active.id).startsWith("j:");
    const x = fromBlock ? e.active.rect.current.translated?.left ?? null : pointerX(e);
    if (x === null || rect.width <= 0) return null;
    const dur = durationOf(job);
    const raw = range.startMin + ((x - rect.left) / rect.width) * (range.endMin - range.startMin);
    return { techId, startMin: clampStart(snapMinutes(raw), dur, range), dur };
  };

  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current?.job as BoardJob) ?? null);
  const onDragMove = (e: DragMoveEvent) => {
    const next = dropAt(e);
    setPreview((cur) => (cur?.techId === next?.techId && cur?.startMin === next?.startMin ? cur : next));
  };
  const onDragEnd = (e: DragEndEvent) => {
    const at = dropAt(e);
    const job = e.active.data.current?.job as BoardJob | undefined;
    setDragging(null);
    setPreview(null);
    if (!at || !job) return;
    const tech = allTechs.find((t) => t.id === at.techId);
    setPlacingId(null);
    void placer.place({ job, techId: at.techId, techName: tech?.name ?? "the technician", dayKey: day, startMin: at.startMin });
  };

  const placeSlot = (s: Slot) => {
    if (!placing) return;
    const tech = allTechs.find((t) => t.id === s.techId);
    setPlacingId(null);
    void placer.place({ job: placing, techId: s.techId, techName: tech?.name ?? "the technician", dayKey: day, startMin: s.startMin });
  };

  const pick = (j: BoardJob) => {
    if (placingId === j.id) return setPlacingId(null);
    setPlacingId(j.id);
    setView("day");
    // Place it on the day it's due, or today if that's already past.
    const due = dayOf(j, tz);
    setDay(due < today ? today : due);
  };

  const shift = (dir: number) => {
    if (view === "day") setDay(addDays(day, dir));
    else if (view === "week") setDay(addDays(day, dir * 7));
    else {
      const [y, m] = day.split("-").map(Number) as [number, number];
      const d = new Date(Date.UTC(y, m - 1 + dir, 1));
      setDay(d.toISOString().slice(0, 10));
    }
  };

  const label =
    view === "day"
      ? dayTitle(day, { weekday: "long", month: "short", day: "numeric" })
      : view === "week"
        ? `${dayTitle(mondayOf(day), { month: "short", day: "numeric" })} – ${dayTitle(addDays(mondayOf(day), 6), { month: "short", day: "numeric", year: "numeric" })}`
        : dayTitle(`${day.slice(0, 7)}-15`, { month: "long", year: "numeric" });

  const dayJobs = [...jobsByTech.values()].flat();
  const conflicts = [...jobsByTech.values()].reduce((n, list) => {
    let c = 0;
    for (let i = 1; i < list.length; i++) {
      const a = spanOf(list[i - 1]!, tz);
      const b = spanOf(list[i]!, tz);
      if (b.startMin < a.endMin) c++;
    }
    return n + c;
  }, 0);

  const openJob = (j: BoardJob) => p.onOpenJob(j.id);
  /** A new job on `d`: at the time picked, else the next half hour today, else 9:00. */
  const newJob = (d: string, riderId?: string, startMin?: number) => {
    const min = startMin ?? (d === today ? Math.ceil((zonedMinutesOfDay(now, tz) + 30) / 30) * 30 : 9 * 60);
    p.onNewJob(instantFor(d, Math.min(min, 23 * 60 + 30), tz), riderId);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shift(-1)} aria-label="Previous" className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-ink-2 text-slate-300 hover:text-white">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setDay(today)} className="h-9 rounded-lg border border-white/10 bg-ink-2 px-3 text-xs font-semibold text-slate-300 hover:text-white">
            Today
          </button>
          <button type="button" onClick={() => shift(1)} aria-label="Next" className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-ink-2 text-slate-300 hover:text-white">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <h3 className="min-w-[10rem] font-display text-base font-bold text-white">{label}</h3>
        {sb.isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
        <fieldset {...tourAttr("sched.views")} aria-label="Calendar view" className="m-0 flex min-w-0 rounded-lg border border-white/10 bg-ink-2 p-0.5 sm:ml-auto">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              aria-pressed={view === v.key}
              onClick={() => setView(v.key)}
              className={`rounded-md px-3.5 py-1.5 text-xs font-semibold ${view === v.key ? "bg-brand text-white" : "text-slate-400 hover:text-white"}`}
            >
              {v.label}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {skills.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {["", ...skills].map((s) => (
              <button
                key={s || "all"}
                type="button"
                aria-pressed={skill === s}
                onClick={() => setSkill(s)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${skill === s ? "border-brand bg-brand/15 text-sky-200" : "border-white/10 bg-ink-2 text-slate-400 hover:text-white"}`}
              >
                {s || "All skills"}
              </button>
            ))}
          </div>
        )}
        <label className="flex h-9 min-w-[14rem] flex-1 items-center gap-2 rounded-lg border border-white/10 bg-ink-2 px-3 text-slate-500 sm:max-w-xs">
          <Search className="h-4 w-4 shrink-0" />
          <span className="sr-only">Find a job, customer or technician</span>
          <input
            aria-label="Find a job, customer or technician"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a job, customer or tech"
            className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-slate-500 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
        <button
          type="button"
          onClick={() => {
            setCompact((c) => {
              try {
                localStorage.setItem(DENSITY_KEY, c ? "0" : "1");
              } catch {
                /* private mode: lasts for this page only */
              }
              return !c;
            });
          }}
          className="h-9 rounded-lg border border-white/10 bg-ink-2 px-3 text-xs font-semibold text-slate-300 hover:text-white"
        >
          {compact ? "Comfortable rows" : "Compact rows"}
        </button>
        {view === "day" && (
          <span className="text-xs text-slate-500 lg:ml-auto">
            {dayJobs.length} jobs · {hours(dayJobs.reduce((s, j) => s + durationOf(j), 0))} booked
            {conflicts > 0 && <span className="font-semibold text-red-300"> · {conflicts} overlap{conflicts === 1 ? "" : "s"}</span>}
          </span>
        )}
      </div>

      {sb.error && !sb.board && <p className="nvc-card px-4 py-6 text-sm text-red-300">Couldn't load the schedule: {sb.error.message}</p>}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={() => (setDragging(null), setPreview(null))}>
        {view !== "day" && waiting.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setDay(today);
              setView("day");
            }}
            className="flex items-center gap-2 self-start rounded-lg border border-amber-warn/30 bg-amber-warn/[0.07] px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-warn/[0.12]"
          >
            <span className="rounded-full bg-amber-warn/20 px-1.5 font-bold text-amber-warn">{waiting.length}</span>
            {waiting.length === 1 ? "job" : "jobs"} to schedule · open today to place {waiting.length === 1 ? "it" : "them"}
          </button>
        )}
        <div className={`grid gap-4 ${view === "day" ? "lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]" : ""}`}>
          <div className="min-w-0">
            {view === "day" && (
              <>
                <div className="hidden lg:block">
                  <DayTimeline
                    techs={techs}
                    jobsByTech={jobsByTech}
                    tz={tz}
                    range={range}
                    nowMin={nowMin}
                    compact={compact}
                    query={query}
                    placing={placing}
                    ghosts={ghosts}
                    selectedJobId={null}
                    preview={preview}
                    dimmedTechs={dimmed}
                    onGhost={placeSlot}
                    onOpenJob={openJob}
                    onNewJob={(techId, startMin) => newJob(day, techId, startMin)}
                  />
                </div>
                <div className="lg:hidden">
                  <Agenda techs={techs} jobsByTech={jobsByTech} tz={tz} query={query} onOpenJob={openJob} onNewJob={() => newJob(day)} />
                </div>
              </>
            )}
            {view === "week" && (
              <WeekCapacity
                techs={techs}
                jobs={jobs}
                monday={mondayOf(day)}
                today={today}
                tz={tz}
                compact={compact}
                query={query}
                onOpenDay={(d) => {
                  setDay(d);
                  setView("day");
                }}
                onOpenJob={openJob}
                onNewJob={(d) => newJob(d)}
              />
            )}
            {view === "month" && (
              <MonthLoad
                load={load.data}
                month={day.slice(0, 7)}
                today={today}
                loading={load.isLoading}
                onOpenDay={(d) => {
                  setDay(d);
                  setView("week");
                }}
              />
            )}
          </div>
          <div className={`min-w-0 flex-col gap-3 ${view === "day" ? "flex" : "hidden"}`}>
            {placing && view === "day" && (
              <SlotList
                job={placing}
                slots={ghosts}
                techs={allTechs}
                dayLabel={day === today ? "Today" : dayTitle(day, { weekday: "long", month: "short", day: "numeric" })}
                onPlace={placeSlot}
                onCancel={() => setPlacingId(null)}
              />
            )}
            <Queue jobs={waiting} tz={tz} today={today} query={query} placingId={placingId} onPick={pick} onOpen={openJob} />
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging && (
            <div className="pointer-events-none w-48 rounded-lg border border-brand bg-ink-3 px-2.5 py-1.5 text-left shadow-2xl">
              <span className="block truncate text-xs font-bold text-white">{dragging.title || dragging.service}</span>
              <span className="block font-mono text-[11px] text-sky-200">
                {preview ? `${clock(preview.startMin)} · ${allTechs.find((t) => t.id === preview.techId)?.name ?? ""}` : hours(durationOf(dragging))}
              </span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* toasts */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2 px-4">
        {placer.toasts.map((t) => (
          <output
            key={t.id}
            className={`pointer-events-auto flex max-w-xl items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold shadow-2xl ${t.tone === "warn" ? "bg-amber-100 text-amber-950" : "bg-slate-100 text-slate-900"}`}
          >
            <span>{t.text}</span>
            {t.undo.length > 0 && (
              <button type="button" onClick={() => void placer.undo(t)} className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-700">
                Undo
              </button>
            )}
            <button type="button" onClick={() => placer.dismiss(t.id)} aria-label="Dismiss" className="shrink-0 text-slate-500 hover:text-slate-900">
              <X className="h-4 w-4" />
            </button>
          </output>
        ))}
      </div>
    </div>
  );
}
