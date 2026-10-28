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

const realOauth = { ...(await import("../../../services/oauth")) };
mock.module("../../../services/oauth", () => ({
  ...realOauth,
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
  await ensureTables(schema.companies, schema.integrations, schema.oauthStates, schema.oauthAppCredentials);
  await db.insert(schema.companies).values({ id: CO, name: "OAuth Co", kind: "test" } as never);
  const [row] = await db.insert(schema.integrations).values({ companyId: CO, provider: "quickbooks" } as never).returning();
  integrationId = row!.id;
  // companyinfo lookup after the exchange
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/companyinfo/")) {
      return new Response(JSON.stringify({ CompanyInfo: { CompanyName: "BMD Sandbox" } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(url as never);
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
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
