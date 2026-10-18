/**
 * Launch checklist — the five things a new company does to go live, ticked
 * from real data (blueprint 2026-10-17, section 4). Nothing here is stored as
 * a tick: every item is recomputed from the tables, so it can never claim
 * something happened that didn't, and it can't fall out of date.
 *
 *  1. first-job       a real (non-sample) job exists
 *  2. invite-tech     a real technician exists and has signed in
 *                     ("waiting" while they're invited but haven't yet)
 *  3. live-eta        a customer was sent an on-the-way message on a real job
 *  4. reply-to        a reply-to address is set for outgoing email
 *  5. milestone-copy  someone edited the words of a milestone message
 *
 * Plus the six things the AI setup did at signup (industry, service area,
 * catalog, forms, templates, team), shown as a collapsed "Setup done" group so
 * people start ahead.
 */
import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { db, sdb } from "../api/database";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";

export type LaunchItemId = "first-job" | "invite-tech" | "live-eta" | "reply-to" | "milestone-copy";
export type SetupItemId = "industry" | "service-area" | "catalog" | "forms" | "templates" | "team";

export interface LaunchChecklist {
  items: { id: LaunchItemId; done: boolean; waiting?: boolean }[];
  setup: { id: SetupItemId; done: boolean }[];
  /** All five launch items done. */
  complete: boolean;
}

export async function computeLaunchChecklist(companyId: string): Promise<LaunchChecklist> {
  const t = tdb(companyId);
  const [[co], settings, realJob, allRiders, fieldMembers, invites, liveEta, channels, copyEdit, catalog, forms, templates] = await Promise.all([
    db.select().from(schema.companies).where(eq(schema.companies.id, companyId)),
    t.selectOne(schema.companySettings).catch(() => undefined),
    t.selectOne(schema.bookings, and(eq(schema.bookings.isSample, false), isNull(schema.bookings.deletedAt))),
    t.select(schema.riders, eq(schema.riders.isSample, false)),
    t.select(schema.memberships, and(eq(schema.memberships.role, "rider"), eq(schema.memberships.status, "active"))),
    t.select(schema.techInvites).catch(() => [] as (typeof schema.techInvites.$inferSelect)[]),
    t.selectOne(
      schema.notificationDeliveries,
      and(
        eq(schema.notificationDeliveries.event, "enroute"),
        eq(schema.notificationDeliveries.recipient, "client"),
        eq(schema.notificationDeliveries.status, "sent"),
        inArray(schema.notificationDeliveries.channel, ["sms", "email"]),
        isNotNull(schema.notificationDeliveries.bookingId),
      ),
    ),
    t.selectOne(schema.notificationChannels),
    t.selectOne(schema.auditLog, eq(schema.auditLog.entityType, "notification_copy")),
    t.selectOne(schema.catalogItems),
    t.selectOne(schema.intakeForms),
    t.selectOne(schema.taskTemplates),
  ]);

  // Technicians: real field staff only (office staff can carry a rider profile
  // too, so the membership role decides), and "signed in" = they have had a
  // session, or their phone has reported a location (sessions get pruned).
  const fieldUserIds = new Set(fieldMembers.map((m) => m.userId));
  const riders = allRiders.filter((r) => fieldUserIds.has(r.userId));
  const techUserIds = riders.map((r) => r.userId);
  let signedIn = riders.some((r) => r.locationUpdatedAt != null);
  if (!signedIn && techUserIds.length) {
    // Session rows aren't tenant-scoped (one login, many companies): system read.
    const [s] = await sdb.select({ id: schema.session.id }).from(schema.session).where(inArray(schema.session.userId, techUserIds)).limit(1);
    signedIn = Boolean(s);
  }
  const invitedTech = techUserIds.length > 0 || invites.some((i) => i.status === "pending");

  // The live-ETA delivery must be for a real job (sample jobs never send, but
  // be explicit in case one is ever converted).
  let liveEtaReal = false;
  if (liveEta?.bookingId) {
    const b = await t.selectOne(schema.bookings, eq(schema.bookings.id, liveEta.bookingId));
    liveEtaReal = Boolean(b && !b.isSample);
  }

  const items: LaunchChecklist["items"] = [
    { id: "first-job", done: Boolean(realJob) },
    { id: "invite-tech", done: signedIn, ...(invitedTech && !signedIn ? { waiting: true } : {}) },
    { id: "live-eta", done: liveEtaReal },
    { id: "reply-to", done: Boolean(channels?.emailReplyTo?.trim()) },
    { id: "milestone-copy", done: Boolean(copyEdit) },
  ];
  const setup: LaunchChecklist["setup"] = [
    { id: "industry", done: Boolean(co?.industry) },
    { id: "service-area", done: Boolean(settings?.serviceArea?.trim()) },
    { id: "catalog", done: Boolean(catalog) },
    { id: "forms", done: Boolean(forms) },
    { id: "templates", done: Boolean(templates) },
    { id: "team", done: invitedTech },
  ];
  return { items, setup, complete: items.every((i) => i.done) };
}
