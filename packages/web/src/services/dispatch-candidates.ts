/**
 * Who should take this job? — ranked technicians, with how well each one fits.
 *
 * Feeds the dispatch map while a job is dragged (which pins light up, which
 * dim, which wear "Best match") and the job card's ranked list. Batched: up to
 * MAX_JOBS jobs in one call, in at most five reads whatever the team size, so
 * the visible queue can be scored in the background before anyone picks a
 * card up. No AI model runs here — the drag loop needs answers in milliseconds;
 * the model-written rationale stays on the job card (/api/ai/suggest-tech).
 *
 * Every number comes from the same places as the rest of dispatch: distance
 * and score from ai-dispatch's deterministic scorer, double-bookings and time
 * off from shared/availability, "qualified" from shared/qualify, and the clash
 * sentence from shared/dispatch-fit.
 */
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, notInArray, or } from "drizzle-orm";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { DEFAULT_TZ, safeTimeZone } from "../shared/tz";
import { IN_FLIGHT_STATUSES, TERMINAL_STATUSES } from "../shared/job-status";
import { clockLabel, findOverlappingJob, findTimeOff, jobMinutes, overlapMessage, timeOffMessage, type JobSlot, type ShiftRow } from "../shared/availability";
import { qualifies } from "../shared/qualify";
import { classifyFit, listJoin, type Clash, type Fit } from "../shared/dispatch-fit";
import { scoreCandidates } from "./ai-dispatch";
import { freeAtFor } from "./dispatch-board";

export const MAX_CANDIDATE_JOBS = 20;

export interface DispatchCandidate {
  techId: string;
  fit: Fit;
  clash: Clash | null;
  qualified: boolean;
  missing: string[];
  /** Straight-line distance; null when either end has no location. */
  distanceKm: number | null;
  /** Rough drive time at urban speed (ai-dispatch AVG_KMH). */
  etaMins: number | null;
  openJobs: number;
  freeAt: string | null;
  /** Lower is better (ai-dispatch scoreCandidates). */
  score: number;
  /** The first ready candidate. */
  best: boolean;
  /** A few words for the list: "Qualified · 6 min away · free now". */
  reason: string;
}

const FIT_ORDER: Record<Fit, number> = { ready: 0, busy: 1, unqualified: 2, offline: 3 };
const IN_FIELD: readonly string[] = IN_FLIGHT_STATUSES;
const WINDOW_MS = 25 * 60 * 60_000;
const TIMEOFF_MS = 48 * 60 * 60_000;

