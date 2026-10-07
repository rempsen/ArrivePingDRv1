import type { AppEnv } from "../env";
import { Hono } from "hono";
import { sdb } from "../database";
import * as schema from "../database/schema";
import { and, eq } from "drizzle-orm";
import { requireAuth, requireAdmin, tx, tenantId } from "../middleware/auth";
import { auth } from "../auth";
import { reconcileRiderStatus } from "../../services/presence";
import { attachMembership, isMember, findUserByEmail, detachMembership, usersForCompany } from "../lib/memberships";
import { sendJoinCompanyInvite } from "../lib/join-invite";
import { putObject, deleteObject } from "../lib/storage";
import { z } from "zod";
import { jsonBody,
  shortText,
  optText,
  longText,
  money,
  email as emailField,
  phone as phoneField,
  latitude,
  longitude,
  id as idField,
} from "../lib/validate";

/* -------------------------------------------------------------------------- */
/*  Request schemas                                                            */
/*                                                                             */
/*  Probed live on :4200 before this pass; every one of these returned 200/201  */
/*  and was written to the database:                                           */
/*    - PATCH /riders/:id { payRatePerHour: "lots" } -> the STRING "lots" in a  */
/*      real() column, so payout gross pay becomes NaN for that technician      */
/*    - PATCH /riders/:id { payRatePerHour: -500 } -> negative hourly pay       */
/*    - PATCH /riders/:id { status: "on vacation" } -> a state the presence      */
/*      machine and the scheduler's availability filters don't know about       */
/*    - PATCH /riders/:id { notes: 60_000 chars }                               */
/*    - PATCH /riders/me { lat: 9999, lng: -9999 } -> the technician is plotted  */
/*      off the edge of the world on the fleet map and live tracking            */
/*  and { email: "nope nope nope" } / { rating: 999 } leaked bare 500s.         */
/* -------------------------------------------------------------------------- */
/**
 * Roles that are "office staff" rather than field staff. These people can be
 * assigned work when company_settings.officeStaffAssignable is on (see GET /).
 * `customer` and `rider` are deliberately absent.
 */
const OFFICE_STAFF_ROLES = new Set(["superadmin", "admin", "manager", "dispatcher", "project_manager"]);

/** The presence states services/presence.ts actually understands. */
const RIDER_STATUSES = ["offline", "available", "enroute", "onsite", "break", "busy"] as const;
const riderStatus = z.enum(RIDER_STATUSES, {
  message: `Status must be one of: ${RIDER_STATUSES.join(", ")}`,
});

/** Self-service heartbeat / status toggle from the mobile app. */
const RiderSelfPatch = z.object({
  vehicle: optText(120),
  lat: latitude.optional(),
  lng: longitude.optional(),
  status: riderStatus.optional(),
  heartbeat: z.boolean().optional(),
});

const RiderProfileFields = {
  phone: phoneField.optional(),
  skillClass: optText(60),
  vehicle: optText(120),
  vehicleColor: optText(40),
  color: optText(32),
  licensePlate: optText(32),
  licenseNumber: optText(60),
  address: optText(300),
  notes: longText(2_000).optional(),
  skills: z.union([z.array(shortText("Skill", 60)).max(50, "Too many skills"), z.string().max(500)]).optional(),
  payRatePerHour: money("Pay rate").optional(),
};

const RiderCreate = z.object({
  name: shortText("Name", 120),
  email: emailField(),
  password: z.string({ message: "Password is required" }).min(8, "Password must be at least 8 characters").max(200, "Password is too long"),
  ...RiderProfileFields,
  tags: z.array(z.union([idField("Tag"), z.object({ id: idField("Tag") }).passthrough()])).max(50).optional(),
});

