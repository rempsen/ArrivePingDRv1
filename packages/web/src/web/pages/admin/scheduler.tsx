import { useState } from "react";
import { useConfirm } from "../../components/confirm-dialog";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiHeaders } from "../../lib/api";
import { ok } from "../../lib/api-ok";
import { assignJob } from "../../lib/assign-job";
import { FullLoader } from "../../components/loader";
import { PageWrap, StatusBadge } from "../../components/brand";
import { AutoBadge } from "../../components/auto-badge";
import { PageHead } from "./shell";
import { PRIORITY_META } from "../../lib/utils";
import { qualifies } from "../../../shared/qualify";
import { WorkOrderModal } from "../../components/work-order-modal";
import { EmptyState } from "../../components/empty-state";
import { useAccess } from "../../hooks/use-access";
import {
  Sparkles,
  MapPin,
  GripVertical,
  CheckCircle2,
  Inbox,
  Pencil,
  Trash2,
  Plus,
  LayoutGrid,
  CalendarDays,
  Loader2,
  AlertTriangle,
  UserPlus,
  X,
} from "lucide-react";
import { useWorkerNoun, useJobNoun, useBrand } from "../../lib/use-brand";
import { TechAvatar } from "../../components/tech-avatar";
import { tourAttr } from "../../guide/anchors";
import { groupTechJobs, jobClock, type ListJob } from "../../../shared/tech-job-groups";
import { DispatchCalendar } from "./scheduler/DispatchCalendar";

/** "~3258 min late" is unreadable; dispatchers think in hours and days. */
function fmtLate(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `~${m} min late`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `~${h} h ${rem} min late` : `~${h} h late`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `~${d} d ${hh} h late` : `~${d} d late`;
}

