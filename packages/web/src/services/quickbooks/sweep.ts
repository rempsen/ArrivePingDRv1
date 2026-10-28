/**
 * The safety net under Intuit's best-effort webhook: every 30 minutes
 * (server.ts) each connected tenant's QuickBooks is asked, through change
 * data capture, which bills and purchase orders changed since a little
 * before the last sync, and the answers go through the same pull logic.
 *
 * A connection the tenant revoked flips to `needs_reconnect` on its first
 * failed refresh; the office is emailed once, and the sweep skips the
 * tenant until the Integrations page reconnects it.
 */
import { and, eq } from "drizzle-orm";
import { sdb } from "../../api/database";
import * as schema from "../../api/database/schema";
import { sendEmail } from "../email";
import { companiesWithFeature } from "../features";
import { qboCdc, QboError } from "./client";
import { raiseIssue } from "./resolve";
import type { Bill } from "./entities";
import { applyChangedBill } from "./pull";

const LOOKBACK_MS = 5 * 60_000;
/** Intuit keeps CDC history for 30 days; a tenant away longer starts from there. */
const MAX_WINDOW_MS = 29 * 86400_000;

type IntegrationRow = typeof schema.integrations.$inferSelect;

function readConfig(row: IntegrationRow): Record<string, unknown> {
  try {
    const v = JSON.parse(row.config || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** Merge keys into integrations.config without dropping the tenant's settings. */
export async function patchConfig(companyId: string, patch: Record<string, unknown>): Promise<void> {
  const [row] = await sdb.select().from(schema.integrations).where(and(eq(schema.integrations.companyId, companyId), eq(schema.integrations.provider, "quickbooks")));
  if (!row) return;
  await sdb.update(schema.integrations).set({ config: JSON.stringify({ ...readConfig(row), ...patch }) }).where(eq(schema.integrations.id, row.id));
}

/** Tell the office once that QuickBooks has to be reconnected. */
export async function notifyNeedsReconnect(companyId: string): Promise<void> {
  const [row] = await sdb.select().from(schema.integrations).where(and(eq(schema.integrations.companyId, companyId), eq(schema.integrations.provider, "quickbooks")));
  if (!row) return;
  if (readConfig(row).reconnectNotifiedAt) return;
  const [cs] = await sdb.select({ email: schema.companySettings.email, name: schema.companySettings.name }).from(schema.companySettings).where(eq(schema.companySettings.companyId, companyId));
  const to = cs?.email?.trim();
  if (!to) return;
  const appUrl = (process.env.APP_URL || process.env.PUBLIC_URL || "https://arriveping.com").replace(/\/$/, "");
  await sendEmail({
    to,
    subject: "QuickBooks needs to be reconnected to ArrivePing",
    text: `ArrivePing can no longer reach ${cs?.name ?? "your company"}'s QuickBooks: the connection was revoked or expired. Jobs keep flowing; purchase orders, bills and paid status will catch up once you reconnect.\n\nReconnect: ${appUrl}/admin/integrations?provider=quickbooks\n`,
    html: `<p>ArrivePing can no longer reach ${cs?.name ?? "your company"}'s QuickBooks: the connection was revoked or expired.</p><p>Jobs keep flowing. Purchase orders, bills and paid status will catch up once you reconnect.</p><p><a href="${appUrl}/admin/integrations?provider=quickbooks">Reconnect QuickBooks</a></p>`,
  });
  await patchConfig(companyId, { reconnectNotifiedAt: new Date().toISOString() });
}

/** Pull everything that changed for one tenant. */
export async function sweepCompany(companyId: string): Promise<void> {
  const [row] = await sdb.select().from(schema.integrations).where(and(eq(schema.integrations.companyId, companyId), eq(schema.integrations.provider, "quickbooks")));
  if (!row || !row.externalAccountId) return;
  if (row.status === "needs_reconnect") {
    await notifyNeedsReconnect(companyId);
    return;
  }
  if (row.status !== "connected") return;
  const startedAt = new Date();
  const last = row.lastSyncAt?.getTime() ?? startedAt.getTime() - 86400_000;
  const since = new Date(Math.max(last - LOOKBACK_MS, startedAt.getTime() - MAX_WINDOW_MS));
  let res;
  try {
    res = await qboCdc(companyId, ["Bill", "PurchaseOrder"], since);
  } catch (e) {
    if (e instanceof QboError && e.code === "needs_reconnect") {
      await notifyNeedsReconnect(companyId);
      return;
    }
    throw e;
  }
  const bills: Bill[] = [];
  for (const group of res.CDCResponse ?? []) {
    for (const qr of group.QueryResponse ?? []) {
      for (const b of (qr.Bill ?? []) as Bill[]) bills.push(b);
    }
  }
  // one bad record must not hold every later one (and the sync marker) back
  let failed = 0;
  for (const bill of bills) {
    try {
      await applyChangedBill(companyId, bill);
    } catch (e) {
      failed++;
      console.error("[qbo] sweep bill", companyId, bill.Id, e instanceof Error ? e.message : e);
    }
  }
  if (failed) await raiseIssue(companyId, "sweep_failed", `${failed} changed bill(s) could not be applied during the QuickBooks sweep. Check the bill in QuickBooks, then use Sync now on the job.`, { detail: { failed, since: since.toISOString() } });
  await sdb.update(schema.integrations).set({ lastSyncAt: startedAt }).where(eq(schema.integrations.id, row.id));
  // a successful sweep means the connection is healthy again
  if (readConfig(row).reconnectNotifiedAt) await patchConfig(companyId, { reconnectNotifiedAt: "" });
}

/** Every tenant with the switch on and a QuickBooks connection. */
export async function sweepQboChanges(): Promise<void> {
  const rows = await sdb
    .select({ companyId: schema.integrations.companyId, status: schema.integrations.status })
    .from(schema.integrations)
    .where(eq(schema.integrations.provider, "quickbooks"));
  const candidates = rows.filter((r) => r.status === "connected" || r.status === "needs_reconnect").map((r) => r.companyId);
  const on = await companiesWithFeature("integrations.quickbooks", candidates);
  for (const companyId of on) {
    try {
      await sweepCompany(companyId);
    } catch (e) {
      console.error("[qbo] sweep failed", companyId, e instanceof Error ? e.message : e);
    }
  }
}
