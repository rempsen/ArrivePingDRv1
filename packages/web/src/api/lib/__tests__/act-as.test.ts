/**
 * Control Hub act-as, through the real authMiddleware (getSession mocked, real
 * pglite): the swap gives exactly the target's powers at that company; every
 * write on the deny list is refused; changes made meanwhile name the staff
 * member; expiry and the tenant's opt-out drop back to the staff member; the
 * tenant's Audit Log shows start and end. Ids prefixed "aa-".
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

type FakeUser = { id: string; role: string; companyId: string; email: string; name: string };
let current: FakeUser | null = null;
const realAuth = { ...(await import("../../auth")) };
beforeAll(() => {
  mock.module("../../auth", () => ({
    ...realAuth,
    auth: { ...realAuth.auth, api: { ...realAuth.auth.api, getSession: async () => (current ? { user: current, session: { id: "s" } } : null) } },
  }));
});
afterAll(() => {
  mock.module("../../auth", () => realAuth);
});

const { db, sdb } = await import("../../database/index");
const schema = await import("../../database/schema");
const { ensureTables } = await import("../../../test-support/tables");
const { authMiddleware, requirePlatform, invalidateCompanyCache } = await import("../../middleware/auth");
const { audit } = await import("../audit");
const actAs = await import("../../../services/act-as");
const { actAsRoutes } = await import("../../routes/act-as");
const { invalidateRoster } = await import("../../../services/platform-staff");
const { ACT_AS_DENY } = await import("../../../shared/act-as");

const app = new Hono<AppEnv>()
  .use("*", authMiddleware)
  .get("/api/whoami", (c) => c.json({ id: c.get("user")?.id, role: c.get("user")?.role, companyId: c.get("companyId"), acting: Boolean(c.get("actAs")) }))
  .post("/api/bookings", async (c) => {
    const u = c.get("user")!;
    await audit({ companyId: c.get("companyId"), actorId: u.id, actorName: u.name, action: "create", entityType: "booking", summary: "Booked a job" });
    return c.json({ ok: true });
  })
  .get("/api/hub/overview", requirePlatform("sales"), (c) => c.json({ ok: true }))
  .route("/api/act-as", actAsRoutes)
  .all("/api/*", (c) => c.json({ reached: true }));

const staff: FakeUser = { id: "aa-staff", role: "superadmin", companyId: "default", email: "aa-staff@nvc360.com", name: "Dan R." };
const sales: FakeUser = { id: "aa-sales", role: "superadmin", companyId: "default", email: "aa-sales@nvc360.com", name: "Sam Sales" };
const H = (sessionId: string, extra: Record<string, string> = {}) => ({ "X-Act-As": sessionId, "Content-Type": "application/json", ...extra });

async function start(over: Partial<Parameters<typeof actAs.startActAs>[0]> = {}) {
  return actAs.startActAs({ actor: { id: staff.id, name: staff.name }, role: "staff", targetUserId: "aa-tom", companyId: "aa-cust", reason: "Tom can't see tomorrow's jobs", minutes: 30, ...over });
}

beforeAll(async () => {
  await ensureTables(schema.companies, schema.companySettings, schema.memberships, schema.user, schema.platformStaff, schema.platformAudit, schema.actAsSessions, schema.auditLog);
  await db.insert(schema.companies).values([
    { id: "aa-cust", name: "Acme HVAC", kind: "customer" },
    { id: "aa-demo", name: "Demo Co", kind: "demo", isInternal: true },
    { id: "aa-shy", name: "Private Co", kind: "customer" },
  ] as never);
  // Our own account. Other test files in the same run may already have
  // created it (hub.test.ts does), so seed it the same way they do.
  await db.insert(schema.companies).values({ id: "default", name: "ArrivePing", kind: "internal" } as never).onConflictDoNothing();
  await db.insert(schema.companySettings).values([
    { id: "aa-s1", companyId: "aa-cust" },
    { id: "aa-s2", companyId: "aa-demo" },
    { id: "aa-s3", companyId: "aa-shy", allowSupportAccess: false },
  ] as never);
  await db.insert(schema.user).values([
    { id: "aa-staff", name: "Dan R.", email: "aa-staff@nvc360.com", role: "superadmin", companyId: "default" },
    { id: "aa-sales", name: "Sam Sales", email: "aa-sales@nvc360.com", role: "superadmin", companyId: "default" },
    { id: "aa-tom", name: "Tom Rivera", email: "tom@acme.test", role: "rider", companyId: "aa-cust" },
    { id: "aa-demo-admin", name: "Demo Admin", email: "admin@demo.test", role: "admin", companyId: "aa-demo" },
    { id: "aa-shy-admin", name: "Pat", email: "pat@shy.test", role: "admin", companyId: "aa-shy" },
  ] as never);
  await db.insert(schema.memberships).values([
    { id: "aa-m1", userId: "aa-tom", companyId: "aa-cust", role: "dispatcher", status: "active" },
    { id: "aa-m2", userId: "aa-demo-admin", companyId: "aa-demo", role: "admin", status: "active" },
    { id: "aa-m3", userId: "aa-shy-admin", companyId: "aa-shy", role: "admin", status: "active" },
  ] as never);
  await sdb.insert(schema.platformStaff).values([
    { userId: "aa-staff", role: "staff" },
    { userId: "aa-sales", role: "sales" },
  ]);
  invalidateRoster();
  invalidateCompanyCache();
});

describe("starting", () => {
  it("refuses a short reason, an odd length, a super admin target and a tenant that said no", async () => {
    await expect(start({ reason: "help" })).rejects.toMatchObject({ code: "bad_reason" });
    await expect(start({ minutes: 45 })).rejects.toMatchObject({ code: "bad_length" });
    await expect(start({ targetUserId: "aa-sales" })).rejects.toMatchObject({ code: "no_person" });
    await expect(start({ companyId: "aa-shy", targetUserId: "aa-shy-admin" })).rejects.toMatchObject({ code: "support_off" });
  });
  it("keeps sales to demo and test accounts", async () => {
    await expect(start({ actor: { id: sales.id, name: sales.name }, role: "sales" })).rejects.toMatchObject({ code: "not_allowed" });
    const s = await start({ actor: { id: sales.id, name: sales.name }, role: "sales", companyId: "aa-demo", targetUserId: "aa-demo-admin" });
    current = sales;
    const r = await app.request("/api/whoami", { headers: H(s.id) });
    expect(await r.json()).toMatchObject({ id: "aa-demo-admin", companyId: "aa-demo", acting: true });
    await actAs.endActAs(s.id, sales.id);
  });
  it("writes the start to the tenant's own audit log with the reason", async () => {
    const s = await start();
    const rows = await sdb.select().from(schema.auditLog).where(and(eq(schema.auditLog.companyId, "aa-cust"), eq(schema.auditLog.action, "support_access")));
    expect(rows.at(-1)?.summary).toBe("signed in as Tom Rivera for up to 30 minutes to help: Tom can't see tomorrow's jobs");
    expect(rows.at(-1)?.actorName).toBe("ArrivePing support (Dan R.)");
    await actAs.endActAs(s.id, staff.id);
  });
});

describe("during a session", () => {
  it("is exactly that person at that company, and kept out of the hub", async () => {
    const s = await start();
    current = staff;
    const r = await app.request("/api/whoami", { headers: H(s.id) });
    expect(await r.json()).toEqual({ id: "aa-tom", role: "dispatcher", companyId: "aa-cust", acting: true });
    expect(r.headers.get("X-Act-As-Expires")).toBeTruthy();
    expect((await app.request("/api/hub/overview", { headers: H(s.id) })).status).toBe(403);
    await actAs.endActAs(s.id, staff.id);
  });
  it("refuses every write on the deny list, but lets reads through", async () => {
    const s = await start();
    current = staff;
    for (const d of ACT_AS_DENY) {
      const r = await app.request(`${d.prefix}/x`, { method: "POST", headers: H(s.id), body: "{}" });
      expect(r.status).toBe(403);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe("act_as_blocked");
      expect((await app.request(`${d.prefix}/x`, { headers: H(s.id) })).status).toBe(200);
    }
    expect((await app.request("/api/admin/users/u1/reset-password", { method: "POST", headers: H(s.id), body: "{}" })).status).toBe(403);
    expect((await app.request("/api/me", { method: "DELETE", headers: H(s.id) })).status).toBe(403);
    await actAs.endActAs(s.id, staff.id);
  });
  it("names the staff member on every change made meanwhile", async () => {
    const s = await start();
    current = staff;
    expect((await app.request("/api/bookings", { method: "POST", headers: H(s.id), body: "{}" })).status).toBe(200);
    const [row] = await sdb.select().from(schema.auditLog).where(and(eq(schema.auditLog.companyId, "aa-cust"), eq(schema.auditLog.action, "create")));
    expect(row).toMatchObject({ actorId: "aa-tom", supportActorId: "aa-staff", supportActorName: "Dan R." });
    await actAs.endActAs(s.id, staff.id);
  });
  it("ignores a session that belongs to someone else", async () => {
    const s = await start();
    current = sales;
    const r = await app.request("/api/whoami", { headers: H(s.id) });
    expect(await r.json()).toMatchObject({ id: "aa-sales", acting: false });
    expect(r.headers.get("X-Act-As-Ended")).toBe("unknown");
    await actAs.endActAs(s.id, staff.id);
  });
});

describe("review fixes", () => {
  it("keeps sales out of our own account's people", async () => {
    await expect(start({ actor: { id: sales.id, name: sales.name }, role: "sales", companyId: "default", targetUserId: "aa-tom" })).rejects.toMatchObject({ code: "not_allowed" });
    await db.insert(schema.companies).values({ id: "default", name: "ArrivePing", kind: "internal" } as never).catch(() => {});
    await expect(start({ actor: { id: sales.id, name: sales.name }, role: "sales", companyId: "default", targetUserId: "aa-tom" })).rejects.toMatchObject({ code: "not_allowed" });
  });
  it("refuses a write sent under a session that has run out, instead of saving it as the staff member", async () => {
    const s = await start({ now: new Date(Date.now() - 31 * 60_000) });
    current = staff;
    const r = await app.request("/api/bookings", { method: "POST", headers: H(s.id, { "X-Company-Id": "aa-cust" }), body: "{}" });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("act_as_ended");
    const rows = await sdb.select().from(schema.auditLog).where(and(eq(schema.auditLog.companyId, "aa-cust"), eq(schema.auditLog.action, "create"), eq(schema.auditLog.actorId, "aa-staff")));
    expect(rows.length).toBe(0);
  });
});

describe("ending", () => {
  it("leaves from inside the session and logs it", async () => {
    const s = await start();
    current = staff;
    const r = await app.request("/api/act-as/end", { method: "POST", headers: H(s.id), body: "{}" });
    expect(((await r.json()) as { companyId: string }).companyId).toBe("aa-cust");
    const [row] = await sdb.select().from(schema.actAsSessions).where(eq(schema.actAsSessions.id, s.id));
    expect(row).toMatchObject({ endedReason: "exit" });
    expect((await app.request("/api/whoami", { headers: H(s.id) }).then((x) => x.json()) as { acting: boolean }).acting).toBe(false);
  });
  it("drops back to the staff member once time runs out", async () => {
    const s = await start({ now: new Date(Date.now() - 31 * 60_000) });
    current = staff;
    const r = await app.request("/api/whoami", { headers: H(s.id) });
    expect(await r.json()).toMatchObject({ id: "aa-staff", acting: false });
    expect(r.headers.get("X-Act-As-Ended")).toBe("expired");
    const [row] = await sdb.select().from(schema.actAsSessions).where(eq(schema.actAsSessions.id, s.id));
    expect(row!.endedReason).toBe("expired");
    const ends = await sdb.select().from(schema.auditLog).where(and(eq(schema.auditLog.companyId, "aa-cust"), eq(schema.auditLog.action, "support_access_end")));
    expect(ends.some((e) => e.summary.includes("time ran out"))).toBe(true);
  });
  it("ends at once when the tenant switches support access off", async () => {
    const s = await start();
    await sdb.update(schema.companySettings).set({ allowSupportAccess: false }).where(eq(schema.companySettings.companyId, "aa-cust"));
    actAs.invalidateSupportAccess("aa-cust");
    current = staff;
    const r = await app.request("/api/whoami", { headers: H(s.id) });
    expect(r.headers.get("X-Act-As-Ended")).toBe("support_off");
    expect((await sdb.select().from(schema.actAsSessions).where(eq(schema.actAsSessions.id, s.id)))[0]!.endedReason).toBe("revoked");
    await sdb.update(schema.companySettings).set({ allowSupportAccess: true }).where(eq(schema.companySettings.companyId, "aa-cust"));
    actAs.invalidateSupportAccess("aa-cust");
  });
  it("replaces an open session when a new one starts", async () => {
    const a = await start();
    const b = await start();
    const [row] = await sdb.select().from(schema.actAsSessions).where(eq(schema.actAsSessions.id, a.id));
    expect(row!.endedReason).toBe("replaced");
    await actAs.endActAs(b.id, staff.id);
  });
});
