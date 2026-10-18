/**
 * Welcome email for someone a company adds to its team (services/welcome.ts).
 *
 *  - Technicians and office staff get one, the moment they're added, in the
 *    company's name: a set-password link plus the app (field) or the
 *    dashboard (office). Customers, sample people and anyone not active on
 *    the team get nothing.
 *  - The set-password link is a real better-auth reset token: redeeming it
 *    through the normal reset endpoint sets the password, and sending a new
 *    one makes the old link stop working.
 *  - Sending is remembered on the membership (welcomeSentAt).
 *
 * Ephemeral in-memory database; ids prefixed "wl-".
 */
import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { and, eq, like } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.RESEND_API_KEY = "";
process.env.APP_URL = "https://app.example.test";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const w = await import("../welcome");
const { parseOnboarding } = await import("../../shared/onboarding");

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

const CO = "wl-co";
const sent: { to: string; subject: string; html: string; text?: string; replyTo?: string }[] = [];
const deps = {
  send: (async (o: any) => {
    sent.push(o);
    return { ok: true };
  }) as any,
};

const people = [
  { id: "wl-boss", name: "Dana Owner", email: "dana@wl.test", role: "admin" },
  { id: "wl-tech", name: "Marcus Lee", firstName: "Marcus", email: "marcus@wl.test", role: "rider" },
  { id: "wl-disp", name: "Dee Dispatch", email: "dee@wl.test", role: "dispatcher" },
  { id: "wl-cust", name: "Pat Customer", email: "pat@wl.test", role: "customer" },
  // A sample person's .invalid address. (Not flagged isSample here: other test
  // files share this database and count sample people; the flag is covered below.)
  { id: "wl-sample", name: "Sam Sample", email: "sam@wl-co.invalid", role: "rider" },
  { id: "wl-gone", name: "Gail Gone", email: "gail@wl.test", role: "rider" },
];

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTable(v);
  await db.insert(schema.companies).values({ id: CO, name: "Prairie Comfort" } as any);
  await db.insert(schema.companySettings).values({ id: CO, companyId: CO, name: "Prairie Comfort", workerNoun: "Installer" } as any);
  for (const p of people) {
    await db.insert(schema.user).values({ ...p, companyId: CO } as any);
    await db.insert(schema.memberships).values({
      id: `m-${p.id}`,
      userId: p.id,
      companyId: CO,
      role: p.role,
      status: p.id === "wl-gone" ? "disabled" : "active",
    } as any);
  }
});
beforeEach(() => {
  sent.length = 0;
});

describe("who gets a welcome", () => {
  it("field staff and office roles; never customers or platform operators", () => {
    expect(w.welcomeKind("rider")).toBe("field");
    for (const r of ["admin", "manager", "dispatcher", "project_manager"]) expect(w.welcomeKind(r)).toBe("office");
    expect(w.welcomeKind("customer")).toBeNull();
    expect(w.welcomeKind("superadmin")).toBeNull();
    expect(w.welcomeKind(undefined)).toBeNull();
  });
});

