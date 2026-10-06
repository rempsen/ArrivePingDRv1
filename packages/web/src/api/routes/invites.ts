import { Hono } from "hono";
import { sdb } from "../database";
import { tdb } from "../database/tenant";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, tx, tenantId } from "../middleware/auth";
import { attachMembership, isMember, findUserByEmail } from "../lib/memberships";
import { sendJoinCompanyInvite } from "../lib/join-invite";
import { auth } from "../auth";
import { sendEmail, loadEmailBrand, resolveLogo } from "../../services/email";
import { logoDims, contrastText } from "../../services/email-render";
import { sendSms } from "../../services/sms";

import { z } from "zod";
import { jsonBody, shortText, optText, email as emailField, phone as phoneField } from "../lib/validate";
import type { AppEnv } from "../env";

type SessionUser = { id: string; name?: string };

/* -------------------------------------------------------------------------- */
/*  Request schemas                                                            */
/*                                                                             */
/*  POST / took `email` as any non-empty string, so an invite could be sent to  */
/*  "not an email" (a hard bounce against the tenant's own sending domain --    */
/*  bounces are what get a domain's reputation shredded), and name/phone/       */
/*  skillClass were unbounded strings interpolated into an outbound email.      */
/*                                                                             */
/*  POST /accept/:token is PUBLIC and unauthenticated: it accepted an arbitrary */
/*  length `name` and `phone` straight into a new login account, and enforced   */
/*  a 6-character minimum password while better-auth itself wants 8, so the     */
/*  hand-rolled check produced a confusing 400 from the auth layer instead.     */
/* -------------------------------------------------------------------------- */
const InviteCreate = z.object({
  email: emailField(),
  name: optText(120),
  phone: phoneField.optional(),
  skillClass: optText(60),
});

const InviteAccept = z.object({
  name: shortText("Name", 120).optional(),
  password: z
    .string({ message: "Password is required" })
    .min(8, "Password must be at least 8 characters")
    .max(200, "Password is too long"),
  phone: phoneField.optional(),
});

const SITE = (process.env.WEBSITE_URL || "http://localhost:4200").replace(/\/$/, "");

/** Company display name for a given company, used in invite emails/SMS. */
async function companyName(companyId: string): Promise<string> {
  const co = await tdb(companyId).selectOne(schema.companySettings);
  return co?.name || "ArrivePing";
}

async function companyBrand(companyId: string): Promise<{ name: string; workerNoun: string }> {
  const co = await tdb(companyId).selectOne(schema.companySettings);
  return { name: co?.name || "ArrivePing", workerNoun: co?.workerNoun || "Technician" };
}

