/**
 * /api/dispatch — what the dispatch map (Map v2) talks to.
 *
 * Office-only (requireAdmin on every route; technicians never reach it).
 *
 *   GET  /settings        { mapV2Default } — should this company open Map v2 by default
 *   GET  /board?day=&days=  one snapshot: technicians, the day's (or up to 7 days') jobs, waiting jobs (4 reads)
 *   GET  /load?from=&days=  jobs and booked minutes per day, up to 42 days (the calendar's Month view)
 *   POST /schedule        { bookingId, scheduledAt, force? } → { job, undo } | 404 | 409 — a calendar move
 *   GET  /candidates?jobs=a,b   ranked technicians per job, up to 20 jobs (5 reads)
 *   POST /assign          { bookingId, riderId, force? } → { job, undo } | 404 | 409
 *   POST /undo            { token } → { job } — undoes an assign or a calendar move
 *   GET  /stream          server-sent events that keep an open map fresh
 *
 * The stream replaces polling. It carries signals, not data: `locations`
 * (new pin positions, coalesced to one per technician per second), and
 * `changed` ({techs, jobs} ids to re-read — the client refetches the board,
 * debounced). A `ready` event opens it and a `ping` every ~20 quiet seconds
 * keeps proxies from closing it. The channel is the caller's company, taken
 * from the session — never from the URL.
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database";
import * as schema from "../database/schema";
import { requireAdmin, tenantId } from "../middleware/auth";
import { jsonBody, id as idField, ValidationError } from "../lib/validate";
import type { AppEnv } from "../env";
import { loadBoard, MAX_BOARD_DAYS } from "../../services/dispatch-board";
import { loadCandidates, MAX_CANDIDATE_JOBS } from "../../services/dispatch-candidates";
import { dispatchAssign } from "../../services/dispatch-assign";
import { dispatchSchedule, loadDayLoad, MAX_LOAD_DAYS, undoAny } from "../../services/dispatch-schedule";
import { subscribeDispatch, type DispatchSignal } from "../../services/realtime";

type SessionUser = { id: string; role?: string; name: string };

const AssignBody = z.object({
  bookingId: idField("Job"),
  riderId: idField("Technician"),
  /** The dispatcher confirmed the clash card ("Assign anyway?"). */
  force: z.boolean().optional(),
  /** Also move it to this time (the calendar), in the same write and the same Undo. */
  scheduledAt: z.string().datetime({ message: "Time must be an ISO date-time", offset: true }).optional(),
});
const ScheduleBody = z.object({
  bookingId: idField("Job"),
  scheduledAt: z.string({ message: "Time is required" }).datetime({ message: "Time must be an ISO date-time", offset: true }),
  /** The dispatcher confirmed "Move it there anyway?". */
  force: z.boolean().optional(),
  /** Check the time against this technician instead: the job is about to be reassigned to them. */
  forTechId: idField("Technician").optional(),
});
const UndoBody = z.object({ token: z.string({ message: "Undo token is required" }).min(1, "Undo token is required").max(2_000) });

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Stream tuning: one flush a second; a ping after ~20 quiet seconds. */
const TICK_MS = 1_000;
const PING_EVERY = 20;
/** More distinct ids than this in one tick: tell the client to re-read everything instead. */
const MAX_PENDING_IDS = 500;