export default function SchedulerPage() {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { noun, nounPlural } = useWorkerNoun();
  // Tenant's unit-of-work noun ("Work Order" / "Booking" / "Visit"…) — the
  // sidebar already uses it; the page copy and the New button must agree.
  const { noun: jobNoun, nounPlural: jobNounPlural } = useJobNoun();
  const jobLower = jobNoun.toLowerCase();
  const jobsLower = jobNounPlural.toLowerCase();
  // Archiving a job needs work_orders:delete (api/routes/job-search.ts); without
  // it the delete buttons would only ever fail, so they aren't shown.
  const canArchive = useAccess().can("work_orders:delete");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overTech, setOverTech] = useState<string | null>(null);
  const [aiFor, setAiFor] = useState<string | null>(null);
  // touch-friendly manual assign (alternative to drag-and-drop)
  const [assignFor, setAssignFor] = useState<string | null>(null);
  // skill class filter for board view
  const [skillFilter, setSkillFilter] = useState<string>("");
  const [focusTech, setFocusTech] = useState<string | null>(null);
  const [mode, setMode] = useState<"board" | "calendar">("calendar");
  const [newDate, setNewDate] = useState<Date | null>(null);
  const [newRider, setNewRider] = useState<string | undefined>(undefined);
  const [editJob, setEditJob] = useState<any | null>(null);
  const [, navigate] = useLocation();
  // Completed jobs are historical now — open the read-only report instead
  // of the editable work order. Everything else (including cancelled)
  // keeps the existing edit-modal behavior.
  const openJob = (b: any) => {
    if (b.status === "completed") navigate(`/admin/jobs/${b.id}/report`);
    else setEditJob(b);
  };

  // The calendar works from the dispatch board, so it hands over an id; the
  // work-order modal wants the full booking, fetched fresh.
  const openJobById = async (id: string) => {
    // Always the job as it is now: the Board tab's list isn't refreshed while
    // the calendar is open, and the form saves every field it was given.
    try {
      const r = (await ok(await api.bookings[":id"].$get({ param: { id } }))) as { booking: any };
      openJob(r.booking);
    } catch {
      /* the global error toast has already said why */
    }
  };

  // The Board tab's full lists. The calendar reads the dispatch board and its
  // live stream instead, so these load only while the Board tab is open.
  const bookings = useQuery({
    queryKey: ["bookings"],
    queryFn: async () => ok(await api.bookings.$get()),
    refetchInterval: 8000,
    enabled: mode === "board",
  });
  const riders = useQuery({
    queryKey: ["riders"],
    queryFn: async () => ok(await api.riders.$get()),
    enabled: mode === "board",
  });

  const skillClassesQ = useQuery({
    queryKey: ["msg-skill-classes"],
    queryFn: async () => { const r = await fetch("/api/messages/skill-classes", { headers: apiHeaders() }); return r.json(); },
  });
  const boardSkillClasses: string[] = (skillClassesQ.data?.skillClasses ?? []).map((s: any) => s.name);

  // assignJob turns the server's "a tech is already working this job" refusal into
  // a Reassign confirmation. Dragging a card onto another tech's column is exactly
  // how that used to happen silently, mid-visit.
  const assign = useMutation({
    mutationFn: async ({ id, riderId, techName }: { id: string; riderId: string; techName?: string }) =>
      assignJob({ bookingId: id, riderId, techName, confirm }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["fleet"] });
    },
  });

  // jobs projected to run late (live tech position + this tenant's own history)
  const risk = useQuery({
    queryKey: ["delay-risk"],
    queryFn: async () => ok(await api.ai["delay-risk"].$get()),
    refetchInterval: 60_000,
  });

  const suggest = useMutation({
    mutationFn: async (bookingId: string) =>
      ok(await api.ai["suggest-tech"][":bookingId"].$post({
        param: { bookingId },
      })),
  });

  const del = useMutation({
    mutationFn: async (id: string) =>
      api.jobs[":id"].$delete({ param: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["fleet"] });
      qc.invalidateQueries({ queryKey: ["riders"] });
    },
  });

  const removeJob = async (b: any) => {
    const ok = await confirm({
      title: `Archive "${b.title || b.service?.name || `this ${jobLower}`}"?`,
      message: `It will be moved to the archive and can be restored later from ${jobNounPlural}.`,
      confirmLabel: "Archive",
    });
    if (ok) del.mutate(b.id);
  };

  if (mode === "board" && (bookings.isLoading || riders.isLoading))
    return <FullLoader label="Loading scheduler…" />;

  const all = bookings.data?.bookings ?? [];
  const techs = riders.data?.riders ?? [];
  // skill-class-filtered techs for board view
  const filteredTechs = skillFilter ? techs.filter((t: any) => t.skillClass === skillFilter) : techs;
  const unassigned = all.filter((b) => !b.riderId && b.status !== "completed" && b.status !== "cancelled");
  // dragging job for skill highlight
  const draggedJob = dragId ? all.find((b) => b.id === dragId) : null;
  // One rule for "qualified" everywhere (shared/qualify.ts): the job's required
  // skill class and tags, else its service category against the tech's skills.
  const qualifiedFor = (t: any, b: any) =>
    qualifies(
      { skills: t?.skills, skillClass: t?.skillClass },
      { requiredSkillClass: b?.requiredSkillClass, requiredSkills: b?.requiredSkills, serviceCategory: b?.service?.category },
    ).qualified;
  const byTech = (tid: string) =>
    all.filter((b) => b.riderId === tid && !["completed", "cancelled"].includes(b.status));

  function onDrop(riderId: string) {
    if (dragId) assign.mutate({ id: dragId, riderId });
    setDragId(null);
    setOverTech(null);
  }

  return (
    <PageWrap wide>
      <WorkOrderModal
        open={newDate !== null}
        defaultDate={newDate ?? undefined}
        defaultRiderId={newRider}
        onClose={() => {
          setNewDate(null);
          setNewRider(undefined);
        }}
      />
      <WorkOrderModal
        open={editJob !== null}
        editBooking={editJob ?? undefined}
        onClose={() => setEditJob(null)}
      />
      <PageHead
        title="Scheduler"
        // Device-neutral wording: "drag" is a lie on a phone, where HTML5 drag
        // events never fire and Assign is the only way to dispatch.
        subtitle={`Dispatch ${jobsLower} to a ${noun.toLowerCase()} — or let AI suggest the best match`}
        actions={
          <div className="flex items-center gap-2">
            <div {...tourAttr("sched.mode")} className="flex rounded-lg border border-white/10 bg-ink-2 p-0.5">
              <button
                onClick={() => setMode("board")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${mode === "board" ? "bg-brand text-white" : "text-slate-400 hover:text-white"}`}
              >
                <LayoutGrid className="h-3.5 w-3.5" /> Board
              </button>
              <button
                {...tourAttr("sched.calendar")}
                onClick={() => setMode("calendar")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${mode === "calendar" ? "bg-brand text-white" : "text-slate-400 hover:text-white"}`}
              >
                <CalendarDays className="h-3.5 w-3.5" /> Calendar
              </button>
            </div>
            <button
              {...tourAttr("sched.new-job")}
              onClick={() => setNewDate(new Date())}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-deep"
            >
              <Plus className="h-4 w-4" /> New {jobNoun}
            </button>
          </div>
        }
      />

      {((risk.data as any)?.risks ?? []).length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-warn/25 bg-amber-warn/[0.06] p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-warn" />
            <h3 className="text-sm font-bold text-amber-warn">
              {(risk.data as any).risks.length} job
              {(risk.data as any).risks.length === 1 ? "" : "s"} projected to run
              late
            </h3>
          </div>
          <div className="mt-2 space-y-1.5">
            {((risk.data as any).risks as any[]).slice(0, 4).map((r) => (
              <button
                key={r.bookingId}
                onClick={() => void openJobById(r.bookingId)}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left text-xs hover:bg-white/5"
              >
                <span className="font-semibold text-slate-200">
                  {r.title || jobNoun}
                </span>
                <span className="rounded-full bg-amber-warn/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-warn">
                  {fmtLate(r.minutesLate)}
                </span>
                <span className="truncate text-slate-500">
                  {r.techName ? `${r.techName} — ` : ""}
                  {r.reason}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === "calendar" ? (
        <DispatchCalendar
          confirm={confirm}
          onOpenJob={openJobById}
          onNewJob={(at, riderId) => {
            setNewRider(riderId);
            setNewDate(at);
          }}
        />
      ) : (
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        {/* unassigned queue */}
        <div className="nvc-card flex h-fit flex-col">
          <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
            <Inbox className="h-4 w-4 text-amber-warn" />
            <h2 className="font-bold text-white">Unassigned</h2>
            <span className="ml-auto rounded-full bg-amber-warn/15 px-2 py-0.5 text-xs font-bold text-amber-warn">
              {unassigned.length}
            </span>
          </div>
          <div className="space-y-2 p-3">
            {unassigned.length === 0 ? (
              // tone="good": an empty dispatch queue is the goal, not missing
              // data, and it should feel like it.
              <EmptyState
                compact
                tone="good"
                icon={CheckCircle2}
                title="All dispatched"
                hint="Nothing is waiting for a technician right now."
              />
            ) : (
              unassigned.map((b) => (
                <div
                  key={b.id}
                  draggable
                  // oxlint-disable-next-line prefer-tag-over-role -- a draggable div cannot be a <button>
                  role="button"
                  tabIndex={0}
                  title="Click to view & edit"
                  onClick={() => {
                    if (!dragId) openJob(b);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openJob(b);
                    }
                  }}
                  onDragStart={() => setDragId(b.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverTech(null);
                  }}
                  className={`group cursor-grab rounded-xl border border-white/10 bg-ink-3/60 p-3 transition hover:border-brand/40 active:cursor-grabbing ${
                    dragId === b.id ? "dragging" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {/* The grab handle promises drag-to-dispatch, so it only
                        appears at the widths where dragging exists. */}
                    <GripVertical className="mt-0.5 hidden h-4 w-4 shrink-0 cursor-grab text-slate-600 group-hover:text-slate-400 lg:block" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-semibold text-white">
                          {b.title || b.service?.name}
                        </p>
                        {b.priority && (
                          <span
                            className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                            style={{
                              color: PRIORITY_META[b.priority]?.color,
                              background: `${PRIORITY_META[b.priority]?.color}22`,
                            }}
                          >
                            {PRIORITY_META[b.priority]?.label}
                          </span>
                        )}
                        {(b as any).requiredSkillClass && (
                          <span className="shrink-0 rounded-full bg-brand/20 px-1.5 py-0.5 text-[10px] font-bold text-brand">
                            {(b as any).requiredSkillClass}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {b.address}
                      </p>
                      {(b as any).requiredSkills && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {((b as any).requiredSkills as string).split(",").filter(Boolean).map((sk: string) => (
                            <span key={sk} className="rounded-full bg-cyan-glow/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-glow">{sk}</span>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setAssignFor((v) => (v === b.id ? null : b.id));
                            setAiFor(null);
                          }}
                          className="-mx-1 flex min-h-11 items-center gap-1 px-1 text-xs font-semibold text-slate-300 hover:text-white lg:mx-0 lg:min-h-0 lg:px-0"
                        >
                          <UserPlus className="h-3 w-3" /> Assign
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setAiFor(b.id);
                            setAssignFor(null);
                            suggest.mutate(b.id);
                          }}
                          className="-mx-1 flex min-h-11 items-center gap-1 px-1 text-xs font-semibold text-cyan-glow hover:text-brand lg:mx-0 lg:min-h-0 lg:px-0"
                        >
                          <Sparkles className="h-3 w-3" /> AI suggest
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openJob(b);
                          }}
                          className="-mx-1 flex min-h-11 items-center gap-1 px-1 text-xs font-semibold text-slate-400 hover:text-white lg:mx-0 lg:min-h-0 lg:px-0"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                        {canArchive && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeJob(b);
                            }}
                            aria-label={`Delete ${jobLower}`}
                            className="-mr-1 ml-auto flex min-h-11 items-center gap-1 px-1 text-xs font-semibold text-slate-500 hover:text-rose-400 lg:mr-0 lg:min-h-0 lg:px-0"
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </button>
                        )}
                      </div>
                      {assignFor === b.id && (
                        <div className="mt-2 rounded-lg border border-white/10 bg-ink-3/60 p-2">
                          <p className="mb-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Assign to {noun.toLowerCase()}
                          </p>
                          <div className="max-h-44 space-y-1 overflow-y-auto">
                            {(() => {
                              const matchedTechs = techs.filter((t: any) => qualifiedFor(t, b));
                              const otherTechs = techs.filter((t: any) => !qualifiedFor(t, b));
                              const renderTech = (t: any, dimmed = false) => (
                                <button
                                  key={t.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    assign.mutate({ id: b.id, riderId: t.id, techName: t.name });
                                    setAssignFor(null);
                                  }}
                                  className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs hover:bg-white/5 ${dimmed ? "opacity-50" : ""}`}
                                >
                                  <TechAvatar
                                    name={t.name}
                                    photoUrl={(t as any).photoUrl}
                                    color={t.color}
                                    className="h-5 w-5"
                                    textClassName="text-[10px]"
                                  />
                                  <span className="font-medium text-slate-200">{t.name}</span>
                                  {t.skillClass && <span className={`rounded-full px-1 py-0.5 text-[10px] font-semibold ${!dimmed ? "bg-brand/20 text-brand" : "bg-white/10 text-slate-500"}`}>{t.skillClass}</span>}
                                  <span className="ml-auto capitalize text-[10px] text-slate-500">{t.status}</span>
                                </button>
                              );
                              if (techs.length === 0) return <p className="px-1 py-2 text-xs text-slate-500">No {nounPlural.toLowerCase()} found.</p>;
                              return (
                                <>
                                  {matchedTechs.map((t: any) => renderTech(t, false))}
                                  {otherTechs.length > 0 && (
                                    <>
                                      <p className="px-1 pt-1 text-[10px] text-slate-600">— other {nounPlural.toLowerCase()} —</p>
                                      {otherTechs.map((t: any) => renderTech(t, true))}
                                    </>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      )}
                      {aiFor === b.id && suggest.isPending && (
                        <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-2 text-xs text-slate-400">
                          <Loader2 className="h-3 w-3 animate-spin" /> Finding the
                          best {noun.toLowerCase()}…
                        </div>
                      )}
                      {aiFor === b.id &&
                        !suggest.isPending &&
                        suggest.data &&
                        !suggest.data.best && (
                          <div className="mt-2 rounded-lg border border-amber-warn/20 bg-amber-warn/5 p-2 text-xs text-amber-warn">
                            No {nounPlural.toLowerCase()} available to suggest right now.
                          </div>
                        )}
                      {aiFor === b.id && !suggest.isPending && suggest.data?.best && (
                        <div
                          className={`mt-2 rounded-lg border p-2 text-xs ${
                            suggest.data.confident
                              ? "border-brand/20 bg-brand/5"
                              : "border-amber-warn/25 bg-amber-warn/[0.06]"
                          }`}
                        >
                          {!suggest.data.confident && (
                            <p className="mb-1 flex items-center gap-1 font-semibold text-amber-warn">
                              <AlertTriangle className="h-3 w-3" /> Low-confidence
                              match
                            </p>
                          )}
                          <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-cyan-glow">
                            <Sparkles className="h-3 w-3" />
                            {(suggest.data as any).source === "ai"
                              ? "AI dispatch"
                              : "Best match"}
                          </p>
                          <p className="text-slate-300">
                            {suggest.data.reasoning}
                          </p>
                          {((suggest.data as any).ranked ?? [])
                            .slice(1, 3)
                            .filter((r: any) => r.rationale)
                            .map((r: any) => (
                              <p
                                key={r.techId}
                                className="mt-1 border-t border-white/5 pt-1 text-[11px] leading-snug text-slate-500"
                              >
                                <span className="font-semibold text-slate-400">
                                  {r.name}:
                                </span>{" "}
                                {r.rationale}
                              </p>
                            ))}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              assign.mutate({
                                id: b.id,
                                riderId: suggest.data!.best!.techId,
                                techName: suggest.data!.best!.name,
                              });
                            }}
                            className={`mt-1.5 w-full rounded-md py-1 font-semibold text-white ${
                              suggest.data.confident
                                ? "bg-brand hover:bg-brand-deep"
                                : "bg-white/10 hover:bg-white/15"
                            }`}
                          >
                            Assign {suggest.data.best.name}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* technician lanes */}
        <div className="space-y-3">
          {/* skill class filter bar */}
          {boardSkillClasses.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-ink-3/60 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filter by skill:</span>
              <button
                type="button"
                onClick={() => setSkillFilter("")}
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${skillFilter === "" ? "bg-brand text-white" : "bg-white/10 text-slate-300 hover:bg-white/15"}`}
              >
                All
              </button>
              {boardSkillClasses.map((sc) => (
                <button
                  key={sc}
                  type="button"
                  onClick={() => setSkillFilter(sc === skillFilter ? "" : sc)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${skillFilter === sc ? "bg-brand text-white" : "bg-white/10 text-slate-300 hover:bg-white/15"}`}
                >
                  {sc}
                </button>
              ))}
              {skillFilter && (
                <span className="ml-auto text-xs text-slate-500">{filteredTechs.length} of {techs.length} shown</span>
              )}
            </div>
          )}
          {/* technician tiles -- roughly 1in square so 15+ fit on a laptop
              screen and every tech is a drop target without scrolling. The
              count bubble is the committed (not completed/cancelled) job
              count; click a tile to open that tech's job list below. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
            {filteredTechs.map((t) => {
              const jobs = byTech(t.id);
              const over = overTech === t.id;
              const focused = focusTech === t.id;
              // dim this tile if dragging a job that requires a different skill class
              const skillMismatch = !!draggedJob && !qualifiedFor(t, draggedJob);
              const statusDot =
                t.status === "available"
                  ? "bg-emerald-400"
                  : t.status === "onsite" || t.status === "busy" || t.status === "enroute"
                    ? "bg-brand"
                    : t.status === "break"
                      ? "bg-amber-warn"
                      : "bg-slate-600";
              return (
                <div
                  key={t.id}
                  // oxlint-disable-next-line prefer-tag-over-role -- a drop target needs to be a div
                  role="button"
                  tabIndex={0}
                  title={`${t.name} · ${jobs.length} ${jobs.length === 1 ? jobLower : jobsLower} · ${t.status}`}
                  onClick={() => setFocusTech((v) => (v === t.id ? null : t.id))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setFocusTech((v) => (v === t.id ? null : t.id));
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverTech(t.id);
                  }}
                  onDragLeave={() => setOverTech((v) => (v === t.id ? null : v))}
                  onDrop={() => onDrop(t.id)}
                  className={`nvc-card relative flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 p-2 text-center transition ${
                    over ? "drop-active" : ""
                  } ${focused ? "border-brand/60 ring-1 ring-brand/40" : ""} ${
                    skillMismatch ? "opacity-40 pointer-events-none" : ""
                  }`}
                >
                  {jobs.length > 0 && (
                    <span
                      aria-label={`${jobs.length} ${jobsLower}`}
                      className="absolute right-1.5 top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold leading-none text-white shadow"
                    >
                      {jobs.length}
                    </span>
                  )}
                  <div className="relative">
                    <TechAvatar
                      name={t.name}
                      photoUrl={(t as any).photoUrl}
                      color={t.color}
                      className="h-10 w-10"
                      textClassName="text-xs"
                    />
                    <span
                      aria-hidden="true"
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-ink-2 ${statusDot}`}
                    />
                  </div>
                  <p className="w-full truncate text-[11px] font-semibold leading-tight text-white">
                    {t.name}
                  </p>
                  <p className="w-full truncate text-[10px] leading-tight text-slate-500">
                    {(t as any).skillClass || t.status}
                  </p>
                </div>
              );
            })}
          </div>

          {/* selected technician's job list */}
          {(() => {
            const t = focusTech ? techs.find((x) => x.id === focusTech) : null;
            if (!t) {
              return (
                <p className="px-1 text-xs text-slate-500">
                  <span className="hidden lg:inline">Drag a {jobLower} from the Unassigned list onto a {noun.toLowerCase()} to dispatch it. </span>
                  Click a tile to see that {noun.toLowerCase()}'s {jobsLower}.
                </p>
              );
            }
            const jobs = byTech(t.id);
            return (
              <div className="nvc-card p-3">
                <div className="mb-2 flex items-center gap-3">
                  <TechAvatar
                    name={t.name}
                    photoUrl={(t as any).photoUrl}
                    color={t.color}
                    className="h-9 w-9"
                    textClassName="text-xs"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-white">{t.name}</p>
                    <p className="text-xs text-slate-500">
                      {(t as any).skillClass ? `${(t as any).skillClass} · ` : ""}
                      {jobs.length} {jobs.length === 1 ? jobLower : jobsLower}
                    </p>
                  </div>
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] capitalize text-slate-400">
                    {t.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFocusTech(null)}
                    aria-label="Close"
                    className="grid h-8 w-8 place-items-center rounded text-slate-500 hover:bg-white/5 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {jobs.length === 0 ? (
                  <div className="flex w-full items-center gap-2 rounded-md border border-dashed border-white/10 px-3 py-2.5 text-[11px] text-slate-500">
                    <Plus className="h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden="true" />
                    <span className="hidden lg:inline">Free — drag a {jobLower} onto the tile to dispatch</span>
                    <span className="lg:hidden">Free — tap Assign on an unassigned job to dispatch</span>
                  </div>
                ) : (
                  <TechJobList jobs={jobs} onOpen={openJob} onRemove={canArchive ? removeJob : undefined} jobLower={jobLower} />
                )}
              </div>
            );
          })()}
        </div>
      </div>
      )}
    </PageWrap>
  );
}

