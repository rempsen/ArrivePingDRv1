/**
 * The safety net under the webhook: every 30 minutes the sweep asks each
 * connected tenant's QuickBooks what changed, so a missed delivery still
 * marks the job paid. A revoked connection tells the owner once and resumes
 * where it left off after reconnecting. Transport and email are stubs.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { and, eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.QUICKBOOKS_ENV = "sandbox";

let emails: { to: string | string[]; subject: string }[] = [];
const realEmail = { ...(await import("../email")) };
mock.module("../email", () => ({
  ...realEmail,
  sendEmail: async (o: { to: string | string[]; subject: string }) => {
    emails.push({ to: o.to, subject: o.subject });
    return { ok: true };
  },
}));
let refreshThrows = false;
const realOauth = { ...(await import("../oauth")) };
mock.module("../oauth", () => ({
  ...realOauth,
  refreshTokens: async () => {
    if (refreshThrows) throw new Error("invalid_grant: revoked");
    return { accessToken: "at-new", refreshToken: "rt-new", expiresAt: Date.now() + 3600_000, scope: "s" };
  },
}));
afterAll(() => {
  mock.module("../email", () => realEmail);
  mock.module("../oauth", () => realOauth);
});

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { PgTable } = await import("drizzle-orm/pg-core");
const { ensureTables } = await import("../../test-support/tables");
const { _setQboFetch } = await import("../quickbooks/client");
const { setMapping } = await import("../quickbooks/resolve");
const { sweepQboChanges, notifyNeedsReconnect } = await import("../quickbooks/sweep");
const features = await import("../features");

const CO = "qsw-co";
let cdcBills: any[] = [];
let cdcSince: string | null = null;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTables(v);
  await db.insert(schema.companies).values({ id: CO, name: "Sweep Co", kind: "test" } as never);
  await db.insert(schema.companySettings).values({ id: "qsw-settings", companyId: CO, email: "office@sweep.test" } as never);
  await db.insert(schema.user).values([{ id: "qsw-cust", name: "Customer", email: "c@sweep.test", role: "customer", companyId: CO }] as never);
  await db.insert(schema.services).values({ id: "qsw-svc", name: "Flooring", category: "flooring", basePrice: 0, companyId: CO } as never);
  await db.insert(schema.integrations).values({
    companyId: CO, provider: "quickbooks", status: "connected", externalAccountId: "r3", accessToken: "at", refreshToken: "rt",
    expiresAt: new Date(Date.now() + 3600_000), lastSyncAt: new Date(Date.now() - 3600_000),
    config: JSON.stringify({ billMode: "subtrade", taxCodeId: "4", defaultItemId: "154", parentCustomerId: "", shadow: false }),
  } as never);
  await features.setFeatureOverride({ companyId: CO, key: "integrations.quickbooks", enabled: true, actor: { id: "t", name: "T" } });
  _setQboFetch((async (url: any) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/cdc")) {
      cdcSince = u.searchParams.get("changedSince");
      return json({ CDCResponse: [{ QueryResponse: [{ Bill: cdcBills }, { PurchaseOrder: [] }] }] });
    }
    return json({ Fault: { Error: [{ code: "999", Message: `unexpected ${u.pathname}` }] } }, 400);
  }) as typeof fetch);
});
afterAll(() => _setQboFetch(null));

beforeEach(async () => {
  emails = [];
  cdcBills = [];
  cdcSince = null;
  refreshThrows = false;
  await db.delete(schema.qboLinks);
  await db.delete(schema.qboIssues);
  await db.update(schema.integrations).set({ status: "connected", expiresAt: new Date(Date.now() + 3600_000), config: JSON.stringify({ billMode: "subtrade", taxCodeId: "4", defaultItemId: "154", parentCustomerId: "", shadow: false, reconnectNotifiedAt: "" }) }).where(eq(schema.integrations.companyId, CO));
});

async function jobWithPoAndBill(po: string, bill: string) {
  const [b] = await db
    .insert(schema.bookings)
    .values({ companyId: CO, customerId: "qsw-cust", serviceId: "qsw-svc", status: "completed", scheduledAt: new Date(), address: "x", techPay: 100, vendorBillStatus: "billed" } as never)
    .returning();
  await setMapping(CO, "purchase_order", b!.id, po);
  await setMapping(CO, "bill", b!.id, bill);
  return b!;
}
const booking = async (id: string) => (await db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0]!;
const integration = async () => (await db.select().from(schema.integrations).where(and(eq(schema.integrations.companyId, CO), eq(schema.integrations.provider, "quickbooks"))))[0]!;

describe("sweepQboChanges", () => {
  it("marks a paid bill the webhook never delivered, asking from a little before the last sync", async () => {
    const b = await jobWithPoAndBill("700", "145");
    cdcBills = [{ Id: "145", SyncToken: "3", TotalAmt: 100, Balance: 0, VendorRef: { value: "1" }, Line: [], LinkedTxn: [{ TxnId: "700", TxnType: "PurchaseOrder" }] }];
    const before = (await integration()).lastSyncAt!.getTime();
    await sweepQboChanges();
    expect((await booking(b.id)).vendorBillStatus).toBe("paid");
    expect(new Date(cdcSince!).getTime()).toBeLessThanOrEqual(before - 5 * 60_000);
    expect((await integration()).lastSyncAt!.getTime()).toBeGreaterThan(before);
  });

  it("after a revoked connection is reconnected, the next sweep catches up with no second PO", async () => {
    const b = await jobWithPoAndBill("701", "146");
    refreshThrows = true;
    await db.update(schema.integrations).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(schema.integrations.companyId, CO));
    await sweepQboChanges();
    expect((await integration()).status).toBe("needs_reconnect");
    expect(emails.length).toBe(1);
    expect(emails[0]!.to).toBe("office@sweep.test");
    // a second sweep while still disconnected: no second email, no calls
    await sweepQboChanges();
    expect(emails.length).toBe(1);
    // the office reconnects
    refreshThrows = false;
    await db.update(schema.integrations).set({ status: "connected", expiresAt: new Date(Date.now() + 3600_000) }).where(eq(schema.integrations.companyId, CO));
    cdcBills = [{ Id: "146", SyncToken: "3", TotalAmt: 100, Balance: 0, VendorRef: { value: "1" }, Line: [], LinkedTxn: [{ TxnId: "701", TxnType: "PurchaseOrder" }] }];
    await sweepQboChanges();
    expect((await booking(b.id)).vendorBillStatus).toBe("paid");
    const poLinks = await db.select().from(schema.qboLinks).where(and(eq(schema.qboLinks.companyId, CO), eq(schema.qboLinks.kind, "purchase_order")));
    expect(poLinks.length).toBe(1); // this job's only, nothing new
  });

  it("skips tenants with the switch off", async () => {
    await features.setFeatureOverride({ companyId: CO, key: "integrations.quickbooks", enabled: false, actor: { id: "t", name: "T" } });
    await sweepQboChanges();
    expect(cdcSince).toBeNull();
    await features.setFeatureOverride({ companyId: CO, key: "integrations.quickbooks", enabled: true, actor: { id: "t", name: "T" } });
  });
});

describe("notifyNeedsReconnect", () => {
  it("emails the office once", async () => {
    await notifyNeedsReconnect(CO);
    await notifyNeedsReconnect(CO);
    expect(emails.length).toBe(1);
    expect(emails[0]!.subject).toContain("QuickBooks");
  });
});