export const dispatchRoutes = new Hono<AppEnv>()
  .get("/settings", requireAdmin, async (c) => {
    const [co] = await db
      .select({ isInternal: schema.companies.isInternal })
      .from(schema.companies)
      .where(eq(schema.companies.id, tenantId(c)))
      .limit(1);
    return c.json({ mapV2Default: co?.isInternal ?? false }, 200);
  })

  .get("/board", requireAdmin, async (c) => {
    const day = c.req.query("day");
    if (day && !DAY.test(day)) throw new ValidationError({ day: "Day must look like 2026-10-17" }, "day: Day must look like 2026-10-17");
    const days = Number(c.req.query("days") ?? 1);
    if (!Number.isInteger(days) || days < 1 || days > MAX_BOARD_DAYS)
      throw new ValidationError({ days: `Days must be 1 to ${MAX_BOARD_DAYS}` }, `days: Days must be 1 to ${MAX_BOARD_DAYS}`);
    return c.json(await loadBoard(tenantId(c), { day: day || null, days }), 200);
  })

  .get("/load", requireAdmin, async (c) => {
    const from = c.req.query("from") ?? "";
    if (!DAY.test(from)) throw new ValidationError({ from: "From must look like 2026-10-17" }, "from: From must look like 2026-10-17");
    const days = Number(c.req.query("days") ?? 42);
    if (!Number.isInteger(days) || days < 1 || days > MAX_LOAD_DAYS)
      throw new ValidationError({ days: `Days must be 1 to ${MAX_LOAD_DAYS}` }, `days: Days must be 1 to ${MAX_LOAD_DAYS}`);
    return c.json(await loadDayLoad(tenantId(c), { from, days }), 200);
  })

  .get("/candidates", requireAdmin, async (c) => {
    const raw = c.req.query("jobs") ?? "";
    const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
    if (ids.length === 0) throw new ValidationError({ jobs: "Pass the job ids, comma-separated" }, "jobs: Pass the job ids, comma-separated");
    if (ids.length > MAX_CANDIDATE_JOBS || ids.some((s) => s.length > 128))
      throw new ValidationError({ jobs: `At most ${MAX_CANDIDATE_JOBS} jobs at a time` }, `jobs: At most ${MAX_CANDIDATE_JOBS} jobs at a time`);
    return c.json({ candidates: await loadCandidates(tenantId(c), ids) }, 200);
  })

  .post("/assign", requireAdmin, jsonBody(AssignBody), async (c) => {
    const u = c.get("user") as SessionUser;
    const { bookingId, riderId, force, scheduledAt } = c.req.valid("json");
    const r = await dispatchAssign(tenantId(c), { bookingId, riderId, force, scheduledAt, by: u.name });
    if (!r.ok) {
      if (r.status === 404) return c.json({ message: r.message }, 404);
      return c.json({ message: r.message, forceable: r.forceable, ...(r.reason ? { reason: r.reason } : {}) }, 409);
    }
    return c.json({ job: r.job, undo: r.undo }, 200);
  })

  .post("/schedule", requireAdmin, jsonBody(ScheduleBody), async (c) => {
    const u = c.get("user") as SessionUser;
    const { bookingId, scheduledAt, force, forTechId } = c.req.valid("json");
    const r = await dispatchSchedule(tenantId(c), { bookingId, scheduledAt, force, forTechId, by: u.name });
    if (!r.ok) {
      if (r.status === 404) return c.json({ message: r.message }, 404);
      return c.json({ message: r.message, forceable: r.forceable, ...(r.reason ? { reason: r.reason } : {}) }, 409);
    }
    return c.json({ job: r.job, undo: r.undo }, 200);
  })

  .post("/undo", requireAdmin, jsonBody(UndoBody), async (c) => {
    const u = c.get("user") as SessionUser;
    const r = await undoAny(tenantId(c), c.req.valid("json").token, u.name);
    if (!r.ok) return c.json({ message: r.message }, r.status);
    return c.json({ job: r.job }, 200);
  })

  .get("/stream", requireAdmin, async (c) => {
    const co = tenantId(c);
    return streamSSE(c, async (stream) => {
      let closed = false;
      // Latest position per technician, and the ids to re-read, since the last flush.
      const locations = new Map<string, { techId: string; lat: number; lng: number; at: number }>();
      const techs = new Set<string>();
      const jobs = new Set<string>();
      let everything = false;

      const unsub = subscribeDispatch(co, (s: DispatchSignal) => {
        if (s.kind === "location") {
          locations.set(s.techId, { techId: s.techId, lat: s.lat, lng: s.lng, at: s.at });
          if (locations.size > MAX_PENDING_IDS) everything = true;
        } else if (s.kind === "tech") {
          techs.add(s.techId);
        } else if (s.kind === "job") {
          jobs.add(s.jobId);
        }
        if (techs.size + jobs.size > MAX_PENDING_IDS) everything = true;
      });
      stream.onAbort(() => {
        closed = true;
        unsub();
      });

      await stream.writeSSE({ event: "ready", data: JSON.stringify({ at: new Date().toISOString() }) });

      let quiet = 0;
      while (!closed) {
        await stream.sleep(TICK_MS);
        if (closed) break;
        let sent = false;
        if (locations.size > 0 && !everything) {
          const batch = [...locations.values()];
          locations.clear();
          await stream.writeSSE({ event: "locations", data: JSON.stringify(batch) });
          sent = true;
        }
        if (everything || techs.size > 0 || jobs.size > 0) {
          const payload = everything
            ? { techs: [], jobs: [], all: true }
            : { techs: [...techs], jobs: [...jobs] };
          everything = false;
          locations.clear();
          techs.clear();
          jobs.clear();
          await stream.writeSSE({ event: "changed", data: JSON.stringify(payload) });
          sent = true;
        }
        if (sent) {
          quiet = 0;
        } else if (++quiet >= PING_EVERY) {
          quiet = 0;
          await stream.writeSSE({ event: "ping", data: "1" });
        }
      }
    });
  });
