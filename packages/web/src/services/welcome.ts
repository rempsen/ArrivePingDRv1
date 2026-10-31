/**
 * Welcome email for someone a company has just added to its team.
 *
 * Until now a brand-new technician or office user added from People got no
 * email at all: the admin typed a temporary password and had to pass it on
 * themselves, although the help centre promised an invitation. Now, the
 * moment they're created (by hand or from a spreadsheet), they get one email
 * in the company's name with:
 *   - a link to set their own password (a one-off token, valid 7 days, that
 *     the normal /reset-password page redeems — the same mechanism as
 *     "Forgot password", so there's nothing new to secure);
 *   - field staff: where to get the app; office staff: where to sign in.
 *
 * Customers get nothing here (Dan, 2026-10-17): they first hear from a
 * company when a job is booked or a technician is on the way.
 *
 * Sample people (.invalid addresses) are never emailed; sendEmail drops them
 * too, but skipping here keeps the token table clean.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, like, lt, ne } from "drizzle-orm";
import { sdb } from "../api/database";
import { tdb } from "../api/database/tenant";
import * as schema from "../api/database/schema";
import { log } from "../api/lib/logger";
import { ROLE_LABELS } from "../api/lib/permissions";
import { parseOnboarding } from "../shared/onboarding";
import { isUndeliverableEmail } from "../shared/sample-contact";
import { emailTemplates, loadEmailBrand, resolveFromAddress, sendEmail } from "./email";

const DAY = 86_400_000;
export const WELCOME_LINK_DAYS = 7;
const SITE = () => (process.env.APP_URL || process.env.WEBSITE_URL || "https://arriveping.com").replace(/\/$/, "");

/**
 * For someone added without a password: nobody is ever shown or told this
 * one; they choose their own from the welcome email.
 */
export function unguessablePassword(): string {
  return `${randomUUID()}${randomUUID()}`;
}

/** Office roles: they work in the dispatch dashboard. */
export const OFFICE_ROLES = new Set(["admin", "manager", "dispatcher", "project_manager"]);
/** Roles that get a welcome email when added. Customers and superadmins don't. */
export function welcomeKind(role: string | null | undefined): "field" | "office" | null {
  if (role === "rider") return "field";
  return role && OFFICE_ROLES.has(role) ? "office" : null;
}

/**
 * A one-off "set your password" link. It doesn't retire older links: that
 * happens only once the email carrying the new one has gone out
 * (keepOnlyLink), so a failed resend never breaks the link they already have.
 */
export async function setPasswordLink(userId: string, kind: "field" | "office", at = new Date()): Promise<{ url: string; identifier: string; createdAt: Date }> {
  const token = randomBytes(24).toString("base64url");
  const identifier = `reset-password:${token}`;
  // Strictly newer than any link they already have, even one made in the same
  // millisecond, so keepOnlyLink's "older than this one" retires all of them.
  const [prev] = await sdb
    .select({ createdAt: schema.verification.createdAt })
    .from(schema.verification)
    .where(and(eq(schema.verification.value, userId), like(schema.verification.identifier, "reset-password:%")))
    .orderBy(desc(schema.verification.createdAt))
    .limit(1);
  const now = prev && prev.createdAt.getTime() >= at.getTime() ? new Date(prev.createdAt.getTime() + 1) : at;
  await sdb.insert(schema.verification).values({
    id: randomUUID(),
    identifier,
    value: userId,
    expiresAt: new Date(now.getTime() + WELCOME_LINK_DAYS * DAY),
    createdAt: now,
    updatedAt: now,
  });
  return { url: `${SITE()}/reset-password?token=${encodeURIComponent(token)}&welcome=${kind}`, identifier, createdAt: now };
}

/**
 * After a successful send: links older than the one just sent stop working.
 * Newer ones are left alone, so a Forgot password request or another welcome
 * made while this email was going out keeps its link.
 */
export async function keepOnlyLink(userId: string, link: { identifier: string; createdAt: Date }): Promise<void> {
  await sdb
    .delete(schema.verification)
    .where(
      and(
        eq(schema.verification.value, userId),
        like(schema.verification.identifier, "reset-password:%"),
        ne(schema.verification.identifier, link.identifier),
        lt(schema.verification.createdAt, link.createdAt),
      ),
    );
}

/** After a failed send: drop the link nobody received. */
async function dropLink(identifier: string): Promise<void> {
  await sdb.delete(schema.verification).where(eq(schema.verification.identifier, identifier));
}

