/**
 * ADDING SOMEONE SENDS THEM A WAY IN.
 *
 * Before this, "Add technician" and "New Employee" made the admin type a
 * temporary password and pass it on themselves, and the new person got no
 * email at all — although the help centre promised one. Now:
 *   - the password is optional; without one the account still works and the
 *     person sets their own from the welcome email, sent before the response;
 *   - "Email a sign-in link" sends a fresh one later, but only for logins this
 *     company created (someone who joined with an existing account uses
 *     Forgot password) and never reveals people on other companies' rosters.
 *
 * Drives the real ridersRoutes / teamRoutes handlers on an in-memory database;
 * the email itself goes through sendEmail with no RESEND_API_KEY (logged, not
 * sent). Ids prefixed "tw-".
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { and, eq, like } from "drizzle-orm";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.RESEND_API_KEY = "";
process.env.TWILIO_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { teamRoutes } = await import("../team");
const { ridersRoutes } = await import("../riders");
const { parseOnboarding } = await import("../../../shared/onboarding");

function colDdl(col: PgColumn, withPk: boolean): string {
  const parts = [`"${col.name}"`, col.getSQLType()];
  if (withPk && col.primary) parts.push("PRIMARY KEY");
  const d = (col as any).default;
  const lit = d === undefined ? null : typeof d === "string" ? `'${d.replace(/'/g, "''")}'` : typeof d === "boolean" ? (d ? "TRUE" : "FALSE") : typeof d === "number" ? String(d) : null;
  if (lit !== null) parts.push(`DEFAULT ${lit}`);
  return parts.join(" ");
}
async function ensureTable(table: PgTable) {
  const s = (db as any).$client;
  const cfg = getTableConfig(table);
  await s.execute(`CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cfg.columns.map((c) => colDdl(c, true)).join(", ")})`);
  for (const c of cfg.columns) if (!c.primary) await s.execute(`ALTER TABLE "${cfg.name}" ADD COLUMN IF NOT EXISTS ${colDdl(c, false)}`);
}

const CO = "tw-co";
const OTHER = "tw-other";
const BOSS = "tw-boss";

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", c.req.header("X-Test-Company") || CO);
  c.set("user", { id: BOSS, role: "admin", email: "boss@tw.test", name: "Dana Boss" } as any);
  return next();
});
app.route("/team", teamRoutes);
app.route("/riders", ridersRoutes);
// As the real app does (api/index.ts): validation errors are 400s.
app.onError((e, c) => c.json({ message: e.message }, ((e as { status?: number }).status ?? 500) as 400));

const post = (path: string, body?: unknown, company = CO) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Test-Company": company },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function personByEmail(email: string) {
  const [u] = await db.select().from(schema.user).where(eq(schema.user.email, email));
  const [m] = u ? await db.select().from(schema.memberships).where(and(eq(schema.memberships.userId, u.id), eq(schema.memberships.companyId, CO))) : [];
  const links = u ? await db.select().from(schema.verification).where(and(eq(schema.verification.value, u.id), like(schema.verification.identifier, "reset-password:%"))) : [];
  return { user: u, membership: m, links };
}

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTable(v);
  await db.insert(schema.companies).values([{ id: CO, name: "Prairie Comfort" } as any, { id: OTHER, name: "Other Co" } as any]);
  await db.insert(schema.companySettings).values({ id: CO, companyId: CO, name: "Prairie Comfort" } as any);
  await db.insert(schema.user).values([
    { id: BOSS, name: "Dana Boss", email: "boss@tw.test", role: "admin", companyId: CO } as any,
    // Works for another company first, then joined this one with that login.
    { id: "tw-contract", name: "Casey Contract", email: "casey@tw.test", role: "rider", companyId: OTHER } as any,
    { id: "tw-stranger", name: "Sid Stranger", email: "sid@tw.test", role: "rider", companyId: OTHER } as any,
  ]);
  await db.insert(schema.memberships).values([
    { id: "tw-m-boss", userId: BOSS, companyId: CO, role: "admin", status: "active" } as any,
    { id: "tw-m-contract", userId: "tw-contract", companyId: CO, role: "rider", status: "active" } as any,
    { id: "tw-m-contract-home", userId: "tw-contract", companyId: OTHER, role: "rider", status: "active" } as any,
    { id: "tw-m-stranger", userId: "tw-stranger", companyId: OTHER, role: "rider", status: "active" } as any,
  ]);
});

describe("adding someone without a password", () => {
  it("Add technician: created, welcomed, with a working set-password link", async () => {
    const res = await post("/riders", { name: "Marcus Lee", email: "marcus@tw.test", phone: "+12045550199" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.welcomeSent).toBe(true);
    const p = await personByEmail("marcus@tw.test");
    expect(p.user?.role).toBe("rider");
    expect(p.membership?.status).toBe("active");
    expect(parseOnboarding(p.membership?.onboarding).welcomeSentAt).toBeTruthy();
    expect(p.links).toHaveLength(1);
  });

  it("New Employee (dispatcher): same, office welcome", async () => {
    const res = await post("/team", { name: "Dee Dispatch", email: "dee@tw.test", role: "dispatcher" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).welcomeSent).toBe(true);
    const p = await personByEmail("dee@tw.test");
    expect(p.membership?.role).toBe("dispatcher");
    expect(p.links).toHaveLength(1);
  });

  it("a password, if the admin gives one, still has to be at least 8 characters", async () => {
    const res = await post("/team", { name: "Short Pw", email: "short@tw.test", role: "dispatcher", password: "abc" });
    expect(res.status).toBe(400);
  });
});

describe("Email a sign-in link", () => {
  it("sends a fresh link to someone this company created; the old one stops working", async () => {
    const before = (await personByEmail("marcus@tw.test")).links[0]!.identifier;
    const id = (await personByEmail("marcus@tw.test")).user!.id;
    const res = await post(`/team/${id}/send-welcome`);
    expect(res.status).toBe(200);
    const after = (await personByEmail("marcus@tw.test")).links;
    expect(after).toHaveLength(1);
    expect(after[0]!.identifier).not.toBe(before);
  });

  it("not for someone who joined with an existing login: they use Forgot password", async () => {
    const res = await post("/team/tw-contract/send-welcome");
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).message).toContain("Forgot password");
  });

  it("404 for someone on another company's roster, without saying so", async () => {
    const res = await post("/team/tw-stranger/send-welcome");
    expect(res.status).toBe(404);
    expect((await personByEmail("sid@tw.test")).links).toHaveLength(0);
  });
});
