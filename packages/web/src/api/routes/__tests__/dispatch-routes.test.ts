/**
 * /api/dispatch over HTTP — the contract the Map v2 screen depends on:
 * office-only, company-scoped, board + candidates reads, assign with Undo, and
 * the live stream.
 *
 * Harness: ephemeral in-memory PGlite, ids prefixed "drt-". The "assigned"
 * notice is held back by a test timer so nothing is ever sent.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { dispatchRoutes } = await import("../dispatch");
const { AppError } = await import("../../lib/errors");
const { publishDispatch } = await import("../../../services/realtime");
const da = await import("../../../services/dispatch-assign");

const CO = "drt-co";
const OTHER = "drt-other";
const HOUR = 3_600_000;

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", c.req.header("X-Test-Company") || CO);
  const uid = c.req.header("X-Test-User");
  const role = c.req.header("X-Test-Role") || "admin";
  c.set("user", uid ? { id: uid, role, email: `${uid}@t.test`, name: "Dana Dispatcher" } : null);
  return next();
});
app.route("/dispatch", dispatchRoutes);
app.onError((err, c) => {
  if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.expose ? err.message : "error" } }, err.status as 400);
  return c.json({ error: { code: "internal", message: String((err as Error).message) } }, 500);
});

const as = (role: string | null, extra: Record<string, string> = {}): Record<string, string> => ({
  ...(role ? { "X-Test-User": "drt-user", "X-Test-Role": role } : {}),
  "Content-Type": "application/json",
  ...extra,
});
const get = (path: string, role: string | null = "admin", extra: Record<string, string> = {}) =>
  app.request(`/dispatch${path}`, { headers: as(role, extra) });
const post = (path: string, body: unknown, role: string | null = "admin", extra: Record<string, string> = {}) =>
  app.request(`/dispatch${path}`, { method: "POST", headers: as(role, extra), body: JSON.stringify(body) });

function colDdl(col: PgColumn, withPk: boolean): string {
  const parts = [`"${col.name}"`, col.getSQLType()];
  if (withPk && col.primary) parts.push("PRIMARY KEY");
  const dflt = (col as any).default;
  const lit =
    dflt === undefined ? null
    : typeof dflt === "string" ? `'${dflt.replace(/'/g, "''")}'`
    : typeof dflt === "boolean" ? (dflt ? "TRUE" : "FALSE")
    : typeof dflt === "number" ? String(dflt)
    : null;
  if (lit !== null) parts.push(`DEFAULT ${lit}`);
  return parts.join(" ");
}
async function ensureTable(table: PgTable) {
  const s = (db as any).$client;
  const cfg = getTableConfig(table);
  await s.execute(`CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cfg.columns.map((c) => colDdl(c, true)).join(", ")})`);
  for (const c of cfg.columns) {
    if (c.primary) continue;
    await s.execute(`ALTER TABLE "${cfg.name}" ADD COLUMN IF NOT EXISTS ${colDdl(c, false)}`);
  }
}

async function company(id: string) {
  await db.insert(schema.companies).values({ id, name: id } as any);
  await db.insert(schema.companySettings).values({ id, companyId: id, timezone: "America/Winnipeg" } as any);
  await db.insert(schema.services).values({ id: `${id}-svc`, companyId: id, name: "Furnace repair", category: "HVAC", durationMins: 60 });
  await db.insert(schema.user).values({ id: `${id}-cust`, name: "Customer", email: `${id}-cust@t.test`, companyId: id } as any);
  for (const n of [1, 2]) {
    await db.insert(schema.user).values({ id: `${id}-u${n}`, name: n === 1 ? "Tom Rivera" : "Priya Nair", email: `${id}-u${n}@t.test`, companyId: id, role: "rider" } as any);
    await db.insert(schema.riders).values({
      id: `${id}-t${n}`, userId: `${id}-u${n}`, companyId: id, skills: "HVAC", skillClass: "HVAC", status: "available",
      lat: 49.9 + n / 100, lng: -97.14, locationUpdatedAt: new Date(),
    });
  }
}

let n = 0;
async function job(co: string, extra: Partial<typeof schema.bookings.$inferInsert> = {}) {
  const id = `drt-job-${++n}`;
  await db.insert(schema.bookings).values({
    id, companyId: co, customerId: `${co}-cust`, serviceId: `${co}-svc`, title: `Job ${n}`, status: "pending",
    scheduledAt: new Date(Date.now() + 3 * HOUR + n * 5 * HOUR), address: "1 Test St", lat: 49.9, lng: -97.14, ...extra,
  });
  return id;
}
const row = async (id: string) => (await db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0]!;

const pending: (() => void)[] = [];
beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTable(v);
  await company(CO);
  await company(OTHER);
  da._setGraceTimerForTests((run) => pending.push(run));
});
afterAll(() => da._setGraceTimerForTests(null));

/** An open /stream whose text we can wait on. */
async function openStream(extra: Record<string, string> = {}) {
  const res = await app.request("/dispatch/stream", { headers: as("admin", extra) });
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  let done = false;
  void (async () => {
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        text += dec.decode(r.value);
      }
    } catch {
      /* cancelled */
    }
    done = true;
  })();
  return {
    text: () => text,
    async waitFor(re: RegExp, ms = 4_000) {
      const end = Date.now() + ms;
      while (Date.now() < end && !re.test(text) && !done) await new Promise((r) => setTimeout(r, 25));
      return re.test(text);
    },
    async close() {
      await reader.cancel().catch(() => {});
    },
  };
}