describe("sendWelcome", () => {
  it("a technician: company-branded, set-password link, app stores, their email", async () => {
    const r = await w.sendWelcome({ companyId: CO, userId: "wl-tech", inviterId: "wl-boss" }, deps);
    expect(r).toEqual({ sent: true });
    expect(sent).toHaveLength(1);
    const m = sent[0]!;
    expect(m.to).toBe("marcus@wl.test");
    expect(m.subject).toBe("Prairie Comfort added you to ArrivePing");
    expect(m.html).toContain("Hi Marcus");
    expect(m.html).toContain("Dana Owner at <b>Prairie Comfort</b>");
    // The company's own word for its field staff.
    expect(m.html).toContain("an <b>installer</b>");
    expect(m.html).toMatch(/https:\/\/app\.example\.test\/reset-password\?token=[A-Za-z0-9_-]+&amp;welcome=field|https:\/\/app\.example\.test\/reset-password\?token=[A-Za-z0-9_-]+&welcome=field/);
    expect(m.html).toContain("Search for <b>ArrivePing</b> in the App Store or Google Play");
    expect(m.html).toContain("marcus@wl.test");
    expect(m.text).toContain("1. Set your password");
    const [mem] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, "m-wl-tech"));
    expect(parseOnboarding(mem!.onboarding).welcomeSentAt).toBeTruthy();
  });

  it("store buttons appear once the store links are configured", async () => {
    process.env.APP_STORE_URL = "https://apps.apple.com/app/id123";
    process.env.PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.nvc360.uberize";
    try {
      await w.sendWelcome({ companyId: CO, userId: "wl-tech", inviterId: "wl-boss" }, deps);
      expect(sent[0]!.html).toContain('href="https://apps.apple.com/app/id123"');
      expect(sent[0]!.html).toContain("details?id=com.nvc360.uberize");
      expect(sent[0]!.html).not.toContain("Search for <b>ArrivePing</b>");
    } finally {
      delete process.env.APP_STORE_URL;
      delete process.env.PLAY_STORE_URL;
    }
  });

  it("a dispatcher: the dashboard sign-in, not the app", async () => {
    const r = await w.sendWelcome({ companyId: CO, userId: "wl-disp", inviterId: "wl-boss" }, deps);
    expect(r.sent).toBe(true);
    const m = sent[0]!;
    expect(m.html).toContain("a <b>dispatcher</b>");
    expect(m.html).toContain("https://app.example.test/sign-in");
    expect(m.html).toContain("welcome=office");
    expect(m.html).not.toContain("App Store");
  });

  it("nothing for a customer, a sample person or someone deactivated", async () => {
    expect(await w.sendWelcome({ companyId: CO, userId: "wl-cust" }, deps)).toEqual({ sent: false, reason: "role" });
    expect(await w.sendWelcome({ companyId: CO, userId: "wl-sample" }, deps)).toEqual({ sent: false, reason: "sample" });
    // Flagged as sample, with a real-looking address: still nothing.
    await db.update(schema.user).set({ email: "sam@real.test", isSample: true }).where(eq(schema.user.id, "wl-sample"));
    try {
      expect(await w.sendWelcome({ companyId: CO, userId: "wl-sample" }, deps)).toEqual({ sent: false, reason: "sample" });
    } finally {
      await db.update(schema.user).set({ email: "sam@wl-co.invalid", isSample: false }).where(eq(schema.user.id, "wl-sample"));
    }
    expect(await w.sendWelcome({ companyId: CO, userId: "wl-gone" }, deps)).toEqual({ sent: false, reason: "not on the team" });
    expect(await w.sendWelcome({ companyId: "wl-other-co", userId: "wl-tech" }, deps)).toEqual({ sent: false, reason: "not on the team" });
    expect(sent).toHaveLength(0);
  });

  it("a failed send is reported and not recorded as sent", async () => {
    await db.update(schema.memberships).set({ onboarding: null }).where(eq(schema.memberships.id, "m-wl-disp"));
    const r = await w.sendWelcome({ companyId: CO, userId: "wl-disp" }, { send: (async () => ({ ok: false, error: "boom" })) as any });
    expect(r).toEqual({ sent: false, reason: "send failed" });
    const [mem] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, "m-wl-disp"));
    expect(parseOnboarding(mem!.onboarding).welcomeSentAt).toBeUndefined();
  });
});

describe("a spreadsheet roster", () => {
  it("welcomes each new person in turn, skipping the ones who don't get one", async () => {
    w.queueWelcomes(CO, ["wl-tech", "wl-cust", "wl-disp"], "wl-boss", 0, deps);
    for (let i = 0; i < 50 && sent.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    expect(sent.map((m) => m.to)).toEqual(["marcus@wl.test", "dee@wl.test"]);
  });
});

describe("the set-password link", () => {
  const tokensFor = async (userId: string) =>
    (await db.select().from(schema.verification).where(and(eq(schema.verification.value, userId), like(schema.verification.identifier, "reset-password:%")))).map((v) =>
      v.identifier.slice("reset-password:".length),
    );

  it("lasts 7 days, and a new one replaces the old", async () => {
    const now = new Date("2026-10-18T03:00:00Z");
    const first = new URL(await w.setPasswordLink("wl-tech", "field", now));
    expect(first.pathname).toBe("/reset-password");
    expect(first.searchParams.get("welcome")).toBe("field");
    const t1 = first.searchParams.get("token")!;
    expect(await tokensFor("wl-tech")).toEqual([t1]);
    const [row] = await db.select().from(schema.verification).where(eq(schema.verification.identifier, `reset-password:${t1}`));
    expect(row!.expiresAt.getTime() - now.getTime()).toBe(7 * 86_400_000);

    const t2 = new URL(await w.setPasswordLink("wl-tech", "field", now)).searchParams.get("token")!;
    expect(t2).not.toBe(t1);
    expect(await tokensFor("wl-tech")).toEqual([t2]);
  });

  it("is redeemed by the normal reset-password endpoint", async () => {
    const { auth } = await import("../../api/auth");
    const token = new URL(await w.setPasswordLink("wl-disp", "office")).searchParams.get("token")!;
    const res = await auth.api.resetPassword({ body: { newPassword: "Correct-horse-42", token } });
    expect(res.status).toBe(true);
    // One use only.
    expect(await tokensFor("wl-disp")).toEqual([]);
    const accounts = await db.select().from(schema.account).where(eq(schema.account.userId, "wl-disp"));
    expect(accounts.some((a) => a.providerId === "credential" && Boolean(a.password))).toBe(true);
  });
});
