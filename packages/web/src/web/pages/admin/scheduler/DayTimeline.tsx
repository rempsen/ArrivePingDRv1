/**
 * The Day view: one row per technician, the day's hours across.
 *
 * A technician can't be in two places, so a row never squeezes jobs into
 * slivers: overlapping jobs split the row into two lanes and are flagged as a
 * conflict. Drive time between stops is drawn as a hatch, the now line crosses
 * every row, and while a waiting job is picked the best slots appear as green
 * ghosts on the rows that fit it.
 */
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { AlertTriangle, Clock3, Plus } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import type { BoardJob, BoardTech } from "../../../features/dispatch/data/types";
import { TechAvatar } from "../../../components/tech-avatar";
import { bookedMinutes, driveMinutes, durationOf, loadLevel, packLanes, pct, snapMinutes, type Range, type Slot } from "../../../../shared/schedule-layout";
import { DRIVE_HATCH, LOAD_COLOR, PHASE_STYLE, TECH_STATUS, clock, hourLabel, hours, matches, phaseOf, spanOf } from "./calendar-utils";

export interface DropPreview {
  techId: string;
  startMin: number;
  dur: number;
}

interface Props {
  techs: BoardTech[];
  /** Jobs on this day, by technician. */
  jobsByTech: Map<string, BoardJob[]>;
  tz: string;
  range: Range;
  /** Minutes since midnight now, when the day shown is today. */
  nowMin: number | null;
  compact: boolean;
  query: string;
  placing: BoardJob | null;
  ghosts: Slot[];
  selectedJobId: string | null;
  preview: DropPreview | null;
  dimmedTechs: Set<string>;
  onGhost(slot: Slot): void;
  onOpenJob(job: BoardJob): void;
  /** New job for this technician; at a time when one was picked on the row. */
  onNewJob(techId: string, startMin?: number): void;
}

export const TECH_COL_PX = 232;
/** Below this an hour is too narrow to read a job's title: the row scrolls sideways instead. */
const MIN_HOUR_PX = 112;

