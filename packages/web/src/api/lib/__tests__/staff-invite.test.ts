/**
 * ONBOARDING'S "ADD MY TEAM" ONLY SAYS AN EMAIL WENT WHEN IT DID.
 *
 * The onboarding assistant adds staff through inviteStaffMember and then
 * tells the admin "invites are on their way". sendEmail reports a skipped or
 * failed send as { ok: false } instead of throwing, which this ignored, so a
 * person could be added with no email at all and the admin never told
 * (Codex on #73). The result now carries `emailed`.
 *
 * In-memory database, no RESEND_API_KEY (every email is skipped). Ids "si-".
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.RESEND_API_KEY = "";
process.env.TWILIO_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { inviteStaffMember } = await import("../staff-invite");

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

const CO = "si-co";

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTable(v);
  await db.insert(schema.companies).values([{ id: CO, name: "Staff Invite Co" } as any, { id: "si-other", name: "Other Co" } as any]);
  await db.insert(schema.companySettings).values({ id: CO, companyId: CO, name: "Staff Invite Co" });
  // Already has a login, at another company.
  await db.insert(schema.user).values({ id: "si-elsewhere", name: "Elle Where", email: "elle@si.test", role: "rider", companyId: "si-other" });
  await db.insert(schema.memberships).values({ id: "si-m-elsewhere", userId: "si-elsewhere", companyId: "si-other", role: "rider", status: "active" });
});

describe("inviteStaffMember reports whether the email went", () => {
  it("a brand-new person: added, and told the set-password email didn't go out", async () => {
    const r = await inviteStaffMember({ companyId: CO, invitedBy: null, name: "Nina New", email: "nina@si.test", kind: "tech" });
    expect(r.status).toBe("invited");
    expect(r.ok).toBe(true);
    expect(r.emailed).toBe(false);
    expect(r.message).toContain("didn't go out");
  });

  it("someone with a login elsewhere: invited, and told the invitation didn't go out", async () => {
    const r = await inviteStaffMember({ companyId: CO, invitedBy: null, name: "Elle Where", email: "elle@si.test", kind: "dispatcher" });
    expect(r.status).toBe("joined");
    expect(r.emailed).toBe(false);
    expect(r.message).toContain("Resend invite");
  });

  it("silent adds don't claim anything was sent", async () => {
    const r = await inviteStaffMember({ companyId: CO, invitedBy: null, name: "Quinn Quiet", email: "quinn@si.test", kind: "manager", silent: true });
    expect(r.status).toBe("invited");
    expect(r.emailed).toBeUndefined();
    expect(r.message).toBe("Account created.");
  });
});
