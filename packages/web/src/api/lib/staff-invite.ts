/**
 * Onboarding-roster staff invite — "set them up, let them pick their own
 * password".
 *
 * The onboarding chat (routes/onboarding.ts, add_team_members tool) and any
 * future bulk-import path create the whole roster in one go: techs, dispatchers,
 * managers. Nobody types passwords for other people (the same rule the manual
 * Team / Technicians pages follow), so for a brand-new person we:
 *
 *   1. create the login with an unguessable throwaway password that is never
 *      shown to anyone (functionally "no password yet"),
 *   2. attach an ACTIVE membership at this company with the right role, so the
 *      moment they set a password they can sign in and see their work,
 *   3. for field staff, create the rider profile immediately (approval
 *      "invited", with vehicle details) so the admin sees them on the
 *      Technicians page right away,
 *   4. write a `tech_invites` row with `userId` set and email them a
 *      "Welcome — set your password" link (/join/:token, no expiry, admin can
 *      resend/revoke from the existing invites list).
 *
 * Someone who already has an ArrivePing login (works for another company) goes
 * down the existing join-company path instead — invited membership, keeps
 * their password. See lib/join-invite.ts.
 */
import { eq } from "drizzle-orm";
import { auth } from "../auth";
import { sdb } from "../database";
import * as schema from "../database/schema";
import { tdb } from "../database/tenant";
import { attachMembership, findUserByEmail, isMember } from "./memberships";
import { sendJoinCompanyInvite } from "./join-invite";
import { formatPhone } from "./validate";
import { sendEmail, loadEmailBrand, resolveLogo } from "../../services/email";
import { logoDims, contrastText } from "../../services/email-render";
import { sendSms } from "../../services/sms";

const SITE = (process.env.WEBSITE_URL || "http://localhost:4200").replace(/\/$/, "");

/** What the admin says the person does, in plain words. */
export type StaffKind = "tech" | "driver" | "dispatcher" | "manager" | "owner";

export interface StaffInviteInput {
  companyId: string;
  invitedBy: string | null;
  name: string;
  email: string;
  phone?: string | null;
  kind: StaffKind;
  /** Trade / skill label for field staff, e.g. "Plumbing", "HVAC". */
  skillClass?: string | null;
  vehicle?: {
    makeModel?: string | null; // "Ford Transit"
    color?: string | null; // "White"
    plate?: string | null;
  } | null;
  /** Skip the email/SMS (tests, dry runs). */
  silent?: boolean;
}

export interface StaffInviteResult {
  ok: boolean;
  name: string;
  email: string;
  kind: StaffKind;
  role: string;
  /** "invited" = brand-new login created, set-password email sent; "joined" = existing login invited to join; "exists" = already on the roster; "error" otherwise. */
  status: "invited" | "joined" | "exists" | "error";
  userId?: string;
  riderId?: string;
  inviteId?: string;
  link?: string;
  message?: string;
}

/** Map the plain-English kind onto our role/staffType model. */
export function kindToRole(kind: StaffKind): { role: "rider" | "dispatcher" | "manager"; staffType: "technician" | "driver" | null } {
  switch (kind) {
    case "tech":
      return { role: "rider", staffType: "technician" };
    case "driver":
      return { role: "rider", staffType: "driver" };
    case "dispatcher":
      return { role: "dispatcher", staffType: null };
    // Only a superadmin may mint admin-tier accounts; a second owner starts as
    // a manager and the admin can promote them from Team later.
    case "manager":
    case "owner":
      return { role: "manager", staffType: null };
  }
}

const KIND_LABEL: Record<StaffKind, string> = {
  tech: "technician",
  driver: "driver",
  dispatcher: "dispatcher",
  manager: "manager",
  owner: "manager",
};

function randomPassword(): string {
  // 32 bytes → 43 url-safe chars. Never stored anywhere readable, never shown.
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString("base64url");
}

const PALETTE = ["#06b6d4", "#22c55e", "#f59e0b", "#a855f7", "#ef4444", "#3b82f6", "#ec4899", "#14b8a6"];

