/**
 * POST /api/guide/ask — "Ask ArrivePing", the help assistant in the Guide panel.
 * GET  /api/guide/ask — { available } so the panel only shows the box when it works.
 *
 * Office roles only, rate limited per person, streamed as SSE with JSON data:
 *   delta  { text }                 part of the answer
 *   action { type, id|route|slug }  a button to offer (tour, page or article)
 *   error  { message }
 *   done   {}
 * See services/guide-ask.ts for what the model is (and isn't) given.
 */
import type { AppEnv } from "../env";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { rateLimit, keyByUser } from "../lib/rate-limit";
import { jsonBody } from "../lib/validate";
import type { Role } from "../../web/guide/registry";
import { ASK_LIMITS, type AskAction } from "../../shared/guide-ask";
import { askAvailable, DEFAULT_TERMS, streamAsk, toAction } from "../../services/guide-ask";

/** The Guide's roles; everyone else (technicians, customers) gets 403. */
function guideRole(role?: string): Role | null {
  if (role === "admin" || role === "superadmin") return "admin";
  if (role === "manager" || role === "dispatcher" || role === "project_manager") return role;
  return null;
}

/** A company's word for jobs etc. Only plain labels reach the model; anything else falls back to the default word. */
const LABEL = /^[A-Za-z][A-Za-z '-]{0,29}$/;
const term = z.string().max(60).optional();

const AskBody = z.object({
  question: z.string().trim().min(1).max(ASK_LIMITS.question),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(ASK_LIMITS.historyText) }))
    .max(ASK_LIMITS.history)
    .optional(),
  terms: z.object({ job: term, jobs: term, worker: term, workers: term, customer: term, customers: term }).optional(),
});

const askLimit = rateLimit({ limit: 30, windowMs: 60 * 60 * 1000, keyFn: keyByUser, name: "guide-ask" });

export const guideAskRoutes = new Hono<AppEnv>()
  .get("/ask", requireAuth, (c) => {
    const role = guideRole((c.get("user") as { role?: string } | null)?.role);
    return c.json({ available: Boolean(role) && askAvailable() });
  })
  .post("/ask", requireAuth, askLimit, jsonBody(AskBody), async (c) => {
    const role = guideRole((c.get("user") as { role?: string } | null)?.role);
    if (!role) return c.json({ message: "Ask ArrivePing is for office staff." }, 403);
    if (!askAvailable()) return c.json({ code: "ask_unavailable", message: "Ask ArrivePing isn't available right now. Search the help articles instead." }, 503);

    const b = c.req.valid("json");
    const terms = { ...DEFAULT_TERMS };
    for (const [k, v] of Object.entries(b.terms ?? {}) as [keyof typeof terms, string | undefined][]) {
      if (k in terms && v && LABEL.test(v.trim())) terms[k] = v.trim();
    }
    const result = streamAsk({ role, terms, question: b.question, history: b.history, abortSignal: c.req.raw.signal });

    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) });
      const offered: AskAction[] = [];
      let paragraphs = 0;
      try {
        for await (const part of result.fullStream) {
          if (part.type === "text-start") {
            // A second text run in one answer starts a new paragraph.
            if (paragraphs++ > 0) await send("delta", { text: "\n\n" });
          } else if (part.type === "text-delta") {
            await send("delta", { text: part.text });
          } else if (part.type === "tool-call") {
            if ((part as { invalid?: boolean }).invalid) continue;
            const action = toAction(role, part.toolName, part.input);
            if (!action || offered.length >= 2 || offered.some((a) => JSON.stringify(a) === JSON.stringify(action))) continue;
            offered.push(action);
            await send("action", action);
          } else if (part.type === "error") {
            console.error("[guide-ask] model error", part.error);
            await send("error", { message: "Sorry, something went wrong. Try again, or search the help articles." });
          }
        }
      } catch (e) {
        console.error("[guide-ask] stream failed", e);
        await send("error", { message: "Sorry, something went wrong. Try again, or search the help articles." });
      }
      await send("done", {});
    });
  });
