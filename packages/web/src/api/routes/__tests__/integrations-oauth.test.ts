/**
 * The OAuth handshake survives a restart and keeps what QuickBooks tells us:
 *   - `state` lives in the database (oauth_states), is single-use and expires;
 *   - the QuickBooks callback stores the company (realmId) it was connected to.
 * Token exchange is stubbed; no network.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.INTEGRATIONS_KEK = Buffer.alloc(32, 7).toString("base64");
process.env.QUICKBOOKS_ENV = "sandbox";

let refreshed: string[] = [];
const realOauth = { ...(await import("../../../services/oauth")) };
mock.module("../../../services/oauth", () => ({
  ...realOauth,
  refreshTokens: async (_p: string, rt: string) => {
    refreshed.push(rt);
    return { accessToken: "at2", refreshToken: "rt2", expiresAt: Date.now() + 3600_000, scope: "s" };
  },
  exchangeCode: async () => ({
    tokens: { accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3600_000, scope: "com.intuit.quickbooks.accounting" },
    raw: { access_token: "at" },
  }),
  hasCredentials: async () => true,
  buildAuthorizeUrl: async (_p: string, state: string) => `https://example.test/authorize?state=${state}`,
}));
afterAll(() => {
  mock.module("../../../services/oauth", () => realOauth);
});

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { ensureTables } = await import("../../../test-support/tables");
const { integrationsRoutes } = await import("../integrations");
const { putState, takeState } = await import("../../lib/oauth-state");
const { seal, open } = await import("../../lib/secretbox");
const { setMapping } = await import("../../../services/quickbooks/resolve");
const { PgTable } = await import("drizzle-orm/pg-core");
const features = await import("../../../services/features");
const { _setQboFetch } = await import("../../../services/quickbooks/client");

const CO = "oa-co";
const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", CO);
  c.set("requestId", "oa-req");
  c.set("user", { id: "oa-admin", role: "admin", email: "a@oa.test", name: "A" } as never);
  return next();
});
app.route("/integrations", integrationsRoutes);

let integrationId = "";
const realFetch = globalThis.fetch;

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTables(v);
  await db.insert(schema.companies).values({ id: CO, name: "OAuth Co", kind: "test" } as never);
  const [row] = await db.insert(schema.integrations).values({ companyId: CO, provider: "quickbooks" } as never).returning();
  integrationId = row!.id;
  // companyinfo lookup after the exchange
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/companyinfo/") && !u.includes("/9130355")) {
      return new Response(JSON.stringify({ CompanyInfo: { CompanyName: "Other Co" } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/companyinfo/")) {
      return new Response(JSON.stringify({ CompanyInfo: { CompanyName: "BMD Sandbox" } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(url as never);
  }) as typeof fetch;
  _setQboFetch(globalThis.fetch);
});
afterAll(() => {
  globalThis.fetch = realFetch;
  _setQboFetch(null);
});

describe("oauth state", () => {
  it("is stored in the database and is single-use", async () => {
    const s = await putState(integrationId, "quickbooks", CO);
    const rows = await db.select().from(schema.oauthStates).where(eq(schema.oauthStates.id, s));
    expect(rows.length).toBe(1);
    expect(await takeState(s)).toEqual({ integrationId, provider: "quickbooks", companyId: CO });
    expect(await takeState(s)).toBeNull();
  });

  it("rejects an expired state", async () => {
    const s = await putState(integrationId, "quickbooks", CO, -1);
    expect(await takeState(s)).toBeNull();
  });
});

describe("quickbooks callback", () => {
  it("stores the realmId and company name on the integration", async () => {
    const r = await app.request(`/integrations/${integrationId}/authorize`, { method: "POST" });
    expect(r.status).toBe(200);
    const state = new URL(((await r.json()) as any).authorizeUrl).searchParams.get("state")!;
    const cb = await app.request(`/integrations/oauth/callback/quickbooks?code=abc&state=${state}&realmId=9130355`);
    expect(cb.status).toBe(200);
    const [row] = await db.select().from(schema.integrations).where(eq(schema.integrations.id, integrationId));
    expect(row!.status).toBe("connected");
    expect(row!.externalAccountId).toBe("9130355");
    expect(row!.accountLabel).toBe("BMD Sandbox");
  });
});

describe("manual sync (C3)", () => {
  it("opens the sealed refresh token for a non-QuickBooks provider and stores the rotation sealed", async () => {
    const [row] = await db.insert(schema.integrations).values({ companyId: CO, provider: "google_drive", status: "connected", accessToken: seal("at"), refreshToken: seal("rt-plain"), expiresAt: new Date() } as never).returning();
    refreshed = [];
    const r = await app.request(`/integrations/${row!.id}/sync`, { method: "POST" });
    expect(r.status).toBe(200);
    expect(refreshed).toEqual(["rt-plain"]);
    const [after] = await db.select().from(schema.integrations).where(eq(schema.integrations.id, row!.id));
    expect(after!.refreshToken.startsWith("enc:v1:")).toBe(true);
    expect(open(after!.refreshToken)).toBe("rt2");
    expect(after!.status).toBe("connected");
  });

  it("checks a QuickBooks connection through the QuickBooks client (refresh-on-use, sealed)", async () => {
    const [row] = await db.select().from(schema.integrations).where(eq(schema.integrations.id, integrationId));
    expect(row!.status).toBe("connected");
    await db.update(schema.integrations).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(schema.integrations.id, integrationId));
    refreshed = [];
    const r = await app.request(`/integrations/${integrationId}/sync`, { method: "POST" });
    expect(r.status).toBe(200);
    expect(refreshed).toEqual(["rt"]);
    const [after] = await db.select().from(schema.integrations).where(eq(schema.integrations.id, integrationId));
    expect(open(after!.refreshToken)).toBe("rt2");
    expect(after!.status).toBe("connected");
  });
});

describe("reconnecting (I4, I6)", () => {
  async function reconnect(realmId: string) {
    const r = await app.request(`/integrations/${integrationId}/authorize`, { method: "POST" });
    const state = new URL(((await r.json()) as any).authorizeUrl).searchParams.get("state")!;
    return app.request(`/integrations/oauth/callback/quickbooks?code=abc&state=${state}&realmId=${realmId}`);
  }

  it("re-queues the jobs that waited while the connection was down", async () => {
    await features.setFeatureOverride({ companyId: CO, key: "integrations.quickbooks", enabled: true, actor: { id: "t", name: "T" } });
    await db.insert(schema.user).values({ id: "oa-tech", name: "Tech", email: "t@oa.test", role: "rider", companyId: CO } as never);
    await db.insert(schema.riders).values({ id: "oa-rider", userId: "oa-tech", companyId: CO } as never);
    await db.insert(schema.services).values({ id: "oa-svc", name: "Flooring", category: "flooring", basePrice: 0, companyId: CO } as never);
    const [b] = await db.insert(schema.bookings).values({ companyId: CO, serviceId: "oa-svc", riderId: "oa-rider", status: "assigned", scheduledAt: new Date(), address: "x", vendorBillStatus: "error" } as never).returning();
    await db.update(schema.integrations).set({ status: "needs_reconnect" }).where(eq(schema.integrations.id, integrationId));
    expect((await reconnect("9130355")).status).toBe(200);
    const queued = await db.select().from(schema.scheduledTasks).where(eq(schema.scheduledTasks.bookingId, b!.id));
    expect(queued.map((t) => t.kind)).toEqual(["qbo.po.create"]);
  });

  it("drops the saved links when the tenant connects a different QuickBooks company", async () => {
    await setMapping(CO, "vendor", "oa-rider", "227");
    expect((await reconnect("5550001")).status).toBe(200);
    const [row] = await db.select().from(schema.integrations).where(eq(schema.integrations.id, integrationId));
    expect(row!.externalAccountId).toBe("5550001");
    expect(row!.accountLabel).toBe("Other Co");
    expect(await db.select().from(schema.qboLinks).where(eq(schema.qboLinks.companyId, CO))).toEqual([]);
    const [issue] = await db.select().from(schema.qboIssues).where(eq(schema.qboIssues.companyId, CO));
    expect(issue!.kind).toBe("realm_changed");
  });
});

describe("GET /integrations", () => {
  it("offers every provider to a company that has never connected anything", async () => {
    const CO2 = "oa-co-fresh";
    await db.insert(schema.companies).values({ id: CO2, name: "Fresh Co", kind: "customer" } as never);
    const fresh = new Hono<AppEnv>().use("*", async (c, next) => {
      c.set("companyId", CO2);
      c.set("requestId", "oa-req2");
      c.set("user", { id: "oa-admin2", role: "admin", email: "b@oa.test", name: "B" } as never);
      return next();
    });
    fresh.route("/integrations", integrationsRoutes);
    const r = await fresh.request("/integrations");
    expect(r.status).toBe(200);
    const list = ((await r.json()) as any).integrations as { provider: string; status: string }[];
    expect(list.map((i) => i.provider).sort()).toEqual(Object.keys(realOauth.PROVIDERS).sort());
    expect(list.every((i) => i.status === "disconnected")).toBe(true);
    // a second read creates nothing more
    const again = ((await (await fresh.request("/integrations")).json()) as any).integrations;
    expect(again.length).toBe(list.length);
    const rows = await db.select().from(schema.integrations).where(eq(schema.integrations.companyId, CO2));
    expect(rows.length).toBe(list.length);
  });
});

describe("integrations are unique per company and provider", () => {
  it("a second row for the same provider is refused by the database", async () => {
    const CO3 = "oa-co-uniq";
    await db.insert(schema.companies).values({ id: CO3, name: "Uniq Co", kind: "customer" } as never);
    await db.insert(schema.integrations).values({ companyId: CO3, provider: "xero" } as never);
    await expect(async () => {
      await db.insert(schema.integrations).values({ companyId: CO3, provider: "xero" } as never);
    }).toThrow();
  });

  it("two first reads at once still leave one card per provider", async () => {
    const CO4 = "oa-co-race";
    await db.insert(schema.companies).values({ id: CO4, name: "Race Co", kind: "customer" } as never);
    const race = new Hono<AppEnv>().use("*", async (c, next) => {
      c.set("companyId", CO4);
      c.set("requestId", "oa-req4");
      c.set("user", { id: "oa-admin4", role: "admin", email: "d@oa.test", name: "D" } as never);
      return next();
    });
    race.route("/integrations", integrationsRoutes);
    const [a, b] = await Promise.all([race.request("/integrations"), race.request("/integrations")]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const rows = await db.select().from(schema.integrations).where(eq(schema.integrations.companyId, CO4));
    expect(rows.length).toBe(Object.keys(realOauth.PROVIDERS).length);
  });
});
