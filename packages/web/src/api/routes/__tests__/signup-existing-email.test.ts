/**
 * Self-serve signup with an email that already has a login (a customer of
 * another company, say). Logins are global and one person can belong to many
 * companies, so signup adds the new company to that login, but only when the
 * person is signed in as it (the page signs them in with their existing
 * password first). Nothing about the login itself changes: not its password,
 * name or global role. Before this, signup failed with "Email already in use".
 *
 * Ids prefixed "sx-".
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { PgTable } from "drizzle-orm/pg-core";
import { and, eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

let signedIn: { id: string; email: string } | null = null;
const realAuth = { ...(await import("../../auth")) };
beforeAll(() => {
  mock.module("../../auth", () => ({
    ...realAuth,
    auth: { ...realAuth.auth, api: { ...realAuth.auth.api, getSession: async () => (signedIn ? { user: signedIn, session: { id: "s" } } : null) } },
  }));
});
afterAll(() => {
  mock.module("../../auth", () => realAuth);
});

const { sdb } = await import("../../database/index");
const schema = await import("../../database/schema");
const { ensureTables } = await import("../../../test-support/tables");
const { attachExistingAdmin } = await import("../../../services/company-provisioning");
const { onboardingPublicRoutes } = await import("../onboarding");

const app = new Hono().route("/o", onboardingPublicRoutes as never);
const post = (path: string, body: unknown) =>
  app.request(`/o${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const EMAIL = "sx-client@towers.test";

beforeAll(async () => {
  await ensureTables(...(Object.values(schema).filter((v) => v instanceof PgTable) as PgTable[]));
  await sdb.insert(schema.user).values([
    // A customer of another company, as an admin there typed it (mixed case).
    { id: "sx-u1", name: "Matt Client", email: "SX-Client@Towers.test", role: "customer", companyId: "sx-bmd" },
    { id: "sx-gone", name: "Gone", email: "sx-gone@x.test", role: "deleted", companyId: "sx-bmd" },
    { id: "sx-legacy", name: "Old Tech", email: "sx-legacy@x.test", role: "rider", companyId: "sx-acme" },
    { id: "sx-root", name: "Platform", email: "sx-root@x.test", role: "superadmin", companyId: "default" },
  ] as never);
  await sdb.insert(schema.memberships).values({ id: "sx-m1", userId: "sx-u1", companyId: "sx-bmd", role: "customer", status: "active" } as never);
});

describe("POST /email/check", () => {
  it("says whether the email already has a login, ignoring case, and never counts a deleted one", async () => {
    expect(await (await post("/email/check", { email: EMAIL })).json()).toEqual({ exists: true });
    expect(await (await post("/email/check", { email: "sx-new@nowhere.test" })).json()).toEqual({ exists: false });
    expect(await (await post("/email/check", { email: "sx-gone@x.test" })).json()).toEqual({ exists: false });
  });
});

describe("POST /signup with an existing email", () => {
  const body = { name: "Towers Realty", adminName: "Matt Client", adminEmail: EMAIL, adminPassword: "whatever-1" };

  it("asks to sign in instead of failing with 'already in use'", async () => {
    signedIn = null;
    const res = await post("/signup", body);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "email_needs_signin" });
  });

  it("refuses someone signed in as a different login", async () => {
    signedIn = { id: "sx-root", email: "sx-root@x.test" };
    const res = await post("/signup", body);
    expect(res.status).toBe(409);
    const [co] = await sdb.select().from(schema.companies).where(eq(schema.companies.id, "towers-realty"));
    expect(co).toBeUndefined();
  });
});

describe("POST /signup retried after it already went through", () => {
  it("hands back the company the card already has, instead of making a second one", async () => {
    await sdb.insert(schema.companies).values({ id: "sx-done", name: "Towers Realty", billingCustomerId: "cus_sx1", billingStatus: "trialing" } as never);
    await sdb.insert(schema.memberships).values({ id: "sx-m-done", userId: "sx-u1", companyId: "sx-done", role: "admin", status: "active" } as never);
    signedIn = { id: "sx-u1", email: "SX-Client@Towers.test" };
    const res = await post("/signup", { name: "Towers Realty", adminName: "Matt", adminEmail: EMAIL, adminPassword: "x-12345678", billingCustomerId: "cus_sx1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ companySlug: "sx-done", alreadyCreated: true });
    const rows = await sdb.select().from(schema.companies).where(eq(schema.companies.billingCustomerId, "cus_sx1"));
    expect(rows.length).toBe(1);
  });

  it("won't hand that company to someone else's email", async () => {
    signedIn = null;
    const res = await post("/signup", { name: "Other", adminName: "X", adminEmail: "sx-other@x.test", adminPassword: "x-12345678", billingCustomerId: "cus_sx1" });
    expect(res.status).toBe(409);
  });
});

describe("adding the new company to the login", () => {
  const member = async (userId: string, companyId: string) =>
    (await sdb.select().from(schema.memberships).where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.companyId, companyId))))[0];

  it("makes them admin of the new company and keeps everything else", async () => {
    const r = await attachExistingAdmin(EMAIL, "sx-towers");
    expect(r).toEqual({ id: "sx-u1", reused: true });
    expect(await member("sx-u1", "sx-towers")).toMatchObject({ role: "admin", status: "active" });
    expect(await member("sx-u1", "sx-bmd")).toMatchObject({ role: "customer", status: "active" });
    const [u] = await sdb.select().from(schema.user).where(eq(schema.user.id, "sx-u1"));
    expect(u).toMatchObject({ name: "Matt Client", role: "customer", companyId: "sx-towers" });
  });

  it("gives a legacy login a membership at its old company before moving its home", async () => {
    await attachExistingAdmin("sx-legacy@x.test", "sx-legacy-co");
    expect(await member("sx-legacy", "sx-acme")).toMatchObject({ role: "rider", status: "active" });
    expect(await member("sx-legacy", "sx-legacy-co")).toMatchObject({ role: "admin" });
  });

  it("leaves a platform superadmin's role and home company alone", async () => {
    await attachExistingAdmin("sx-root@x.test", "sx-root-co");
    const [u] = await sdb.select().from(schema.user).where(eq(schema.user.id, "sx-root"));
    expect(u).toMatchObject({ role: "superadmin", companyId: "default" });
    expect(await member("sx-root", "sx-root-co")).toMatchObject({ role: "admin" });
  });

  it("refuses a deleted account", async () => {
    await expect(attachExistingAdmin("sx-gone@x.test", "sx-x")).rejects.toBeTruthy();
  });
});
