/**
 * "Ask ArrivePing" outside the office dashboard (that one is routes/guide-ask.ts).
 *
 *   GET  /api/public/help/ask         { available }
 *   POST /api/public/help/ask         anyone, from the public Help Center
 *   POST /api/public/help/rate        { id, rating: 1 | -1 } the thumbs under an answer
 *   POST /api/help/ask                signed in, from the mobile apps (office or technician)
 *   GET  /api/hub/help-questions      Control Hub: recent questions, the unanswered first
 *
 * Answers stream as SSE with JSON data (shared/help-ask.ts):
 *   delta  { text }            part of the answer
 *   action { type, … }         a button: article, video, or contact support
 *   error  { message }
 *   done   { id }              the logged question's id, for the thumbs
 *
 * Every question is logged (help_questions) without who asked, so support can
 * see what the help material doesn't answer yet.
 */
import type { AppEnv } from "../env";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { and, desc, eq, gte, or, lt } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { requireAuth, requirePlatform } from "../middleware/auth";
import { rateLimit, keyByIp, keyByUser } from "../lib/rate-limit";
import { jsonBody } from "../lib/validate";
import { articles } from "../../web/site/support/articles";
import { liveVideos } from "../../web/site/support/videos";
import { HELP_ASK_LIMITS, type HelpAskAction, type HelpAskAudience, type HelpAskPlatform } from "../../shared/help-ask";
import { HELP_DEFAULT_TERMS, retrieveHelp, streamHelpAsk, type HelpTurn } from "../../services/help-ask";

/** Ask is on when the AI gateway is configured. */
export function helpAskAvailable(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY);
}

const LABEL = /^[A-Za-z][A-Za-z '-]{0,29}$/;
const term = z.string().max(60).optional();

const AskBody = z.object({
  question: z.string().trim().min(1).max(HELP_ASK_LIMITS.question),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(HELP_ASK_LIMITS.historyText) }))
    .max(HELP_ASK_LIMITS.history)
    .optional(),
  platform: z.enum(["web", "ios", "android"]).optional(),
  terms: z.object({ job: term, jobs: term, worker: term, workers: term, customer: term, customers: term }).optional(),
});
type AskBodyT = z.infer<typeof AskBody>;

const RateBody = z.object({ id: z.string().uuid(), rating: z.union([z.literal(1), z.literal(-1)]) });

const publicLimit = rateLimit({ name: "help-ask-public", limit: 20, windowMs: 60 * 60_000, keyFn: keyByIp });
const appLimit = rateLimit({ name: "help-ask-app", limit: 40, windowMs: 60 * 60_000, keyFn: keyByUser });
const rateLimitVotes = rateLimit({ name: "help-ask-rate", limit: 60, windowMs: 60 * 60_000, keyFn: keyByIp });

/**
 * A ceiling on public questions per server per day, so a flood of anonymous
 * questions can't run up the AI bill. Past it, the Help Center falls back to
 * article search.
 */
export const PUBLIC_DAILY_CAP = Number(process.env.HELP_ASK_DAILY_CAP || 3000);
let day = "";
let asked = 0;
export function takePublicSlot(now = new Date()): boolean {
  const d = now.toISOString().slice(0, 10);
  if (d !== day) {
    day = d;
    asked = 0;
  }
  if (asked >= PUBLIC_DAILY_CAP) return false;
  asked++;
  return true;
}

const ERROR_TEXT = "Sorry, something went wrong. Try again, or search the help articles below.";

/** A tool call → a button, only for things that exist. */
export function toHelpAction(toolName: string, input: unknown): HelpAskAction | null {
  const v = (input ?? {}) as Record<string, unknown>;
  if (toolName === "show_article" && typeof v.slug === "string" && articles.some((a) => a.slug === v.slug)) return { type: "article", slug: v.slug };
  if (toolName === "watch_video" && typeof v.key === "string" && liveVideos.some((x) => x.key === v.key)) return { type: "video", key: v.key };
  if (toolName === "contact_support") return { type: "contact", reason: typeof v.reason === "string" ? v.reason.slice(0, 200) : "" };
  return null;
}

function cleanTerms(t: AskBodyT["terms"]) {
  const terms = { ...HELP_DEFAULT_TERMS };
  for (const [k, v] of Object.entries(t ?? {}) as [keyof typeof terms, string | undefined][]) {
    if (k in terms && v && LABEL.test(v.trim())) terms[k] = v.trim();
  }
  return terms;
}