export function DayTimeline(p: Props) {
  const rowH = p.compact ? 50 : 76;
  const hourMarks: number[] = [];
  for (let m = Math.ceil(p.range.startMin / 60) * 60; m < p.range.endMin; m += 60) hourMarks.push(m);
  const span = p.range.endMin - p.range.startMin;
  const grid: CSSProperties = {
    backgroundImage: `repeating-linear-gradient(to right, rgba(148,163,184,.10) 0 1px, transparent 1px calc(100% / ${span / 60}))`,
  };
  const minTrack = (span / 60) * MIN_HOUR_PX;

  // Open scrolled to an hour before now, so the part of the day that's still
  // ahead is what a dispatcher sees first when the rows are wider than the screen.
  const scroller = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);
  const scrollKey = `${p.range.startMin}-${p.range.endMin}-${p.nowMin !== null}`;
  useEffect(() => {
    const el = scroller.current;
    if (!el || scrolledFor.current === scrollKey) return;
    scrolledFor.current = scrollKey;
    if (p.nowMin === null) {
      el.scrollLeft = 0;
      return;
    }
    const trackPx = el.scrollWidth - TECH_COL_PX;
    el.scrollLeft = Math.max(0, (pct(p.nowMin - 60, p.range) / 100) * trackPx);
  }, [scrollKey, p.nowMin, p.range]);

  return (
    <div className="nvc-card overflow-hidden">
      <div ref={scroller} className="overflow-x-auto">
        <div style={{ minWidth: TECH_COL_PX + minTrack }}>
          {/* hour axis */}
          <div className="sticky top-0 z-10 grid h-10 border-b border-white/10 bg-ink-2" style={{ gridTemplateColumns: `${TECH_COL_PX}px minmax(0,1fr)` }}>
            <div className="sticky left-0 z-[6] flex items-center bg-ink-2 px-4 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
              {p.techs.length} {p.techs.length === 1 ? "technician" : "technicians"}
            </div>
            <div className="relative">
              {hourMarks.map((m) => (
                <span key={m} className="absolute top-3 font-mono text-[11px] text-slate-500" style={{ left: `calc(${pct(m, p.range)}% + 6px)` }}>
                  {hourLabel(m)}
                </span>
              ))}
              {p.nowMin !== null && p.nowMin >= p.range.startMin && p.nowMin <= p.range.endMin && (
                <span
                  className="absolute top-2 -translate-x-1/2 rounded bg-red-400 px-1.5 text-[10.5px] font-extrabold text-red-950"
                  style={{ left: `${pct(p.nowMin, p.range)}%` }}
                >
                  {clock(p.nowMin, true)}
                </span>
              )}
            </div>
          </div>

          {p.techs.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-slate-500">No technicians match this filter.</p>
          )}
          {p.techs.map((t) => (
            <TechRow key={t.id} tech={t} jobs={p.jobsByTech.get(t.id) ?? []} rowH={rowH} grid={grid} {...p} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TechRow(p: Props & { tech: BoardTech; jobs: BoardJob[]; rowH: number; grid: CSSProperties }) {
  const { tech: t, jobs, rowH, range, tz } = p;
  const { setNodeRef, isOver } = useDroppable({ id: `row:${t.id}`, data: { techId: t.id } });
  const spans = jobs.map((j) => spanOf(j, tz));
  const lanes = new Map(packLanes(spans).map((l) => [l.id, l]));
  const booked = bookedMinutes(jobs);
  const level = loadLevel(booked);
  const st = TECH_STATUS[t.status] ?? TECH_STATUS.offline!;
  const dim = p.dimmedTechs.has(t.id);
  const ghosts = p.ghosts.map((g, i) => ({ g, i })).filter((x) => x.g.techId === t.id);
  const preview = p.preview && p.preview.techId === t.id ? p.preview : null;

  return (
    <div
      className="grid border-b border-white/[0.06] transition-opacity"
      style={{ gridTemplateColumns: `${TECH_COL_PX}px minmax(0,1fr)`, height: rowH, opacity: dim ? 0.5 : 1 }}
    >
      <div className="sticky left-0 z-[6] flex min-w-0 items-center gap-2.5 border-r border-white/10 bg-[#0d1524] px-3.5">
        <TechAvatar
          name={t.name}
          photoUrl={t.photoUrl}
          color={t.color}
          className={p.compact ? "h-7 w-7 ring-2" : "h-9 w-9 ring-2"}
          textClassName="text-[11px] font-bold"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold text-white">{t.name}</span>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: st.dot }} title={st.label} />
            <button
              type="button"
              onClick={() => p.onNewJob(t.id)}
              aria-label={`New job for ${t.name} on this day`}
              title="New job for this technician (or double-click a time on the row)"
              className="ml-auto grid h-5 w-5 shrink-0 place-items-center rounded text-slate-500 opacity-60 hover:bg-white/10 hover:text-white hover:opacity-100 focus-visible:opacity-100"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {dim && p.placing ? (
            <span className="truncate text-xs font-semibold text-slate-500">Not qualified for this job</span>
          ) : (
            !p.compact && (
              <span className="truncate text-xs text-slate-500">
                {t.skillClass || "General"} · {st.label}
              </span>
            )
          )}
          <div className="flex items-center gap-1.5" title={`${hours(booked)} of 8h booked`}>
            <span className="h-1 flex-1 overflow-hidden rounded bg-white/10">
              <span className="block h-full" style={{ width: `${Math.min(100, (booked / 480) * 100)}%`, background: LOAD_COLOR[level] }} />
            </span>
            <span className="font-mono text-[10.5px] text-slate-400">{hours(booked)}/8h</span>
          </div>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className="relative"
        style={{ ...p.grid, background: isOver ? "rgba(14,165,233,.06)" : undefined }}
        // Double-click an empty spot to book a job there.
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          const r = e.currentTarget.getBoundingClientRect();
          if (r.width <= 0) return;
          const at = range.startMin + ((e.clientX - r.left) / r.width) * (range.endMin - range.startMin);
          p.onNewJob(t.id, snapMinutes(at));
        }}
      >
        {p.nowMin !== null && p.nowMin > range.startMin && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 bg-black/25" style={{ width: `${pct(Math.min(p.nowMin, range.endMin), range)}%` }} />
        )}
        {p.nowMin !== null && p.nowMin >= range.startMin && p.nowMin <= range.endMin && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-[3] w-0.5 bg-red-400" style={{ left: `${pct(p.nowMin, range)}%` }} />
        )}

        {/* drive time into each stop */}
        {jobs.map((j, i) => {
          const prev = jobs[i - 1];
          if (!prev) return null;
          const drive = driveMinutes(prev, j);
          if (drive === null) return null;
          const s = spans[i]!;
          const from = Math.max(range.startMin, s.startMin - drive, spans[i - 1]!.endMin);
          if (from >= s.startMin) return null;
          return (
            <span
              key={`d-${j.id}`}
              title={`About ${drive} min drive from the last stop`}
              className="absolute z-[1] h-1.5 rounded"
              style={{ left: `${pct(from, range)}%`, width: `${pct(s.startMin, range) - pct(from, range)}%`, top: rowH / 2 - 3, backgroundImage: DRIVE_HATCH }}
            />
          );
        })}

        {jobs.map((j, i) => (
          <JobBlock
            key={j.id}
            job={j}
            span={spans[i]!}
            lane={lanes.get(j.id)!}
            rowH={rowH}
            range={range}
            compact={p.compact}
            faded={!matches(p.query, j.title, j.service, j.customerName, j.address, t.name) || dim}
            selected={p.selectedJobId === j.id}
            onOpen={() => p.onOpenJob(j)}
          />
        ))}

        {ghosts.map(({ g, i }) => (
          <button
            key={`g-${i}`}
            type="button"
            onClick={() => p.onGhost(g)}
            aria-label={`Assign ${p.placing?.title ?? "job"} to ${t.name} at ${clock(g.startMin)}`}
            className="absolute z-[4] flex flex-col justify-center gap-0.5 overflow-hidden rounded-lg border-[1.5px] border-dashed border-emerald-live bg-[#0d2420]/95 px-2 text-left text-white shadow-[0_0_0_4px_rgba(16,185,129,.12)] hover:brightness-125"
            style={{ left: `${pct(g.startMin, range)}%`, width: `max(150px, ${pct(g.startMin + durationOf(p.placing ?? {}), range) - pct(g.startMin, range)}%)`, top: 4, height: rowH - 8 }}
          >
            <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-extrabold">
              <span className="rounded bg-emerald-live px-1.5 text-[10.5px] text-emerald-950">#{i + 1}</span>
              {i === 0 ? "Best fit" : `Option ${i + 1}`}
            </span>
            {!p.compact && (
              <span className="truncate text-[11.5px] text-emerald-100">
                {clock(g.startMin, true)}–{clock(g.startMin + durationOf(p.placing ?? {}), true)}
                {g.driveMins !== null ? ` · ${g.driveMins} min drive` : ""}
              </span>
            )}
          </button>
        ))}

        {preview && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute z-[3] rounded-lg border-[1.5px] border-dashed border-brand bg-brand/10 px-2 py-1 text-[11.5px] font-extrabold text-sky-200"
            style={{ left: `${pct(preview.startMin, range)}%`, width: `${pct(preview.startMin + preview.dur, range) - pct(preview.startMin, range)}%`, top: 4, height: rowH - 8 }}
          >
            {clock(preview.startMin)}
          </span>
        )}
      </div>
    </div>
  );
}

