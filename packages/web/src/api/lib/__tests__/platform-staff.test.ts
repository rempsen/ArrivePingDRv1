/**
 * Control Hub staff list, end to end through the real authMiddleware
 * (`auth.api.getSession` mocked, real pglite database):
 *   - an empty list keeps every super admin an owner (no lock-out);
 *   - a super admin who isn't on the list loses cross-tenant powers;
 *   - sales staff only open demo, test and our own tenants, whatever header
 *     they send;
 *   - hub and super-admin guards follow the role;
 *   - opening another tenant is written to the platform audit once;
 *   - the last owner can't be removed or demoted.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
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
  delete process.env.PLATFORM_OWNER_EMAILS;
});

const { db, sdb } = await import("../../database/index");
const schema = await import("../../database/schema");
const { ensureTables } = await import("../../../test-support/tables");
const { authMiddleware, requirePlatform, requireSuperadmin, invalidateCompanyCache } = await import("../../middleware/auth");
const staff = await import("../../../services/platform-staff");
const { _resetTenantVisits } = await import("../../../services/platform-audit");

const app = new Hono<AppEnv>()
  .use("*", authMiddleware)
  .get("/api/whoami", (c) => c.json({ companyId: c.get("companyId"), role: c.get("user")?.role ?? null, platformRole: c.get("platformRole") ?? null }))
  .get("/api/hub/staff-only", requirePlatform("staff"), (c) => c.json({ ok: true }))
  .get("/api/hub/sales-ok", requirePlatform("sales"), (c) => c.json({ ok: true }))
  .get("/api/superadmin/x", requireSuperadmin, (c) => c.json({ ok: true }));

const u = (id: string, role = "superadmin", email = `${id}@nvc360.com`): FakeUser => ({ id, role, companyId: "default", email, name: id.toUpperCase() });
const who = async (user: FakeUser, company?: string) => {
  current = user;
  const r = await app.request("/api/whoami", { headers: company ? { "X-Company-Id": company } : {} });
  return (await r.json()) as { companyId: string; role: string | null; platformRole: string | null };
};

beforeAll(async () => {
  await ensureTables(schema.companies, schema.memberships, schema.platformStaff, schema.platformAudit, schema.user);
  await db.insert(schema.companies).values([
    { id: "ps-cust", name: "Customer Co", kind: "customer" },
    { id: "ps-demo", name: "Demo Co", kind: "demo", isInternal: true },
  ] as never);
  for (const id of ["ps-owner", "ps-sales", "ps-staff", "ps-off"]) {
    await db.insert(schema.user).values({ id, name: id.toUpperCase(), email: `${id}@nvc360.com`, role: "superadmin", companyId: "default" } as never);
  }
  await db.insert(schema.user).values({ id: "ps-outsider", name: "Out", email: "out@acme.test", role: "admin", companyId: "ps-cust" } as never);
  invalidateCompanyCache();
});

beforeEach(() => {
  staff.invalidateRoster();
  _resetTenantVisits();
});

describe("with an empty staff list", () => {
  it("every super admin is an owner and can open any tenant", async () => {
    // Test files share one in-memory database: start from an empty list.
    await sdb.delete(schema.platformStaff);
    staff.invalidateRoster();
    expect(await who(u("ps-off"), "ps-cust")).toEqual({ companyId: "ps-cust", role: "superadmin", platformRole: "owner" });
  });
});

describe("with a staff list", () => {
  beforeAll(async () => {
    await sdb.insert(schema.platformStaff).values([
      { userId: "ps-owner", role: "owner" },
      { userId: "ps-staff", role: "staff" },
      { userId: "ps-sales", role: "sales" },
    ]);
  });

  it("a super admin who isn't on it is an admin of their own company only", async () => {
    expect(await who(u("ps-off"), "ps-cust")).toEqual({ companyId: "default", role: "admin", platformRole: null });
  });
  it("sales open demo tenants but never a customer's, whatever header they send", async () => {
    expect((await who(u("ps-sales"), "ps-demo")).companyId).toBe("ps-demo");
    expect((await who(u("ps-sales"), "ps-cust")).companyId).toBe("default");
  });
  it("staff and owners open any tenant", async () => {
    expect((await who(u("ps-staff"), "ps-cust")).companyId).toBe("ps-cust");
    expect((await who(u("ps-owner"), "ps-cust")).platformRole).toBe("owner");
  });
  it("a non-NVC360 email is never platform staff", async () => {
    expect((await who(u("ps-owner", "superadmin", "ps-owner@gmail.com"), "ps-cust")).platformRole).toBeNull();
  });
  it("guards follow the role", async () => {
    current = u("ps-sales");
    expect((await app.request("/api/hub/sales-ok")).status).toBe(200);
    expect((await app.request("/api/hub/staff-only")).status).toBe(403);
    expect((await app.request("/api/superadmin/x")).status).toBe(403);
    current = u("ps-staff");
    expect((await app.request("/api/hub/staff-only")).status).toBe(200);
    expect((await app.request("/api/superadmin/x")).status).toBe(200);
    current = u("ps-off");
    expect((await app.request("/api/hub/sales-ok")).status).toBe(403);
    expect((await app.request("/api/superadmin/x")).status).toBe(403);
  });
  it("writes one platform audit entry when staff open another tenant", async () => {
    await sdb.delete(schema.platformAudit);
    await who(u("ps-staff"), "ps-cust");
    await who(u("ps-staff"), "ps-cust");
    await new Promise((r) => setTimeout(r, 50));
    const rows = await sdb.select().from(schema.platformAudit);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ action: "tenant.open", companyId: "ps-cust", actorId: "ps-staff", summary: "Opened Customer Co" });
  });
  it("lets the break-glass email in as owner even when off the list", async () => {
    process.env.PLATFORM_OWNER_EMAILS = "ps-off@nvc360.com";
    expect((await who(u("ps-off"), "ps-cust")).platformRole).toBe("owner");
    delete process.env.PLATFORM_OWNER_EMAILS;
  });

  it("refuses to remove or demote the last owner", async () => {
    await expect(staff.removeStaff("ps-owner")).rejects.toMatchObject({ code: "last_owner" });
    await expect(staff.upsertStaff({ email: "ps-owner@nvc360.com", role: "staff", actorId: "x" })).rejects.toMatchObject({ code: "last_owner" });
  });
  it("only adds NVC360 people who already have an account", async () => {
    await expect(staff.upsertStaff({ email: "out@acme.test", role: "sales", actorId: "ps-owner" })).rejects.toMatchObject({ code: "not_nvc360" });
    await expect(staff.upsertStaff({ email: "nobody@nvc360.com", role: "sales", actorId: "ps-owner" })).rejects.toMatchObject({ code: "not_found" });
  });
  it("adding makes them a super admin; removing leaves them an admin", async () => {
    await sdb.update(schema.user).set({ role: "admin" }).where((await import("drizzle-orm")).eq(schema.user.id, "ps-off"));
    const m = await staff.upsertStaff({ email: "PS-OFF@nvc360.com", role: "sales", actorId: "ps-owner" });
    expect(m.role).toBe("sales");
    const { eq } = await import("drizzle-orm");
    expect((await sdb.select().from(schema.user).where(eq(schema.user.id, "ps-off")))[0]!.role).toBe("superadmin");
    expect((await staff.listStaff()).map((s) => s.userId)).toContain("ps-off");
    await staff.removeStaff("ps-off");
    expect((await sdb.select().from(schema.user).where(eq(schema.user.id, "ps-off")))[0]!.role).toBe("admin");
  });
});
