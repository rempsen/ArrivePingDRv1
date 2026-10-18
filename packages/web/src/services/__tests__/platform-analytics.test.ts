/**
 * Platform analytics: the shared SQL gives the right numbers, leaves test
 * tenants out unless asked, binds every filter as a parameter, and renders
 * for the Claude dashboard in a form it accepts and that returns exactly
 * what the app gets.
 *
 * The in-memory database is shared with other test files, so every fixture
 * company here has its own industry and every query filters on it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const auth = await import("../../api/database/auth-schema");
const { getTableConfig } = await import("drizzle-orm/pg-core");
const { sql } = await import("drizzle-orm");
const A = await import("../platform-analytics");
const S = await import("../platform-analytics/sql");
const { monthlyPrice } = await import("../../web/site/config");
const { parseParams } = await import("../../api/routes/platform-analytics");
const D = await import("../platform-analytics/dashboard");
const { INDUSTRY_LABELS, industryLabel } = await import("../industry-presets");

const IND = "zz-analytics-fixture";
const SEPT = { start_day: "2026-09-01", end_day: "2026-09-30", industry: IND } as const;

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

const client = (db as any).$client;
async function insert(table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  await client.execute({
    sql: `INSERT OR IGNORE INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    args: cols.map((c) => row[c]),
  });
}

// Times are written with Winnipeg's September offset (-05), the zone days are counted in.
const at = (day: string, hm = "15:00") => `${day} ${hm}:00-05`;
let seq = 0;
// Ids are prefixed: the in-memory database is shared, and an id another file used would be silently skipped.
const id = (p: string) => `pafx-${p}-${++seq}`;

async function job(co: string, created: string, extra: Record<string, unknown> = {}) {
  await insert("bookings", { id: id("bk"), company_id: co, title: "Job", status: "assigned", created_at: created, ...extra });
}

beforeAll(async () => {
  for (const t of [
    schema.companies, schema.bookings, schema.memberships, schema.riders, schema.notificationDeliveries,
    schema.reviews, schema.invoices, schema.messages, schema.jobEvents, schema.trackingPings,
    auth.user, auth.session, schema.companyHistory, schema.technicianHistory,
  ]) await client.execute(ddlFor(t));

  // Companies: two real ones, one closed, one internal demo.
  await insert("companies", { id: "acme-fx", name: "Acme Fixture", industry: IND, status: "active", billing_status: "active", billing_seats: 3, onboarding_completed_at: at("2026-08-16"), created_at: at("2026-08-15", "09:00"), is_internal: false });
  await insert("companies", { id: "bolt-fx", name: "Bolt Fixture", industry: IND, status: "active", billing_status: "trialing", billing_seats: 1, billing_trial_ends_at: new Date(Date.now() + 3 * 86400_000).toISOString(), created_at: at("2026-09-10", "09:00"), is_internal: false });
  await insert("companies", { id: "closed-fx", name: "Closed Fixture", industry: IND, status: "closed", billing_status: "canceled", billing_seats: 0, created_at: at("2026-06-01"), updated_at: at("2026-09-20"), is_internal: false });
  await insert("companies", { id: "demo-fx", name: "Demo Fixture", industry: IND, status: "active", billing_status: "none", billing_seats: 0, created_at: at("2026-07-01"), is_internal: true });

  // Acme: 3 jobs on Sep 5, 1 on Sep 6 (2 completed on Sep 7, 1 cancelled), 1 in August, 1 deleted.
  await job("acme-fx", at("2026-09-05", "10:00"), { status: "completed", finished_at: at("2026-09-07", "11:00") });
  await job("acme-fx", at("2026-09-05", "11:00"), { status: "completed", finished_at: at("2026-09-07", "12:00") });
  await job("acme-fx", at("2026-09-05", "12:00"), { status: "cancelled" });
  await job("acme-fx", at("2026-09-06", "10:00"));
  await job("acme-fx", at("2026-08-20", "10:00"), { status: "completed", finished_at: at("2026-08-21", "10:00") });
  await job("acme-fx", at("2026-09-05", "13:00"), { deleted_at: at("2026-09-05", "14:00") });
  // Bolt: one job, completed the same day, flagged running late.
  await job("bolt-fx", at("2026-09-12", "08:00"), { status: "completed", finished_at: at("2026-09-12", "17:00"), delay_flagged_at: at("2026-09-12", "09:00") });
  // Sample-day work (pretend jobs and a pretend technician) never counts.
  await job("acme-fx", at("2026-09-05", "16:00"), { is_sample: true, status: "completed", finished_at: at("2026-09-05", "17:00") });
  await insert("riders", { id: "r-sample-fx", company_id: "acme-fx", approval: "active", is_sample: true, created_at: at("2026-08-15") });
  // Demo: a busy day that must not count unless test tenants are included.
  for (let i = 0; i < 10; i++) await job("demo-fx", at("2026-09-15", "10:00"), i < 5 ? { status: "completed", finished_at: at("2026-09-15", "16:00") } : {});

  // People.
  for (const [uid, co, role, status] of [
    ["u-acme-admin", "acme-fx", "admin", "active"],
    ["u-acme-tech1", "acme-fx", "rider", "active"],
    ["u-acme-tech2", "acme-fx", "rider", "active"],
    ["u-acme-cust1", "acme-fx", "customer", "active"],
    ["u-acme-cust2", "acme-fx", "customer", "active"],
    ["u-staff", "acme-fx", "superadmin", "active"],
    ["u-bolt-admin", "bolt-fx", "admin", "active"],
    ["u-demo-admin", "demo-fx", "admin", "active"],
  ] as const) {
    await insert("user", { id: uid, name: uid, email: `${uid}@fx.test`, email_verified: true, role, company_id: co, created_at: at("2026-08-15"), updated_at: at("2026-08-15") });
    await insert("memberships", { id: id("m"), user_id: uid, company_id: co, role, status, created_at: role === "customer" ? at("2026-09-08") : at("2026-08-15") });
  }
  await insert("riders", { id: "r1-fx", user_id: "u-acme-tech1", company_id: "acme-fx", approval: "active", created_at: at("2026-08-15") });
  await insert("riders", { id: "r2-fx", user_id: "u-acme-tech2", company_id: "acme-fx", approval: "active", created_at: at("2026-08-15") });
  await insert("riders", { id: "r3-fx", company_id: "acme-fx", approval: "invited", created_at: at("2026-08-15") });

  // Sessions: Acme's admin used the app in September, Bolt's admin only in August.
  await insert("session", { id: "s1-fx", token: "t1-fx", user_id: "u-acme-admin", expires_at: at("2026-12-01"), created_at: at("2026-09-10"), updated_at: at("2026-09-12") });
  await insert("session", { id: "s2-fx", token: "t2-fx", user_id: "u-bolt-admin", expires_at: at("2026-12-01"), created_at: at("2026-08-25"), updated_at: at("2026-08-28") });

  // Notifications: 3 customer texts in September, 1 failed email, 1 text to a technician; 2 customer emails in August.
  for (let i = 0; i < 3; i++) await insert("notification_deliveries", { id: id("nd"), company_id: "acme-fx", event: "enroute", recipient: "client", channel: "sms", status: "sent", created_at: at("2026-09-05") });
  await insert("notification_deliveries", { id: id("nd"), company_id: "acme-fx", event: "enroute", recipient: "client", channel: "email", status: "failed", created_at: at("2026-09-05") });
  await insert("notification_deliveries", { id: id("nd"), company_id: "acme-fx", event: "assigned", recipient: "tech", channel: "sms", status: "sent", created_at: at("2026-09-05") });
  for (let i = 0; i < 2; i++) await insert("notification_deliveries", { id: id("nd"), company_id: "acme-fx", event: "enroute", recipient: "client", channel: "email", status: "sent", created_at: at("2026-08-20") });

  await insert("reviews", { id: id("rv"), company_id: "acme-fx", rating: 5, created_at: at("2026-09-08") });
  await insert("reviews", { id: id("rv"), company_id: "acme-fx", rating: 4, created_at: at("2026-09-09") });

  // Company history, as the trigger on companies writes it (drizzle/0024_tenant_history.sql):
  //   Acme:   trial Aug 15, paying Sep 14
  //   Bolt:   trial Sep 10, still on it
  //   Closed: trial Jun 1, paying Jul 1, cancelled and closed Sep 20 (churn)
  //   Gone:   trial Sep 3, deleted Sep 25 while still on trial (a trial lost); no companies row left
  //   Demo:   a test company, never billed
  const hist = (company_id: string, when: string, row: Record<string, unknown>) =>
    insert("company_history", { id: id("ch"), company_id, at: when, name: company_id, status: "active", billing_status: "none", billing_seats: 0, industry: IND, is_internal: false, removed: false, source: "live", ...row });
  await hist("acme-fx", at("2026-08-15", "09:00"), { billing_status: "trialing", billing_seats: 3 });
  await hist("acme-fx", at("2026-09-14"), { billing_status: "active", billing_seats: 3 });
  await hist("bolt-fx", at("2026-09-10", "09:00"), { billing_status: "trialing", billing_seats: 1 });
  await hist("closed-fx", at("2026-06-01"), { billing_status: "trialing", billing_seats: 1 });
  await hist("closed-fx", at("2026-07-01"), { billing_status: "active", billing_seats: 1 });
  await hist("closed-fx", at("2026-09-20"), { status: "closed", billing_status: "canceled" });
  await hist("gone-fx", at("2026-09-03"), { billing_status: "trialing", billing_seats: 1 });
  await hist("gone-fx", at("2026-09-25"), { billing_status: "trialing", billing_seats: 1, removed: true });
  await hist("demo-fx", at("2026-07-01"), { is_internal: true });
  // Technicians: Acme's two from Aug 15; one on Bolt from Sep 11 who leaves Sep 16; a test company's.
  const tech = (rider_id: string, company_id: string, when: string, active: boolean) =>
    insert("technician_history", { id: id("th"), rider_id, company_id, at: when, active, source: "live" });
  await tech("r1-fx", "acme-fx", at("2026-08-15"), true);
  await tech("r2-fx", "acme-fx", at("2026-08-15"), true);
  await tech("r3-fx", "acme-fx", at("2026-08-15"), false);
  await tech("rb-fx", "bolt-fx", at("2026-09-11"), true);
  await tech("rb-fx", "bolt-fx", at("2026-09-16"), false);
  await tech("rd-fx", "demo-fx", at("2026-07-01"), true);

  await insert("invoices", { id: id("inv"), company_id: "acme-fx", number: "1", amount: 100, total: 100, amount_refunded: 10, currency: "usd", status: "paid", paid_at: at("2026-09-07"), created_at: at("2026-09-07") });
  await insert("invoices", { id: id("inv"), company_id: "acme-fx", number: "2", amount: 50, total: 50, currency: "cad", status: "paid", paid_at: at("2026-09-08"), created_at: at("2026-09-08") });
});

beforeEach(() => A._clearAnalyticsCache());

// Other files share this database and count sample rows across every company
// (sample-day.test.ts), so take this file's sample rows back out when done.
afterAll(async () => {
  await client.execute("DELETE FROM bookings WHERE company_id = 'acme-fx' AND is_sample");
  await client.execute("DELETE FROM riders WHERE id = 'r-sample-fx'");
});

describe("headline", () => {
  it("counts the real companies only, against the period before", async () => {
    const h = await A.headline(SEPT);
    expect(h.start_day).toBe("2026-09-01");
    expect(h.days).toBe(30);
    expect(h.tenants).toBe(2); // closed and test tenants left out
    expect([h.tenants_new, h.tenants_new_prev]).toEqual([1, 1]);
    expect([h.tenants_active, h.tenants_active_prev]).toEqual([2, 1]);
    expect(h.tenants_closed).toBe(1);
    expect([h.jobs_created, h.jobs_created_prev]).toEqual([5, 1]); // the deleted job never counts
    expect([h.jobs_completed, h.jobs_completed_prev, h.jobs_completed_all]).toEqual([3, 1, 4]);
    expect(h.jobs_cancelled).toBe(1);
    expect(h.on_time_rate).toBeCloseTo(2 / 3, 5);
  });

  it("counts people once, without platform staff, and who was active", async () => {
    const h = await A.headline(SEPT);
    expect(h.users).toBe(4); // Acme admin + 2 technicians + Bolt admin
    expect(h.techs).toBe(2); // the invited technician isn't counted
    expect(h.customers).toBe(2);
    expect([h.customers_new, h.customers_new_prev]).toEqual([2, 0]);
    expect([h.users_active, h.users_active_prev]).toEqual([1, 1]);
  });

  it("names the most active company and its share of jobs", async () => {
    const h = await A.headline(SEPT);
    expect(h.top_tenant_id).toBe("acme-fx");
    expect(h.top_tenant_jobs).toBe(4);
    expect(h.top_tenant_share).toBeCloseTo(0.8, 5);
  });

  it("prices plans from the public price list and splits paying from trials", async () => {
    const h = await A.headline(SEPT);
    expect(h.mrr).toBe(monthlyPrice(3).total); // Acme: 3 seats
    expect(h.trial_mrr).toBe(monthlyPrice(1).total); // Bolt: 1 seat, on trial
    expect([h.paying, h.trialing, h.trials_ending_soon]).toEqual([1, 1, 1]);
  });

  it("counts customer updates, delivery and ratings", async () => {
    const h = await A.headline(SEPT);
    expect([h.customer_updates, h.customer_updates_prev]).toEqual([3, 2]);
    expect(h.sms_sent).toBe(4);
    expect(h.delivery_rate).toBeCloseTo(4 / 5, 5);
    expect([h.reviews, h.avg_rating]).toEqual([2, 4.5]);
  });

  it("includes test tenants only when asked", async () => {
    const h = await A.headline({ ...SEPT, include_test: true });
    expect(h.tenants).toBe(3);
    expect(h.jobs_created).toBe(15);
    expect(h.top_tenant_id).toBe("demo-fx");
  });

  it("works out period-over-period change the way the dashboard does", async () => {
    const k = A.kpisFrom(await A.headline(SEPT));
    expect(k.find((x) => x.metric === "jobs_created")).toEqual({ metric: "jobs_created", label: "Jobs created", value: 5, previous: 1, change: 4, ratio: 5 });
    expect(k.find((x) => x.metric === "customers_new")!.change).toBeNull(); // nothing before: no percentage
  });
});

describe("trials, conversion, churn and technicians", () => {
  it("counts trial starts, conversions, lost trials and churn in the period and the one before", async () => {
    const h = await A.headline(SEPT);
    expect([h.trial_starts, h.trial_starts_prev]).toEqual([2, 1]); // Bolt and Gone; Acme in August
    expect([h.conversions, h.conversions_prev]).toEqual([1, 0]); // Acme
    expect(h.trials_lost).toBe(1); // Gone, deleted on trial
    expect([h.churned, h.paying_start]).toEqual([1, 1]); // Closed was paying on Sep 1
    expect(h.techs_per_account).toBeCloseTo(1, 5); // 2 technicians, 2 open companies
    expect(h.techs_per_paying).toBeCloseTo(2, 5);
    const k = A.kpisFrom(h);
    expect(k.find((x) => x.metric === "trial_starts")).toMatchObject({ value: 2, previous: 1, change: 1 });
    expect(k.find((x) => x.metric === "churned")).toMatchObject({ value: 1, previous: 0, change: null });
  });

  it("keeps test companies out of the lifecycle unless asked", async () => {
    const w = await A.weekly({ ...SEPT, include_test: true });
    const sep14 = w.find((x) => x.week === "2026-09-14")!;
    expect(sep14.tenants).toBe(4); // + Demo
    expect(sep14.techs).toBe(3);
  });

  it("gives every week the range touches, Monday to Sunday", async () => {
    const w = await A.weekly(SEPT);
    expect(w.map((x) => x.week)).toEqual(["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
    expect(w[0]!.week_end).toBe("2026-09-06");
    expect(w.every((x) => !x.in_progress)).toBe(true);
  });

  it("counts each week's trials, conversions and churn against the state the week began and ended in", async () => {
    const w = Object.fromEntries((await A.weekly({ start_day: "2026-08-10", end_day: "2026-09-27", industry: IND })).map((x) => [x.week, x]));
    expect(w["2026-08-10"]).toMatchObject({ trial_starts: 1, cohort_converted: 1, cohort_rate: 1 }); // Acme, paying since
    expect(w["2026-08-31"]).toMatchObject({ trial_starts: 1, cohort_converted: 0, tenants: 3 }); // Gone joins Acme and Closed
    expect(w["2026-09-07"]).toMatchObject({ trial_starts: 1, new_tenants: 1, trialing: 3, tenants: 4 }); // Bolt signs up
    expect(w["2026-09-14"]).toMatchObject({
      conversions: 1, trials_lost: 0, conversion_rate: 1,
      paying_start: 1, churned: 1, churn_rate: 1, paying: 1, accounts_closed: 1, tenants: 3,
      mrr: monthlyPrice(3).total,
    });
    expect(w["2026-09-21"]).toMatchObject({ trials_lost: 1, conversion_rate: 0, accounts_closed: 1, tenants: 2, churned: 0, churn_rate: 0 });
  });

  it("reads technicians per company as they were at each week's end", async () => {
    const w = Object.fromEntries((await A.weekly(SEPT)).map((x) => [x.week, x]));
    expect(w["2026-09-07"]).toMatchObject({ techs: 3, accounts_with_techs: 2, median_techs: 0.5 }); // Acme 2, Bolt 1, Gone and Closed 0
    expect(w["2026-09-07"]!.techs_per_account).toBeCloseTo(3 / 4, 5);
    expect(w["2026-09-14"]).toMatchObject({ techs: 2, accounts_with_techs: 1, techs_per_paying: 2 }); // Bolt's technician left on Sep 16
  });

  it("lists when each company started its trial, first paid and stopped paying", async () => {
    const t = Object.fromEntries((await A.tenants(SEPT)).map((x) => [x.id, x]));
    expect(t["acme-fx"]).toMatchObject({ trial_started: "2026-08-15", paid_since: "2026-09-14", churned_on: null });
    expect(t["bolt-fx"]).toMatchObject({ trial_started: "2026-09-10", paid_since: null, churned_on: null });
    expect(t["closed-fx"]).toMatchObject({ trial_started: "2026-06-01", paid_since: "2026-07-01", churned_on: "2026-09-20" });
  });

  it("filters by billing status and company like every other figure", async () => {
    const paying = await A.weekly({ ...SEPT, billing: "active" });
    expect(paying.find((x) => x.week === "2026-09-07")!.tenants).toBe(1); // Acme only
    const acme = await A.headline({ ...SEPT, tenant: "acme-fx" });
    expect([acme.trial_starts, acme.conversions, acme.churned]).toEqual([0, 1, 0]);
  });
});

describe("history triggers", () => {
  it("record every state change, deletions and technicians leaving, and nothing else", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const pg = new PGlite();
    await pg.exec(`
      CREATE TABLE companies (id text PRIMARY KEY, name text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'active',
        billing_status text NOT NULL DEFAULT 'none', billing_seats integer NOT NULL DEFAULT 0, billing_trial_ends_at timestamptz,
        industry text NOT NULL DEFAULT '', is_internal boolean NOT NULL DEFAULT false, updated_at timestamptz);
      CREATE TABLE riders (id text PRIMARY KEY, company_id text NOT NULL, approval text NOT NULL DEFAULT 'invited', is_sample boolean NOT NULL DEFAULT false);
    `);
    const migration = readFileSync(join(import.meta.dir, "../../../drizzle/0024_tenant_history.sql"), "utf8");
    for (const stmt of migration.split("--> statement-breakpoint")) {
      const body = stmt.replace(/^\s*--[^\n]*\n/gm, "").trim();
      if (/^(CREATE TABLE|CREATE INDEX|CREATE OR REPLACE FUNCTION|CREATE TRIGGER)/.test(body)) await pg.exec(body);
    }
    await pg.exec(`
      INSERT INTO companies (id, name, billing_status) VALUES ('c1', 'One', 'trialing');
      UPDATE companies SET name = 'One Ltd', updated_at = now() WHERE id = 'c1';
      UPDATE companies SET billing_status = 'active' WHERE id = 'c1';
      UPDATE companies SET billing_seats = 4 WHERE id = 'c1';
      DELETE FROM companies WHERE id = 'c1';
      INSERT INTO riders (id, company_id, approval) VALUES ('r1', 'c1', 'invited');
      UPDATE riders SET approval = 'active' WHERE id = 'r1';
      UPDATE riders SET company_id = 'c2' WHERE id = 'r1';
      UPDATE riders SET is_sample = false WHERE id = 'r1';
      DELETE FROM riders WHERE id = 'r1';
    `);
    const c = await pg.query<{ billing_status: string; billing_seats: number; removed: boolean; name: string }>(
      "SELECT name, billing_status, billing_seats, removed FROM company_history ORDER BY seq",
    );
    expect(c.rows).toEqual([
      { name: "One", billing_status: "trialing", billing_seats: 0, removed: false },
      { name: "One Ltd", billing_status: "active", billing_seats: 0, removed: false }, // the rename alone wrote nothing
      { name: "One Ltd", billing_status: "active", billing_seats: 4, removed: false },
      { name: "One Ltd", billing_status: "active", billing_seats: 4, removed: true },
    ]);
    const t = await pg.query<{ company_id: string; active: boolean }>("SELECT company_id, active FROM technician_history ORDER BY seq");
    expect(t.rows).toEqual([
      { company_id: "c1", active: false },
      { company_id: "c1", active: true },
      { company_id: "c1", active: false },
      { company_id: "c2", active: true },
      { company_id: "c2", active: false },
    ]);
    await pg.close();
  });
});

describe("series, records, funnel, tenants", () => {
  it("fills every day of the range and counts in local days", async () => {
    const s = await A.series({ ...SEPT, grain: "day" });
    expect(s).toHaveLength(30);
    const day = (d: string) => s.find((p) => p.bucket === d)!;
    expect(day("2026-09-05").jobs_created).toBe(3);
    expect(day("2026-09-07").jobs_completed).toBe(2);
    expect(day("2026-09-10").new_tenants).toBe(1);
    expect(day("2026-09-05").customer_updates).toBe(3);
    expect(day("2026-09-10").sign_ins).toBe(1);
    expect(day("2026-09-20").jobs_created).toBe(0);
    const w = await A.series({ ...SEPT, grain: "week" });
    expect(w[0]!.bucket).toBe("2026-08-31"); // weeks start on Monday
    expect(w.reduce((n, p) => n + p.jobs_created, 0)).toBe(5);
  });

  it("finds the all-time records", async () => {
    const r = Object.fromEntries((await A.records(SEPT)).map((x) => [x.record, x]));
    expect(r.jobs_in_a_day).toMatchObject({ value: 3, day: "2026-09-05" });
    expect(r.company_jobs_in_a_day).toMatchObject({ value: 3, day: "2026-09-05", tenant: "Acme Fixture" });
    expect(r.completed_in_a_day).toMatchObject({ value: 2, day: "2026-09-07" });
    expect(r.busiest_week).toMatchObject({ value: 4, day: "2026-08-31" });
    expect(r.largest_field_team).toMatchObject({ value: 2, tenant: "Acme Fixture" });
    expect(r.fastest_first_job).toMatchObject({ tenant: "Bolt Fixture" });
    expect(r.updates_in_a_day).toMatchObject({ value: 3, day: "2026-09-05" });
  });

  it("shows how far companies have got", async () => {
    const f = await A.funnel(SEPT);
    expect(f).toMatchObject({ signed_up: 2, onboarded: 1, added_team: 1, first_job: 2, first_completed: 2, paying: 1 });
    expect(f.median_days_to_first_job).toBeGreaterThan(2);
  });

  it("lists the milestones one row each for the dashboard, as shares of signups", async () => {
    const f = await A.funnel(SEPT);
    const res: any = await db.execute(S.forApp(S.FUNNEL_STEPS, SEPT));
    const steps = (res.rows ?? res) as { step: string; companies: number; share: number | null; median_days: number | null }[];
    expect(steps.map((x) => x.step)).toEqual(["signed_up", "onboarded", "added_team", "first_job", "first_completed", "paying"]);
    for (const x of steps) {
      expect({ step: x.step, companies: x.companies }).toEqual({ step: x.step, companies: (f as any)[x.step] });
      expect(x.share!).toBeCloseTo((f as any)[x.step] / f.signed_up, 10);
    }
    expect(steps.filter((x) => x.median_days != null).map((x) => [x.step, x.median_days])).toEqual([["first_job", f.median_days_to_first_job]]);
  });

  it("lists companies with their plan, people and activity", async () => {
    const t = await A.tenants(SEPT);
    expect(t.map((x) => x.id)).toEqual(["acme-fx", "bolt-fx", "closed-fx"]);
    const acme = t[0]!;
    expect(acme).toMatchObject({ jobs: 4, completed: 2, jobs_all: 5, team: 3, techs: 2, customers: 2, active_users: 1, customer_updates: 3, plan_seats: 3, plan_value: monthlyPrice(3).total, onboarded: true, internal: false });
    expect(acme.last_active).toBe("2026-09-12T20:00:00Z");
    expect(acme.industry_label).toBe(IND); // an id with no preset shows as is
    expect(t.find((x) => x.id === "closed-fx")!.health).toBe("closed");
    expect(t.find((x) => x.id === "bolt-fx")!.plan_value).toBe(monthlyPrice(1).total);
  });

  it("drills into one company, test tenants included", async () => {
    const d = await A.tenantDetail("demo-fx", SEPT);
    expect(d.headline.jobs_created).toBe(10);
    expect(d.headline.tenants).toBe(1);
  });
});

describe("explorer", () => {
  it("breaks a metric down by company or over time", async () => {
    const byTenant = await A.explore("jobs_created", "tenant", SEPT);
    expect(byTenant.rows).toEqual([
      { key: "acme-fx", label: "Acme Fixture", value: 4 },
      { key: "bolt-fx", label: "Bolt Fixture", value: 1 },
    ]);
    const byWeek = await A.explore("jobs_completed", "time", { ...SEPT, grain: "week" });
    expect(byWeek.rows.find((r) => r.key === "2026-09-07")!.value).toBe(3);
  });

  it("totals money in each currency, never across", async () => {
    const r = await A.explore("payments_collected", "currency", SEPT);
    expect(r.rows).toEqual([
      { key: "USD", label: "USD", value: 90 },
      { key: "CAD", label: "CAD", value: 50 },
    ]);
    expect(() => S.exploreQuery("payments_collected", "time")).toThrow(/can't be broken down/);
  });

  it("refuses anything outside the registry", () => {
    expect(() => S.exploreQuery("drop_tables", "time")).toThrow(/Unknown metric/);
    expect(() => S.exploreQuery("jobs_created", "currency")).toThrow(/can't be broken down/);
  });

  it("every metric and breakdown runs", async () => {
    for (const m of S.METRICS) {
      for (const by of S.metricDimensions(m)) {
        const r = await A.explore(m.id, by, { ...SEPT, grain: "month" });
        expect(Array.isArray(r.rows)).toBe(true);
      }
    }
  });
});

describe("safety and the shared definitions", () => {
  it("binds filters as parameters, never as SQL", async () => {
    const h = await A.headline({ ...SEPT, tenant: "x'); DROP TABLE companies; --" });
    expect(h.tenants).toBe(0);
    const still = await db.execute(sql`SELECT COUNT(*)::int AS n FROM companies WHERE id = 'acme-fx'`);
    expect(((still as any).rows ?? still)[0].n).toBe(1);
  });

  it("matches the public price list at every fleet size", async () => {
    for (const n of [1, 2, 3, 10, 29, 30, 50, 100]) {
      const res: any = await db.execute(sql.raw(`SELECT (${S.planPriceSql(String(n))})::float8 AS p`));
      expect((res.rows ?? res)[0].p).toBe(monthlyPrice(n).total);
    }
  });

  it("names industries in SQL exactly as the app does", async () => {
    const appName = (id: string) => (!id ? "Not set" : id === "other" ? "Other" : industryLabel(id) || id);
    for (const id of [...new Set(INDUSTRY_LABELS.map((x) => x.id)), "other", "", "zz-unknown"]) {
      const res: any = await db.execute(sql.raw(`SELECT ${S.industryLabelSql(`'${id}'`)} AS label`));
      expect({ id, label: (res.rows ?? res)[0].label }).toEqual({ id, label: appName(id) });
    }
    const none: any = await db.execute(sql.raw(`SELECT ${S.industryLabelSql("NULL::text")} AS label`));
    expect((none.rows ?? none)[0].label).toBe("Not set");
  });

  it("lists the industries in use for the dashboard's filter, test companies only when asked", async () => {
    const run = async (p: object) => {
      const res: any = await db.execute(S.forApp(S.INDUSTRIES, p));
      return ((res.rows ?? res) as { industry: string; label: string; companies: number }[]).find((r) => r.industry === IND);
    };
    expect(await run({})).toEqual({ industry: IND, label: IND, companies: 2 }); // closed and test companies left out
    expect((await run({ include_test: true }))!.companies).toBe(3);
  });

  it("describes every dashboard source and stores a query the dashboard accepts", () => {
    const docs = D.dashboardDatasetDocuments();
    expect(Object.keys(docs).sort()).toEqual(Object.keys(S.DASHBOARD_QUERIES).sort());
    for (const [id, doc] of Object.entries(docs)) {
      expect(doc.title.split(/\s+/).length).toBeLessThanOrEqual(5);
      expect(doc.description).toMatch(/Reads [a-z_, ]+(and [a-z_]+)?\.$/);
      expect(doc.source).toMatchObject({ kind: "query", connector: "Supabase", tool: "execute_sql", args: { project_id: D.SUPABASE_PROJECT_ID } });
      expect(doc.source.args.query).toBe(S.forDashboard(S.DASHBOARD_QUERIES[id as keyof typeof S.DASHBOARD_QUERIES]));
    }
  });

  it("renders every dashboard query in a form the dashboard accepts", () => {
    for (const [name, q] of Object.entries(S.DASHBOARD_QUERIES)) {
      const d = S.forDashboard(q);
      expect({ name, violations: S.dashboardViolations(d) }).toEqual({ name, violations: [] });
      expect(d.length).toBeLessThan(16_000);
      expect(d).not.toContain("@@");
      expect(/^\s*(WITH|SELECT)\b/i.test(d)).toBe(true);
      expect(d.split(";").length).toBe(1); // one statement
      for (const m of d.matchAll(/\{\{(\w+)\}\}/g)) expect(Object.keys(S.PARAM_TYPES)).toContain(m[1]!);
      expect(d.replace(/CAST\(\{\{\w+\}\} AS [A-Z]+\)/g, "")).not.toContain("{{");
    }
  });

  it("gives the dashboard exactly what the app gets", async () => {
    // The dashboard fills each {{name}} with a literal; check it at a real filter set.
    const p = { start_day: "2026-09-01", end_day: "2026-09-30", include_test: false, industry: IND, grain: "day" } as const;
    const literal = (v: unknown) => (v == null ? "NULL" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : `'${String(v)}'`);
    for (const [name, q] of Object.entries(S.DASHBOARD_QUERIES)) {
      const filled = S.forDashboard(q).replace(/\{\{(\w+)\}\}/g, (_, k) => literal((p as any)[k]));
      const dash: any = await db.execute(sql.raw(filled));
      const app: any = await db.execute(S.forApp(q, p));
      expect({ name, rows: dash.rows ?? dash }).toEqual({ name, rows: app.rows ?? app });
    }
  });

  it("validates the filters a request sends", () => {
    expect(parseParams({ start: "2026-09-30", end: "2026-09-01" })).toEqual({ ok: false, message: "The start date is after the end date" });
    expect(parseParams({ start: "2010-01-01", end: "2026-09-01" }).ok).toBe(false);
    expect(parseParams({ start: "2026-13-45", end: "2026-09-01" }).ok).toBe(false);
    const long = parseParams({ start: "2024-01-01", end: "2026-01-01", grain: "day" });
    expect(long.ok && long.params.grain).toBe("week");
    const ok = parseParams({ start: "2026-09-01", end: "2026-09-30", test: "1", billing: "active" });
    expect(ok).toEqual({ ok: true, params: { start_day: "2026-09-01", end_day: "2026-09-30", include_test: true, tenant: null, industry: null, billing: "active", grain: null } });
  });
});

describe("query text", () => {
  it("has no SQL comments, so collapsing whitespace can't swallow a clause", () => {
    for (const [name, q] of Object.entries(S.DASHBOARD_QUERIES)) {
      const bare = q.replace(/'(?:[^']|'')*'/g, "''");
      expect({ name, comment: bare.includes("--") || bare.includes("/*") }).toEqual({ name, comment: false });
    }
  });
});

describe("company filter", () => {
  it("lists every open company for the picker, test ones flagged, closed ones left out", async () => {
    const { companies } = await A.catalog();
    const fx = companies.filter((c) => c.id.endsWith("-fx"));
    expect(fx).toEqual([
      { id: "acme-fx", name: "Acme Fixture", internal: false },
      { id: "bolt-fx", name: "Bolt Fixture", internal: false },
      { id: "demo-fx", name: "Demo Fixture", internal: true },
    ]);
  });

  it("narrows the numbers to the picked company, even a test one", async () => {
    expect((await A.headline({ ...SEPT, tenant: "acme-fx" })).tenants).toBe(1);
    expect((await A.headline({ ...SEPT, tenant: "demo-fx" })).tenants).toBe(1);
  });
});
