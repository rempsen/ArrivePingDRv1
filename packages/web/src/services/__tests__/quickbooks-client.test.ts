/**
 * The QuickBooks client: every call carries the tenant's token and the pinned
 * minor version, tokens refresh before they expire (and the rotated refresh
 * token is kept, sealed), a revoked connection is marked for reconnect, and
 * errors say whether a retry can help. Transport is a stub; no network.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.INTEGRATIONS_KEK = Buffer.alloc(32, 7).toString("base64");
process.env.QUICKBOOKS_ENV = "sandbox";

let refreshResult: () => Promise<any> = async () => ({ accessToken: "at-2", refreshToken: "rt-2", expiresAt: Date.now() + 3600_000, scope: "s" });
const realOauth = { ...(await import("../oauth")) };
mock.module("../oauth", () => ({ ...realOauth, refreshTokens: () => refreshResult() }));
afterAll(() => mock.module("../oauth", () => realOauth));

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { ensureTables } = await import("../../test-support/tables");
const { seal, open } = await import("../../api/lib/secretbox");
const { qboFetch, qboQuery, QboError, _setQboFetch, loadConnection } = await import("../quickbooks/client");

const CO = "qc-co";
type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let responder: (c: Call) => Response = () => new Response("{}", { status: 200 });
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

beforeAll(async () => {
  await ensureTables(schema.companies, schema.integrations);
  await db.insert(schema.companies).values({ id: CO, name: "Client Co", kind: "test" } as never);
  _setQboFetch((async (url: any, init: any) => {
    const c = { url: String(url), init: init ?? {} };
    calls.push(c);
    return responder(c);
  }) as typeof fetch);
});
afterAll(() => _setQboFetch(null));

async function connect(over: Partial<typeof schema.integrations.$inferInsert> = {}) {
  await db.delete(schema.integrations).where(eq(schema.integrations.companyId, CO));
  await db.insert(schema.integrations).values({
    companyId: CO, provider: "quickbooks", status: "connected", externalAccountId: "4620816365",
    accessToken: seal("at-1"), refreshToken: seal("rt-1"), expiresAt: new Date(Date.now() + 3600_000), ...over,
  } as never);
}
const row = async () => (await db.select().from(schema.integrations).where(eq(schema.integrations.companyId, CO)))[0]!;

beforeEach(() => {
  calls = [];
  responder = () => json(200, { ok: true });
  refreshResult = async () => ({ accessToken: "at-2", refreshToken: "rt-2", expiresAt: Date.now() + 3600_000, scope: "s" });
});

describe("qboFetch", () => {
  it("addresses the tenant's company with its bearer token and the pinned minor version", async () => {
    await connect();
    await qboFetch(CO, "/vendor/1");
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("https://sandbox-quickbooks.api.intuit.com/v3/company/4620816365/vendor/1?minorversion=75");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer at-1");
  });

  it("refreshes an expiring token first and keeps the rotated refresh token sealed", async () => {
    await connect({ expiresAt: new Date(Date.now() + 10_000) });
    await qboFetch(CO, "/vendor/1");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer at-2");
    const r = await row();
    expect(r.refreshToken.startsWith("enc:v1:")).toBe(true);
    expect(open(r.refreshToken)).toBe("rt-2");
  });

  it("retries once with a fresh token after a 401", async () => {
    await connect();
    let n = 0;
    responder = () => (n++ === 0 ? json(401, { fault: "expired" }) : json(200, { ok: 1 }));
    const out = await qboFetch<{ ok: number }>(CO, "/vendor/1");
    expect(out.ok).toBe(1);
    expect(calls.length).toBe(2);
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe("Bearer at-2");
  });

  it("marks the connection needs_reconnect when the refresh token is revoked", async () => {
    await connect({ expiresAt: new Date(Date.now() - 1) });
    refreshResult = async () => {
      throw new Error("invalid_grant: Token invalid");
    };
    let err: unknown;
    try {
      await qboFetch(CO, "/vendor/1");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(QboError);
    expect((err as InstanceType<typeof QboError>).code).toBe("needs_reconnect");
    expect((err as InstanceType<typeof QboError>).retryable).toBe(false);
    expect((await row()).status).toBe("needs_reconnect");
    expect(calls.length).toBe(0);
  });

  it("says a throttle can be retried", async () => {
    await connect();
    responder = () => json(429, { Fault: { Error: [{ code: "3001", Message: "ThrottleExceeded" }] } }, { intuit_tid: "tid-429" });
    let err: any;
    try {
      await qboFetch(CO, "/vendor/1");
    } catch (e) {
      err = e;
    }
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(429);
    expect(err.tid).toBe("tid-429");
  });

  it("says a validation fault cannot be retried and keeps Intuit's code", async () => {
    await connect();
    responder = () => json(400, { Fault: { Error: [{ code: "6240", Message: "Duplicate Name Exists Error", Detail: "The name supplied already exists." }], type: "ValidationFault" } }, { intuit_tid: "tid-6240" });
    let err: any;
    try {
      await qboFetch(CO, "/vendor", { method: "POST", body: { DisplayName: "X" } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(QboError);
    expect(err.code).toBe("6240");
    expect(err.detail).toContain("already exists");
    expect(err.retryable).toBe(false);
    expect(err.tid).toBe("tid-6240");
  });

  it("throws not_connected when the tenant has no QuickBooks connection", async () => {
    await db.delete(schema.integrations).where(eq(schema.integrations.companyId, CO));
    expect(await loadConnection(CO)).toBeNull();
    let err: any;
    try {
      await qboFetch(CO, "/vendor/1");
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe("not_connected");
  });
});

describe("qboQuery", () => {
  it("sends the query and unwraps the entity list", async () => {
    await connect();
    responder = () => json(200, { QueryResponse: { Vendor: [{ Id: "7", DisplayName: "A" }], maxResults: 1 } });
    const out = await qboQuery<{ Id: string }>(CO, "SELECT * FROM Vendor WHERE DisplayName = 'A'");
    expect(out).toEqual([{ Id: "7", DisplayName: "A" }]);
    expect(new URL(calls[0]!.url).searchParams.get("query")).toBe("SELECT * FROM Vendor WHERE DisplayName = 'A'");
  });

  it("returns an empty list when nothing matches", async () => {
    await connect();
    responder = () => json(200, { QueryResponse: {} });
    expect(await qboQuery(CO, "SELECT * FROM Vendor WHERE DisplayName = 'Nobody'")).toEqual([]);
  });
});