export const invitesRoutes = new Hono<AppEnv>()
  // list invites (admin)
  .get("/", requireAdmin, async (c) => {
    const rows = await tx(c).select(schema.techInvites);
    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return c.json({ invites: rows }, 200);
  })
  // create + send an invite (admin)
  .post("/", requireAdmin, jsonBody(InviteCreate), async (c) => {
    const u = c.get("user") as SessionUser;
    const b = c.req.valid("json");
    const exists = await findUserByEmail(b.email);
    if (exists) {
      // They already have an ArrivePing login — probably a contract technician who
      // works for another company. Don't ask them to create a second account
      // (and don't let this company set a password for them). Invite them to
      // join with the login they already have.
      const cid = tenantId(c);
      if (await isMember(exists.id, cid))
        return c.json({ message: "That person is already on your team" }, 409);
      const { membership } = await attachMembership({
        userId: exists.id,
        companyId: cid,
        role: "rider",
        staffType: "technician",
        status: "invited",
        invitedBy: u.id,
      });
      await sendJoinCompanyInvite({
        email: exists.email,
        name: exists.name,
        companyId: cid,
        membershipId: membership!.id,
      }).catch((e) => console.error("join-company invite failed", e));
      return c.json(
        {
          existingAccount: true,
          status: "invited",
          message:
            "That email already has an ArrivePing login. We've invited them to join your company — they'll keep their existing password.",
        },
        201,
      );
    }

    const [inv] = await tx(c).insert(schema.techInvites, {
      email: b.email,
      name: b.name || "",
      phone: b.phone || "",
      skillClass: b.skillClass || "General",
      invitedBy: u.id,
    });
    if (!inv) throw new Error("failed to create invite");

    const link = `${SITE}/join/${inv.token}`;
    const company = await companyName(inv.companyId);
    const brand = await loadEmailBrand(inv.companyId);
    const accent = brand.brandColor || "#06B6D4";
    // Tenant logo always sits above the company name in the header.
    const logoSrc = resolveLogo(brand.logoUrl);
    const { height: logoH, maxWidth: logoMaxW } = logoDims(brand.logoHeight);
    const headerText = contrastText(accent);
    const logoBlock = logoSrc
      ? `<img src="${logoSrc}" alt="${company}" style="height:${logoH}px;max-width:${logoMaxW}px;display:block;margin:0 auto 8px"/>
         <div style="color:${headerText};font-size:15px;font-weight:700;text-align:center">${company}</div>`
      : `<div style="color:${headerText};font-size:18px;font-weight:800;text-align:center">${company}</div>`;

    // email the invite
    sendEmail({
      to: inv.email,
      subject: `You're invited to join ${company} as a technician`,
      html: `<div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <div style="background:linear-gradient(135deg,${accent},${accent}cc);border-radius:16px 16px 0 0;padding:22px 24px">
          ${logoBlock}
        </div>
        <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:24px">
          <h2 style="margin:0 0 10px;color:#0f172a">Welcome aboard${inv.name ? ", " + inv.name : ""} 👋</h2>
          <p style="font-size:14px;color:#334155;line-height:1.6">You've been invited to join <b>${company}</b> as a technician. Set up your account to start receiving job assignments, navigate to clients, and update job status in real time.</p>
          <a href="${link}" style="display:inline-block;margin-top:16px;background:${accent};color:${contrastText(accent)};text-decoration:none;font-weight:700;padding:11px 21px;border:1px solid rgba(15,23,42,0.14);border-radius:10px">Accept invite & set password</a>
          <p style="margin-top:18px;font-size:12px;color:#94a3b8">If the button doesn't work, paste this link: ${link}</p>
        </div>
      </div>`,
    }).catch((e) => console.error("invite email failed", e));

    if (inv.phone) {
      sendSms(inv.phone, `${company}: You're invited to join as a technician. Set up your account: ${link}`).catch(() => {});
    }

    return c.json({ invite: inv, link }, 201);
  })
  // resend
  .post("/:id/resend", requireAdmin, async (c) => {
    const inv = await tx(c).selectOne(schema.techInvites, eq(schema.techInvites.id, c.req.param("id")));
    if (!inv) return c.json({ message: "Not found" }, 404);
    const link = `${SITE}/join/${inv.token}`;
    const company = await companyName(inv.companyId);
    sendEmail({ to: inv.email, subject: `Reminder: join ${company} as a technician`, html: `<p>Your invite link: <a href="${link}">${link}</a></p>` }).catch(() => {});
    if (inv.phone) sendSms(inv.phone, `${company}: Reminder — set up your technician account: ${link}`).catch(() => {});
    return c.json({ ok: true, link }, 200);
  })
  // revoke
  .post("/:id/revoke", requireAdmin, async (c) => {
    const [inv] = await tx(c).update(schema.techInvites, { status: "revoked" }, eq(schema.techInvites.id, c.req.param("id")));
    return c.json({ invite: inv }, 200);
  })

  // ---- PUBLIC: look up an invite by token (for the join page) ----
  // No request user/tenant context yet — the invite token itself resolves the
  // company, so this has to run on the BYPASSRLS system connection.
  .get("/lookup/:token", async (c) => {
    const [inv] = await sdb.select().from(schema.techInvites).where(eq(schema.techInvites.token, c.req.param("token")));
    if (!inv || inv.status !== "pending") return c.json({ message: "Invite not found or already used" }, 404);
    const brand = await companyBrand(inv.companyId);
    return c.json({ invite: { email: inv.email, name: inv.name, skillClass: inv.skillClass }, company: brand.name, workerNoun: brand.workerNoun }, 200);
  })
  // ---- PUBLIC: accept an invite -> create user(role=rider) + active rider profile ----
  .post("/accept/:token", jsonBody(InviteAccept), async (c) => {
    const token = c.req.param("token");
    const { name, password, phone } = c.req.valid("json");
    // Pre-tenant: the token itself is what resolves the company.
    const [inv] = await sdb.select().from(schema.techInvites).where(eq(schema.techInvites.token, token));
    if (!inv || inv.status !== "pending") return c.json({ message: "Invite not found or already used" }, 404);

    const exists = await findUserByEmail(inv.email);
    if (exists) return c.json({ message: "Account already exists — please sign in" }, 409);

    try {
      await auth.api.signUpEmail({
        body: { name: name || inv.name || inv.email, email: inv.email, password, role: "rider", phone: phone || inv.phone || "" } as any,
      });
    } catch (e: any) {
      return c.json({ message: e?.message ?? "Sign-up failed" }, 400);
    }
    const u = await findUserByEmail(inv.email);
    if (!u) return c.json({ message: "Failed to create account" }, 500);
    // The new tech belongs to the inviting company — stamp tenant onto the
    // user row for the first time. Deliberately cross-tenant/pre-membership,
    // same as the equivalent stamp in team.ts's create path.
    await sdb.update(schema.user).set({ role: "rider", phone: phone || inv.phone || "", companyId: inv.companyId }).where(eq(schema.user.id, u.id));
    // The membership is what actually grants them their role at this company.
    await attachMembership({
      userId: u.id,
      companyId: inv.companyId,
      role: "rider",
      staffType: "technician",
      status: "active",
    });

    const palette = ["#06b6d4", "#22c55e", "#f59e0b", "#a855f7", "#ef4444", "#3b82f6"];
    const t = tdb(inv.companyId);
    await t.insert(schema.riders, {
      userId: u.id,
      phone: phone || inv.phone || "",
      skillClass: inv.skillClass || "General",
      color: palette[Math.floor(Math.random() * palette.length)],
      status: "available",
      approval: "active",
    });
    await t.update(schema.techInvites, { status: "accepted", acceptedAt: new Date() }, eq(schema.techInvites.id, inv.id));
    return c.json({ ok: true, email: inv.email }, 200);
  });
