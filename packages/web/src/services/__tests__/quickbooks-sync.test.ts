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
let onPoCreate: ((po: any) => Promise<void>) | null = null;
let nextId = 800;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", intuit_tid: "t" } });

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTables(v);
  await db.insert(schema.companies).values({ id: CO, name: "Sync Co", kind: "test" } as never);
  await db.insert(schema.user).values([
    { id: "qsy-tech", name: "B. Froese Service & Installation", email: "b@froese.test", role: "rider", companyId: CO },
    { id: "qsy-cust", name: "Allard Condos", email: "c@allard.test", role: "customer", companyId: CO },
    { id: "qsy-tech2", name: "Second Tech", email: "s@froese.test", role: "rider", companyId: CO },
    { id: "qsy-tech3", name: "Unmapped Tech", email: "u@froese.test", role: "rider", companyId: CO },
    { id: "qsy-cust2", name: "New Customer", email: "n@allard.test", role: "customer", companyId: CO },
  ] as never);
  await db.insert(schema.riders).values([
    { id: "qsy-rider", userId: "qsy-tech", companyId: CO },
    { id: "qsy-rider2", userId: "qsy-tech2", companyId: CO },
    { id: "qsy-rider3", userId: "qsy-tech3", companyId: CO, payRatePerHour: 60 },
  ] as never);
  await db.insert(schema.services).values({ id: "qsy-svc", name: "Flooring", category: "flooring", basePrice: 0, companyId: CO } as never);
  await db.insert(schema.integrations).values({
    companyId: CO, provider: "quickbooks", status: "connected", externalAccountId: "r1", accessToken: "at", refreshToken: "rt",
    expiresAt: new Date(Date.now() + 3600_000),
    config: JSON.stringify({ billMode: "arriveping", taxCodeId: "4", defaultItemId: "154", parentCustomerId: "", shadow: false }),
  } as never);
  await setMapping(CO, "vendor", "qsy-rider", "227");
  await setMapping(CO, "vendor", "qsy-rider2", "228");
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
    if (sql.startsWith("SELECT * FROM Vendor") || sql.startsWith("SELECT * FROM Customer")) return json({ QueryResponse: {} });
    if (u.pathname.endsWith("/purchaseorder") && method === "POST" && body.sparse) {
      pos[body.Id] = { ...pos[body.Id], ...body, SyncToken: String(Number(pos[body.Id].SyncToken) + 1) };
      return json({ PurchaseOrder: pos[body.Id] });
    }
    if (u.pathname.endsWith("/purchaseorder") && method === "POST") {
      const po = { Id: String(nextId++), SyncToken: "0", POStatus: "Open", TotalAmt: body.Line.reduce((s: number, l: any) => s + l.Amount, 0), ...body, Line: body.Line.map((l: any, i: number) => ({ ...l, Id: String(i + 1) })) };
      pos[po.Id] = po;
      if (onPoCreate) await onPoCreate(po);
      return json({ PurchaseOrder: po });
    }
    if (u.pathname.match(/\/bill\/\d+$/) && method === "GET") return json({ Bill: bills[u.pathname.split("/").pop()!] });
    if (u.pathname.endsWith("/bill") && method === "POST") {
      const bill = { Id: String(nextId++), SyncToken: "0", Balance: body.Line.reduce((s: number, l: any) => s + l.Amount, 0), TotalAmt: body.Line.reduce((s: number, l: any) => s + l.Amount, 0), ...body };
      bills[bill.Id] = bill;
      // Intuit closes a PO once every one of its lines is linked from a bill
      for (const l of body.LinkedTxn ?? []) {
        const po = pos[l.TxnId];
        if (!po) continue;
        po.LinkedTxn = [...(po.LinkedTxn ?? []), { TxnId: bill.Id, TxnType: "Bill" }];
        const linked = new Set(body.Line.flatMap((x: any) => (x.LinkedTxn ?? []).map((t: any) => t.TxnLineId)));
        if (po.Line.every((x: any) => linked.has(x.Id))) po.POStatus = "Closed";
      }
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
  onPoCreate = null;
  nextId = 800;
  await db.delete(schema.scheduledTasks);
  await db.delete(schema.qboIssues);
  await db.delete(schema.qboLinks).where(and(eq(schema.qboLinks.companyId, CO), eq(schema.qboLinks.localId, "qsy-rider3")));
  await db.delete(schema.qboLinks).where(and(eq(schema.qboLinks.companyId, CO), eq(schema.qboLinks.localId, "qsy-cust2")));
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

  it("prices the PO from the job's line items before the job has been paid (C1)", async () => {
    // At assignment nothing has accrued yet: techPay is 0 and there is no breakdown.
    const b = await job({ techPay: 0, techPayBreakdown: "", finishedAt: null });
    await fireEvent("assigned", b.id);
    await drain();
    const creates = calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/purchaseorder"));
    expect(creates.length).toBe(1);
    expect(creates[0]!.body.Line[0].Amount).toBe(750);
    expect(creates[0]!.body.Line[0].Description).toBe("Floor tile install");
    expect((await booking(b.id)).vendorBillStatus).toBe("po_open");
  });

  it("tells a person when a job cannot be priced yet, then prices it at completion (C1)", async () => {
    const b = await job({ riderId: "qsy-rider3", techPay: 0, techPayBreakdown: "", lineItems: "[]", finishedAt: null });
    await setMapping(CO, "vendor", "qsy-rider3", "229");
    await fireEvent("assigned", b.id);
    await drain();
    expect(calls.filter((c) => c.method === "POST").length).toBe(0);
    const open = (await issues()).filter((i) => i.status === "open");
    expect(open.map((i) => i.kind)).toEqual(["no_pay"]);
    expect((await booking(b.id)).vendorBillStatus).toBe("none");
    // the tech finishes 2h on site; completion accrues the pay
    await db.update(schema.bookings).set({ status: "completed", techPay: 120, finishedAt: new Date("2026-10-28T20:00:00Z"), techPayBreakdown: JSON.stringify({ hourlyPay: 120, techPay: 120, onSiteMinutes: 120 }) }).where(eq(schema.bookings.id, b.id));
    await fireEvent("completed", b.id);
    await drain();
    expect(calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/purchaseorder")).length).toBe(1);
    expect(calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/bill")).length).toBe(1);
    expect((await issues()).filter((i) => i.kind === "no_pay" && i.status === "open")).toEqual([]);
    expect((await booking(b.id)).vendorBillStatus).toBe("billed");
  });

  it("in shadow mode creates no vendor or customer either (C2)", async () => {
    await db.update(schema.integrations).set({ config: JSON.stringify({ billMode: "arriveping", taxCodeId: "4", defaultItemId: "154", parentCustomerId: "", shadow: true }) }).where(eq(schema.integrations.companyId, CO));
    const b = await job({ riderId: "qsy-rider3", customerId: "qsy-cust2" });
    await fireEvent("assigned", b.id);
    await drain();
    expect(calls.filter((c) => c.method === "POST").length).toBe(0);
    expect(await link("vendor", "qsy-rider3")).toEqual([]);
    expect(await link("customer", "qsy-cust2")).toEqual([]);
    const msgs = (await issues()).map((i) => i.message).join("\n");
    expect(msgs).toContain('vendor "Unmapped Tech"');
    expect(msgs).toContain('customer "New Customer');
    expect(msgs).toContain("purchase order AP-");
  });

  it("removes its own duplicate when another instance linked the job's PO first (I3)", async () => {
    const b = await job();
    onPoCreate = async () => {
      // the other instance created PO 700 and linked it between our query and our create
      pos["700"] = { Id: "700", SyncToken: "0", POStatus: "Open", VendorRef: { value: "227" }, Line: [] };
      await setMapping(CO, "purchase_order", b.id, "700");
      onPoCreate = null;
    };
    await syncBookingNow(CO, b.id);
    expect(calls.some((c) => c.url.searchParams.get("operation") === "delete" && c.body.Id === "800")).toBe(true);
    expect((await link("purchase_order", b.id))[0]!.qboId).toBe("700");
    expect(pos["700"]).toBeDefined();
  });

  it("allows only one pending QuickBooks task per job and kind at the database (I3)", async () => {
    const b = await job();
    await db.insert(schema.scheduledTasks).values({ companyId: CO, kind: "qbo.po.create", bookingId: b.id, runAt: new Date(), payload: "{}" } as never);
    await expect(async () => {
      await db.insert(schema.scheduledTasks).values({ companyId: CO, kind: "qbo.po.create", bookingId: b.id, runAt: new Date(), payload: "{}" } as never);
    }).toThrow();
    // a done task does not block a new pending one
    await db.update(schema.scheduledTasks).set({ status: "done" }).where(eq(schema.scheduledTasks.bookingId, b.id));
    await db.insert(schema.scheduledTasks).values({ companyId: CO, kind: "qbo.po.create", bookingId: b.id, runAt: new Date(), payload: "{}" } as never);
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

  it("adopts the bookkeeper's bill that is linked to the PO even under her own number (I2)", async () => {
    const b = await job();
    await fireEvent("assigned", b.id);
    await drain();
    pos["800"].LinkedTxn = [{ TxnId: "900", TxnType: "Bill" }];
    bills["900"] = { Id: "900", SyncToken: "1", DocNumber: "SUB-0091", TotalAmt: 750, Balance: 750, VendorRef: { value: "227" }, Line: [], LinkedTxn: [{ TxnId: "800", TxnType: "PurchaseOrder" }] };
    await fireEvent("completed", b.id);
    await drain();
    expect(calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/bill")).length).toBe(0);
    expect((await link("bill", b.id))[0]!.qboId).toBe("900");
    expect((await booking(b.id)).vendorBillStatus).toBe("billed");
  });

  it("links bill lines to the PO's real line ids and closes a PO the bill did not cover (I7)", async () => {
    // PO priced at assignment from two line items; at completion only one was done, plus labour
    const two = JSON.stringify([
      { itemId: "cat-1", kind: "unit", name: "Floor tile install", sku: "", unit: "sq ft", qty: 300, unitCost: 2.5, unitPrice: 4, taxable: false, cost: 750, price: 1200 },
      { itemId: "cat-2", kind: "unit", name: "Baseboard", sku: "", unit: "ft", qty: 40, unitCost: 1, unitPrice: 2, taxable: false, cost: 40, price: 80 },
    ]);
    const b = await job({ techPay: 0, techPayBreakdown: "", lineItems: two, finishedAt: null });
    await fireEvent("assigned", b.id);
    await drain();
    expect(pos["800"].Line.map((l: any) => l.Id)).toEqual(["1", "2"]);
    // in the end the tech was paid 1h of labour only
    await db.update(schema.bookings).set({ status: "completed", techPay: 60, finishedAt: new Date("2026-10-28T20:00:00Z"), techPayBreakdown: JSON.stringify({ hourlyPay: 60, techPay: 60, onSiteMinutes: 60 }), lineItems: "[]" }).where(eq(schema.bookings.id, b.id));
    await fireEvent("completed", b.id);
    await drain();
    const create = calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/bill"))!;
    expect(create.body.LinkedTxn).toEqual([{ TxnId: "800", TxnType: "PurchaseOrder" }]);
    expect(create.body.Line.length).toBe(1);
    expect(create.body.Line[0].Amount).toBe(60);
    expect(create.body.Line[0].LinkedTxn).toEqual([{ TxnId: "800", TxnType: "PurchaseOrder", TxnLineId: "1" }]);
    // the stub leaves the PO open when a line is not fully billed; the sync closes it
    expect(pos["800"].POStatus).toBe("Closed");
    expect(calls.some((c) => c.method === "POST" && c.url.pathname.endsWith("/purchaseorder") && c.body.Id === "800" && c.body.POStatus === "Closed" && c.body.sparse === true)).toBe(true);
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
    await db.update(schema.bookings).set({ status: "cancelled" }).where(eq(schema.bookings.id, b.id));
    await fireEvent("cancelled", b.id);
    await drain();
    expect(calls.some((c) => c.url.searchParams.get("operation") === "delete" && c.body.Id === "800")).toBe(true);
    expect((await booking(b.id)).vendorBillStatus).toBe("none");
    expect(await link("purchase_order", b.id)).toEqual([]);
  });

  it("moves the PO to the new technician's vendor on reassignment (I5)", async () => {
    const b = await job();
    await fireEvent("assigned", b.id);
    await drain();
    await db.update(schema.bookings).set({ riderId: "qsy-rider2" }).where(eq(schema.bookings.id, b.id));
    await fireEvent("assigned", b.id);
    await drain();
    expect(calls.some((c) => c.url.searchParams.get("operation") === "delete" && c.body.Id === "800")).toBe(true);
    const creates = calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/purchaseorder") && !c.url.searchParams.get("operation"));
    expect(creates.length).toBe(2);
    expect(creates[1]!.body.VendorRef).toEqual({ value: "228" });
    expect((await link("purchase_order", b.id))[0]!.qboId).toBe("801");
    expect((await booking(b.id)).vendorBillStatus).toBe("po_open");
  });

  it("removes the PO when the technician declines or is released from the job (I5)", async () => {
    const b = await job();
    await fireEvent("assigned", b.id);
    await drain();
    await db.update(schema.bookings).set({ riderId: null, status: "pending", assignStatus: "pending" }).where(eq(schema.bookings.id, b.id));
    await fireEvent("released", b.id);
    await drain();
    expect(calls.some((c) => c.url.searchParams.get("operation") === "delete" && c.body.Id === "800")).toBe(true);
    expect(await link("purchase_order", b.id)).toEqual([]);
    expect((await booking(b.id)).vendorBillStatus).toBe("none");
  });

  it("asks a person when the PO already has a bill", async () => {
    const b = await job();
    await fireEvent("assigned", b.id);
    await drain();
    await fireEvent("completed", b.id);
    await drain();
    await db.update(schema.bookings).set({ status: "cancelled" }).where(eq(schema.bookings.id, b.id));
    await fireEvent("cancelled", b.id);
    await drain();
    expect(calls.some((c) => c.url.searchParams.get("operation") === "delete")).toBe(false);
    expect((await issues()).some((i) => i.kind === "po_cancel_review")).toBe(true);
  });
});

describe("jobs from before QuickBooks was connected", () => {
  const cfgWith = (extra: Record<string, unknown>) => JSON.stringify({ billMode: "arriveping", taxCodeId: "4", defaultItemId: "154", parentCustomerId: "", shadow: false, ...extra });

  it("are never synced: not on an event, not by the reconnect sweep", async () => {
    await db.delete(schema.bookings).where(eq(schema.bookings.companyId, CO));
    await db.update(schema.integrations).set({ config: cfgWith({ syncSince: "2026-10-29" }) }).where(eq(schema.integrations.companyId, CO));
    const before = await job({ scheduledAt: new Date("2026-10-20T15:00:00Z") });
    const after = await job({ scheduledAt: new Date("2026-10-30T15:00:00Z") });
    await fireEvent("assigned", before.id);
    await fireEvent("assigned", after.id);
    expect(await tasks(before.id)).toEqual([]);
    expect((await tasks(after.id)).map((t) => t.kind)).toEqual(["qbo.po.create"]);
    await db.delete(schema.scheduledTasks);
    const { requeueAfterReconnect } = await import("../quickbooks/sync");
    expect(await requeueAfterReconnect(CO)).toBe(1);
    expect(await tasks(before.id)).toEqual([]);
    expect((await tasks(after.id)).length).toBe(1);
  });

  it("the first connection fixes the date; a reconnect keeps it", async () => {
    await db.update(schema.integrations).set({ config: cfgWith({}) }).where(eq(schema.integrations.companyId, CO));
    const { afterQuickbooksConnect } = await import("../quickbooks/sync");
    const { settings } = await import("../quickbooks/resolve");
    await afterQuickbooksConnect(CO, "", "r1");
    const first = (await settings(CO)).syncSince;
    expect(first).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await db.update(schema.integrations).set({ config: cfgWith({ syncSince: "2026-01-15" }) }).where(eq(schema.integrations.companyId, CO));
    await afterQuickbooksConnect(CO, "r1", "r1");
    expect((await settings(CO)).syncSince).toBe("2026-01-15");
  });
});

describe("after a reconnect", () => {
  it("connecting a different QuickBooks company clears links and the job states that described them", async () => {
    await db.delete(schema.bookings).where(eq(schema.bookings.companyId, CO));
    const open = await job({ vendorBillStatus: "po_open" });
    const paid = await job({ status: "completed", vendorBillStatus: "paid", subtradePaidAt: new Date() });
    await setMapping(CO, "purchase_order", open.id, "700");
    const { afterQuickbooksConnect } = await import("../quickbooks/sync");
    await afterQuickbooksConnect(CO, "r1", "r9");
    expect(await link("purchase_order", open.id)).toEqual([]);
    // the open PO lived in the old books: back to "none" and queued for the new ones
    expect((await booking(open.id)).vendorBillStatus).toBe("none");
    expect((await tasks(open.id)).map((t) => t.kind)).toEqual(["qbo.po.create"]);
    // what was billed and paid in the old company stays history
    expect((await booking(paid.id)).vendorBillStatus).toBe("paid");
    expect(await tasks(paid.id)).toEqual([]);
    expect((await issues()).some((i) => i.kind === "realm_changed" && i.message.includes("1 job"))).toBe(true);
  });

  it("re-queues the jobs that were waiting while the connection was down (I4)", async () => {
    await db.delete(schema.bookings).where(eq(schema.bookings.companyId, CO)); // only this test's jobs count
    const waiting = await job({ vendorBillStatus: "none" });
    const errored = await job({ vendorBillStatus: "error" });
    const completedOpen = await job({ status: "completed", vendorBillStatus: "po_open" });
    const done = await job({ status: "completed", vendorBillStatus: "billed" });
    const cancelled = await job({ status: "cancelled", vendorBillStatus: "none" });
    const { requeueAfterReconnect } = await import("../quickbooks/sync");
    const n = await requeueAfterReconnect(CO);
    expect(n).toBe(3);
    expect((await tasks(waiting.id)).map((t) => t.kind)).toEqual(["qbo.po.create"]);
    expect((await tasks(errored.id)).map((t) => t.kind)).toEqual(["qbo.po.create"]);
    expect((await tasks(completedOpen.id)).map((t) => t.kind)).toEqual(["qbo.bill.create"]);
    expect(await tasks(done.id)).toEqual([]);
    expect(await tasks(cancelled.id)).toEqual([]);
  });
});
