/**
 * Self-service account deletion (services/account-deletion.ts).
 *
 * App Store guideline 5.1.1(v): a person who signs in to the app must be able
 * to delete their account from inside it. We anonymize rather than drop the
 * row so every tenant keeps its job history, exactly as the privacy policy's
 * retention clause says.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const realStripe = { ...(await import("../stripe")) };
beforeAll(() => {
  mock.module("../stripe", () => ({ ...realStripe, stripeEnabled: false }));
});
afterAll(() => {
  mock.module("../stripe", () => realStripe);
});

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { getTableConfig } = await import("drizzle-orm/pg-core");
const { eq, and } = await import("drizzle-orm");
const { deleteOwnAccount, deletionBlockers } = await import("../account-deletion");
const { AccessError } = await import("../user-access");

function ddlFor(table: any): string {
  const cfg = getTableConfig(table);
  const cols = cfg.columns.map((col: any) => {
    const parts = [`"${col.name}"`, col.getSQLType()];
    if (col.primary) parts.push("PRIMARY KEY");
    const d = col.default;
    const lit = typeof d === "string" ? `'${d.replace(/'/g, "''")}'` : typeof d === "boolean" ? (d ? "TRUE" : "FALSE") : typeof d === "number" ? String(d) : null;
    if (col.notNull && (lit !== null || col.primary)) parts.push("NOT NULL");
    if (lit !== null) parts.push(`DEFAULT ${lit}`);
    return parts.join(" ");
  });
  return `CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cols.join(", ")})`;
}

const A = "ad-a"; // company where the tech works and has open jobs
const B = "ad-b"; // second company: tech is the only admin here

async function reseed() {
  const sql = (db as any).$client;
  for (const t of ["bookings", "memberships", "riders", "audit_log", "push_tokens"]) await sql.execute(`DELETE FROM ${t} WHERE company_id IN ('${A}','${B}')`);
  for (const t of ["session", "account", "verification"]) await sql.execute(`DELETE FROM "${t}"`);
  await sql.execute(`DELETE FROM "user" WHERE id LIKE 'ad-%'`);
  await sql.execute(`DELETE FROM companies WHERE id IN ('${A}','${B}')`);
  await sql.execute({ sql: "INSERT INTO companies (id, name, billing_status, billing_seats) VALUES (?,?,?,?)", args: [A, "Acme Heating", "active", 5] });
  await sql.execute({ sql: "INSERT INTO companies (id, name, billing_status, billing_seats) VALUES (?,?,?,?)", args: [B, "Bolt Plumbing", "active", 5] });

  const users: [string, string, string, string][] = [
    ["ad-tech", "Tess Tech", "rider", A],
    ["ad-admin", "Ada Admin", "admin", A],
    ["ad-other", "Ollie Other", "rider", A],
    ["ad-super", "Sue Super", "superadmin", A],
  ];
  for (const [id, name, role, co] of users) {
    await sql.execute({
      sql: 'INSERT INTO "user" (id, name, email, role, company_id, email_verified, phone, image, first_name, last_name, address) VALUES (?,?,?,?,?,TRUE,?,?,?,?,?)',
      args: [id, name, `${id}@t.test`, role, co, "204-555-0100", "https://img/x.png", name.split(" ")[0], name.split(" ")[1], "1 Main St"],
    });
  }
  // Tech: field staff at A (rider profile with PII), sole admin at B.
  await sql.execute({ sql: "INSERT INTO memberships (id, user_id, company_id, role, status, staff_type) VALUES (?,?,?,?,?,?)", args: ["m-tech-a", "ad-tech", A, "rider", "active", "technician"] });
  await sql.execute({ sql: "INSERT INTO memberships (id, user_id, company_id, role, status) VALUES (?,?,?,?,?)", args: ["m-tech-b", "ad-tech", B, "admin", "active"] });
  await sql.execute({ sql: "INSERT INTO memberships (id, user_id, company_id, role, status) VALUES (?,?,?,?,?)", args: ["m-admin-a", "ad-admin", A, "admin", "active"] });
  await sql.execute({ sql: "INSERT INTO memberships (id, user_id, company_id, role, status, staff_type) VALUES (?,?,?,?,?,?)", args: ["m-other-a", "ad-other", A, "rider", "active", "technician"] });
  await sql.execute({ sql: "INSERT INTO riders (id, user_id, company_id, approval, phone, photo_url, license_number, address) VALUES (?,?,?,?,?,?,?,?)", args: ["rd-tech", "ad-tech", A, "active", "204-555-0100", "https://img/head.png", "DL123", "1 Main St"] });
  await sql.execute({ sql: "INSERT INTO riders (id, user_id, company_id, approval) VALUES (?,?,?,?)", args: ["rd-other", "ad-other", A, "active"] });
  const jobs: [string, string, string][] = [
    ["bk-open", "rd-tech", "assigned"],
    ["bk-enroute", "rd-tech", "enroute"],
    ["bk-done", "rd-tech", "completed"],
  ];
  for (const [id, rid, status] of jobs) {
    await sql.execute({ sql: "INSERT INTO bookings (id, company_id, customer_id, service_id, title, status, address, scheduled_at, rider_id, assign_status, clock_state) VALUES (?,?,?,?,?,?,?,?,?,?,?)", args: [id, A, "cust", "svc", id, status, "", new Date().toISOString(), rid, status === "completed" ? "" : "accepted", status === "enroute" ? "running" : "idle"] });
  }
  await sql.execute({ sql: 'INSERT INTO "session" (id, expires_at, token, user_id, created_at, updated_at) VALUES (?,?,?,?,?,?)', args: ["s-1", new Date(Date.now() + 86_400_000).toISOString(), "tok-1", "ad-tech", new Date().toISOString(), new Date().toISOString()] });
  await sql.execute({ sql: 'INSERT INTO "account" (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', args: ["acc-1", "ad-tech", "credential", "ad-tech", "hash", new Date().toISOString(), new Date().toISOString()] });
  await sql.execute({ sql: 'INSERT INTO "verification" (id, identifier, value, expires_at) VALUES (?,?,?,?)', args: ["v-1", "ad-tech@t.test", "code", new Date(Date.now() + 86_400_000).toISOString()] });
  await sql.execute({ sql: "INSERT INTO push_tokens (id, company_id, user_id, token) VALUES (?,?,?,?)", args: ["pt-1", A, "ad-tech", "ExponentPushToken[abc]"] });
}

beforeAll(async () => {
  const sql = (db as any).$client;
  for (const t of [schema.companies, schema.user, schema.memberships, schema.riders, schema.bookings, schema.auditLog, schema.session, schema.account, schema.verification, schema.pushTokens]) await sql.execute(ddlFor(t));
});
beforeEach(reseed);

async function one<T extends { id: string }>(table: any, id: string): Promise<T> {
  const [r] = await db.select().from(table).where(eq(table.id, id));
  return r as T;
}
async function expectAccessError(p: Promise<unknown>, status: number, code: string) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AccessError);
    expect((e as InstanceType<typeof AccessError>).status).toBe(status);
    expect((e as InstanceType<typeof AccessError>).code).toBe(code);
    return e as InstanceType<typeof AccessError>;
  }
  throw new Error(`expected AccessError ${status} ${code}`);
}

describe("deletionBlockers", () => {
  it("names every company where the person is the last active admin", async () => {
    const blockers = await deletionBlockers("ad-tech");
    expect(blockers).toEqual([{ companyId: B, company: "Bolt Plumbing", reason: "last_admin" }]);
  });

  it("is empty for a plain tech", async () => {
    expect(await deletionBlockers("ad-other")).toEqual([]);
  });
});

describe("deleteOwnAccount", () => {
  it("refuses while the person is the last admin somewhere, changing nothing", async () => {
    const err = await expectAccessError(deleteOwnAccount("ad-tech"), 409, "last_admin");
    expect(err.meta).toEqual({ blockers: [{ companyId: B, company: "Bolt Plumbing", reason: "last_admin" }] });
    const u = await one<typeof schema.user.$inferSelect>(schema.user, "ad-tech");
    expect(u.email).toBe("ad-tech@t.test");
    expect((await one<typeof schema.memberships.$inferSelect>(schema.memberships, "m-tech-a")).status).toBe("active");
  });

  it("refuses platform superadmins", async () => {
    await expectAccessError(deleteOwnAccount("ad-super"), 400, "superadmin");
  });

  it("404s for an unknown user", async () => {
    await expectAccessError(deleteOwnAccount("ad-nobody"), 404, "not_found");
  });

  it("releases open jobs, disables every membership, scrubs PII and revokes credentials", async () => {
    // Give B a second admin so the tech is free to go.
    const sql = (db as any).$client;
    await sql.execute({ sql: "INSERT INTO memberships (id, user_id, company_id, role, status) VALUES (?,?,?,?,?)", args: ["m-admin-b", "ad-admin", B, "admin", "active"] });

    const r = await deleteOwnAccount("ad-tech");
    expect(r.companies.sort()).toEqual([A, B]);
    expect(r.releasedJobs).toBe(2);

    // Open jobs go back to the board; finished work is untouched.
    const open = await one<typeof schema.bookings.$inferSelect>(schema.bookings, "bk-open");
    expect(open.riderId).toBeNull();
    expect(open.status).toBe("confirmed");
    expect(open.assignStatus).toBe("released");
    const enroute = await one<typeof schema.bookings.$inferSelect>(schema.bookings, "bk-enroute");
    expect(enroute.riderId).toBeNull();
    expect(enroute.clockState).toBe("idle");
    const done = await one<typeof schema.bookings.$inferSelect>(schema.bookings, "bk-done");
    expect(done.riderId).toBe("rd-tech");
    expect(done.status).toBe("completed");

    // Memberships disabled with a timestamp (shows under "Deactivated" on both rosters).
    for (const id of ["m-tech-a", "m-tech-b"]) {
      const m = await one<typeof schema.memberships.$inferSelect>(schema.memberships, id);
      expect(m.status).toBe("disabled");
      expect(m.deactivatedAt).not.toBeNull();
    }

    // Rider profile suspended and scrubbed; the row itself survives for history.
    const rd = await one<typeof schema.riders.$inferSelect>(schema.riders, "rd-tech");
    expect(rd.approval).toBe("suspended");
    expect(rd.status).toBe("offline");
    expect(rd.phone).toBe("");
    expect(rd.photoUrl).toBe("");
    expect(rd.licenseNumber).toBe("");
    expect(rd.address).toBe("");
    expect(rd.lat).toBeNull();

    // User row anonymized, not deleted.
    const u = await one<typeof schema.user.$inferSelect>(schema.user, "ad-tech");
    expect(u.name).toBe("Deleted user");
    expect(u.email).toBe("deleted-ad-tech@anon.arriveping.com");
    expect(u.emailVerified).toBe(false);
    expect(u.phone).toBeNull();
    expect(u.image).toBeNull();
    expect(u.firstName).toBeNull();
    expect(u.address).toBeNull();

    // Nothing left to sign in with.
    expect(await db.select().from(schema.session).where(eq(schema.session.userId, "ad-tech"))).toEqual([]);
    expect(await db.select().from(schema.account).where(eq(schema.account.userId, "ad-tech"))).toEqual([]);
    expect(await db.select().from(schema.verification).where(eq(schema.verification.identifier, "ad-tech@t.test"))).toEqual([]);
    expect(await db.select().from(schema.pushTokens).where(eq(schema.pushTokens.userId, "ad-tech"))).toEqual([]);

    // Teammates untouched.
    expect((await one<typeof schema.memberships.$inferSelect>(schema.memberships, "m-other-a")).status).toBe("active");
    const [log] = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.companyId, A), eq(schema.auditLog.action, "account.delete")));
    expect(log?.entityId).toBe("ad-tech");
  });

  it("is idempotent: a second call on an anonymized account is a 404", async () => {
    const sql = (db as any).$client;
    await sql.execute({ sql: "INSERT INTO memberships (id, user_id, company_id, role, status) VALUES (?,?,?,?,?)", args: ["m-admin-b", "ad-admin", B, "admin", "active"] });
    await deleteOwnAccount("ad-tech");
    await expectAccessError(deleteOwnAccount("ad-tech"), 404, "not_found");
  });
});