/* ---------- selected technician's jobs: one aligned row each, grouped by when ---------- */

export function TechJobList<T extends ListJob>({
  jobs,
  onOpen,
  onRemove,
  jobLower,
}: {
  jobs: T[];
  onOpen: (b: T) => void;
  /** Left out for people who can't archive jobs, so there's no Delete button. */
  onRemove?: (b: T) => void;
  jobLower: string;
}) {
  const { timezone } = useBrand();
  const groups = groupTechJobs(jobs, timezone);
  return (
    <div>
      {groups.map((g) => (
        <section key={g.label} className="mt-3 first:mt-1" aria-label={g.label}>
          <h4 className="mb-1 flex items-center gap-2 px-1 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
            {g.label}
            <span className="rounded-full bg-white/5 px-1.5 py-px text-[10px] font-medium tabular-nums text-slate-400">{g.jobs.length}</span>
          </h4>
          <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10 bg-ink-3/40">
            {g.jobs.map((b) => {
              return (
                <li key={b.id} className="group/row flex items-center transition hover:bg-white/[0.03]">
                  <button
                    type="button"
                    onClick={() => onOpen(b)}
                    title="Open"
                    className="grid min-h-11 flex-1 grid-cols-[4.25rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left"
                  >
                    <span className="text-xs font-semibold tabular-nums text-cyan-glow">
                      {jobClock(b.scheduledAt, timezone)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-slate-100">{b.title || b.service?.name}</span>
                      {b.address ? <span className="block truncate text-[11px] text-slate-500">{b.address}</span> : null}
                    </span>
                    <span className="flex items-center gap-1.5 justify-self-end">
                      <AutoBadge booking={b as any} />
                      <StatusBadge status={b.status} />
                    </span>
                  </button>
                  {onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(b)}
                      aria-label={`Delete ${jobLower}`}
                      title={`Delete ${jobLower}`}
                      className="mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded text-slate-600 opacity-60 transition hover:bg-rose-500/10 hover:text-rose-400 group-hover/row:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
