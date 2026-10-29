/**
 * The tenant's QuickBooks settings: an admin can read status, choose the bill
 * mode and shadow mode, map technicians and templates, and resolve issues; a
 * technician can't change any of it. QuickBooks itself is a stub.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.QUICKBOOKS_ENV = "sandbox";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { PgTable } = await import("drizzle-orm/pg-core");
const { ensureTables } = await import("../../../test-support/tables");
const { _setQboFetch } = await import("../../../services/quickbooks/client");
const { quickbooksRoutes } = await import("../quickbooks");

const CO = "qa-co";
const ADMIN = "qa-admin";
const TECH = "qa-tech";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", CO);
  c.set("requestId", "qa-req");
  const uid = c.req.header("X-Test-User") ?? ADMIN;
  c.set("user", { id: uid, role: uid === ADMIN ? "admin" : "rider", email: `${uid}@t.test`, name: uid === ADMIN ? "Office" : "Tech" } as never);
  return next();
});
app.route("/api/integrations/quickbooks", quickbooksRoutes);
// the real server maps AppError (validation, forbidden…) to its status
app.onError((err, c) => c.json({ error: err.message }, ((err as { status?: number }).status ?? 500) as never));
const call = (path: string, init: RequestInit = {}, user = ADMIN) =>
  app.request(`/api/integrations/quickbooks${path}`, { ...init, headers: { "content-type": "application/json", "X-Test-User": user, ...init.headers } });

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTables(v);
  await db.insert(schema.companies).values({ id: CO, name: "Admin Co", kind: "test" } as never);
  await db.insert(schema.user).values([
    { id: ADMIN, name: "Office", email: "office@qa.test", role: "admin", companyId: CO },
    { id: TECH, name: "Tech Tom", email: "tom@qa.test", role: "rider", companyId: CO },
  ] as never);
  await db.insert(schema.riders).values({ id: "qa-rider", userId: TECH, companyId: CO } as never);
  await db.insert(schema.taskTemplates).values({ id: "qa-tpl", companyId: CO, name: "Site visit" } as never);
  await db.insert(schema.integrations).values({
    companyId: CO, provider: "quickbooks", status: "connected", accountLabel: "Admin Co Sandbox", externalAccountId: "r9", accessToken: "at", refreshToken: "rt",
    expiresAt: new Date(Date.now() + 3600_000), config: "{}",
  } as never);
  await db.insert(schema.qboIssues).values({ companyId: CO, kind: "vendor_ambiguous", message: "Two vendors" } as never);
  _setQboFetch((async (url: any) => {
    const u = new URL(String(url));
    const sql = u.searchParams.get("query") ?? "";
    if (sql.startsWith("SELECT * FROM TaxCode")) return json({ QueryResponse: { TaxCode: [{ Id: "4", Name: "GST", Active: true }, { Id: "5", Name: "GST/PST MB", Active: true }] } });
    if (/FROM Item\b/.test(sql)) return json({ QueryResponse: { Item: [{ Id: "154", Name: "01-26 - Install Flooring", Type: "Service", Active: true }] } });
    if (sql.startsWith("SELECT * FROM Customer")) return json({ QueryResponse: { Customer: [{ Id: "77", DisplayName: "ArrivePing jobs", Active: true }] } });
    if (/FROM Vendor\b/.test(sql)) return json({ QueryResponse: { Vendor: [{ Id: "227", DisplayName: "B. Froese", Active: true }] } });
    return json({ Fault: { Error: [{ code: "999", Message: `unexpected ${sql || u.pathname}` }] } }, 400);
  }) as typeof fetch);
});
afterAll(() => _setQboFetch(null));

describe("status and settings", () => {
  it("shows the connection and the defaults", async () => {
    const r = await call("/status");
    expect(r.status).toBe(200);
    const s = (await r.json()) as any;
    expect(s.connected).toBe(true);
    expect(s.companyName).toBe("Admin Co Sandbox");
    expect(s.billMode).toBe("arriveping");
    expect(s.shadow).toBe(true);
    expect(s.openIssues).toBe(1);
  });

  it("lets an admin change the bill mode, shadow mode and tax code, keeping the rest", async () => {
    let r = await call("/settings", { method: "PUT", body: JSON.stringify({ billMode: "subtrade", taxCodeId: "4" }) });
    expect(r.status).toBe(200);
    r = await call("/settings", { method: "PUT", body: JSON.stringify({ shadow: false }) });
    expect(r.status).toBe(200);
    const s = (await (await call("/status")).json()) as any;
    expect(s.billMode).toBe("subtrade");
    expect(s.taxCodeId).toBe("4");
    expect(s.shadow).toBe(false);
  });

  it("lets an admin move the date the sync starts from, and reports it", async () => {
    expect((await call("/settings", { method: "PUT", body: JSON.stringify({ syncSince: "2026-11-01" }) })).status).toBe(200);
    expect(((await (await call("/status")).json()) as any).syncSince).toBe("2026-11-01");
    expect((await call("/settings", { method: "PUT", body: JSON.stringify({ syncSince: "next tuesday" }) })).status).toBe(400);
  });

  it("rejects a bill mode it doesn't know", async () => {
    expect((await call("/settings", { method: "PUT", body: JSON.stringify({ billMode: "someone_else" }) })).status).toBe(400);
  });

  it("stops a technician changing settings", async () => {
    expect((await call("/settings", { method: "PUT", body: JSON.stringify({ shadow: true }) }, TECH)).status).toBe(403);
  });
});

describe("options and mappings", () => {
  it("lists the tenant's tax codes, items and customers from QuickBooks", async () => {
    const o = (await (await call("/options")).json()) as any;
    expect(o.taxCodes.map((t: any) => t.name)).toEqual(["GST", "GST/PST MB"]);
    expect(o.items[0].id).toBe("154");
    expect(o.customers[0].name).toBe("ArrivePing jobs");
    expect(o.vendors[0].name).toBe("B. Froese");
  });

  it("maps a technician to a vendor and a template to an item", async () => {
    expect((await call("/mappings", { method: "PUT", body: JSON.stringify({ kind: "vendor", localId: "qa-rider", qboId: "227" }) })).status).toBe(200);
    expect((await call("/mappings", { method: "PUT", body: JSON.stringify({ kind: "item", localId: "qa-tpl", qboId: "154" }) })).status).toBe(200);
    const m = (await (await call("/mappings")).json()) as any;
    expect(m.technicians).toEqual([{ riderId: "qa-rider", name: "Tech Tom", qboId: "227", qboName: "B. Froese" }]);
    expect(m.templates).toEqual([{ templateId: "qa-tpl", name: "Site visit", qboId: "154", qboName: "01-26 - Install Flooring" }]);
  });

  it("refuses a mapping kind it doesn't manage", async () => {
    expect((await call("/mappings", { method: "PUT", body: JSON.stringify({ kind: "bill", localId: "x", qboId: "1" }) })).status).toBe(400);
  });
});

describe("issues", () => {
  it("lists open issues and resolves one", async () => {
    const list = (await (await call("/issues")).json()) as any;
    expect(list.issues.length).toBe(1);
    expect(list.issues[0].resolved).toBe(false);
    const r = await call(`/issues/${list.issues[0].id}/resolve`, { method: "POST" });
    expect(r.status).toBe(200);
    const [row] = await db.select().from(schema.qboIssues).where(and(eq(schema.qboIssues.companyId, CO), eq(schema.qboIssues.id, list.issues[0].id)));
    expect(row!.status).toBe("resolved");
    expect(((await (await call("/issues")).json()) as any).issues.filter((i: any) => !i.resolved).length).toBe(0);
  });

  it("also shows recent resolved notes the sync left for the bookkeeper", async () => {
    const { raiseIssue } = await import("../../../services/quickbooks/resolve");
    await raiseIssue(CO, "name_in_use", 'QuickBooks already uses the name "Dan Rosenblat"…', { resolved: true });
    await raiseIssue(CO, "shadow", "Shadow mode: would create purchase order AP-1.", { resolved: true });
    await db.update(schema.qboIssues).set({ resolvedAt: new Date(Date.now() - 10 * 86400_000) }).where(and(eq(schema.qboIssues.companyId, CO), eq(schema.qboIssues.kind, "shadow")));
    const list = (await (await call("/issues")).json()) as any;
    const notes = list.issues.filter((i: any) => i.resolved);
    const kinds = notes.map((i: any) => i.kind);
    expect(kinds).toContain("name_in_use");
    expect(kinds).not.toContain("shadow"); // the 10-day-old shadow note has aged out
  });
});