/**
 * Note on their membership that a welcome went out. Read, merge and write
 * under a row lock, like PATCH /api/me/onboarding, so a Guide progress save or
 * a launch-tips unsubscribe at the same moment isn't lost.
 */
async function markWelcomeSent(membershipId: string, at: Date): Promise<void> {
  await sdb.transaction(async (tx) => {
    const [m] = await tx.select().from(schema.memberships).where(eq(schema.memberships.id, membershipId)).limit(1).for("update");
    if (!m) return;
    const state = parseOnboarding(m.onboarding);
    await tx
      .update(schema.memberships)
      .set({ onboarding: JSON.stringify({ ...state, welcomeSentAt: at.toISOString() }), updatedAt: at })
      .where(eq(schema.memberships.id, membershipId));
  });
}

async function workerNoun(companyId: string): Promise<string> {
  const s = await tdb(companyId).selectOne(schema.companySettings).catch(() => undefined);
  return (s?.workerNoun || "technician").trim() || "technician";
}

export interface WelcomeDeps {
  send?: typeof sendEmail;
}

export type WelcomeResult = { sent: true } | { sent: false; reason: "not on the team" | "no email" | "sample" | "role" | "send failed" };

/**
 * Email this person their welcome for this company. `inviterId` is whoever
 * added them (their name goes in the email). Never throws.
 */
export async function sendWelcome(
  a: { companyId: string; userId: string; inviterId?: string | null },
  deps: WelcomeDeps = {},
): Promise<WelcomeResult> {
  const send = deps.send ?? sendEmail;
  try {
    const t = tdb(a.companyId);
    const membership = await t.selectOne(schema.memberships, eq(schema.memberships.userId, a.userId));
    if (!membership || membership.status !== "active") return { sent: false, reason: "not on the team" };
    const kind = welcomeKind(membership.role);
    if (!kind) return { sent: false, reason: "role" };
    const [user] = await sdb.select().from(schema.user).where(eq(schema.user.id, a.userId));
    if (!user?.email) return { sent: false, reason: "no email" };
    if (user.isSample || isUndeliverableEmail(user.email)) return { sent: false, reason: "sample" };

    const [inviter] = a.inviterId ? await sdb.select({ name: schema.user.name, role: schema.user.role }).from(schema.user).where(eq(schema.user.id, a.inviterId)) : [];
    // A platform operator (superadmin) adding someone isn't who the person knows.
    const inviterName = inviter && inviter.role !== "superadmin" ? (inviter.name || "").trim() || null : null;
    const roleLabel = kind === "field" ? await workerNoun(a.companyId) : ROLE_LABELS[membership.role] || "team member";
    const [brand, sender, link] = await Promise.all([loadEmailBrand(a.companyId), resolveFromAddress(a.companyId), setPasswordLink(a.userId, kind)]);

    const mail = emailTemplates.welcome(
      {
        kind,
        firstName: (user.firstName || user.name || "").split(" ")[0] || "there",
        email: user.email,
        inviter: inviterName,
        roleLabel,
        setPasswordUrl: link.url,
        signInUrl: `${SITE()}/sign-in`,
        // The iOS app is live; APP_STORE_URL can still override (e.g. a regional link).
        appStoreUrl: process.env.APP_STORE_URL?.trim() || "https://apps.apple.com/app/arriveping/id6776464675",
        playStoreUrl: process.env.PLAY_STORE_URL?.trim() || undefined,
        expiresDays: WELCOME_LINK_DAYS,
      },
      brand,
    );
    const r = await send({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text, ...sender });
    if ((r as { ok?: boolean; skipped?: boolean })?.ok === false && !(r as { skipped?: boolean }).skipped) {
      log.error("welcome email failed", { companyId: a.companyId, userId: a.userId, err: (r as { error?: string }).error });
      await dropLink(link.identifier);
      return { sent: false, reason: "send failed" };
    }
    await keepOnlyLink(a.userId, link);
    await markWelcomeSent(membership.id, new Date());
    return { sent: true };
  } catch (e) {
    log.error("welcome email error", { companyId: a.companyId, userId: a.userId, err: (e as Error).message });
    return { sent: false, reason: "send failed" };
  }
}

/**
 * Welcome a batch (a spreadsheet import) in the background, one at a time so a
 * 500-row roster doesn't trip the email provider's rate limit.
 */
export function queueWelcomes(companyId: string, userIds: string[], inviterId: string | null, gapMs = 600, deps: WelcomeDeps = {}) {
  if (!userIds.length) return;
  void (async () => {
    for (const userId of userIds) {
      await sendWelcome({ companyId, userId, inviterId }, deps);
      if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
    }
  })();
}