export async function inviteStaffMember(a: StaffInviteInput): Promise<StaffInviteResult> {
  const email = a.email.trim().toLowerCase();
  const name = a.name.trim();
  const phone = formatPhone(a.phone ?? null) ?? "";
  const { role, staffType } = kindToRole(a.kind);
  const base: StaffInviteResult = { ok: false, name, email, kind: a.kind, role, status: "error" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ...base, message: "Invalid email address" };
  if (name.length < 2) return { ...base, message: "Name is required" };

  const t = tdb(a.companyId);
  const vehicleStr = (a.vehicle?.makeModel ?? "").trim();
  const vehicleColor = (a.vehicle?.color ?? "").trim();
  const plate = (a.vehicle?.plate ?? "").trim();
  const isField = role === "rider";

  // ── Existing login anywhere → join-company invite, never touch their password
  const existing = await findUserByEmail(email);
  if (existing) {
    if (await isMember(existing.id, a.companyId)) {
      return { ...base, ok: true, status: "exists", userId: existing.id, message: "Already on your team" };
    }
    const { membership } = await attachMembership({
      userId: existing.id,
      companyId: a.companyId,
      role,
      staffType,
      status: "invited",
      invitedBy: a.invitedBy,
    });
    let riderId: string | undefined;
    if (isField) {
      const existingRider = await t.selectOne(schema.riders, eq(schema.riders.userId, existing.id));
      if (existingRider) riderId = existingRider.id;
      else {
        const [r] = await t.insert(schema.riders, {
          userId: existing.id,
          phone: phone || existing.phone || "",
          skillClass: a.skillClass?.trim() || "General",
          vehicle: vehicleStr || "Van",
          vehicleColor,
          licensePlate: plate,
          color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
          status: "available",
          approval: "invited",
          invitedAt: new Date(),
        });
        riderId = r.id;
      }
    }
    if (!a.silent)
      await sendJoinCompanyInvite({ email: existing.email, name: existing.name, companyId: a.companyId, membershipId: membership!.id }).catch(
        (e) => console.error("[staff-invite] join-company email failed", e),
      );
    return {
      ...base,
      ok: true,
      status: "joined",
      userId: existing.id,
      riderId,
      message: "Already has an ArrivePing login — invited to join your company with their existing password.",
    };
  }

  // ── Brand-new person → create login (throwaway password) + active membership
  try {
    await auth.api.signUpEmail({
      body: { name, email, password: randomPassword(), role, phone } as any,
    });
  } catch (e: any) {
    return { ...base, message: e?.message ?? "Couldn't create the account" };
  }
  const u = await findUserByEmail(email);
  if (!u) return { ...base, message: "Couldn't create the account" };

  // First-time stamp of this login's home company — cross-tenant by design,
  // same as team.ts / riders.ts create paths.
  const set: Record<string, unknown> = { role, phone, companyId: a.companyId };
  if (staffType) set.staffType = staffType;
  await sdb.update(schema.user).set(set).where(eq(schema.user.id, u.id));

  await attachMembership({
    userId: u.id,
    companyId: a.companyId,
    role,
    staffType,
    status: "active",
    invitedBy: a.invitedBy,
  });

  let riderId: string | undefined;
  if (isField) {
    const [r] = await t.insert(schema.riders, {
      userId: u.id,
      phone,
      skillClass: a.skillClass?.trim() || "General",
      vehicle: vehicleStr || "Van",
      vehicleColor,
      licensePlate: plate,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      status: "offline",
      approval: "invited",
      invitedAt: new Date(),
    });
    riderId = r.id;
  }

  const [inv] = await t.insert(schema.techInvites, {
    email,
    name,
    phone,
    skillClass: a.skillClass?.trim() || "General",
    invitedBy: a.invitedBy ?? "",
    userId: u.id,
    role,
    staffType: staffType ?? "technician",
  });
  const link = `${SITE}/join/${inv.token}`;

  if (!a.silent) {
    await sendWelcomeSetPassword({ companyId: a.companyId, to: email, name, kind: a.kind, link }).catch((e) =>
      console.error("[staff-invite] welcome email failed", e),
    );
    if (phone) {
      const co = await t.selectOne(schema.companySettings);
      sendSms(phone, `${co?.name || "ArrivePing"}: you've been added as a ${KIND_LABEL[a.kind]}. Set your password here: ${link}`).catch(() => {});
    }
  }

  return { ...base, ok: true, status: "invited", userId: u.id, riderId, inviteId: inv.id, link, message: "Account created — set-password email sent." };
}

async function sendWelcomeSetPassword(a: { companyId: string; to: string; name: string; kind: StaffKind; link: string }) {
  const co = await tdb(a.companyId).selectOne(schema.companySettings);
  const company = co?.name || "ArrivePing";
  const brand = await loadEmailBrand(a.companyId);
  const accent = brand.brandColor || "#06B6D4";
  const logoSrc = resolveLogo(brand.logoUrl);
  const { height: logoH, maxWidth: logoMaxW } = logoDims(brand.logoHeight);
  const headerText = contrastText(accent);
  const logoBlock = logoSrc
    ? `<img src="${logoSrc}" alt="${company}" style="height:${logoH}px;max-width:${logoMaxW}px;display:block;margin:0 auto 8px"/>
       <div style="color:${headerText};font-size:15px;font-weight:700;text-align:center">${company}</div>`
    : `<div style="color:${headerText};font-size:18px;font-weight:800;text-align:center">${company}</div>`;
  const isField = a.kind === "tech" || a.kind === "driver";
  const what = isField
    ? "receive your job assignments, navigate to customers, and update job status from your phone"
    : "see the schedule, dispatch jobs, and keep customers in the loop";
  const noun = isField ? (co?.workerNoun || "technician").toLowerCase() : KIND_LABEL[a.kind];

  await sendEmail({
    to: a.to,
    subject: `Welcome to ${company} on ArrivePing — set your password`,
    html: `<div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <div style="background:linear-gradient(135deg,${accent},${accent}cc);border-radius:16px 16px 0 0;padding:22px 24px">
        ${logoBlock}
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:24px">
        <h2 style="margin:0 0 10px;color:#0f172a">Welcome aboard, ${a.name} 👋</h2>
        <p style="font-size:14px;color:#334155;line-height:1.6"><b>${company}</b> has set you up as a ${noun} on ArrivePing. Pick a password and you're in — you'll be able to ${what}.</p>
        <a href="${a.link}" style="display:inline-block;margin-top:16px;background:${accent};color:${contrastText(accent)};text-decoration:none;font-weight:700;padding:11px 21px;border:1px solid rgba(15,23,42,0.14);border-radius:10px">Set my password</a>
        <p style="margin-top:18px;font-size:12px;color:#94a3b8">Your login email is <b>${a.to}</b>. If the button doesn't work, paste this link: ${a.link}</p>
      </div>
    </div>`,
  });
}