describe("access", () => {
  it("is office-only on every route", async () => {
    for (const role of ["rider", "customer"]) {
      expect((await get("/settings", role)).status).toBe(403);
      expect((await get("/board", role)).status).toBe(403);
      expect((await get("/candidates?jobs=x", role)).status).toBe(403);
      expect((await post("/assign", { bookingId: "x", riderId: "y" }, role)).status).toBe(403);
      expect((await post("/undo", { token: "x" }, role)).status).toBe(403);
      expect((await get("/stream", role)).status).toBe(403);
    }
    expect((await get("/board", null)).status).toBe(401);
    expect((await get("/stream", null)).status).toBe(401);
  });
});

describe("GET /settings", () => {
  it("turns Map v2 on by default only for internal companies", async () => {
    expect(await (await get("/settings")).json()).toEqual({ mapV2Default: false });
    await db.update(schema.companies).set({ isInternal: true }).where(eq(schema.companies.id, OTHER));
    expect(await (await get("/settings", "admin", { "X-Test-Company": OTHER })).json()).toEqual({ mapV2Default: true });
    expect(await (await get("/settings")).json()).toEqual({ mapV2Default: false });
  });
});

describe("GET /board", () => {
  it("returns this company's technicians and waiting jobs, and nothing of another's", async () => {
    const mine = await job(CO);
    const theirs = await job(OTHER);
    const res = await get("/board");
    expect(res.status).toBe(200);
    const b = (await res.json()) as any;
    expect(b.techs.map((t: any) => t.id).sort()).toEqual([`${CO}-t1`, `${CO}-t2`]);
    expect(b.techs.find((t: any) => t.id === `${CO}-t1`)).toMatchObject({ name: "Tom Rivera", status: "available", skills: ["HVAC"] });
    const ids = b.jobs.map((j: any) => j.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
    expect(b.tz).toBe("America/Winnipeg");
    expect(b.mapV2Default).toBe(false);
  });

  it("rejects a malformed day", async () => {
    const res = await get("/board?day=tomorrow");
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("validation_failed");
    expect((await get("/board?day=2026-10-17")).status).toBe(200);
  });
});

describe("GET /candidates", () => {
  it("ranks this company's technicians for the jobs asked about", async () => {
    const id = await job(CO);
    const other = await job(OTHER);
    const res = await get(`/candidates?jobs=${id},${other}`);
    expect(res.status).toBe(200);
    const { candidates } = (await res.json()) as any;
    expect(Object.keys(candidates)).toEqual([id]);
    expect(candidates[id].map((c: any) => c.techId).sort()).toEqual([`${CO}-t1`, `${CO}-t2`]);
    expect(candidates[id].filter((c: any) => c.best)).toHaveLength(1);
  });

  it("asks for ids, and for no more than 20", async () => {
    expect((await get("/candidates")).status).toBe(400);
    expect((await get("/candidates?jobs=,,")).status).toBe(400);
    const many = Array.from({ length: 21 }, (_, i) => `j${i}`).join(",");
    expect((await get(`/candidates?jobs=${many}`)).status).toBe(400);
    expect((await get(`/candidates?jobs=${many.split(",").slice(0, 20).join(",")}`)).status).toBe(200);
  });
});

describe("POST /assign and /undo", () => {
  it("assigns, then Undo puts the job back", async () => {
    const id = await job(CO);
    const a = await post("/assign", { bookingId: id, riderId: `${CO}-t1` });
    expect(a.status).toBe(200);
    const body = (await a.json()) as any;
    expect(body.job).toEqual({ id, status: "assigned", assignStatus: "offered", riderId: `${CO}-t1` });
    expect(typeof body.undo).toBe("string");

    const u = await post("/undo", { token: body.undo });
    expect(u.status).toBe(200);
    expect(((await u.json()) as any).job).toEqual({ id, status: "pending", assignStatus: "none", riderId: null });
    expect((await row(id)).riderId).toBeNull();

    // the same token can't be used twice
    expect((await post("/undo", { token: body.undo })).status).toBe(409);
  });

  it("refuses a bad token and a missing one", async () => {
    expect((await post("/undo", { token: "garbage" })).status).toBe(400);
    expect((await post("/undo", {})).status).toBe(400);
    expect((await post("/undo", { token: "" })).status).toBe(400);
  });

  it("won't use another company's Undo token", async () => {
    const id = await job(CO);
    const a = (await (await post("/assign", { bookingId: id, riderId: `${CO}-t1` })).json()) as any;
    const u = await post("/undo", { token: a.undo }, "admin", { "X-Test-Company": OTHER });
    expect(u.status).toBe(404);
    expect((await row(id)).riderId).toBe(`${CO}-t1`);
  });

  it("404s on unknown jobs and on other companies' jobs and technicians", async () => {
    expect((await post("/assign", { bookingId: "nope", riderId: `${CO}-t1` })).status).toBe(404);
    const theirs = await job(OTHER);
    expect((await post("/assign", { bookingId: theirs, riderId: `${CO}-t1` })).status).toBe(404);
    const mine = await job(CO);
    expect((await post("/assign", { bookingId: mine, riderId: `${OTHER}-t1` })).status).toBe(404);
    expect((await row(mine)).riderId).toBeNull();
  });

  it("validates the body", async () => {
    expect((await post("/assign", { riderId: `${CO}-t1` })).status).toBe(400);
    expect((await post("/assign", { bookingId: "x" })).status).toBe(400);
    expect((await post("/assign", { bookingId: "x", riderId: "y", force: "yes" })).status).toBe(400);
  });

  it("stops on a double booking with a sentence, and goes through when forced", async () => {
    const first = await job(CO);
    const at = (await row(first)).scheduledAt;
    await db.update(schema.bookings).set({ riderId: `${CO}-t2`, status: "assigned", assignStatus: "accepted" }).where(eq(schema.bookings.id, first));
    const second = await job(CO, { scheduledAt: new Date(at.getTime() + 20 * 60_000) });

    const refused = await post("/assign", { bookingId: second, riderId: `${CO}-t2` });
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as any;
    expect(body).toMatchObject({ forceable: true, reason: "overlap" });
    expect(body.message).toContain("Priya Nair");
    expect((await row(second)).riderId).toBeNull();

    const forced = await post("/assign", { bookingId: second, riderId: `${CO}-t2`, force: true });
    expect(forced.status).toBe(200);
    expect((await row(second)).riderId).toBe(`${CO}-t2`);
  });

  it("won't touch a finished job", async () => {
    const id = await job(CO, { status: "completed" });
    const res = await post("/assign", { bookingId: id, riderId: `${CO}-t1` });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).forceable).toBe(false);
  });
});

