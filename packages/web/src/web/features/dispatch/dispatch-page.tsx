/**
 * Map v2: the dispatch screen. The map fills the page; the queue, team strip
 * and inspectors float over it. Everything routes through one selection
 * (a technician or a job), mirrored to ?tech= / ?job= so a link opens the same view.
 */
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkOrderModal } from "../../components/work-order-modal";
import { apiFetch, apiHeaders } from "../../lib/api";
import { useJobNoun, useWorkerNoun } from "../../lib/use-brand";
import { queueOrder } from "../../../shared/job-kind";
import { Announcer, ClashCard, UndoToast } from "./assign/assign-feedback";
import { useAssign } from "./assign/use-assign";
import { setMapV2 } from "./map-switch";
import { useBoard } from "./data/use-board";
import { useCandidates } from "./data/use-candidates";
import type { BoardJob, BoardTech, DispatchCandidate } from "./data/types";
import { createDragEngine, MAGNET_MOUSE, MAGNET_TOUCH, type DragEngine } from "./drag/drag-engine";
import { DispatchMap, type DispatchMapHandle } from "./map/dispatch-map";
import type { DragFit } from "./map/tech-markers";
import { FIT_LABEL, firstName, jobSub, jobTitle } from "./panels/format";
import { JobInspector, TechInspector } from "./panels/inspector";
import { QueuePanel } from "./panels/queue-panel";
import { TeamStrip } from "./panels/team-strip";
import "./dispatch.css";

const NO_TECHS: BoardTech[] = [];
const NO_JOBS: BoardJob[] = [];

type Layout = "wide" | "medium" | "narrow";
const layoutFor = (w: number): Layout => (w >= 1280 ? "wide" : w >= 768 ? "medium" : "narrow");

function readSel(): { tech: string | null; job: string | null } {
  const p = new URLSearchParams(window.location.search);
  return { tech: p.get("tech"), job: p.get("job") };
}

