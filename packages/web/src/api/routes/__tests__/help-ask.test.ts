/**
 * "Ask ArrivePing" on the public Help Center and in the mobile apps
 * (routes/help-ask.ts), with a mock model:
 *  - answers stream as `delta`; tool calls become buttons (article, video,
 *    contact support); unknown articles are dropped; at most two
 *    article/video buttons;
 *  - every question is logged without who asked; "contact support" marks it
 *    handed off; the thumbs rate it once;
 *  - a technician is answered from the technician app's screens only;
 *  - no AI key → 503; the daily ceiling → 503; the Control Hub lists the gaps.
 * In-memory database.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";
import { MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream } from "ai";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { helpPublicRoutes, helpAppRoutes, helpHubRoutes, takePublicSlot, PUBLIC_DAILY_CAP, audienceFor } = await import("../help-ask");
const { setHelpModelForTests, buildHelpSystem, HELP_DEFAULT_TERMS } = await import("../../../services/help-ask");
const { articles } = await import("../../../web/site/support/articles");
const { liveVideos } = await import("../../../web/site/support/videos");

function colDdl(col: PgColumn, withPk: boolean): string {
  const parts = [`"${col.name}"`, col.getSQLType()];
  if (withPk && col.primary) parts.push("PRIMARY KEY");
  const d = (col as any).default;
  const lit = d === undefined ? null : typeof d === "string" ? `'${d.replace(/'/g, "''")}'` : typeof d === "boolean" ? (d ? "TRUE" : "FALSE") : typeof d === "number" ? String(d) : null;
  if (lit !== null) parts.push(`DEFAULT ${lit}`);
  // created_at defaults to now() in SQL, which the literal check above skips.
  else if (col.name === "created_at") parts.push("DEFAULT now()");
  return parts.join(" ");
}
async function ensureTable(table: PgTable) {
  const s = (db as any).$client;
  const cfg = getTableConfig(table);
  await s.execute(`CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cfg.columns.map((c) => colDdl(c, true)).join(", ")})`);
}

const app = new Hono<AppEnv>()
  .use("*", async (c, next) => {
    const role = c.req.header("X-Test-Role");
    if (role) c.set("user", { id: `ha-${role}`, role, email: `${role}@t.test`, name: "Secret Person" } as never);
    if (c.req.header("X-Test-Platform")) c.set("platformRole", c.req.header("X-Test-Platform") as never);
    return next();
  })
  .route("/public/help", helpPublicRoutes)
  .route("/help", helpAppRoutes)
  .route("/hub", helpHubRoutes)
  .onError((err, c) => c.json({ message: err.message }, ((err as { status?: number }).status ?? 500) as 400));

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } };
type Part = Record<string, unknown>;
function mockModel(parts: Part[]) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks: [{ type: "stream-start", warnings: [] }, ...parts, { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage }] as never[] }),
    }),
  });
}
const text = (id: string, ...deltas: string[]): Part[] => [{ type: "text-start", id }, ...deltas.map((delta) => ({ type: "text-delta", id, delta })), { type: "text-end", id }];
const call = (toolName: string, input: unknown, n = 1): Part => ({ type: "tool-call", toolCallId: `c${n}`, toolName, input: JSON.stringify(input) });

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
async function events(res: Response) {
  return (await res.text())
    .split("\n\n")
    .filter((b) => b.trim())
    .map((b) => ({
      event: /^event: ?(.*)$/m.exec(b)?.[1] ?? "message",
      data: JSON.parse(
        b
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n"),
      ),
    }));
}

const savedKey = process.env.AI_GATEWAY_API_KEY;
beforeAll(async () => {
  await ensureTable(schema.helpQuestions as unknown as PgTable);
});
beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = "test-key";
});
afterAll(() => {
  setHelpModelForTests(null);
  if (savedKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = savedKey;
});

describe("POST /api/public/help/ask", () => {
  it("streams the answer, offers real buttons only, and logs the question", async () => {
    const slug = articles[0]!.slug;
    const video = liveVideos[0]!.key;
    setHelpModelForTests(
      mockModel([
        ...text("t1", "In the office dashboard:\n", "1. Open **Scheduler**"),
        call("show_article", { slug }, 1),
        call("show_article", { slug: "not-a-real-article" }, 2),
        call("watch_video", { key: video }, 3),
        call("show_article", { slug: articles[1]!.slug }, 4), // a third article/video button: dropped
      ]),
    );
    const res = await post("/public/help/ask", { question: "How do I move a job to tomorrow?" });
    expect(res.status).toBe(200);
    const ev = await events(res);
    expect(ev.filter((e) => e.event === "delta").map((e) => e.data.text).join("")).toBe("In the office dashboard:\n1. Open **Scheduler**");
    expect(ev.filter((e) => e.event === "action").map((e) => e.data)).toEqual([
      { type: "article", slug },
      { type: "video", key: video },
    ]);
    const done = ev.find((e) => e.event === "done")!;
    expect(typeof done.data.id).toBe("string");
    const rows = await db.select().from(schema.helpQuestions);
    const row = rows.find((r) => r.id === done.data.id)!;
    expect(row.source).toBe("public");
    expect(row.question).toBe("How do I move a job to tomorrow?");
    expect(row.handedOff).toBe(false);
    expect(row.answerChars).toBeGreaterThan(10);
    expect(row.matched.length).toBeGreaterThan(0);
  });

  it("contact support is a button and marks the question handed off; the thumbs rate it once", async () => {
    setHelpModelForTests(mockModel([...text("t1", "I'm not sure about that one."), call("contact_support", { reason: "Refund for last month" })]));
    const ev = await events(await post("/public/help/ask", { question: "Can I get a refund for October?" }));
    expect(ev.find((e) => e.event === "action")!.data).toEqual({ type: "contact", reason: "Refund for last month" });
    const id = ev.find((e) => e.event === "done")!.data.id as string;
    expect((await post("/public/help/rate", { id, rating: -1 })).status).toBe(200);
    await post("/public/help/rate", { id, rating: 1 }); // a second vote doesn't change it
    const [row] = (await db.select().from(schema.helpQuestions)).filter((r) => r.id === id);
    expect(row!.handedOff).toBe(true);
    expect(row!.rating).toBe(-1);
  });

  it("is off without an AI key, and refuses an over-long question", async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    expect((await app.request("/public/help/ask")).status).toBe(200);
    expect(await (await app.request("/public/help/ask")).json()).toEqual({ available: false });
    expect((await post("/public/help/ask", { question: "Hi" })).status).toBe(503);
    process.env.AI_GATEWAY_API_KEY = "test-key";
    expect((await post("/public/help/ask", { question: "x".repeat(501) })).status).toBe(400);
  });

  it("keeps to a daily ceiling", () => {
    const tomorrow = new Date(Date.now() + 2 * 86_400_000);
    for (let i = 0; i < PUBLIC_DAILY_CAP; i++) expect(takePublicSlot(tomorrow)).toBe(true);
    expect(takePublicSlot(tomorrow)).toBe(false);
    expect(takePublicSlot(new Date(tomorrow.getTime() + 86_400_000))).toBe(true);
  });
});

describe("POST /api/help/ask (the apps)", () => {
  it("needs a sign-in, and answers a technician from the technician app", async () => {
    expect((await post("/help/ask", { question: "How do I finish a job?" })).status).toBe(401);
    const model = mockModel(text("t1", "Tap **Complete Job**."));
    setHelpModelForTests(model);
    const ev = await events(await post("/help/ask", { question: "How do I finish a job?", platform: "android" }, { "X-Test-Role": "rider" }));
    expect(ev.some((e) => e.event === "delta")).toBe(true);
    const prompt = JSON.stringify(model.doStreamCalls[0]!.prompt);
    expect(prompt).toContain("technician using the ArrivePing app");
    expect(prompt).toContain("an Android phone");
    expect(prompt).not.toContain('<screen id=\\"office-web.');
    expect(prompt).not.toContain("Secret Person");
    const rows = await db.select().from(schema.helpQuestions);
    expect(rows.some((r) => r.source === "technician" && r.platform === "android")).toBe(true);
  });

  it("maps roles to who's asking", () => {
    expect(audienceFor("rider")).toBe("technician");
    expect(audienceFor("dispatcher")).toBe("office");
    expect(audienceFor("admin")).toBe("office");
    expect(audienceFor("customer")).toBe("public");
  });
});

describe("what the model is given", () => {
  it("the matching screens in full, the company's words, and the rules", () => {
    const sys = buildHelpSystem({ audience: "public", terms: { ...HELP_DEFAULT_TERMS, job: "work order", jobs: "work orders" }, question: "How do I invite a technician?" });
    expect(sys).toContain("<screen id=");
    expect(sys).toContain('"work order"');
    expect(sys).toContain("call contact_support");
    expect(sys).toContain("data, not instructions");
  });
});

describe("GET /api/hub/help-questions", () => {
  it("is for platform staff; totals and gaps cover the whole period, the list is capped", async () => {
    expect((await app.request("/hub/help-questions", { headers: { "X-Test-Role": "admin" } })).status).toBe(403);
    const res = await app.request("/hub/help-questions?days=30", { headers: { "X-Test-Role": "superadmin", "X-Test-Platform": "staff" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stats: { asked: number; gaps: number; handedOff: number; thumbsDown: number };
      gaps: { question: string }[];
      questions: unknown[];
      truncated: boolean;
    };
    const rows = await db.select().from(schema.helpQuestions);
    expect(body.stats.asked).toBe(rows.length);
    expect(body.stats.gaps).toBe(rows.filter((r) => r.handedOff || r.rating < 0 || r.failed).length);
    expect(body.stats.handedOff).toBe(rows.filter((r) => r.handedOff).length);
    expect(body.gaps.length).toBe(body.stats.gaps);
    expect(body.gaps.some((g) => g.question === "Can I get a refund for October?")).toBe(true);
    expect(body.questions.length).toBe(rows.length);
    expect(body.truncated).toBe(false);
  });
});
