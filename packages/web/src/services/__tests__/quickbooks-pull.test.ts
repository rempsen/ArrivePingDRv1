/**
 * Inbound QuickBooks Sync: a bill the bookkeeper entered against our purchase
 * order is adopted, a bill whose balance reaches zero marks the job paid (and
 * back to billed if it reopens), and a removed bill returns the job to "PO
 * open". Transport is a stub; no network.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.QUICKBOOKS_ENV = "sandbox";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { PgTable } = await import("drizzle-orm/pg-core");
const { ensureTables } = await import("../../test-support/tables");
const { _setQboFetch } = await import("../quickbooks/client");
const { setMapping } = await import("../quickbooks/resolve");
const { docNumberFor } = await import("../quickbooks/sync");
const { adoptBillForPo, applyBillBalance, pullEntity, handleWebhook } = await import("../quickbooks/pull");
const { runDueTasks } = await import("../scheduler");
const features = await import("../features");

const CO = "qp-co";
let bills: Record<string, any> = {};
let billPayments: Record<string, any> = {};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTables(v);
  await db.insert(schema.companies).values({ id: CO, name: "Pull Co", kind: "test" } as never);
  await db.insert(schema.user).values([{ id: "qp-cust", name: "Allard Condos", email: "c@allard.test", role: "customer", companyId: CO }] as never);
  await db.insert(schema.services).values({ id: "qp-svc", name: "Flooring", category: "flooring", basePrice: 0, companyId: CO } as never);
  await db.insert(schema.integrations).values({
    companyId: CO, provider: "quickbooks", status: "connected", externalAccountId: "r2", accessToken: "at", refreshToken: "rt",
    expiresAt: new Date(Date.now() + 3600_000),
    config: JSON.stringify({ billMode: "subtrade", taxCodeId: "4", defaultItemId: "154", parentCustomerId: "", shadow: false }),
  } as never);
  await features.setFeatureOverride({ companyId: CO, key: "integrations.quickbooks", enabled: true, actor: { id: "t", name: "T" } });
  _setQboFetch((async (url: any) => {
    const u = new URL(String(url));
    const m = /\/(bill|billpayment)\/(\d+)$/.exec(u.pathname);
    if (m) {
      const store = m[1] === "bill" ? bills : billPayments;
      const row = store[m[2]!];
      if (!row) return json({ Fault: { Error: [{ code: "610", Message: "Object Not Found" }] } }, 400);
      return json(m[1] === "bill" ? { Bill: row } : { BillPayment: row });
    }
    return json({ Fault: { Error: [{ code: "999", Message: `unexpected ${u.pathname}` }] } }, 400);
  }) as typeof fetch);
});
afterAll(() => _setQboFetch(null));

beforeEach(async () => {
  bills = {};
  billPayments = {};
  await db.delete(schema.scheduledTasks);
  await db.delete(schema.qboLinks);
  await db.delete(schema.qboIssues);
});

async function jobWithPo(qboPoId: string) {
  const [b] = await db
    .insert(schema.bookings)
    .values({ companyId: CO, customerId: "qp-cust", serviceId: "qp-svc", status: "completed", scheduledAt: new Date(), address: "1055 Allard Ave", techPay: 750, vendorBillStatus: "po_open" } as never)
    .returning();
  await setMapping(CO, "purchase_order", b!.id, qboPoId);
  return b!;
}
const booking = async (id: string) => (await db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0]!;
const link = (kind: string, localId: string) => db.select().from(schema.qboLinks).where(and(eq(schema.qboLinks.companyId, CO), eq(schema.qboLinks.kind, kind), eq(schema.qboLinks.localId, localId)));
const timeline = (id: string) => db.select().from(schema.jobEvents).where(and(eq(schema.jobEvents.bookingId, id), eq(schema.jobEvents.kind, "accounting")));

describe("adoptBillForPo", () => {
  it("links the bookkeeper's bill to the job through the PO it references and marks the job billed", async () => {
    const b = await jobWithPo("700");
    await adoptBillForPo(CO, { Id: "145", SyncToken: "1", DocNumber: "SUB-0091", TotalAmt: 787.5, Balance: 787.5, VendorRef: { value: "227" }, Line: [], LinkedTxn: [{ TxnId: "700", TxnType: "PurchaseOrder" }] });
    expect((await link("bill", b.id))[0]!.qboId).toBe("145");
    expect((await booking(b.id)).vendorBillStatus).toBe("billed");
    expect((await timeline(b.id))[0]!.label).toContain("SUB-0091");
  });

  it("ignores a bill that references no PO of ours", async () => {
    await jobWithPo("700");
    await adoptBillForPo(CO, { Id: "146", SyncToken: "1", VendorRef: { value: "1" }, Line: [], LinkedTxn: [{ TxnId: "999", TxnType: "PurchaseOrder" }] });
    expect(await db.select().from(schema.qboLinks).where(eq(schema.qboLinks.kind, "bill"))).toEqual([]);
  });
});

describe("applyBillBalance", () => {
  it("marks the job paid when the bill's balance reaches zero, dated from the payment", async () => {
    const b = await jobWithPo("700");
    await setMapping(CO, "bill", b.id, "145");
    await db.update(schema.bookings).set({ vendorBillStatus: "billed" }).where(eq(schema.bookings.id, b.id));
    billPayments["146"] = { Id: "146", SyncToken: "0", TxnDate: "2026-11-05", TotalAmt: 787.5, Line: [{ Amount: 787.5, LinkedTxn: [{ TxnId: "145", TxnType: "Bill" }] }] };
    await applyBillBalance(CO, { Id: "145", SyncToken: "2", DocNumber: "SUB-0091", TotalAmt: 787.5, Balance: 0, VendorRef: { value: "227" }, Line: [], LinkedTxn: [{ TxnId: "146", TxnType: "BillPaymentCheck" }] });
    const row = await booking(b.id);
    expect(row.vendorBillStatus).toBe("paid");
    expect(row.subtradePaidAt?.toISOString().slice(0, 10)).toBe("2026-11-05");
    expect((await timeline(b.id)).some((e) => e.label.startsWith("Subtrade paid"))).toBe(true);
  });

  it("returns a paid job to billed if the bill reopens, and does nothing twice", async () => {
    const b = await jobWithPo("700");
    await setMapping(CO, "bill", b.id, "145");
    const bill = { Id: "145", SyncToken: "2", TotalAmt: 100, Balance: 0, VendorRef: { value: "227" }, Line: [] };
    await applyBillBalance(CO, bill);
    await applyBillBalance(CO, bill);
    expect((await timeline(b.id)).filter((e) => e.label.startsWith("Subtrade paid")).length).toBe(1);
    await applyBillBalance(CO, { ...bill, Balance: 100 });
    const row = await booking(b.id);
    expect(row.vendorBillStatus).toBe("billed");
    expect(row.subtradePaidAt).toBeNull();
  });
});

describe("pullEntity", () => {
  it("fetches a bill and both adopts and applies it", async () => {
    const b = await jobWithPo("700");
    bills["145"] = { Id: "145", SyncToken: "1", DocNumber: docNumberFor(b.id), TotalAmt: 50, Balance: 0, VendorRef: { value: "227" }, Line: [], LinkedTxn: [{ TxnId: "700", TxnType: "PurchaseOrder" }] };
    await pullEntity(CO, "Bill", "145");
    expect((await booking(b.id)).vendorBillStatus).toBe("paid");
  });

  it("marks a deleted bill's job as PO open again", async () => {
    const b = await jobWithPo("700");
    await setMapping(CO, "bill", b.id, "145");
    await db.update(schema.bookings).set({ vendorBillStatus: "paid", subtradePaidAt: new Date() }).where(eq(schema.bookings.id, b.id));
    await pullEntity(CO, "Bill", "145", "Delete");
    const row = await booking(b.id);
    expect(row.vendorBillStatus).toBe("po_open");
    expect(row.subtradePaidAt).toBeNull();
    expect(await link("bill", b.id)).toEqual([]);
    expect((await db.select().from(schema.qboIssues))[0]!.kind).toBe("bill_removed");
  });
});

describe("handleWebhook → task", () => {
  it("runs the queued pull for the tenant that owns the realm", async () => {
    const b = await jobWithPo("700");
    bills["145"] = { Id: "145", SyncToken: "1", TotalAmt: 50, Balance: 0, VendorRef: { value: "227" }, Line: [], LinkedTxn: [{ TxnId: "700", TxnType: "PurchaseOrder" }] };
    await handleWebhook({ eventNotifications: [{ realmId: "r2", dataChangeEvent: { entities: [{ name: "Bill", id: "145", operation: "Update", lastUpdated: "2026-10-28T20:00:00Z" }] } }] });
    await runDueTasks(new Date(Date.now() + 60_000));
    expect((await booking(b.id)).vendorBillStatus).toBe("paid");
  });
});
