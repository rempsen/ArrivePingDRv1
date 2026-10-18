import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { checkHubspot, REQUIRED_SCOPES } = await import("../hubspot-check");
const { _setHubspotFetch } = await import("../hubspot-sync");

let tokenInfo: { status: number; body: any };
let forbidden = new Set<string>();
let ownerStatus = 200;
let stages = [
  { id: "1", label: "New" },
  { id: "4", label: "Closed" },
];
let calls: { method: string; path: string; body: any }[] = [];

function stub(url: string, init?: RequestInit): Promise<Response> {
  const path = url.replace("https://api.hubapi.com", "");
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, path, body });
  const json = (status: number, data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { status }));
  if (path === "/oauth/v2/private-apps/get/access-token-info") return json(tokenInfo.status, tokenInfo.body);
  const o = /^\/crm\/v3\/objects\/(\w+)\?/.exec(path);
  if (o) return forbidden.has(o[1]!) ? json(403, { message: "This app hasn't been granted all required scopes" }) : json(200, { results: [] });
  if (path.startsWith("/crm/v3/owners/")) return ownerStatus === 200 ? json(200, { firstName: "Dan", lastName: "R", archived: false }) : json(ownerStatus, { message: "not found" });
  if (path.startsWith("/crm/v3/pipelines/tickets/")) return json(200, { label: "Support Pipeline", stages });
  if (path.startsWith("/crm/v3/properties/contacts/")) return json(200, { name: "arriveping_lead_source" });
  return json(404, { message: "unhandled" });
}

beforeAll(() => _setHubspotFetch(stub as unknown as typeof fetch));
afterAll(() => _setHubspotFetch(null));
beforeEach(() => {
  calls = [];
  forbidden = new Set();
  ownerStatus = 200;
  stages = [
    { id: "1", label: "New" },
    { id: "4", label: "Closed" },
  ];
  tokenInfo = { status: 200, body: { hubId: 342390247, appId: 99, userId: 1, scopes: REQUIRED_SCOPES.map((s) => s.scope) } };
  process.env.HUBSPOT_ACCESS_TOKEN = "pat-na1-secret";
  process.env.HUBSPOT_OWNER_ID = "83114636";
  delete process.env.HUBSPOT_PORTAL_ID;
  delete process.env.HUBSPOT_TICKET_PIPELINE;
  delete process.env.HUBSPOT_TICKET_STAGE;
});

describe("checkHubspot", () => {
  it("passes a correct key and never echoes the token", async () => {
    const r = await checkHubspot();
    expect(r.ok).toBe(true);
    expect(r.portal).toEqual({ tokenHubId: "342390247", expected: "342390247", matches: true });
    expect(r.scopes!.missing).toEqual([]);
    expect(r.nextSteps).toEqual([]);
    expect(r.checks.find((c) => c.name === "Ticket pipeline")!.detail).toBe('New tickets go to "Support Pipeline" → "New".');
    expect(JSON.stringify(r)).not.toContain("pat-na1-secret");
    expect(calls.every((c) => c.method === "GET" || c.path.startsWith("/oauth/"))).toBe(true);
  });

  it("flags a key from another HubSpot account", async () => {
    tokenInfo.body.hubId = 111;
    const r = await checkHubspot();
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === "Portal")!.status).toBe("fail");
    expect(r.nextSteps.join(" ")).toContain("342390247");
  });

  it("lists missing scopes and the objects they block", async () => {
    tokenInfo.body.scopes = REQUIRED_SCOPES.map((s) => s.scope).filter((s) => s !== "tickets");
    forbidden.add("tickets");
    const r = await checkHubspot();
    expect(r.ok).toBe(false);
    expect(r.scopes!.missing).toEqual(["tickets"]);
    expect(r.checks.find((c) => c.name === "Tickets")!.status).toBe("fail");
  });

  it("reports a rejected key", async () => {
    tokenInfo = { status: 401, body: { message: "expired" } };
    const r = await checkHubspot();
    expect(r.checks.find((c) => c.name === "Token")!.status).toBe("fail");
    expect(r.ok).toBe(false);
  });

  it("catches a bad owner id and a missing ticket stage", async () => {
    ownerStatus = 404;
    process.env.HUBSPOT_TICKET_STAGE = "9";
    const r = await checkHubspot();
    expect(r.checks.find((c) => c.name === "Owner")!.status).toBe("fail");
    expect(r.checks.find((c) => c.name === "Ticket pipeline")!.status).toBe("fail");
    expect(r.nextSteps.join(" ")).toContain("1 (New)");
  });

  it("says so when no token is configured", async () => {
    delete process.env.HUBSPOT_ACCESS_TOKEN;
    const r = await checkHubspot();
    expect(r).toMatchObject({ configured: false, ok: false });
    expect(calls).toHaveLength(0);
  });
});
