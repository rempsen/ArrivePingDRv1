/**
 * Which QuickBooks record stands for a technician, a job's customer, or a job
 * template: a saved link wins, then an exact name match, then (vendors and
 * customers) a new record; anything ambiguous becomes an issue instead of a
 * guess. Transport is a stub; no network.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.QUICKBOOKS_ENV = "sandbox";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { ensureTables } = await import("../../test-support/tables");
const { _setQboFetch } = await import("../quickbooks/client");
const { resolveVendor, resolveCustomer, resolveItem, settings, setMapping } = await import("../quickbooks/resolve");

const CO = "qr-co";
type Call = { url: URL; method: string; body: any };
let calls: Call[] = [];
let vendorsByName: Record<string, { Id: string; DisplayName: string }[]> = {};
let customersByName: Record<string, { Id: string; DisplayName: string }[]> = {};
let nextId = 500;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  await ensureTables(schema.companies, schema.integrations, schema.qboLinks, schema.qboIssues);
  await db.insert(schema.companies).values({ id: CO, name: "Resolve Co", kind: "test" } as never);
  await db.insert(schema.integrations).values({
    companyId: CO, provider: "quickbooks", status: "connected", externalAccountId: "r1", accessToken: "at", refreshToken: "rt",
    expiresAt: new Date(Date.now() + 3600_000),
    config: JSON.stringify({ billMode: "subtrade", taxCodeId: "4", defaultItemId: "154", parentCustomerId: "", shadow: false }),
  } as never);
  _setQboFetch((async (url: any, init: any) => {
    const u = new URL(String(url));
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: u, method: init?.method ?? "GET", body });
    const sql = u.searchParams.get("query") ?? "";
    const name = /DisplayName = '((?:[^'\\]|\\.)*)'/.exec(sql)?.[1]?.replace(/\\'/g, "'") ?? "";
    if (sql.startsWith("SELECT * FROM Vendor")) return json({ QueryResponse: { Vendor: vendorsByName[name] ?? [] } });
    if (sql.startsWith("SELECT * FROM Customer")) return json({ QueryResponse: { Customer: customersByName[name] ?? [] } });
    if (u.pathname.endsWith("/vendor") && init?.method === "POST") return json({ Vendor: { Id: String(nextId++), SyncToken: "0", ...body } });
    if (u.pathname.endsWith("/customer") && init?.method === "POST") return json({ Customer: { Id: String(nextId++), SyncToken: "0", ...body } });
    return json({ Fault: { Error: [{ code: "999", Message: `unexpected ${u.pathname}` }] } }, 400);
  }) as typeof fetch);
});
afterAll(() => _setQboFetch(null));

beforeEach(async () => {
  calls = [];
  vendorsByName = {};
  customersByName = {};
  await db.delete(schema.qboLinks).where(eq(schema.qboLinks.companyId, CO));
  await db.delete(schema.qboIssues).where(eq(schema.qboIssues.companyId, CO));
});

const links = (kind: string) => db.select().from(schema.qboLinks).where(and(eq(schema.qboLinks.companyId, CO), eq(schema.qboLinks.kind, kind)));
const issues = () => db.select().from(schema.qboIssues).where(eq(schema.qboIssues.companyId, CO));

describe("resolveVendor", () => {
  const rider = { id: "rider-1", userId: "u-1", name: "B. Froese Service & Installation", email: "b@froese.test" };

  it("links an existing vendor with the same display name", async () => {
    vendorsByName[rider.name] = [{ Id: "227", DisplayName: rider.name }];
    expect(await resolveVendor(CO, rider)).toEqual({ qboId: "227" });
    const [l] = await links("vendor");
    expect(l!.localId).toBe("rider-1");
    expect(l!.qboId).toBe("227");
  });

  it("creates the vendor when none matches, with the technician's email", async () => {
    const out = await resolveVendor(CO, { ...rider, name: "New Sub Ltd" });
    expect(out).toEqual({ qboId: "500" });
    const create = calls.find((c) => c.method === "POST");
    expect(create!.body.DisplayName).toBe("New Sub Ltd");
    expect(create!.body.PrimaryEmailAddr.Address).toBe("b@froese.test");
  });

  it("uses the saved link without asking QuickBooks", async () => {
    await setMapping(CO, "vendor", "rider-1", "88");
    expect(await resolveVendor(CO, rider)).toEqual({ qboId: "88" });
    expect(calls.length).toBe(0);
  });

  it("raises an issue instead of guessing between two matching vendors", async () => {
    vendorsByName["Twin"] = [{ Id: "1", DisplayName: "Twin" }, { Id: "2", DisplayName: "Twin" }];
    const out = await resolveVendor(CO, { ...rider, name: "Twin" });
    expect("issue" in out && out.issue).toBe("vendor_ambiguous");
    const [i] = await issues();
    expect(i!.kind).toBe("vendor_ambiguous");
    expect(await links("vendor")).toEqual([]);
  });

  it("escapes a quote in the name", async () => {
    vendorsByName["O'Brien Electric"] = [{ Id: "9", DisplayName: "O'Brien Electric" }];
    expect(await resolveVendor(CO, { ...rider, name: "O'Brien Electric" })).toEqual({ qboId: "9" });
    expect(calls[0]!.url.searchParams.get("query")).toContain("O\\'Brien Electric");
  });
});

describe("resolveCustomer", () => {
  const job = { customerId: "cust-1", customerName: "Allard Condos", address: "1055 Allard Ave, Winnipeg, MB" };

  it("links an existing customer by exact display name", async () => {
    customersByName["Allard Condos"] = [{ Id: "364", DisplayName: "Allard Condos" }];
    expect(await resolveCustomer(CO, job)).toEqual({ qboId: "364" });
  });

  it("finds a customer it created earlier under the name-plus-address it was given (I8)", async () => {
    customersByName["Allard Condos - 1055 Allard Ave, Winnipeg, MB"] = [{ Id: "365", DisplayName: "Allard Condos - 1055 Allard Ave, Winnipeg, MB" }];
    expect(await resolveCustomer(CO, job)).toEqual({ qboId: "365" });
    expect(calls.filter((c) => c.method === "POST").length).toBe(0);
  });

  it("in shadow mode reports what it would create and creates nothing (C2)", async () => {
    const out = await resolveCustomer(CO, { ...job, customerId: "cust-shadow" }, { shadow: true });
    expect(out).toEqual({ qboId: "shadow", shadow: true });
    expect(calls.filter((c) => c.method === "POST").length).toBe(0);
    const [i] = await issues();
    expect(i!.kind).toBe("shadow");
    expect(i!.message).toContain('customer "Allard Condos - 1055 Allard Ave, Winnipeg, MB"');
    expect(await db.select().from(schema.qboLinks).where(and(eq(schema.qboLinks.kind, "customer"), eq(schema.qboLinks.localId, "cust-shadow")))).toEqual([]);
  });

  it("creates a customer named after the job and its address when none matches", async () => {
    const out = await resolveCustomer(CO, job);
    expect("qboId" in out).toBe(true);
    const create = calls.find((c) => c.method === "POST")!;
    expect(create.body.DisplayName).toBe("Allard Condos - 1055 Allard Ave, Winnipeg, MB");
    expect(create.body.ParentRef).toBeUndefined();
    const [i] = await issues();
    expect(i!.kind).toBe("customer_created");
    expect(i!.status).toBe("resolved");
  });

  it("files a new customer under the tenant's parent customer when one is set", async () => {
    await db.update(schema.integrations).set({ config: JSON.stringify({ billMode: "arriveping", taxCodeId: "4", defaultItemId: "154", parentCustomerId: "77", shadow: false }) }).where(eq(schema.integrations.companyId, CO));
    await resolveCustomer(CO, { ...job, customerId: "cust-2", customerName: "Nobody Yet" });
    const create = calls.find((c) => c.method === "POST")!;
    expect(create.body.ParentRef).toEqual({ value: "77" });
    expect(create.body.Job).toBe(true);
  });
});

describe("resolveItem", () => {
  it("uses the mapped item for a template and the default otherwise", async () => {
    await setMapping(CO, "item", "tpl-1", "103");
    expect(await resolveItem(CO, "tpl-1")).toEqual({ qboId: "103" });
    expect(await resolveItem(CO, "tpl-unmapped")).toEqual({ qboId: "154" });
    expect(await resolveItem(CO, null)).toEqual({ qboId: "154" });
  });

  it("raises an issue when there is neither a mapping nor a default", async () => {
    await db.update(schema.integrations).set({ config: JSON.stringify({ billMode: "arriveping", taxCodeId: "4", defaultItemId: "", parentCustomerId: "", shadow: false }) }).where(eq(schema.integrations.companyId, CO));
    const out = await resolveItem(CO, "tpl-x");
    expect("issue" in out && out.issue).toBe("item_unmapped");
  });
});

describe("settings", () => {
  it("fills defaults for anything the tenant has not set", async () => {
    await db.update(schema.integrations).set({ config: "{}" }).where(eq(schema.integrations.companyId, CO));
    expect(await settings(CO)).toEqual({ billMode: "arriveping", taxCodeId: "", defaultItemId: "", parentCustomerId: "", shadow: true });
  });
});
