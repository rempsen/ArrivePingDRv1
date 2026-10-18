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
import { and, eq, like } from "drizzle-orm";
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
 * A one-off "set your password" link. Older unused links for the same person
 * stop working, so a resent email is the only live one.
 */
export async function setPasswordLink(userId: string, kind: "field" | "office", now = new Date()): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await sdb
    .delete(schema.verification)
    .where(and(eq(schema.verification.value, userId), like(schema.verification.identifier, "reset-password:%")));
  await sdb.insert(schema.verification).values({
    id: randomUUID(),
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt: new Date(now.getTime() + WELCOME_LINK_DAYS * DAY),
    createdAt: now,
    updatedAt: now,
  });
  return `${SITE()}/reset-password?token=${encodeURIComponent(token)}&welcome=${kind}`;
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
    const [brand, sender, url] = await Promise.all([loadEmailBrand(a.companyId), resolveFromAddress(a.companyId), setPasswordLink(a.userId, kind)]);

    const mail = emailTemplates.welcome(
      {
        kind,
        firstName: (user.firstName || user.name || "").split(" ")[0] || "there",
        email: user.email,
        inviter: inviterName,
        roleLabel,
        setPasswordUrl: url,
        signInUrl: `${SITE()}/sign-in`,
        appStoreUrl: process.env.APP_STORE_URL?.trim() || undefined,
        playStoreUrl: process.env.PLAY_STORE_URL?.trim() || undefined,
        expiresDays: WELCOME_LINK_DAYS,
      },
      brand,
    );
    const r = await send({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text, ...sender });
    if ((r as { ok?: boolean; skipped?: boolean })?.ok === false && !(r as { skipped?: boolean }).skipped) {
      log.error("welcome email failed", { companyId: a.companyId, userId: a.userId, err: (r as { error?: string }).error });
      return { sent: false, reason: "send failed" };
    }
    // Remember it on their membership (shown as "Welcome email sent" in People).
    const state = parseOnboarding(membership.onboarding);
    await t.update(
      schema.memberships,
      { onboarding: JSON.stringify({ ...state, welcomeSentAt: new Date().toISOString() }), updatedAt: new Date() },
      eq(schema.memberships.id, membership.id),
    );
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
