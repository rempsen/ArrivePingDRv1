/**
 * Launch progress (Phase 6): measure and nudge.
 *
 *  - Stage and nudge rules: day 1 / 3 / 7 windows, once each, nothing once
 *    everything is done, nothing after day 3 once activated, no catch-up burst
 *    after downtime.
 *  - The sweep records when steps are done, emails the right admins with a
 *    working one-click unsubscribe, tells Slack once about a stalled company,
 *    and leaves internal companies and old companies alone.
 *  - Unsubscribe links can't be forged; guide events only accept known shapes.
 */
import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const lp = await import("../launch-progress");
const { launchTipsRoutes } = await import("../../api/routes/launch-tips");
const { meRoutes } = await import("../../api/routes/me");
const { parseOnboarding } = await import("../../shared/onboarding");

const H = 3_600_000;
const NOW = new Date("2026-10-20T15:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * H);

function colDdl(col: PgColumn, withPk: boolean): string {
  const parts = [`"${col.name}"`, col.getSQLType()];
  if (withPk && col.primary) parts.push("PRIMARY KEY");
  const d = (col as any).default;
  const lit = d === undefined ? null : typeof d === "string" ? `'${d.replace(/'/g, "''")}'` : typeof d === "boolean" ? (d ? "TRUE" : "FALSE") : typeof d === "number" ? String(d) : null;
  if (lit !== null) parts.push(`DEFAULT ${lit}`);
  return parts.join(" ");
}
async function ensureTable(table: PgTable) {
  const s = (db as any).$client;
  const cfg = getTableConfig(table);
  await s.execute(`CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cfg.columns.map((c) => colDdl(c, true)).join(", ")})`);
  for (const c of cfg.columns) if (!c.primary) await s.execute(`ALTER TABLE "${cfg.name}" ADD COLUMN IF NOT EXISTS ${colDdl(c, false)}`);
}

const list = (done: Partial<Record<string, boolean>>) => {
  const ids = ["first-job", "invite-tech", "live-eta", "reply-to", "milestone-copy"] as const;
  const items = ids.map((id) => ({ id, done: Boolean(done[id]) }));
  return { items, setup: [], complete: items.every((i) => i.done) };
};

describe("stage and nudge rules", () => {
  it("activation stage", () => {
    expect(lp.activationStage(list({}), false)).toBe("signed_up");
    expect(lp.activationStage(list({}), true)).toBe("set_up");
    expect(lp.activationStage(list({ "first-job": true }), true)).toBe("first_job");
    expect(lp.activationStage(list({ "first-job": true, "invite-tech": true, "live-eta": true }), true)).toBe("activated");
    expect(lp.activationStage(list({ "first-job": true, "invite-tech": true, "live-eta": true, "reply-to": true, "milestone-copy": true }), true)).toBe("live");
  });

  it("day 1 / 3 / 7 windows, once each, no catch-up burst", () => {
    const p = { v: 1 as const, done: {} };
    const c = list({});
    expect(lp.dueNudge(p, ago(10), NOW, c)).toBeNull();
    expect(lp.dueNudge(p, ago(25), NOW, c)).toBe("d1");
    expect(lp.dueNudge({ ...p, nudges: { d1: "x" } }, ago(25), NOW, c)).toBeNull();
    // Down for days: at day 4 only day 3's tip is due, never day 1's too.
    expect(lp.dueNudge(p, ago(4 * 24), NOW, c)).toBe("d3");
    expect(lp.dueNudge(p, ago(7.5 * 24), NOW, c)).toBe("d7");
    expect(lp.dueNudge(p, ago(11 * 24), NOW, c)).toBeNull();
  });

  it("nothing once everything is done; nothing after day 1 once activated", () => {
    const p = { v: 1 as const, done: {} };
    expect(lp.dueNudge(p, ago(25), NOW, list({ "first-job": true, "invite-tech": true, "live-eta": true, "reply-to": true, "milestone-copy": true }))).toBeNull();
    const activated = list({ "first-job": true, "invite-tech": true, "live-eta": true });
    expect(lp.dueNudge(p, ago(25), NOW, activated)).toBe("d1");
    expect(lp.dueNudge(p, ago(80), NOW, activated)).toBeNull();
  });

  it("stall: no real job after 48 hours, once", () => {
    const p = { v: 1 as const, done: {} };
    expect(lp.stallDue(p, ago(47), NOW, list({}))).toBe(false);
    expect(lp.stallDue(p, ago(49), NOW, list({}))).toBe(true);
    expect(lp.stallDue(p, ago(49), NOW, list({ "first-job": true }))).toBe(false);
    expect(lp.stallDue({ ...p, stallAlertAt: "x" }, ago(49), NOW, list({}))).toBe(false);
  });

  it("unsubscribe tokens round-trip and can't be forged", () => {
    const t = lp.unsubscribeToken("m-123");
    expect(lp.readUnsubscribeToken(t)).toBe("m-123");
    const [id, sig] = t.split(".");
    expect(lp.readUnsubscribeToken(`${Buffer.from("m-999").toString("base64url")}.${sig}`)).toBeNull();
    expect(lp.readUnsubscribeToken(`${id}.${sig!.slice(0, -1)}A`)).toBeNull();
    expect(lp.readUnsubscribeToken("garbage")).toBeNull();
  });

  it("the tip email lists what's left in the company's words and links to unsubscribe", () => {
    const terms = { job: "work order", jobs: "work orders", worker: "crew member", workers: "crew members", customer: "client", customers: "clients" };
    const m = lp.nudgeEmail("d1", list({ "reply-to": true }), terms, "Dana", "https://x.test/unsub");
    expect(m.subject).toBe("1 of 5 done: here's what's next on ArrivePing");
    expect(m.html).toContain("Book your first real work order");
    expect(m.html).toContain("Invite a crew member");
    expect(m.html).not.toContain("Set your reply-to email");
    expect(m.html).toContain("https://x.test/unsub");
    expect(m.text).toContain("Stop these tips: https://x.test/unsub");
  });
});

describe("the sweep", () => {
  const sent: { to: string; subject: string; headers?: Record<string, string> }[] = [];
  const alerts: string[] = [];
  const stageChanges: string[] = [];
  const deps = {
    // Other test files share this in-memory database (bun runs them in one
    // process) and seed companies of their own: the sweep is scoped to this
    // file's companies so it neither emails nor modifies theirs. The internal
    // and old companies are in the list on purpose: the sweep must still skip them.
    companyIds: ["lp-new", "lp-internal", "lp-old"],
    send: (async (o: any) => {
      sent.push({ to: o.to, subject: o.subject, headers: o.headers });
      return { ok: true };
    }) as any,
    slack: (async (co: { name: string }) => {
      alerts.push(co.name);
      return true;
    }) as any,
    onStageChange: (id: string) => stageChanges.push(id),
  };

  beforeAll(async () => {
    for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTable(v);
    await db.insert(schema.companies).values([
      { id: "lp-new", name: "New Co", createdAt: ago(25) } as any,
      { id: "lp-internal", name: "Internal Co", createdAt: ago(25), isInternal: true } as any,
      { id: "lp-old", name: "Old Co", createdAt: ago(30 * 24) } as any,
    ]);
    for (const co of ["lp-new", "lp-internal", "lp-old"]) await db.insert(schema.companySettings).values({ id: co, companyId: co, jobNoun: "Work order", jobNounPlural: "Work orders" } as any);
    await db.insert(schema.user).values([
      { id: "lp-admin", companyId: "lp-new", name: "Dana Admin", firstName: "Dana", email: "dana@new.test", role: "admin" } as any,
      { id: "lp-admin2", companyId: "lp-new", name: "Sam Second", email: "sam@new.test", role: "admin" } as any,
      { id: "lp-disp", companyId: "lp-new", name: "Dee Dispatch", email: "dee@new.test", role: "dispatcher" } as any,
      { id: "lp-int-admin", companyId: "lp-internal", name: "Int", email: "int@internal.test", role: "admin" } as any,
    ]);
    await db.insert(schema.memberships).values([
      { id: "lp-m-admin", userId: "lp-admin", companyId: "lp-new", role: "admin", status: "active" } as any,
      { id: "lp-m-admin2", userId: "lp-admin2", companyId: "lp-new", role: "admin", status: "active" } as any,
      { id: "lp-m-disp", userId: "lp-disp", companyId: "lp-new", role: "dispatcher", status: "active" } as any,
      { id: "lp-m-int", userId: "lp-int-admin", companyId: "lp-internal", role: "admin", status: "active" } as any,
    ]);
  });
  beforeEach(() => {
    sent.length = 0;
    alerts.length = 0;
    process.env.LAUNCH_NUDGES = "on";
    process.env.SLACK_ONBOARDING_WEBHOOK_URL = "https://hooks.slack.test/x";
  });

  it("day 1: emails each admin once (not the dispatcher), with one-click unsubscribe, and records it", async () => {
    await lp.sweepLaunch(NOW, deps);
    expect(sent.map((s) => s.to).sort()).toEqual(["dana@new.test", "sam@new.test"]);
    expect(sent[0]!.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(sent[0]!.headers?.["List-Unsubscribe"]).toMatch(/^<https?:\/\/.+\/api\/launch-tips\/unsubscribe\?t=.+>$/);
    const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, "lp-new"));
    const p = lp.parseProgress(co!.launchProgress);
    expect(p.nudges?.d1).toBe(NOW.toISOString());
    expect(p.stage).toBe("signed_up");
    expect(stageChanges).toContain("lp-new");
    // Internal and old companies are left alone.
    const [int] = await db.select().from(schema.companies).where(eq(schema.companies.id, "lp-internal"));
    expect(int!.launchProgress).toBeNull();
    // …and no other test's company was touched.
    const touched = (await db.select().from(schema.companies)).filter((c) => c.launchProgress && c.id !== "lp-new");
    expect(touched.map((c) => c.id)).toEqual([]);
    await lp.sweepLaunch(new Date(NOW.getTime() + H), deps);
    expect(sent.length).toBe(2);
  });

  it("the unsubscribe link works (GET page and one-click POST), and that admin gets no more tips", async () => {
    const app = new Hono<any>().route("/launch-tips", launchTipsRoutes);
    const bad = await app.request("/launch-tips/unsubscribe?t=nope");
    expect(bad.status).toBe(400);
    const ok = await app.request(`/launch-tips/unsubscribe?t=${lp.unsubscribeToken("lp-m-admin2")}`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("You won't get these tips again");
    const post = await app.request(`/launch-tips/unsubscribe?t=${lp.unsubscribeToken("lp-m-admin2")}`, { method: "POST" });
    expect(post.status).toBe(200);
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, "lp-m-admin2"));
    expect(parseOnboarding(m!.onboarding).nudgesOff).toBe(true);

    sent.length = 0;
    await lp.sweepLaunch(new Date(NOW.getTime() + 60 * H), deps); // day 3.5
    expect(sent.map((s) => s.to)).toEqual(["dana@new.test"]);
  });

  it("tells Slack once when there's no real job after two days, and records steps as they're done", async () => {
    expect(alerts).toEqual([]);
    const later = new Date(NOW.getTime() + 61 * H);
    await lp.sweepLaunch(later, deps);
    expect(alerts).toEqual([]); // already alerted in the previous sweep (day 3.5)
    const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, "lp-new"));
    expect(lp.parseProgress(co!.launchProgress).stallAlertAt).toBeTruthy();

    await db.insert(schema.notificationChannels).values({ id: "lp-nc", companyId: "lp-new", emailReplyTo: "office@new.test" } as any);
    await lp.sweepLaunch(new Date(NOW.getTime() + 62 * H), deps);
    const [co2] = await db.select().from(schema.companies).where(eq(schema.companies.id, "lp-new"));
    expect(lp.parseProgress(co2!.launchProgress).done["reply-to"]).toBe(new Date(NOW.getTime() + 62 * H).toISOString());
  });

  it("with LAUNCH_NUDGES off, no emails go out", async () => {
    delete process.env.LAUNCH_NUDGES;
    await db.update(schema.companies).set({ launchProgress: null }).where(eq(schema.companies.id, "lp-new"));
    await lp.sweepLaunch(NOW, deps);
    expect(sent).toEqual([]);
  });
});