export function DispatchPage() {
  const root = useRef<HTMLDivElement>(null);
  const mapRef = useRef<DispatchMapHandle | null>(null);
  const strip = useRef<HTMLUListElement>(null);
  const engine = useRef<DragEngine | null>(null);

  const [layout, setLayout] = useState<Layout>(() => layoutFor(window.innerWidth));
  const [sel, setSel] = useState(readSel);
  const [satellite, setSatellite] = useState(false);
  const [hoverJob, setHoverJob] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"peek" | "half" | "full">("peek");
  const [dragJob, setDragJob] = useState<string | null>(null);
  const [overTech, setOverTech] = useState<string | null>(null);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [learned, setLearned] = useState(() => {
    try {
      return localStorage.getItem("arriveping.dispatchHint") === "1";
    } catch {
      return false;
    }
  });

  const { board, isLoading, error, connected, optimistic, commit, refetch } = useBoard(null);
  const { noun: jobNoun, nounPlural: jobPlural } = useJobNoun();
  const { noun: workerNoun } = useWorkerNoun();
  const assigner = useAssign({ board, optimistic, commit, refetch });

  const tz = board?.tz ?? "UTC";
  const techs = board?.techs ?? NO_TECHS;
  const jobs = board?.jobs ?? NO_JOBS;

  const queue = useMemo(
    () => jobs.filter((j) => !j.riderId && j.status !== "completed" && j.status !== "cancelled").sort(queueOrder),
    [jobs],
  );
  const queueIds = useMemo(() => queue.map((j) => j.id), [queue]);
  const selectedJobId = sel.job;
  const wanted = useMemo(() => (selectedJobId && !queueIds.includes(selectedJobId) ? [...queueIds, selectedJobId] : queueIds), [queueIds, selectedJobId]);
  const { candidates } = useCandidates(wanted);

  const techById = useMemo(() => new Map(techs.map((t) => [t.id, t])), [techs]);
  const techName = useCallback((id: string) => techById.get(id)?.name ?? "", [techById]);
  const tech = sel.tech ? techById.get(sel.tech) ?? null : null;
  const job = selectedJobId ? jobs.find((j) => j.id === selectedJobId) ?? null : null;

  // Selection <-> URL.
  const select = useCallback((next: { tech?: string | null; job?: string | null }) => {
    setSel((cur) => {
      const n = { ...cur, ...next };
      if (next.tech) n.job = null;
      if (next.job) n.tech = null;
      const u = new URL(window.location.href);
      if (n.tech) u.searchParams.set("tech", n.tech);
      else u.searchParams.delete("tech");
      if (n.job) u.searchParams.set("job", n.job);
      else u.searchParams.delete("job");
      window.history.replaceState(null, "", u);
      return n;
    });
  }, []);

  // Layout by measured width.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLayout(layoutFor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the map clear of the panels.
  const hasInspector = !!(tech || job);
  const padding = useMemo(() => {
    if (layout === "narrow") return { top: 64, right: 12, bottom: 160, left: 12 };
    const left = layout === "wide" ? 340 : 316;
    return { top: 72, right: hasInspector ? 380 : 16, bottom: 92, left };
  }, [layout, hasInspector]);

  // Fit score per technician for whatever job is being dragged.
  const fitsFor = useCallback(
    (jobId: string): Record<string, DragFit> | null => {
      const list: DispatchCandidate[] | undefined = candidates[jobId];
      if (!list) return null;
      const out: Record<string, DragFit> = {};
      for (const c of list) out[c.techId] = { fit: c.fit, best: c.best, chip: c.best ? "Best match" : c.fit === "ready" ? (c.etaMins != null ? `${c.etaMins} min away` : "Ready") : FIT_LABEL[c.fit] ?? c.fit };
      return out;
    },
    [candidates],
  );
  const fitsRef = useRef(fitsFor);
  fitsRef.current = fitsFor;
  const stripFits = useMemo(() => (dragJob ? fitsFor(dragJob) : null), [dragJob, fitsFor]);

  const assignRef = useRef(assigner.assign);
  assignRef.current = assigner.assign;
  const boardRef = useRef(board);
  boardRef.current = board;

  // One drag engine for the page.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    const eng = createDragEngine({
      targets: () => {
        const m = mapRef.current?.techs();
        return m ? m.screenPoints() : [];
      },
      mapRect: () => root.current?.querySelector(".ap-map")?.getBoundingClientRect() ?? null,
      panBy: (dx, dy) => mapRef.current?.controller()?.map.panBy([dx, dy], { animate: false }),
      begin: (info) => {
        setDragJob(info.jobId);
        const m = mapRef.current?.techs();
        m?.setDrag(fitsRef.current(info.jobId));
        el.classList.add("ap-dragging-job");
        return true;
      },
      hover: (techId, via) => {
        setOverTech(techId);
        const first = techId ? firstName(boardRef.current?.techs.find((t) => t.id === techId)?.name ?? "") : "";
        mapRef.current?.techs()?.setTarget(via === "magnet" ? techId : null, first ? `Release to assign to ${first}` : undefined);
      },
      drop: (jobId, techId) => {
        void assignRef.current(jobId, techId);
        setLearned(true);
        try {
          localStorage.setItem("arriveping.dispatchHint", "1");
        } catch {
          /* private mode */
        }
      },
      end: () => {
        setDragJob(null);
        setOverTech(null);
        const m = mapRef.current?.techs();
        m?.setDrag(null);
        m?.setTarget(null);
        el.classList.remove("ap-dragging-job");
      },
      lockMap: (locked) => {
        const ctl = mapRef.current?.controller();
        if (ctl) ctl.lockGestures(locked);
      },
    });
    engine.current = eng;
    const unbind = eng.bindRoot(el);
    void MAGNET_MOUSE; void MAGNET_TOUCH; void coarse;
    return () => {
      unbind();
      eng.destroy();
      engine.current = null;
    };
  }, []);

  // Pins on the map are drag sources too.
  const onMapReady = useCallback((h: DispatchMapHandle) => {
    mapRef.current = h;
    const host = root.current?.querySelector<HTMLElement>(".ap-map");
    const layer = h.jobs();
    if (!host || !layer || !engine.current) return;
    engine.current.attachSurface(host, (x, y) => {
      const r = host.getBoundingClientRect();
      const hit = layer.hit(x - r.left, y - r.top, 10);
      if (!hit || hit.type !== "job") return null;
      const j = boardRef.current?.jobs.find((q) => q.id === hit.id);
      if (!j || j.riderId) return null;
      return { jobId: j.id, title: jobTitle(j, jobNoun), sub: jobSub(j, boardRef.current?.tz ?? "UTC") };
    });
  }, [jobNoun]);

  // Keyboard: / or Cmd-K focuses nothing yet; F fits, S toggles satellite, Esc clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (engine.current?.active()) engine.current.cancel();
        else if (assigner.clash) assigner.dismissClash();
        else select({ tech: null, job: null });
      } else if (e.key === "f" || e.key === "F") mapRef.current?.fitAll();
      else if (e.key === "s" || e.key === "S") setSatellite((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assigner, select]);

  const bookingQ = useQuery({
    queryKey: ["dispatch-open-booking", openJobId],
    queryFn: async () => {
      const res = await apiFetch(`/api/bookings/${openJobId}`, { credentials: "include", headers: apiHeaders() });
      return (await res.json()) as { booking: any };
    },
    enabled: !!openJobId,
  });

  const unassign = useCallback(
    async (jobId: string) => {
      await apiFetch(`/api/bookings/${jobId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...apiHeaders() },
        body: JSON.stringify({ riderId: "" }),
      });
      void refetch();
    },
    [refetch],
  );

  const showJob = useCallback(() => true, []);
  const holder = job?.riderId ? techById.get(job.riderId) ?? null : null;
  const counts = useMemo(() => {
    const live = techs.filter((t) => t.status !== "offline").length;
    return `${live} of ${techs.length} online`;
  }, [techs]);

  const panels = (
    <>
      <QueuePanel
        jobs={queue}
        tz={tz}
        noun={jobNoun}
        nounPlural={jobPlural}
        workerNoun={workerNoun}
        selectedId={selectedJobId}
        candidates={candidates}
        techName={techName}
        onSelect={(id) => {
          select({ job: id });
          const p = mapRef.current?.jobs()?.positionOf(id);
          if (p) mapRef.current?.focus(p);
        }}
        onHover={setHoverJob}
      />
    </>
  );

  const inspector = tech ? (
    <TechInspector
      tech={tech}
      jobs={jobs}
      tz={tz}
      noun={jobNoun}
      workerNoun={workerNoun}
      onClose={() => select({ tech: null })}
      onSelectJob={(id) => select({ job: id })}
      onOpenJob={setOpenJobId}
      onCenter={() => {
        const p = mapRef.current?.techs()?.positionOf(tech.id);
        if (p) mapRef.current?.focus(p, 14);
      }}
    />
  ) : job ? (
    <JobInspector
      job={job}
      candidates={candidates[job.id] ?? []}
      techName={techName}
      holder={holder}
      tz={tz}
      noun={jobNoun}
      workerNoun={workerNoun}
      onClose={() => select({ job: null })}
      onAssign={(techId) => void assigner.assign(job.id, techId)}
      onUnassign={() => void unassign(job.id)}
      onOpen={() => setOpenJobId(job.id)}
      onSelectTech={(id) => select({ tech: id })}
    />
  ) : null;

  return (
    <div ref={root} className="dispatch-v2 ap-page" data-layout={layout} data-testid="dispatch-page">
      <DispatchMap
        board={board}
        mode={satellite ? "satellite" : "ink"}
        selectedTech={sel.tech}
        selectedJob={selectedJobId}
        hoverJob={hoverJob}
        padding={padding}
        showJob={showJob}
        onSelectTech={(id) => select({ tech: id })}
        onSelectJob={(id) => select({ job: id })}
        onReady={onMapReady}
      />

      <div className="ap-toolbar ap-glass" role="toolbar" aria-label="Map controls">
        <strong className="ap-toolbar__title">Dispatch</strong>
        <span className="ap-muted tnum">{counts}</span>
        <span className="ap-live" data-on={connected ? "" : undefined} title={connected ? "Live" : "Reconnecting"} />
        <button type="button" className="ap-btn" onClick={() => mapRef.current?.fitAll()} aria-keyshortcuts="F">
          Fit all
        </button>
        <button type="button" className="ap-btn" aria-pressed={satellite} onClick={() => setSatellite((v) => !v)} aria-keyshortcuts="S">
          Satellite
        </button>
        <button type="button" className="ap-btn ap-btn--link" onClick={() => setMapV2(false)}>
          Classic map
        </button>
      </div>

      {layout === "narrow" ? (
        <div className="ap-sheet ap-glass" data-detent={sheet}>
          <button
            type="button"
            className="ap-sheet__grip"
            aria-label="Resize panel"
            onClick={() => setSheet((s) => (s === "peek" ? "half" : s === "half" ? "full" : "peek"))}
          />
          <div className="ap-sheet__body">{inspector ?? panels}</div>
        </div>
      ) : (
        <>
          <div className="ap-left">{panels}</div>
          {inspector && <div className="ap-right">{inspector}</div>}
        </>
      )}

      <TeamStrip
        ref={strip}
        techs={techs}
        selectedId={sel.tech}
        fits={stripFits}
        targetId={overTech}
        jobNoun={jobNoun}
        onSelect={(id) => {
          select({ tech: id });
          const p = mapRef.current?.techs()?.positionOf(id);
          if (p) mapRef.current?.focus(p);
        }}
      />

      {!learned && !sel.tech && !selectedJobId && queue.length > 0 && !dragJob && (
        <p className="ap-firsthint ap-glass">Drag a {jobNoun.toLowerCase()} onto a {workerNoun.toLowerCase()} to assign</p>
      )}
      {isLoading && <p className="ap-loading ap-glass">Loading the map…</p>}
      {error && !board && <p className="ap-loading ap-glass">Couldn't load the board. Retrying…</p>}

      {assigner.clash && <ClashCard clash={assigner.clash} onConfirm={assigner.confirmClash} onCancel={assigner.dismissClash} />}
      {assigner.toast && <UndoToast toast={assigner.toast} onUndo={() => void assigner.undo()} onClose={assigner.dismissToast} />}
      <Announcer text={assigner.announce} />

      <WorkOrderModal open={!!openJobId} editBooking={bookingQ.data?.booking} onClose={() => setOpenJobId(null)} />
    </div>
  );
}