/** Stream one answer and log the question. */
function answer(c: Context<AppEnv>, audience: HelpAskAudience, b: AskBodyT) {
  const platform: HelpAskPlatform | undefined = b.platform;
  const history: HelpTurn[] = b.history ?? [];
  const { screens, articles: arts } = retrieveHelp(b.question, history, audience);
  const result = streamHelpAsk({ audience, platform, terms: cleanTerms(b.terms), question: b.question, history, abortSignal: c.req.raw.signal });

  return streamSSE(c, async (stream) => {
    const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) });
    const offered: HelpAskAction[] = [];
    let chars = 0;
    let failed = false;
    let paragraphs = 0;
    try {
      for await (const part of result.fullStream) {
        if (part.type === "text-start") {
          if (paragraphs++ > 0) await send("delta", { text: "\n\n" });
        } else if (part.type === "text-delta") {
          chars += part.text.length;
          await send("delta", { text: part.text });
        } else if (part.type === "tool-call") {
          if ((part as { invalid?: boolean }).invalid) continue;
          const action = toHelpAction(part.toolName, part.input);
          // Contact support always gets its button; articles and videos at most two.
          if (!action || offered.some((a) => a.type === action.type && JSON.stringify(a) === JSON.stringify(action))) continue;
          if (action.type !== "contact" && offered.filter((a) => a.type !== "contact").length >= 2) continue;
          offered.push(action);
          await send("action", action);
        } else if (part.type === "error") {
          failed = true;
          console.error("[help-ask] model error", part.error);
          await send("error", { message: ERROR_TEXT });
        }
      }
    } catch (e) {
      failed = true;
      console.error("[help-ask] stream failed", e);
      await send("error", { message: ERROR_TEXT });
    }
    let id: string | undefined;
    try {
      const [row] = await db
        .insert(schema.helpQuestions)
        .values({
          source: audience,
          platform: platform ?? "",
          question: b.question.slice(0, HELP_ASK_LIMITS.question),
          matched: [...screens.map((e) => e.id), ...arts.map((a) => `article:${a.slug}`)].join(",").slice(0, 2000),
          answerChars: chars,
          handedOff: offered.some((a) => a.type === "contact"),
          failed,
        })
        .returning({ id: schema.helpQuestions.id });
      id = row?.id;
    } catch (e) {
      console.error("[help-ask] log failed", e); // never costs the person their answer
    }
    await send("done", { id });
  });
}

/** Signed-in roles → who's asking. Customers and anyone else get the public answers. */
export function audienceFor(role?: string): HelpAskAudience {
  if (role === "rider") return "technician";
  if (role === "admin" || role === "superadmin" || role === "manager" || role === "dispatcher" || role === "project_manager") return "office";
  return "public";
}

export const helpPublicRoutes = new Hono<AppEnv>()
  .get("/ask", (c) => c.json({ available: helpAskAvailable() }))
  .post("/ask", publicLimit, jsonBody(AskBody), async (c) => {
    if (!helpAskAvailable()) return c.json({ code: "ask_unavailable", message: "Ask isn't available right now. Search the help articles instead." }, 503);
    if (!takePublicSlot()) return c.json({ code: "ask_busy", message: "Ask is very busy right now. Search the help articles instead, or try again later." }, 503);
    return answer(c, "public", c.req.valid("json"));
  })
  .post("/rate", rateLimitVotes, jsonBody(RateBody), async (c) => {
    const { id, rating } = c.req.valid("json");
    // Only a recent question can be rated, and only once.
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    await db
      .update(schema.helpQuestions)
      .set({ rating })
      .where(and(eq(schema.helpQuestions.id, id), eq(schema.helpQuestions.rating, 0), gte(schema.helpQuestions.createdAt, since)));
    return c.json({ ok: true });
  });

export const helpAppRoutes = new Hono<AppEnv>()
  .get("/ask", requireAuth, (c) => c.json({ available: helpAskAvailable() }))
  .post("/ask", requireAuth, appLimit, jsonBody(AskBody), async (c) => {
    if (!helpAskAvailable()) return c.json({ code: "ask_unavailable", message: "Ask isn't available right now. Try the Help Center instead." }, 503);
    const role = (c.get("user") as { role?: string } | null)?.role;
    return answer(c, audienceFor(role), c.req.valid("json"));
  });

/** Control Hub: what people asked, the ones the assistant couldn't answer (or got a thumbs down) first. */
export const helpHubRoutes = new Hono<AppEnv>().get("/help-questions", requirePlatform("staff"), async (c) => {
  const onlyGaps = c.req.query("gaps") === "1";
  const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60_000);
  const q = schema.helpQuestions;
  const gap = or(eq(q.handedOff, true), lt(q.rating, 0), eq(q.failed, true));
  const rows = await db
    .select()
    .from(q)
    .where(onlyGaps ? and(gte(q.createdAt, since), gap) : gte(q.createdAt, since))
    .orderBy(desc(q.createdAt))
    .limit(1000);
  const total = rows.length;
  const gaps = rows.filter((r) => r.handedOff || r.rating < 0 || r.failed).length;
  return c.json({ days, total, gaps, questions: rows });
});