describe("POST /me/guide-events", () => {
  const app = new Hono<any>()
    .use("*", async (c, next) => {
      c.set("companyId", "lp-new");
      c.set("user", { id: "lp-admin", role: "admin", email: "dana@new.test", name: "Dana" });
      return next();
    })
    .route("/me", meRoutes)
    .onError((err, c) => c.json({ message: err.message }, ((err as any).status ?? 500) as 400));
  const post = (body: unknown) => app.request("/me/guide-events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("accepts known events", async () => {
    const r = await post({
      events: [
        { name: "guide.chapter_started", chapter: "reply-to", source: "ask" },
        { name: "guide.step_viewed", chapter: "reply-to", step: "sender", index: 0 },
        { name: "guide.ask_question", answered: true, actions: 2 },
      ],
    });
    expect(r.status).toBe(204);
  });

  it("refuses unknown events, extra fields and free text", async () => {
    expect((await post({ events: [{ name: "guide.whatever" }] })).status).toBe(400);
    expect((await post({ events: [{ name: "guide.ask_question", answered: true, actions: 1, question: "my customer Bob Smith" }] })).status).toBe(400);
    expect((await post({ events: [{ name: "guide.chapter_started", chapter: "Bob Smith's house", source: "panel" }] })).status).toBe(400);
    expect((await post({ events: [] })).status).toBe(400);
  });
});