describe("GET /stream", () => {
  it("opens with ready, then carries coalesced locations and changes for this company only", async () => {
    const s = await openStream();
    try {
      expect(await s.waitFor(/event: ready/)).toBe(true);

      // two fixes for one technician in the same second: only the latest goes out
      await publishDispatch(CO, { kind: "location", techId: `${CO}-t1`, lat: 49.91, lng: -97.1, at: 1 });
      await publishDispatch(CO, { kind: "location", techId: `${CO}-t1`, lat: 49.92, lng: -97.2, at: 2 });
      await publishDispatch(OTHER, { kind: "location", techId: `${OTHER}-t1`, lat: 1, lng: 2, at: 3 });
      expect(await s.waitFor(/event: locations/)).toBe(true);
      const loc = s.text().split("\n\n").find((b) => b.includes("event: locations"))!;
      const data = JSON.parse(loc.split("\n").find((l) => l.startsWith("data:"))!.slice(5).trim());
      expect(data).toEqual([{ techId: `${CO}-t1`, lat: 49.92, lng: -97.2, at: 2 }]);

      await publishDispatch(CO, { kind: "job", jobId: "j-1" });
      await publishDispatch(CO, { kind: "job", jobId: "j-1" });
      await publishDispatch(CO, { kind: "tech", techId: `${CO}-t2` });
      expect(await s.waitFor(/event: changed/)).toBe(true);
      const ch = s.text().split("\n\n").find((b) => b.includes("event: changed"))!;
      expect(JSON.parse(ch.split("\n").find((l) => l.startsWith("data:"))!.slice(5).trim())).toEqual({ techs: [`${CO}-t2`], jobs: ["j-1"] });

      expect(s.text()).not.toContain(OTHER);
    } finally {
      await s.close();
    }
  });

  it("stops listening when the map closes", async () => {
    const { realtimeStats } = await import("../../../services/realtime");
    const before = realtimeStats().activeSubscribers;
    const s = await openStream();
    expect(await s.waitFor(/event: ready/)).toBe(true);
    expect(realtimeStats().activeSubscribers).toBe(before + 1);
    await s.close();
    for (let i = 0; i < 40 && realtimeStats().activeSubscribers !== before; i++) await new Promise((r) => setTimeout(r, 50));
    expect(realtimeStats().activeSubscribers).toBe(before);
  });
});
