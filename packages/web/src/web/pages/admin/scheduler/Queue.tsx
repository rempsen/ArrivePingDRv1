/**
 * "To schedule": every active job without a technician. Drag a card onto a
 * row (desktop and tablet), or pick it and click one of the suggested slots
 * (works everywhere, including with a keyboard).
 */
import { useDraggable } from "@dnd-kit/core";
import { GripVertical, Inbox, MapPin, Sparkles } from "lucide-react";
import type {
  BoardJob,
  BoardTech,
} from "../../../features/dispatch/data/types";
import { PRIORITY_META } from "../../../lib/utils";
import { durationOf, type Slot } from "../../../../shared/schedule-layout";
import { tourAttr } from "../../../guide/anchors";
import { clock, dayOf, dayTitle, hours, matches } from "./calendar-utils";

export function Queue(p: {
  jobs: BoardJob[];
  tz: string;
  today: string;
  query: string;
  placingId: string | null;
  /** May give jobs to technicians; without it the queue is a list to open. */
  canPlace: boolean;
  onPick(job: BoardJob): void;
  onOpen(job: BoardJob): void;
}) {
  const shown = p.jobs.filter((j) =>
    matches(p.query, j.title, j.service, j.customerName, j.address),
  );
  return (
    <section
      {...tourAttr("sched.queue")}
      aria-label="To schedule"
      className="nvc-card flex flex-col"
    >
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <Inbox className="h-4 w-4 text-amber-warn" />
        <h2 className="font-bold text-white">To schedule</h2>
        <span className="rounded-full bg-amber-warn/15 px-2 py-0.5 text-xs font-bold text-amber-warn">
          {p.jobs.length}
        </span>
        {p.canPlace && (
          <span className="ml-auto hidden text-[11px] text-slate-500 lg:inline">
            Drag onto a row, or pick one
          </span>
        )}
      </div>
      <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-3">
        {p.jobs.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500">
            All caught up. Every active job has a technician.
          </p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">
            Nothing waiting matches “{p.query}”.
          </p>
        ) : (
          shown.map((j) => (
            <QueueCard
              key={j.id}
              job={j}
              tz={p.tz}
              today={p.today}
              on={p.placingId === j.id}
              canPlace={p.canPlace}
              onPick={() => p.onPick(j)}
              onOpen={() => p.onOpen(j)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function QueueCard(p: {
  job: BoardJob;
  tz: string;
  today: string;
  on: boolean;
  canPlace: boolean;
  onPick(): void;
  onOpen(): void;
}) {
  const j = p.job;
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `q:${j.id}`,
    data: { job: j },
    disabled: !p.canPlace,
  });
  const pr = PRIORITY_META[j.priority as keyof typeof PRIORITY_META];
  const due = dayOf(j, p.tz);
  return (
    <div
      className={`group rounded-xl border p-2.5 transition ${p.on ? "border-emerald-live bg-emerald-live/[0.07]" : "border-white/10 bg-ink-3/60 hover:border-brand/40"}`}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <div className="flex items-start gap-2">
        {p.canPlace && (
          <span
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag ${j.title || j.service} onto a technician`}
            className="mt-0.5 hidden cursor-grab touch-none text-slate-600 group-hover:text-slate-400 lg:block"
          >
            <GripVertical className="h-4 w-4" />
          </span>
        )}
        <button
          type="button"
          onClick={p.onOpen}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-sm font-semibold text-white">
            {j.title || j.service}
          </span>
          <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-slate-500">
            <MapPin className="h-3 w-3 shrink-0" />
            {j.customerName ? `${j.customerName} · ` : ""}
            {j.address || "No address"}
          </span>
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {pr && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
            style={{ color: pr.color, background: `${pr.color}22` }}
          >
            {pr.label}
          </span>
        )}
        <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
          {hours(durationOf(j))}
        </span>
        {j.requiredSkillClass && (
          <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
            {j.requiredSkillClass}
          </span>
        )}
        <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
          {due === p.today
            ? "Today"
            : dayTitle(due, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
        </span>
        {p.canPlace && (
          <button
            type="button"
            onClick={p.onPick}
            aria-pressed={p.on}
            className={`ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold ${p.on ? "bg-emerald-live text-emerald-950" : "text-brand hover:bg-brand/10"}`}
          >
            <Sparkles className="h-3 w-3" /> {p.on ? "Placing…" : "Find a slot"}
          </button>
        )}
      </div>
    </div>
  );
}

/** The ranked slots for the job being placed, as a list (the same ones drawn as ghosts). */
export function SlotList(p: {
  job: BoardJob;
  slots: Slot[];
  techs: BoardTech[];
  dayLabel: string;
  onPlace(s: Slot): void;
  onCancel(): void;
}) {
  const name = (id: string) =>
    p.techs.find((t) => t.id === id)?.name ?? "Technician";
  return (
    <section
      aria-label="Suggested slots"
      className="rounded-2xl border border-emerald-live/35 bg-[#0d1a1c] p-3.5"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold text-white">
            Best slots for {p.job.title || p.job.service}
          </h3>
          <p className="text-[11.5px] text-slate-400">
            {p.dayLabel} · ranked by skill, drive time and how full each day is
          </p>
        </div>
        <button
          type="button"
          onClick={p.onCancel}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-400 hover:bg-white/5 hover:text-white"
        >
          Cancel
        </button>
      </div>
      <div className="mt-2.5 flex flex-col gap-2">
        {p.slots.length === 0 ? (
          <p className="text-xs text-red-300">
            No qualified technician has a free gap that day. Try another day, or
            drag it onto a row to book over.
          </p>
        ) : (
          p.slots.map((s, i) => (
            <button
              key={`${s.techId}-${s.startMin}`}
              type="button"
              onClick={() => p.onPlace(s)}
              className="flex items-center gap-2.5 rounded-xl border border-emerald-live/30 bg-emerald-live/[0.06] p-2.5 text-left hover:brightness-125"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-emerald-live text-xs font-extrabold text-emerald-950">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-bold text-white">
                  {name(s.techId)} · {clock(s.startMin)}
                </span>
                <span className="block text-[11.5px] text-slate-400">
                  {s.driveMins !== null ? `${s.driveMins} min drive · ` : ""}day
                  would be {hours(s.bookedAfter)} of 8h
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
