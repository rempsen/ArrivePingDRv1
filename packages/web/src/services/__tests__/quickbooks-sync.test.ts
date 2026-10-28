/**
 * Outbound QuickBooks Sync: an assigned job becomes one purchase order, a
 * completed job one bill linked to it (unless the tenant's subtrades invoice
 * themselves), nothing is ever created twice, and QuickBooks being down or
 * refusing never touches the job. Transport is a stub; notifications are off.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { and, eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.QUICKBOOKS_ENV = "sandbox";
process.env.RESEND_API_KEY = "";
process.env.TWILIO_ACCOUNT_SID = "";
process.env.TWILIO_AUTH_TOKEN = "";

const realDispatch = { ...(await import("../dispatch")) };
const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { PgTable } = await import("drizzle-orm/pg-core");
const { ensureTables } = await import("../../test-support/tables");
const { _setQboFetch } = await import("../quickbooks/client");
const { enqueueQboSync, syncBookingNow, isQboActive } = await import("../quickbooks/sync");
const { runDueTasks } = await import("../scheduler");
const { fireEvent } = await import("../dispatch");
const features = await import("../features");
const { setMapping } = await import("../quickbooks/resolve");

const CO = "qsy-co";
type Call = { url: URL; method: string; body: any };
let calls: Call[] = [];
let pos: Record<string, any> = {};
let bills: Record<string, any> = {};
let failNext: { status: number; body: unknown } | null = null;
let nextId = 800;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", intuit_tid: "t" } });

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTables(v);
  await db.insert(schema.companies).values({ id: CO, name: "Sync Co", kind: "test" } as never);
  await db.insert(schema.user).values([
    { id: "qsy-tech", name: "B. Froese Service & Installation", email: "b@froese.test", role: "rider", companyId: CO },
    { id: "qsy-cust", name: "Allard Condos", email: "c@allard.test", role: "customer", companyId: CO },
  ] as never);
  await db.insert(schema.riders).values({ id: "qsy-rider", userId: "qsy-tech", companyId: CO } as never);
  await db.insert(schema.services).values({ id: "qsy-svc", name: "Flooring", category: "flooring", basePrice: 0, companyId: CO } as never);
  await db.insert(schema.integrations).values({
    companyId: CO, provider: "quickbooks", status: "connected", externalAccountId: "r1", accessToken: "at", refreshToken: "rt",
    expiresAt: new Date(Date.now() + 3600_000),
    config: JSON.stringify({ billMode: "arriveping", taxCodeId: "4", defaultItemId: "154", parentCustomerId: "", shadow: false }),
  } as never);
  await setMapping(CO, "vendor", "qsy-rider", "227");
  await setMapping(CO, "customer", "qsy-cust", "364");
  await features.setFeatureOverride({ companyId: CO, key: "integrations.quickbooks", enabled: true, actor: { id: "t", name: "T" } });

  _setQboFetch((async (url: any, init: any) => {
    const u = new URL(String(url));
    const body = init?.body ? JSON.parse(init.body) : undefined;
    const method = init?.method ?? "GET";
    calls.push({ url: u, method, body });
    if (failNext) {
      const f = failNext;
      failNext = null;
      return json(f.body, f.status);
    }
    const sql = u.searchParams.get("query") ?? "";
    if (sql.startsWith("SELECT * FROM PurchaseOrder")) {
      const doc = /DocNumber = '([^']+)'/.exec(sql)?.[1];
      return json({ QueryResponse: { PurchaseOrder: Object.values(pos).filter((p) => p.DocNumber === doc) } });
    }
    if (sql.startsWith("SELECT * FROM Bill")) {
      const doc = /DocNumber = '([^']+)'/.exec(sql)?.[1];
      return json({ QueryResponse: { Bill: Object.values(bills).filter((b) => b.DocNumber === doc) } });
    }
    if (u.pathname.endsWith("/purchaseorder") && u.searchParams.get("operation") === "delete") {
      delete pos[body.Id];
      return json({ PurchaseOrder: { Id: body.Id, status: "Deleted" } });
    }
    if (u.pathname.endsWith("/purchaseorder") && method === "POST") {
      const po = { Id: String(nextId++), SyncToken: "0", POStatus: "Open", TotalAmt: body.Line.reduce((s: number, l: any) => s + l.Amount, 0), ...body };
      pos[po.Id] = po;
      return json({ PurchaseOrder: po });
    }
    if (u.pathname.endsWith("/bill") && method === "POST") {
      const bill = { Id: String(nextId++), SyncToken: "0", Balance: body.Line.reduce((s: number, l: any) => s + l.Amount, 0), TotalAmt: body.Line.reduce((s: number, l: any) => s + l.Amount, 0), ...body };
      bills[bill.Id] = bill;
      return json({ Bill: bill });
    }
    if (u.pathname.match(/\/purchaseorder\/\d+$/) && method === "GET") return json({ PurchaseOrder: pos[u.pathname.split("/").pop()!] });
    return json({ Fault: { Error: [{ code: "999", Message: `unexpected ${method} ${u.pathname}` }] } }, 400);
  }) as typeof fetch);
});
afterAll(() => {
  _setQboFetch(null);
  mock.module("../dispatch", () => realDispatch);
});

beforeEach(async () => {
  calls = [];
  pos = {};
  bills = {};
  failNext = null;
  nextId = 800;
  await db.delete(schema.scheduledTasks);
  await db.delete(schema.qboIssues);
  await db.update(schema.integrations).set({ status: "connected", config: JSON.stringify({ billMode: "arriveping", taxCodeId: "4", defaultItemId: "154", parentCustomerId: "", shadow: false }) }).where(eq(schema.integrations.companyId, CO));
  await features.setFeatureOverride({ companyId: CO, key: "integrations.quickbooks", enabled: true, actor: { id: "t", name: "T" } });
});

async function job(over: Record<string, unknown> = {}) {
  const [b] = await db
    .insert(schema.bookings)
    .values({
      companyId: CO, customerId: "qsy-cust", serviceId: "qsy-svc", riderId: "qsy-rider", status: "assigned", assignStatus: "accepted",
      scheduledAt: new Date(), address: "1055 Allard Ave, Winnipeg, MB", techPay: 750, finishedAt: new Date("2026-10-28T20:00:00Z"),
      techPayBreakdown: JSON.stringify({ hourlyPay: 0, unitPay: 750, mileagePay: 0, flatPay: 0, techPay: 750, onSiteMinutes: 0 }),
      lineItems: JSON.stringify([{ itemId: "cat-1", kind: "unit", name: "Floor tile install", sku: "", unit: "sq ft", qty: 300, unitCost: 2.5, unitPrice: 4, taxable: false, cost: 750, price: 1200 }]),
      ...over,
    } as never)
    .returning();
  return b!;
}
const booking = async (id: string) => (await db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0]!;
const tasks = (bookingId: string) => db.select().from(schema.scheduledTasks).where(eq(schema.scheduledTasks.bookingId, bookingId));
const issues = () => db.select().from(schema.qboIssues).where(eq(schema.qboIssues.companyId, CO));
const link = (kind: string, localId: string) => db.select().from(schema.qboLinks).where(and(eq(schema.qboLinks.companyId, CO), eq(schema.qboLinks.kind, kind), eq(schema.qboLinks.localId, localId)));
// run everything queued, however far in the future it was scheduled
const drain = async () => {
  for (let i = 0; i < 5; i++) await runDueTasks(new Date(Date.now() + 365 * 86400_000));
};

describe("purchase order on assignment", () => {
  it("creates one PO to the technician's vendor, costed to the customer with the GST code", async () => {
    const b = await job();
    await fireEvent("assigned", b.id);
    expect((await tasks(b.id)).map((t) => t.kind)).toEqual(["qbo.po.create"]);
    await drain();
    const creates = calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/purchaseorder"));
    expect(creates.length).toBe(1);
    const po = creates[0]!.body;
    expect(po.VendorRef).toEqual({ value: "227" });
    expect(po.DocNumber).toBe("AP-" + b.id.slice(0, 8).toUpperCase());
    expect(po.Line[0].ItemBasedExpenseLineDetail.CustomerRef).toEqual({ value: "364" });
    expect(po.Line[0].ItemBasedExpenseLineDetail.TaxCodeRef).toEqual({ value: "4" });
    expect(po.Line[0].Amount).toBe(750);
    expect((await booking(b.id)).vendorBillStatus).toBe("po_open");
    expect((await link("purchase_order", b.id))[0]!.qboId).toBe("800");
  });

  it("enqueues once per job and kind however many times the event fires", async () => {
    const b = await job();
    await Promise.all([fireEvent("assigned", b.id), fireEvent("accepted", b.id), enqueueQboSync(CO, b.id, "po.create")]);
    expect((await tasks(b.id)).filter((t) => t.kind === "qbo.po.create").length).toBe(1);
  });

  it("adopts a PO that already exists for the job instead of creating a second", async () => {
    const b = await job();
    const doc = "AP-" + b.id.slice(0, 8).toUpperCase();
    pos["700"] = { Id: "700", SyncToken: "2", DocNumber: doc, POStatus: "Open", VendorRef: { value: "227" }, Line: [] };
    await syncBookingNow(CO, b.id);
    expect(calls.filter((c) => c.method === "POST").length).toBe(0);
    expect((await link("purchase_order", b.id))[0]!.qboId).toBe("700");
  });

  it("never syncs a sample job", async () => {
    const b = await job({ isSample: true });
    await fireEvent("assigned", b.id);
    expect(await tasks(b.id)).toEqual([]);
  });

  it("does nothing when the switch is off", async () => {
    await features.setFeatureOverride({ companyId: CO, key: "integrations.quickbooks", enabled: false, actor: { id: "t", name: "T" } });
    expect(await isQboActive(CO)).toBe(false);
    const b = await job();
    await fireEvent("assigned", b.id);
    expect(await tasks(b.id)).toEqual([]);
  });

  it("drops queued work if the switch is turned off before it runs", async () => {
    const b = await job();
    await fireEvent("assigned", b.id);
    await features.setFeatureOverride({ companyId: CO, key: "integrations.quickbooks", enabled: false, actor: { id: "t", name: "T" } });
    await drain();
    expect(calls.length).toBe(0);
    expect((await booking(b.id)).vendorBillStatus).toBe("none");
  });

  it("records what it would have sent in shadow mode and writes nothing", async () => {
    await db.update(schema.integrations).set({ config: JSON.stringify({ billMode: "arriveping", taxCodeId: "4", defaultItemId: "154", parentCustomerId: "", shadow: true }) }).where(eq(schema.integrations.companyId, CO));
    const b = await job();
    await fireEvent("assigned", b.id);
    await drain();
    expect(calls.filter((c) => c.method === "POST").length).toBe(0);
    const [i] = await issues();
    expect(i!.kind).toBe("shadow");
    expect(JSON.parse(i!.detail).payload.DocNumber).toBe("AP-" + b.id.slice(0, 8).toUpperCase());
    expect((await booking(b.id)).vendorBillStatus).toBe("none");
  });
});

describe("bill on completion", () => {
  it("creates a bill linked to the job's PO and marks the job billed", async () => {
    const b = await job();
    await fireEvent("assigned", b.id);
    await drain();
    await fireEvent("completed", b.id);
    expect((await tasks(b.id)).map((t) => t.kind)).toContain("qbo.bill.create");
    await drain();
    const create = calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/bill"))!;
    expect(create.body.LinkedTxn).toEqual([{ TxnId: "800", TxnType: "PurchaseOrder" }]);
    expect(create.body.TxnDate).toBe("2026-10-28");
    expect(create.body.DueDate).toBe("2026-11-27");
    expect((await booking(b.id)).vendorBillStatus).toBe("billed");
    expect((await link("bill", b.id))[0]!.qboId).toBe("801");
    const [ev] = await db.select().from(schema.jobEvents).where(and(eq(schema.jobEvents.bookingId, b.id), eq(schema.jobEvents.kind, "accounting")));
    expect(ev!.label).toContain("AP-");
  });

  it("creates the PO first when the job was never assigned through the sync", async () => {
    const b = await job();
    await fireEvent("completed", b.id);
    await drain();
    expect(calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/purchaseorder")).length).toBe(1);
    expect(calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/bill")).length).toBe(1);
  });

  it("writes no bill when the tenant's subtrades invoice themselves", async () => {
    await db.update(schema.integrations).set({ config: JSON.stringify({ billMode: "subtrade", taxCodeId: "4", defaultItemId: "154", parentCustomerId: "", shadow: false }) }).where(eq(schema.integrations.companyId, CO));
    const b = await job();
    await fireEvent("assigned", b.id);
    await drain();
    await fireEvent("completed", b.id);
    await drain();
    expect(calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/bill")).length).toBe(0);
    expect((await booking(b.id)).vendorBillStatus).toBe("po_open");
  });
});

describe("when QuickBooks misbehaves", () => {
  it("the job's status change still succeeds and the write is retried later", async () => {
    const b = await job();
    failNext = { status: 503, body: { Fault: { Error: [{ code: "5000", Message: "down" }] } } };
    await fireEvent("assigned", b.id);
    await runDueTasks(new Date(Date.now() + 60_000));
    const pending = (await tasks(b.id)).filter((t) => t.status === "pending");
    expect(pending.length).toBe(1);
    expect(JSON.parse(pending[0]!.payload).attempt).toBe(1);
    expect((await booking(b.id)).vendorBillStatus).toBe("none");
    await drain();
    expect((await booking(b.id)).vendorBillStatus).toBe("po_open");
  });

  it("a validation fault raises an issue and stops retrying", async () => {
    const b = await job();
    failNext = { status: 400, body: { Fault: { Error: [{ code: "6190", Message: "Period closed", Detail: "The period is locked." }], type: "ValidationFault" } } };
    await fireEvent("assigned", b.id);
    await drain();
    const [i] = await issues();
    expect(i!.kind).toBe("sync_failed");
    expect(i!.message).toContain("locked");
    expect((await booking(b.id)).vendorBillStatus).toBe("error");
    expect((await tasks(b.id)).filter((t) => t.status === "pending")).toEqual([]);
  });
});

describe("cancellation", () => {
  it("deletes an open, un-billed PO", async () => {
    const b = await job();
    await fireEvent("assigned", b.id);
    await drain();
    await fireEvent("cancelled", b.id);
    await drain();
    expect(calls.some((c) => c.url.searchParams.get("operation") === "delete" && c.body.Id === "800")).toBe(true);
    expect((await booking(b.id)).vendorBillStatus).toBe("none");
    expect(await link("purchase_order", b.id)).toEqual([]);
  });

  it("asks a person when the PO already has a bill", async () => {
    const b = await job();
    await fireEvent("assigned", b.id);
    await drain();
    await fireEvent("completed", b.id);
    await drain();
    await fireEvent("cancelled", b.id);
    await drain();
    expect(calls.some((c) => c.url.searchParams.get("operation") === "delete")).toBe(false);
    expect((await issues()).some((i) => i.kind === "po_cancel_review")).toBe(true);
  });
});
