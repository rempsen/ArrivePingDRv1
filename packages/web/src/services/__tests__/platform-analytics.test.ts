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
    auth.user, auth.session,
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
    expect(k.find((x) => x.metric === "jobs_created")).toEqual({ metric: "jobs_created", label: "Jobs created", value: 5, previous: 1, change: 4 });
    expect(k.find((x) => x.metric === "customers_new")!.change).toBeNull(); // nothing before: no percentage
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

  it("lists companies with their plan, people and activity", async () => {
    const t = await A.tenants(SEPT);
    expect(t.map((x) => x.id)).toEqual(["acme-fx", "bolt-fx", "closed-fx"]);
    const acme = t[0]!;
    expect(acme).toMatchObject({ jobs: 4, completed: 2, jobs_all: 5, team: 3, techs: 2, customers: 2, active_users: 1, customer_updates: 3, plan_seats: 3, plan_value: monthlyPrice(3).total, onboarded: true, internal: false });
    expect(acme.last_active).toBe("2026-09-12T20:00:00Z");
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

  it("renders every dashboard query in a form the dashboard accepts", () => {
    for (const [name, q] of Object.entries(S.DASHBOARD_QUERIES)) {
      const d = S.forDashboard(q);
      expect({ name, violations: S.dashboardViolations(d) }).toEqual({ name, violations: [] });
      expect(d.length).toBeLessThan(16_000);
      expect(d).not.toContain("@@");
      expect(/^\s*WITH\b/i.test(d)).toBe(true);
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