function reasonFor(c: { fit: Fit; clash: Clash | null; missing: string[]; etaMins: number | null; openJobs: number; freeAt: number | null; basis: string }, tz: string): string {
  switch (c.fit) {
    case "offline":
      return "Offline";
    case "unqualified":
      return c.missing.length ? `Missing ${listJoin(c.missing)}` : "Not set up for this job";
    case "busy":
      if (c.clash?.kind === "timeoff") return "Time off";
      if (c.clash?.kind === "overlap") return "Already booked then";
      return c.freeAt != null ? `Free at ${clockLabel(c.freeAt, tz)}` : "Busy";
    default: {
      const parts: string[] = [];
      if (c.basis !== "none") parts.push("Qualified");
      if (c.etaMins != null) parts.push(`${Math.max(1, c.etaMins)} min away`);
      parts.push(c.openJobs === 0 ? "free now" : `${c.openJobs} other job${c.openJobs === 1 ? "" : "s"}`);
      const s = parts.join(" · ");
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
  }
}

export async function loadCandidates(
  companyId: string,
  jobIds: readonly string[],
  now: Date = new Date(),
): Promise<Record<string, DispatchCandidate[]>> {
  const ids = [...new Set(jobIds.filter(Boolean))].slice(0, MAX_CANDIDATE_JOBS);
  if (ids.length === 0) return {};
  const t = tdb(companyId);
  const B = schema.bookings;

  const [settings, jobs, techs] = await Promise.all([
    t.selectOne(schema.companySettings),
    t.transaction((tx) =>
      tx
        .select({
          id: B.id,
          title: B.title,
          lat: B.lat,
          lng: B.lng,
          address: B.address,
          priority: B.priority,
          scheduledAt: B.scheduledAt,
          requiredSkillClass: B.requiredSkillClass,
          requiredSkills: B.requiredSkills,
          serviceName: schema.services.name,
          category: schema.services.category,
          durationMins: schema.services.durationMins,
        })
        .from(B)
        .leftJoin(schema.services, eq(schema.services.id, B.serviceId))
        .where(t.scope(B, and(inArray(B.id, ids), isNull(B.deletedAt)))),
    ),
    t.transaction((tx) =>
      tx
        .select({
          id: schema.riders.id,
          name: schema.user.name,
          skills: schema.riders.skills,
          skillClass: schema.riders.skillClass,
          status: schema.riders.status,
          color: schema.riders.color,
          lat: schema.riders.lat,
          lng: schema.riders.lng,
          rating: schema.riders.rating,
          completedJobs: schema.riders.completedJobs,
        })
        .from(schema.riders)
        .leftJoin(schema.user, eq(schema.user.id, schema.riders.userId))
        .where(t.scope(schema.riders, ne(schema.riders.approval, "suspended"))),
    ),
  ]);
  if (jobs.length === 0 || techs.length === 0) return Object.fromEntries(jobs.map((j) => [j.id, []]));

  const tz = safeTimeZone(settings?.timezone ?? DEFAULT_TZ);
  const noun = (settings?.workerNoun || "technician").toLowerCase();
  const starts = jobs.map((j) => new Date(j.scheduledAt).getTime());
  const lo = new Date(Math.min(...starts, now.getTime()) - WINDOW_MS);
  const hi = new Date(Math.max(...starts, now.getTime()) + WINDOW_MS);

  const [occupied, shifts] = await Promise.all([
    // Every technician's live and nearby work: in the field now, or booked
    // within a day either side of any of these jobs.
    t.transaction((tx) =>
      tx
        .select({
          id: B.id,
          riderId: B.riderId,
          title: B.title,
          status: B.status,
          scheduledAt: B.scheduledAt,
          startedAt: B.startedAt,
          clockState: B.clockState,
          accumulatedMs: B.accumulatedMs,
          lastResumeAt: B.lastResumeAt,
          etaMins: B.etaMins,
          durationMins: schema.services.durationMins,
        })
        .from(B)
        .leftJoin(schema.services, eq(schema.services.id, B.serviceId))
        .where(
          t.scope(
            B,
            and(
              isNotNull(B.riderId),
              isNull(B.deletedAt),
              notInArray(B.status, [...TERMINAL_STATUSES]),
              or(inArray(B.status, [...IN_FLIGHT_STATUSES]), and(gte(B.scheduledAt, lo), lte(B.scheduledAt, hi))),
            ),
          ),
        ),
    ),
    t.select(
      schema.techShifts,
      and(
        eq(schema.techShifts.kind, "timeoff"),
        gte(schema.techShifts.date, new Date(lo.getTime() - TIMEOFF_MS)),
        lte(schema.techShifts.date, new Date(hi.getTime() + TIMEOFF_MS)),
      ),
    ),
  ]);

  const byTech = new Map<string, typeof occupied>();
  for (const o of occupied) {
    const list = byTech.get(o.riderId!) ?? [];
    list.push(o);
    byTech.set(o.riderId!, list);
  }
  const offByTech = new Map<string, ShiftRow[]>();
  for (const s of shifts) {
    const list = offByTech.get(s.riderId) ?? [];
    list.push({ id: s.id, riderId: s.riderId, kind: s.kind, date: new Date(s.date).getTime(), startMin: s.startMin, endMin: s.endMin, note: s.note });
    offByTech.set(s.riderId, list);
  }

  const nowMs = now.getTime();
  const out: Record<string, DispatchCandidate[]> = {};
  for (const job of jobs) {
    const start = new Date(job.scheduledAt).getTime();
    const durationMins = jobMinutes(job.durationMins);
    const service = job.category ? { name: job.serviceName ?? "", category: job.category, durationMins } : null;

    // Workload as the scorer expects it, ignoring this job itself (a re-score
    // of an already-offered job mustn't count it against its own tech).
    const facts = new Map(
      techs.map((tech) => {
        const mine = (byTech.get(tech.id) ?? []).filter((o) => o.id !== job.id);
        const inField = mine.filter((o) => IN_FIELD.includes(o.status));
        const freeAt = freeAtFor(
          inField.map((o) => ({
            status: o.status,
            scheduledAt: o.scheduledAt,
            startedAt: o.startedAt,
            durationMins: o.durationMins,
            etaMins: o.etaMins,
            clockState: o.clockState,
            accumulatedMs: o.accumulatedMs,
            lastResumeAt: o.lastResumeAt,
          })),
          nowMs,
        );
        return [tech.id, { mine, inField, freeAt }] as const;
      }),
    );

    const scored = scoreCandidates({
      job: {
        id: job.id,
        title: job.title,
        address: job.address,
        lat: job.lat,
        lng: job.lng,
        priority: job.priority,
        scheduledAt: start,
        requiredSkillClass: job.requiredSkillClass,
        requiredSkills: job.requiredSkills,
      },
      service,
      techs: techs.map((tech) => {
        const f = facts.get(tech.id)!;
        return {
          id: tech.id,
          name: tech.name ?? "",
          skills: tech.skills,
          skillClass: tech.skillClass,
          status: tech.status,
          color: tech.color,
          lat: tech.lat,
          lng: tech.lng,
          rating: tech.rating,
          completedJobs: tech.completedJobs,
          openJobs: f.mine.length,
          freeInMins: f.freeAt != null ? Math.max(0, (f.freeAt - nowMs) / 60_000) : 0,
        };
      }),
      typicalMins: null,
      tz,
    });
    const byId = new Map(techs.map((tech) => [tech.id, tech]));

    const list: DispatchCandidate[] = scored.map((s) => {
      const tech = byId.get(s.techId)!;
      const f = facts.get(s.techId)!;
      const name = (tech.name ?? "").trim() || `This ${noun}`;
      const q = qualifies(
        { skills: tech.skills, skillClass: tech.skillClass },
        { requiredSkillClass: job.requiredSkillClass, requiredSkills: job.requiredSkills, serviceCategory: job.category },
      );
      // Double-bookings are about the schedule: work they're already doing in
      // the field is judged by when it will actually end (busy), not by its slot.
      const slots: JobSlot[] = f.mine.filter((o) => !IN_FIELD.includes(o.status)).map((o) => ({ id: o.id, riderId: o.riderId, scheduledAt: new Date(o.scheduledAt).getTime(), durationMins: o.durationMins, status: o.status, title: o.title }));
      const clashJob = findOverlappingJob({ id: job.id, riderId: tech.id, scheduledAt: start, durationMins }, slots);
      const off = findTimeOff({ riderId: tech.id, scheduledAt: start }, offByTech.get(tech.id) ?? [], tz);
      const { fit, clash } = classifyFit({
        name,
        status: tech.status,
        qualification: q,
        overlap: clashJob ? overlapMessage(name, clashJob, tz, noun) : null,
        timeoff: off ? timeOffMessage(name, off, noun) : null,
        inField: f.inField.length > 0,
        freeAt: f.freeAt,
        jobStart: start,
        now: nowMs,
        tz,
      });
      return {
        techId: tech.id,
        fit,
        clash,
        qualified: q.qualified,
        missing: q.missing,
        distanceKm: s.distanceKm,
        etaMins: s.etaMins,
        openJobs: f.mine.length,
        freeAt: f.freeAt != null ? new Date(f.freeAt).toISOString() : null,
        score: s.score,
        best: false,
        reason: reasonFor({ fit, clash, missing: q.missing, etaMins: s.etaMins, openJobs: f.mine.length, freeAt: f.freeAt, basis: q.basis }, tz),
      };
    });
    list.sort((a, b) => FIT_ORDER[a.fit] - FIT_ORDER[b.fit] || a.score - b.score);
    const first = list[0];
    if (first && first.fit === "ready") first.best = true;
    out[job.id] = list;
  }
  return out;
}
