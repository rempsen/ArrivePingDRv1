/**
 * The sales pack: how ArrivePing books its own meetings on ArrivePing.
 *
 * Reps are technicians in our own tenant ("default"), a meeting is a work
 * order, and the prospect gets the same confirmation and live "on the way"
 * text a homeowner gets from their plumber, which is the best demo there is.
 * Nothing here books the work order itself: the hub opens the normal New Job
 * form with the lead filled in, so the real booking path (invoice, events,
 * notifications, the map) is never bypassed.
 *
 * This file installs the four meeting types once and keeps the leads inbox
 * (marketing-site "contact me" requests) moving.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { tdb } from "../api/database/tenant";
import { platformAudit } from "./platform-audit";

export const SALES_TENANT = "default";
export const SALES_CATEGORY = "Sales";

export const SALES_SERVICES = [
  { key: "meeting", name: "Sales meeting", durationMins: 60, icon: "briefcase", description: "Meet the prospect at their office or shop." },
  { key: "lunch", name: "Lunch", durationMins: 90, icon: "utensils", description: "Lunch with a prospect or customer." },
  { key: "call", name: "Sales call", durationMins: 30, icon: "phone", description: "A phone or video call." },
  { key: "demo", name: "Demo visit", durationMins: 60, icon: "monitor", description: "Show ArrivePing working on their own jobs." },
] as const;

export const LEAD_STATUSES = ["new", "contacted", "booked", "closed"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Add any missing meeting types to our own tenant. Safe to call any time. */
export async function installSalesPack(actor?: { id: string; name: string }) {
  const t = tdb(SALES_TENANT);
  const existing = await t.select(schema.services, eq(schema.services.category, SALES_CATEGORY));
  const have = new Set(existing.map((s) => s.name));
  const added: string[] = [];
  for (const s of SALES_SERVICES) {
    if (have.has(s.name)) continue;
    await t.insert(schema.services, { name: s.name, category: SALES_CATEGORY, description: s.description, icon: s.icon, durationMins: s.durationMins, basePrice: 0, active: true });
    added.push(s.name);
  }
  if (added.length && actor) {
    await platformAudit({ actor, action: "sales.install", companyId: SALES_TENANT, entityType: "service", summary: `Added meeting types: ${added.join(", ")}` });
  }
  return { added, services: await salesServices() };
}

export async function salesServices() {
  const rows = await tdb(SALES_TENANT).select(schema.services, and(eq(schema.services.category, SALES_CATEGORY), eq(schema.services.active, true)));
  const order = new Map<string, number>(SALES_SERVICES.map((s, i) => [s.name, i]));
  return rows
    .map((s) => ({ id: s.id, name: s.name, durationMins: s.durationMins }))
    .sort((a, b) => (order.get(a.name) ?? 9) - (order.get(b.name) ?? 9));
}

/** Our reps: the active, non-sample technicians in our own tenant. */
export async function salesReps() {
  const t = tdb(SALES_TENANT);
  const riders = (await t.select(schema.riders)).filter((r) => r.approval === "active" && !r.isSample);
  if (riders.length === 0) return [];
  const users = await sdb.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, riders.map((r) => r.userId)));
  const name = new Map(users.map((u) => [u.id, u.name]));
  return riders.map((r) => ({ id: r.id, name: name.get(r.userId) ?? "Rep", status: r.status })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listLeads(limit = 200) {
  return sdb.select().from(schema.contactRequests).orderBy(desc(schema.contactRequests.createdAt)).limit(Math.min(Math.max(limit, 1), 500));
}

export async function setLeadStatus(id: string, status: LeadStatus, actor: { id: string; name: string }, note?: string) {
  const [row] = await sdb.update(schema.contactRequests).set({ status }).where(eq(schema.contactRequests.id, id)).returning();
  if (!row) return null;
  await platformAudit({
    actor,
    action: `lead.${status}`,
    entityType: "lead",
    entityId: id,
    summary: `${row.name}${row.company ? ` (${row.company})` : ""} marked ${status}${note ? `: ${note}` : ""}`,
  });
  return row;
}
