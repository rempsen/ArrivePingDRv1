/**
 * WHERE A SELF-SERVE SIGNUP GOT TO (by the card's Stripe customer), which the
 * signup page polls when its request timed out at the edge proxy:
 *   - no company for the card = not started;
 *   - a company not marked finished yet = still being set up (even once its
 *     admin exists), then stuck once old;
 *   - an admin with this email = done (with what the page needs to sign in);
 *   - an admin with another email = the card belongs to someone else.
 * In-memory database. Ids prefixed "ss-".
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { signupState, SIGNUP_PENDING_MS } = await import("../onboarding");

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

const NOW = new Date("2026-10-30T20:00:00Z");

beforeAll(async () => {
  for (const t of [schema.companies, schema.user, schema.memberships]) await ensureTable(t as unknown as PgTable);
  const co = (id: string, cus: string, createdAt: Date, billingStatus: string) =>
    db.insert(schema.companies).values({ id, name: id.toUpperCase(), billingCustomerId: cus, billingStatus, billingTrialEndsAt: new Date("2026-11-29T00:00:00Z"), createdAt } as any);
  const recent = new Date(NOW.getTime() - 60_000);
  await co("ss-done", "cus_done", recent, "trialing");
  await co("ss-wip", "cus_wip", recent, "none");
  await co("ss-late", "cus_late", recent, "none"); // admin made, last steps still running
  await co("ss-old", "cus_old", new Date(NOW.getTime() - SIGNUP_PENDING_MS - 1), "none");
  await db.insert(schema.user).values([
    { id: "ss-u1", name: "Pat", email: "Pat@Example.com", emailVerified: true, role: "admin", companyId: "ss-done", createdAt: NOW, updatedAt: NOW } as any,
  ]);
  await db.insert(schema.memberships).values([
    { id: "ss-m1", userId: "ss-u1", companyId: "ss-done", role: "admin", status: "active" },
    { id: "ss-m2", userId: "ss-u1", companyId: "ss-late", role: "admin", status: "active" },
  ] as any);
});

describe("signupState", () => {
  it("not started when no company has the card", async () => {
    expect((await signupState("cus_nope", "pat@example.com", NOW)).kind).toBe("none");
  });
  it("done for the admin who signed up (email case doesn't matter)", async () => {
    const st = await signupState("cus_done", " pat@example.com", NOW);
    expect(st.kind).toBe("done");
    if (st.kind === "done") {
      expect(st.body.companySlug).toBe("ss-done");
      expect((st.body.admin as { id: string }).id).toBe("ss-u1");
      expect(st.body.alreadyCreated).toBe(true);
    }
  });
  it("taken when the card's company has a different admin", async () => {
    expect((await signupState("cus_done", "someone@else.com", NOW)).kind).toBe("taken");
  });
  it("pending until provisioning marks it finished, stalled once it's old", async () => {
    expect((await signupState("cus_wip", "pat@example.com", NOW)).kind).toBe("pending");
    expect((await signupState("cus_late", "pat@example.com", NOW)).kind).toBe("pending");
    expect((await signupState("cus_old", "pat@example.com", NOW)).kind).toBe("stalled");
  });
});
