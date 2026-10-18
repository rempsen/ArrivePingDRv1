/**
 * Launch checklist — the five things a new company does to go live, ticked
 * from real data (blueprint 2026-10-17, section 4). Nothing here is stored as
 * a tick: every item is recomputed from the tables, so it can never claim
 * something happened that didn't, and it can't fall out of date.
 *
 *  1. first-job       a real (non-sample) job exists
 *  2. invite-tech     a real technician has signed in themselves
 *                     ("waiting" while one is added or invited but hasn't yet)
 *  3. live-eta        a customer was sent an on-the-way message on a real job
 *  4. reply-to        a reply-to address is set for outgoing email
 *  5. milestone-copy  someone edited the words of a milestone message
 *
 * Plus the six things the AI setup did at signup (industry, service area,
 * catalog, forms, templates, team), shown as a collapsed "Setup done" group so
 * people start ahead.
 */
import { and, eq, inArray, isNull, isNotNull, ne } from "drizzle-orm";
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
    t.select(schema.memberships, and(eq(schema.memberships.role, "rider"), inArray(schema.memberships.status, ["active", "invited"]))),
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

  // Technicians: real field staff only. Office staff can carry a rider profile
  // too, so the rider membership decides, and sample technicians are left out.
  const realRiders = new Map(allRiders.map((r) => [r.userId, r]));
  const techMembers = fieldMembers.filter((m) => realRiders.has(m.userId));
  const activeTechIds = techMembers.filter((m) => m.status === "active").map((m) => m.userId);

  // "Signed in" means the technician did it themselves: their phone reported a
  // location, registered for push, or a real client opened a session. Adding a
  // brand-new technician creates a session on the server (Better Auth signs the
  // new login in), and that one has no user agent, so it doesn't count.
  let signedIn = activeTechIds.some((id) => realRiders.get(id)?.locationUpdatedAt != null);
  if (!signedIn && activeTechIds.length) {
    // Sessions and push tokens belong to the login, not to one company (one
    // login can work for several), so these are system reads, limited to this
    // company's own technicians.
    const [[s], [p]] = await Promise.all([
      sdb
        .select({ id: schema.session.id })
        .from(schema.session)
        .where(and(inArray(schema.session.userId, activeTechIds), isNotNull(schema.session.userAgent), ne(schema.session.userAgent, "")))
        .limit(1),
      sdb.select({ id: schema.pushTokens.id }).from(schema.pushTokens).where(inArray(schema.pushTokens.userId, activeTechIds)).limit(1),
    ]);
    signedIn = Boolean(s || p);
  }
  // Waiting: a technician was added or invited (an existing login gets an
  // "invited" rider membership; a new email gets a technician invite) and
  // nobody has signed in yet. Invites for office staff don't count.
  const invitedTech =
    techMembers.length > 0 || invites.some((i) => i.status === "pending" && (i.role ?? "rider") === "rider");

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
