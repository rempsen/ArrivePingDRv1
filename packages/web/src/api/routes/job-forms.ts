/**
 * Job forms v2: the form a technician fills in on a job.
 *
 *   GET   /api/job-forms/:bookingId   the form, answers, what's missing/flagged
 *   PATCH /api/job-forms/:bookingId   { answers: { [questionId]: {value, at, photoIds?, name?} } }
 *
 * Who may use it: the office (anyone with work-order view or edit), and the
 * technician the job is assigned to. Customers never (their copy comes from
 * the job report / PDF, without internal questions).
 */
import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../env";
import * as schema from "../database/schema";
import { officeCan, requireAuth, tenantId, tx } from "../middleware/auth";
import { jsonBody } from "../lib/validate";
import { FormInputError, jobForm, saveJobAnswers } from "../../services/job-forms";
import { publishDispatch } from "../../services/realtime";
import { isTerminalStatus } from "../../shared/job-status";

type SessionUser = { id: string; role?: string; email: string; name: string };

const AnswerBody = z.object({
  value: z.unknown().optional(),
  photoIds: z.array(z.string().max(64)).max(30).optional(),
  name: z.string().max(120).optional(),
  at: z.string().max(40).optional(),
});

const SaveBody = z.object({
  answers: z.record(z.string().max(64), AnswerBody).refine((o) => Object.keys(o).length <= 200, "Too many answers"),
});

async function loadForCaller(c: Context<AppEnv>, write: boolean) {
  const u = c.get("user") as SessionUser;
  const t = tx(c);
  const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, c.req.param("bookingId") ?? ""));
  if (!b) return { error: c.json({ message: "Not found" }, 404) } as const;
  if (await officeCan(u, write ? "work_orders:edit" : "work_orders:view")) return { b, u } as const;
  if (b.riderId) {
    const rider = await t.selectOne(schema.riders, eq(schema.riders.id, b.riderId));
    if (rider?.userId === u.id) {
      // Once a job is finished (or cancelled) its answers are the record:
      // only the office can correct them, and that is attributed to them.
      if (write && isTerminalStatus(b.status))
        return { error: c.json({ message: "This job is finished. Ask the office to change an answer." }, 409) } as const;
      return { b, u } as const;
    }
  }
  return { error: c.json({ message: "Forbidden" }, 403) } as const;
}

export const jobFormsRoutes = new Hono<AppEnv>()
  .get("/:bookingId", requireAuth, async (c) => {
    const r = await loadForCaller(c, false);
    if ("error" in r) return r.error;
    return c.json({ form: await jobForm(tenantId(c), r.b) }, 200);
  })
  .patch("/:bookingId", requireAuth, jsonBody(SaveBody), async (c) => {
    const r = await loadForCaller(c, true);
    if ("error" in r) return r.error;
    const { answers } = c.req.valid("json");
    try {
      const form = await saveJobAnswers(tenantId(c), r.b, answers, r.u.name || r.u.email || "");
      void publishDispatch(tenantId(c), { kind: "job", jobId: r.b.id });
      return c.json({ form }, 200);
    } catch (e) {
      if (e instanceof FormInputError) return c.json({ message: e.message }, 400);
      throw e;
    }
  });
