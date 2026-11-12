/**
 * POST /admin/users/:id/send-password-reset — an ArrivePing super admin emails
 * a customer their reset link from /admin/clients.
 *
 * Protects: only super admins (not company admins, not Control Hub sales staff);
 * only customers in the company being viewed; a customer with no email gets a
 * clear refusal and nothing is sent; it's audited; and it is rate-limited so it
 * can't flood a customer's inbox.
 *
 * Harness: in-memory PGlite, ids prefixed "pwr-". The better-auth call is stubbed.
 */
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { ensureTables } = await import("../../../test-support/tables");
const { auth } = await import("../../auth");
const { adminRoutes } = await import("../admin");
const { maskEmail } = await import("../../lib/mask-email");

const CO = "pwr-co";
const OTHER_CO = "pwr-other";

let sent: { email: string; redirectTo: string }[] = [];
(auth.api as any).requestPasswordReset = async ({ body }: any) => {
  sent.push({ email: body.email, redirectTo: body.redirectTo });
  return { status: true };
};

type Who = { role: string; platformRole?: string | null; companyId?: string } | null;
let who: Who = { role: "superadmin", platformRole: "owner" };

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", who?.companyId ?? CO);
  c.set("platformRole", (who?.platformRole ?? null) as never);
  c.set("user", who ? ({ id: "pwr-admin", role: who.role, email: "support@arriveping.test", name: "Support" } as any) : null);
  return next();
});
app.route("/admin", adminRoutes);

const post = (id: string) => app.request(`/admin/users/${id}/send-password-reset`, { method: "POST" });

async function person(id: string, role: string, email: string | null, company = CO) {
  await db.insert(schema.user).values({ id, name: id, email: email ?? `${id}@none.invalid`, role, companyId: company } as never).onConflictDoNothing();
  if (email === null) await db.update(schema.user).set({ email: "" } as never).where(eq(schema.user.id, id));
  await db
    .insert(schema.memberships)
    .values({ id: `m-${id}`, userId: id, companyId: company, role, status: "active", staffType: "tech" } as never)
    .onConflictDoNothing();
}

beforeAll(async () => {
  await ensureTables(schema.user, schema.memberships, schema.auditLog, schema.companies);
  await person("pwr-cust", "customer", "jane.doe@example.com");
  await person("pwr-noemail", "customer", null);
  await person("pwr-tech", "rider", "tech@example.com");
  await person("pwr-foreign", "customer", "far@example.com", OTHER_CO);
});

beforeEach(() => {
  sent = [];
  who = { role: "superadmin", platformRole: "owner" };
});

describe("POST /admin/users/:id/send-password-reset", () => {
  it("emails the reset link to the customer and audits it", async () => {
    const res = await post("pwr-cust");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, email: "j***@example.com" });
    expect(sent).toEqual([{ email: "jane.doe@example.com", redirectTo: expect.stringContaining("/reset-password") }]);
    const log = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, "pwr-cust"));
    expect(log.some((r) => r.action === "password_reset_sent" && r.actorId === "pwr-admin")).toBe(true);
  });

  it("is refused for a company admin", async () => {
    who = { role: "admin" };
    expect((await post("pwr-noemail")).status).toBe(403);
    expect(sent).toEqual([]);
  });

  it("is refused for Control Hub sales staff", async () => {
    who = { role: "superadmin", platformRole: "sales" };
    expect((await post("pwr-noemail")).status).toBe(403);
  });

  it("is refused when signed out", async () => {
    who = null;
    expect((await post("pwr-cust")).status).toBe(401);
  });

  it("won't reach a customer of another company", async () => {
    expect((await post("pwr-foreign")).status).toBe(404);
    expect(sent).toEqual([]);
  });

  it("only sends to customers", async () => {
    const res = await post("pwr-tech");
    expect(res.status).toBe(400);
    expect(sent).toEqual([]);
  });

  it("says so when the customer has no email", async () => {
    const res = await post("pwr-noemail");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toContain("no email");
    expect(sent).toEqual([]);
  });

  it("limits repeats to the same customer", async () => {
    await person("pwr-spam", "customer", "spam@example.com");
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await post("pwr-spam")).status);
    expect(codes).toEqual([200, 200, 200, 429]);
    expect(sent.length).toBe(3);
  });
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("j***@example.com");
    expect(maskEmail("nope")).toBe("***");
  });
});