const RiderPatch = z
  .object({
    ...RiderProfileFields,
    name: shortText("Name", 120).optional(),
    email: emailField().optional(),
    photoUrl: optText(2_000),
    status: riderStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

type SessionUser = { id: string; role?: string };

export const ridersRoutes = new Hono<AppEnv>()
  // ── Self-service routes (rider acting on own profile) ────────────────────
  // IMPORTANT: these MUST be registered BEFORE /:id routes so Hono matches
  // /me literally and doesn't capture it as /:id → requireAdmin → 403.

  // current rider's own profile (creates one if missing)
  .get("/me", requireAuth, async (c) => {
    const u = c.get("user") as SessionUser;
    const t = tx(c);
    let r = await t.selectOne(schema.riders, eq(schema.riders.userId, u.id));
    if (!r) {
      r = (await t.insert(schema.riders, { userId: u.id, status: "available" }))[0]!;
    }
    // Self-heal: derive the true status from active jobs so a stale "busy"
    // (left behind by a cancel/reassign) clears itself when the app loads.
    await reconcileRiderStatus(tenantId(c), r.id);
    r = await t.selectOne(schema.riders, eq(schema.riders.id, r.id));
    return c.json({ rider: r }, 200);
  })
  // update rider status / location
  .patch("/me", requireAuth, jsonBody(RiderSelfPatch), async (c) => {
    const u = c.get("user") as SessionUser;
    const body = c.req.valid("json");
    const t = tx(c);
    let r = await t.selectOne(schema.riders, eq(schema.riders.userId, u.id));
    if (!r) return c.json({ message: "Not found" }, 404);

    const set: Record<string, unknown> = {};
    if (body.vehicle) set.vehicle = body.vehicle;
    if (body.lat != null) { set.lat = body.lat; set.lng = body.lng; set.locationUpdatedAt = new Date(); }

    // Liveness heartbeat from the mobile app's background/foreground GPS
    // watcher: bumps locationUpdatedAt so presence doesn't flap to "offline"
    // during a GPS warm-up window. Must NEVER touch status/manualOffline —
    // this used to be sent as {status:"available"}, which silently reversed
    // an explicit "go Offline" toggle every 90s / every foreground event,
    // making the off-shift switch effectively not stick.
    if (body.heartbeat === true && body.status == null) {
      set.locationUpdatedAt = new Date();
    }

    let toggled = false;
    if (body.status === "offline") {
      set.manualOffline = true;
      set.status = "offline";
      toggled = true;
    } else if (body.status === "available") {
      set.manualOffline = false;
      set.status = "available";
      set.locationUpdatedAt = new Date();
      toggled = true;
    } else if (body.status) {
      set.status = body.status;
    }

    const riderId = r.id;
    if (Object.keys(set).length) {
      [r] = await t.update(schema.riders, set, eq(schema.riders.id, riderId));
    }
    if (toggled) {
      await reconcileRiderStatus(tenantId(c), riderId);
      r = await t.selectOne(schema.riders, eq(schema.riders.id, riderId));
    }
    return c.json({ rider: r ?? null }, 200);
  })
  // tech uploads their own headshot (self-serve, mobile). multipart field: file
  .post("/me/photo", requireAuth, async (c) => {
    const u = c.get("user") as SessionUser;
    const t = tx(c);
    let existing = await t.selectOne(schema.riders, eq(schema.riders.userId, u.id));
    if (!existing) {
      existing = (await t.insert(schema.riders, { userId: u.id, status: "available" }))[0]!;
    }
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ message: "No file" }, 400);
    if (file.size > 8 * 1024 * 1024) return c.json({ message: "Image too large (max 8MB)" }, 400);
    const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
    if (file.type && !ALLOWED.includes(file.type))
      return c.json({ message: `Unsupported type ${file.type}` }, 400);

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().slice(0, 8);
    const key = `riders/${existing.id}/${Date.now()}.${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const stored = await putObject(key, buf, file.type || "image/jpeg");
    if (existing.photoKey) await deleteObject(existing.photoKey).catch(() => {});
    const [r] = await t.update(
      schema.riders,
      { photoUrl: stored.url, photoKey: stored.key },
      eq(schema.riders.id, existing.id),
    );
    return c.json({ rider: r, photoUrl: stored.url }, 201);
  })

  // ── Admin / list routes ──────────────────────────────────────────────────
  // list all riders (admin assign UI)
  .get("/", requireAuth, async (c) => {
    const cidList = tenantId(c);
    const t = tx(c);
    const rows = await t.select(schema.riders);
    // Reuses the same members+users join team.ts's roster is built from —
    // it already carries membership status and cross-company "isShared".
    const users = await usersForCompany(cidList);
    const byUserId = new Map(users.map((u) => [u.id, u]));

    // Office staff as assignable workers (company_settings.officeStaffAssignable,
    // default on). A solo operator books the job AND does it, so the owner
    // must be pickable in "Assign …" without inventing a second login for
    // themselves. We materialise a rider profile for each active office-staff
    // member the first time the roster is read (idempotent: keyed on userId
    // within this tenant) — the same lazy pattern GET /riders/me already uses
    // when a staff member opens the mobile app. With the setting off, those
    // profiles are hidden from this list (not deleted, so history survives).
    const settings = await t.selectOne(schema.companySettings).catch(() => undefined);
    const staffAssignable = settings?.officeStaffAssignable ?? true;
    const haveProfile = new Set(rows.map((r) => r.userId));
    if (staffAssignable) {
      const missing = users.filter(
        (u) =>
          OFFICE_STAFF_ROLES.has(u.role ?? "") &&
          (u.membershipStatus ?? "active") === "active" &&
          !haveProfile.has(u.id),
      );
      for (const u of missing) {
        const [r] = await t.insert(schema.riders, {
          userId: u.id,
          phone: u.phone ?? "",
          status: "available",
          approval: "active",
        });
        if (r) rows.push(r);
      }
    }

    const enriched = rows
      .map((r) => {
        const ru = byUserId.get(r.userId);
        const role = ru?.role ?? "rider";
        const isOfficeStaff = OFFICE_STAFF_ROLES.has(role);
        return {
          ...r,
          name: ru?.name,
          email: ru?.email,
          phone: ru?.phone,
          membershipStatus: ru?.membershipStatus ?? "active",
          isShared: ru?.isShared ?? false,
          /** Membership role at this company — lets the UI badge "Admin" etc. */
          role,
          isOfficeStaff,
        };
      })
      .filter((r) => staffAssignable || !r.isOfficeStaff);
    return c.json({ riders: enriched }, 200);
  })
  // create a technician (admin): user(role=rider) + rider profile
  .post("/", requireAdmin, jsonBody(RiderCreate), async (c) => {
    const body = c.req.valid("json");
    const { name, email, password, phone, skillClass, vehicle, vehicleColor, color, licensePlate, licenseNumber, address, notes, skills, payRatePerHour, tags } = body;

    const cid = tenantId(c);
    const existing = await findUserByEmail(email);

    // A technician who already has an ArrivePing login (because they work for
    // another company) is INVITED, never re-created — and this company never
    // sets a password for them. See lib/memberships.ts for why.
    if (existing) {
      if (await isMember(existing.id, cid))
        return c.json({ message: "That person is already on your team" }, 409);

      const { membership } = await attachMembership({
        userId: existing.id,
        companyId: cid,
        role: "rider",
        staffType: "technician",
        status: "invited",
        invitedBy: (c.get("user") as { id: string } | null)?.id ?? null,
      });
      await sendJoinCompanyInvite({
        email: existing.email,
        name: existing.name,
        companyId: cid,
        membershipId: membership!.id,
      }).catch((e) => console.error("join-company invite failed", e));

      const t0 = tx(c);
      const palette0 = ["#06b6d4", "#22c55e", "#f59e0b", "#a855f7", "#ef4444", "#3b82f6"];
      const [r0] = await t0.insert(schema.riders, {
        userId: existing.id,
        phone: phone ?? existing.phone ?? "",
        skillClass: skillClass || "General",
        vehicle: vehicle || "Van",
        vehicleColor: vehicleColor ?? "",
        color: color || palette0[Math.floor(Math.random() * palette0.length)],
        licensePlate: licensePlate ?? "",
        licenseNumber: licenseNumber ?? "",
        address: address ?? "",
        notes: notes ?? "",
        skills: Array.isArray(skills) ? skills.join(",") : (skills ?? ""),
        payRatePerHour: payRatePerHour ?? 0,
        status: "available",
      });
      return c.json(
        {
          rider: r0,
          existingAccount: true,
          status: "invited",
          message:
            "That email already has an ArrivePing login. We've invited them to join your company — they'll keep their existing password.",
        },
        201,
      );
    }

    try {
      await auth.api.signUpEmail({
        body: { name, email, password, role: "rider", phone: phone ?? "" } as any,
      });
    } catch (e: any) {
      return c.json({ message: e?.message ?? "Sign-up failed" }, 400);
    }
    const u = await findUserByEmail(email);
    if (!u) return c.json({ message: "Failed to create user" }, 500);
    // ensure role/phone persisted — first-time stamp of this brand-new
    // login's home company, same pattern as team.ts's create path.
    await sdb
      .update(schema.user)
      .set({ role: "rider", phone: phone ?? "", companyId: cid })
      .where(eq(schema.user.id, u.id));
    await attachMembership({
      userId: u.id,
      companyId: cid,
      role: "rider",
      staffType: "technician",
      status: "active",
    });

    const t = tx(c);
    const palette = ["#06b6d4", "#22c55e", "#f59e0b", "#a855f7", "#ef4444", "#3b82f6"];
    const [r] = await t.insert(schema.riders, {
      userId: u.id,
      phone: phone ?? "",
      skillClass: skillClass || "General",
      vehicle: vehicle || "Van",
      vehicleColor: vehicleColor ?? "",
      color: color || palette[Math.floor(Math.random() * palette.length)],
      licensePlate: licensePlate ?? "",
      licenseNumber: licenseNumber ?? "",
      address: address ?? "",
      notes: notes ?? "",
      skills: Array.isArray(skills) ? skills.join(",") : (skills ?? ""),
      payRatePerHour: payRatePerHour ?? 0,
      status: "available",
    });
    // assign tags (entityType "tech")
    if (Array.isArray(tags) && tags.length) {
      const rows = tags
        .map((t2: any) => (typeof t2 === "string" ? t2 : t2?.id))
        .filter(Boolean)
        .map((tagId: string) => ({ tagId, entityId: r!.id, entityType: "tech" as const }));
      if (rows.length) await t.insert(schema.entityTags, rows);
    }
    return c.json({ rider: { ...r, name, email, phone } }, 201);
  })
  // update a technician's profile (admin)
  .patch("/:id", requireAdmin, jsonBody(RiderPatch), async (c) => {
    const id = c.req.param("id");
    const b = c.req.valid("json");
    const patch: Record<string, unknown> = {};
    for (const k of ["vehicle", "vehicleColor", "skillClass", "color", "photoUrl", "phone", "licensePlate", "licenseNumber", "address", "notes", "status", "skills", "payRatePerHour"] as const) {
      if (k in b) patch[k] = (b as Record<string, unknown>)[k];
    }
    if (Array.isArray(patch.skills)) patch.skills = (patch.skills as string[]).join(",");

    const existing = await tx(c).selectOne(schema.riders, eq(schema.riders.id, id));
    if (!existing) return c.json({ message: "Not found" }, 404);

    // Reject a duplicate email BEFORE writing anything, or the unique index on
    // user.email throws and the client gets a bare 500.
    if (b.email) {
      const clash = await findUserByEmail(b.email);
      if (clash && clash.id !== existing.userId)
        return c.json({ message: "Email already in use" }, 409);
    }

    // Editing ONLY user-table fields (just the name, or just the email) left
    // `patch` empty, and drizzle throws "No values to set" -> raw 500. Skip the
    // rider-table write when there is nothing on it to change.
    let r: typeof existing | undefined = existing;
    if (Object.keys(patch).length) {
      [r] = await tx(c).update(
        schema.riders,
        patch as Partial<typeof schema.riders.$inferInsert>,
        eq(schema.riders.id, id),
      );
    }
    // Keep the linked user record in sync. The GET endpoint reads name/email/phone
    // from the user table, so these MUST be written there too or edits appear to revert.
    if (r && (b.name || b.email || "phone" in b)) {
      await tx(c).update(
        schema.user,
        {
          ...(b.name && { name: b.name }),
          ...(b.email && { email: b.email }),
          ...("phone" in b && { phone: b.phone ?? "" }),
        },
        eq(schema.user.id, r.userId),
      );
    }
    const ru = r ? await tx(c).selectOne(schema.user, eq(schema.user.id, r.userId)) : undefined;
    return c.json(
      { rider: r ? { ...r, name: ru?.name, email: ru?.email, phone: ru?.phone } : r },
      200,
    );
  })
  // upload a technician headshot (admin). multipart field: file
  .post("/:id/photo", requireAdmin, async (c) => {
    const id = c.req.param("id");
    const t = tx(c);
    const existing = await t.selectOne(schema.riders, eq(schema.riders.id, id));
    if (!existing) return c.json({ message: "Not found" }, 404);

    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ message: "No file" }, 400);
    if (file.size > 8 * 1024 * 1024) return c.json({ message: "Image too large (max 8MB)" }, 400);
    const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
    if (file.type && !ALLOWED.includes(file.type))
      return c.json({ message: `Unsupported type ${file.type}` }, 400);

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().slice(0, 8);
    const key = `riders/${id}/${Date.now()}.${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const stored = await putObject(key, buf, file.type || "image/jpeg");

    if (existing.photoKey) await deleteObject(existing.photoKey).catch(() => {});

    const [r] = await t.update(
      schema.riders,
      { photoUrl: stored.url, photoKey: stored.key },
      eq(schema.riders.id, id),
    );
    return c.json({ rider: r, photoUrl: stored.url }, 201);
  })
  // remove a technician headshot (admin)
  .delete("/:id/photo", requireAdmin, async (c) => {
    const id = c.req.param("id");
    const t = tx(c);
    const existing = await t.selectOne(schema.riders, eq(schema.riders.id, id));
    if (!existing) return c.json({ message: "Not found" }, 404);
    if (existing.photoKey) await deleteObject(existing.photoKey).catch(() => {});
    await t.update(schema.riders, { photoUrl: "", photoKey: "" }, eq(schema.riders.id, id));
    return c.json({ ok: true }, 200);
  })
  // delete a technician (admin): removes rider profile; only deletes the
  // shared login itself if this is the ONLY company they work for.
  .delete("/:id", requireAdmin, async (c) => {
    const id = c.req.param("id");
    const cid = tenantId(c);
    const t = tx(c);
    const r = await t.selectOne(schema.riders, eq(schema.riders.id, id));
    if (!r) return c.json({ message: "Not found" }, 404);
    // unassign any active bookings
    await t.update(
      schema.bookings,
      { riderId: null, status: "confirmed" },
      eq(schema.bookings.riderId, id),
    );
    await t.delete(schema.riders, eq(schema.riders.id, id));

    // Office staff (admin/manager/…) only hold a rider profile so they can be
    // assigned work — removing them from the technician list must NOT remove
    // their login or their seat at the company. That is done from Team.
    const [member] = await sdb
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.userId, r.userId), eq(schema.memberships.companyId, cid)));
    if (OFFICE_STAFF_ROLES.has(member?.role ?? "")) return c.json({ ok: true, profileOnly: true }, 200);

    // A technician can work for several companies on ONE shared login (see
    // memberships table doc). Hard-deleting `user` here unconditionally used
    // to wipe that person's access — and their login itself — at every OTHER
    // company they work for too, the instant one company removed them.
    // Mirrors the same check already used in admin.ts's user-delete route.
    const memberOf = await sdb
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, r.userId));
    if (memberOf.length > 1) {
      await detachMembership(r.userId, cid);
    } else {
      await t.delete(schema.user, eq(schema.user.id, r.userId));
    }
    return c.json({ ok: true }, 200);
  })
;