function JobBlock(p: {
  job: BoardJob;
  span: { startMin: number; endMin: number };
  lane: { lane: 0 | 1; lanes: 1 | 2; conflict: boolean };
  rowH: number;
  range: Range;
  compact: boolean;
  faded: boolean;
  selected: boolean;
  onOpen(): void;
}) {
  const { job: j, span, lane, rowH, range } = p;
  const phase = phaseOf(j.status);
  const look = PHASE_STYLE[phase];
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `j:${j.id}`, data: { job: j }, disabled: phase === "done" });
  const split = lane.lanes === 2;
  const top = split ? (lane.lane === 0 ? 4 : rowH / 2 + 1) : 5;
  const h = split ? rowH / 2 - 5 : rowH - 10;
  const dur = span.endMin - span.startMin;
  // A short job has room for its title and little else: the title gets two
  // lines and the time moves to the tooltip (its position already says it).
  const short = dur <= 60;
  const showTime = !split && !short;
  const showMeta = !p.compact && !split && dur >= 90;
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={p.onOpen}
      title={`${j.title || j.service} · ${clock(span.startMin)}–${clock(span.endMin)}${j.customerName ? ` · ${j.customerName}` : ""}`}
      aria-label={`${j.title || j.service}, ${clock(span.startMin)}, ${look.label}${lane.conflict ? ", overlaps another job" : ""}`}
      className="absolute z-[2] flex flex-col justify-center gap-px overflow-hidden rounded-lg border text-left transition-[filter] hover:brightness-125"
      style={{
        left: `calc(${pct(span.startMin, range)}% + 1px)`,
        width: `max(44px, calc(${pct(span.endMin, range) - pct(span.startMin, range)}% - 2px))`,
        top,
        height: h,
        padding: p.compact || split ? "2px 7px" : "6px 8px",
        background: look.bg,
        borderColor: lane.conflict ? "#f87171" : look.border,
        color: look.text,
        opacity: isDragging ? 0.35 : p.faded ? 0.25 : 1,
        boxShadow: p.selected ? "0 0 0 2px #e6edf7" : lane.conflict ? "0 0 0 1px #f87171" : undefined,
        cursor: phase === "done" ? "pointer" : "grab",
        touchAction: "manipulation",
      }}
    >
      <span className="flex min-w-0 items-start gap-1.5">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: look.dot }} />
        <span className={`text-[12.5px] font-bold leading-tight ${short && !split && !p.compact ? "line-clamp-2" : "truncate"}`}>{j.title || j.service}</span>
        {lane.conflict && (
          <span title="Overlaps another job" className="ml-auto flex shrink-0 items-center gap-0.5 rounded bg-red-400 px-1 text-[10px] font-extrabold text-red-950">
            <AlertTriangle className="h-2.5 w-2.5" />
            {showMeta && "Overlap"}
          </span>
        )}
        {!lane.conflict && j.late && phase !== "done" && (
          <span title="Projected to run late" className="ml-auto flex shrink-0 items-center gap-0.5 rounded bg-amber-warn px-1 text-[10px] font-extrabold text-amber-950">
            <Clock3 className="h-2.5 w-2.5" />
            {showMeta && "Late"}
          </span>
        )}
      </span>
      {showTime && (
        <span className="truncate font-mono text-[10.5px] text-slate-300/80">
          {clock(span.startMin, true)}–{clock(span.endMin, true)}
        </span>
      )}
      {showMeta && <span className="truncate text-[11.5px] text-slate-400">{j.customerName || j.address || "Customer"}</span>}
    </button>
  );
}
