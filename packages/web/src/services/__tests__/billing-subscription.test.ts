/**
 * Self-serve subscription billing: the Stripe price mirrors the public price
 * list, the trial is 30 days on the saved card, and failures come back as
 * results rather than exceptions. Stripe is a stub; no network.
 */
import { describe, it, expect, beforeEach, beforeAll } from "bun:test";
import { installStripeStub } from "../../test-support/stripe-stub";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const CO = "billtest-co";
const stripe = installStripeStub({ companyId: CO });
const { calls } = stripe;

const {
  ensureSubscriptionPrice,
  createSignupSetup,
  startTrialSubscription,
  mapStatus,
  _resetBillingCache,
  PRICE_LOOKUP_KEY,
  setSeats,
  syncSeats,
  closeAccount,
  cancelAtPeriodEnd,
  billableSeatCounts,
  billableFromCounts,
  driverSeatCount,
  billingSummary,
  officeRemovable,
  plannedSeatsFor,
  activationBlock,
  trialBlock,
  startActivation,
  completeActivation,
} = await import("../billing-subscription");
const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { getTableConfig } = await import("drizzle-orm/pg-core");
const { eq } = await import("drizzle-orm");

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
beforeAll(async () => {
  const sql = (db as any).$client;
  for (const t of [schema.companies, schema.riders, schema.user, schema.memberships]) await sql.execute(ddlFor(t));
  await sql.execute({
    sql: "INSERT OR IGNORE INTO companies (id, name, billing_customer_id, billing_subscription_id, billing_status, billing_seats) VALUES (?,?,?,?,?,?)",
    args: [CO, "Bill Test Co", "cus_1", "sub_1", "trialing", 3],
  });
});
const { monthlyPrice } = await import("../../web/site/config");

beforeEach(() => {
  stripe.reset();
  _resetBillingCache();
  delete process.env.STRIPE_SUBSCRIPTION_PRICE_ID;
});

describe("ensureSubscriptionPrice", () => {
  it("creates one graduated price that matches the public price list, then reuses it", async () => {
    const id = await ensureSubscriptionPrice();
    expect(id).toBe("price_new");
    const create = calls.find((c) => c.method === "prices.create")!.args[0] as any;
    expect(create.lookup_key).toBe(PRICE_LOOKUP_KEY);
    expect(create.recurring).toEqual({ interval: "month", usage_type: "licensed" });
    expect(create.tiers_mode).toBe("graduated");
    expect(create.tiers).toEqual([
      { up_to: 2, flat_amount: 4900, unit_amount: 0 },
      { up_to: 29, unit_amount: 3000 },
      { up_to: "inf", unit_amount: 2500 },
    ]);
    // Stripe's graduated maths on these tiers equals monthlyPrice() for every fleet size we quote.
    const stripeTotal = (n: number) => 49 + Math.max(0, Math.min(n, 29) - 2) * 30 + Math.max(0, n - 29) * 25;
    for (const n of [1, 2, 3, 10, 29, 30, 50, 100]) expect(stripeTotal(n)).toBe(monthlyPrice(n).total);

    stripe.clearCalls();
    expect(await ensureSubscriptionPrice()).toBe("price_new");
    expect(calls).toHaveLength(0); // cached
  });

  it("finds an existing price by lookup key instead of creating another", async () => {
    stripe.existingPrice = { id: "price_existing" };
    expect(await ensureSubscriptionPrice()).toBe("price_existing");
    expect(calls.map((c) => c.method)).toEqual(["prices.list"]);
  });

  it("STRIPE_SUBSCRIPTION_PRICE_ID overrides everything", async () => {
    process.env.STRIPE_SUBSCRIPTION_PRICE_ID = "price_manual";
    expect(await ensureSubscriptionPrice()).toBe("price_manual");
    expect(calls).toHaveLength(0);
  });
});

describe("signup billing", () => {
  it("setup creates a pending customer and an off-session SetupIntent", async () => {
    const r = await createSignupSetup({ email: "a@b.co", name: "Ann Lee", companyName: "Acme HVAC", phone: "204-555-0100" });
    expect(r).toEqual({ customerId: "cus_1", setupIntentId: "seti_1", clientSecret: "seti_1_secret" });
    const cust = calls.find((c) => c.method === "customers.create")!.args[0] as any;
    expect(cust.metadata.signup).toBe("pending");
    expect(cust.name).toBe("Acme HVAC");
    const si = calls.find((c) => c.method === "setupIntents.create")!.args[0] as any;
    expect(si.usage).toBe("off_session");
  });

  it("starts a 30-day trial on the saved card, cancelling if the card goes missing", async () => {
    stripe.existingPrice = { id: "price_existing" };
    const r = await startTrialSubscription({ customerId: "cus_1", setupIntentId: "seti_1", companyId: "acme-hvac", companyName: "Acme HVAC" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.subscriptionId).toBe("sub_1");
    expect(r.status).toBe("trialing");
    expect(r.trialEndsAt.getTime() - Date.now()).toBeGreaterThan(29 * 86400_000);
    const sub = calls.find((c) => c.method === "subscriptions.create")!;
    const body = sub.args[0] as any;
    expect(body.trial_period_days).toBe(30);
    expect(body.default_payment_method).toBe("pm_1");
    expect(body.items).toEqual([{ price: "price_existing", quantity: 1 }]);
    expect(body.trial_settings).toEqual({ end_behavior: { missing_payment_method: "cancel" } });
    expect(body.metadata.companyId).toBe("acme-hvac");
    expect((sub.args[1] as any).idempotencyKey).toBe("signup-sub-cus_1");
    const cu = calls.find((c) => c.method === "customers.update")!.args[1] as any;
    expect(cu.invoice_settings.default_payment_method).toBe("pm_1");
  });

  it("refuses a setup that isn't finished or isn't this customer's", async () => {
    stripe.setupState = { status: "requires_payment_method", customer: "cus_1", payment_method: null };
    const r1 = await startTrialSubscription({ customerId: "cus_1", setupIntentId: "seti_1", companyId: "x", companyName: "X" });
    expect(r1.ok).toBe(false);
    stripe.setupState = { status: "succeeded", customer: "cus_other", payment_method: "pm_9" };
    const r2 = await startTrialSubscription({ customerId: "cus_1", setupIntentId: "seti_1", companyId: "x", companyName: "X" });
    expect(r2.ok).toBe(false);
    expect(calls.some((c) => c.method === "subscriptions.create")).toBe(false);
  });

  it("maps Stripe statuses onto the company's billing status", () => {
    expect(mapStatus("trialing")).toBe("trialing");
    expect(mapStatus("active")).toBe("active");
    expect(mapStatus("past_due")).toBe("past_due");
    expect(mapStatus("canceled")).toBe("canceled");
    expect(mapStatus("incomplete")).toBe("none");
  });
});

describe("tenant self-service", () => {
  it("setSeats puts the chosen user count on the subscription without proration", async () => {
    const r = await setSeats(CO, 5);
    expect(r.seats).toBe(5);
    const u = calls.find((c) => c.method === "subscriptionItems.update")!;
    expect(u.args[0]).toBe("si_1");
    expect(u.args[1]).toEqual({ quantity: 5, proration_behavior: "none" });
    const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, CO));
    expect(co!.billingSeats).toBe(5);
  });

  it("on a paid plan, more users are charged now for the rest of the period, by the day; fewer are not refunded", async () => {
    const orig = stripe.client.subscriptions.retrieve;
    const periodStart = Math.floor(Date.now() / 1000) - 20 * 86400;
    stripe.client.subscriptions.retrieve = async (...args: unknown[]) => (
      calls.push({ method: "subscriptions.retrieve", args }),
      { id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: false, items: { data: [{ id: "si_1", quantity: 3, current_period_start: periodStart, current_period_end: periodStart + 30 * 86400 }] }, metadata: { companyId: CO } }
    ) as any;
    try {
      stripe.clearCalls();
      const r = await setSeats(CO, 4);
      expect(r.charged).toBe(true);
      const up = calls.find((c) => c.method === "subscriptionItems.update")!.args[1] as any;
      expect(up.quantity).toBe(4);
      expect(up.proration_behavior).toBe("always_invoice");
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      expect(up.proration_date).toBe(Math.floor(today.getTime() / 1000)); // from the start of today

      stripe.clearCalls();
      const down = await setSeats(CO, 2);
      expect(down.charged).toBe(false);
      expect(calls.find((c) => c.method === "subscriptionItems.update")!.args[1]).toEqual({ quantity: 2, proration_behavior: "none" });

      stripe.clearCalls();
      await setSeats(CO, 5, { prorate: false }); // putting back a license already paid for
      expect(calls.find((c) => c.method === "subscriptionItems.update")!.args[1]).toEqual({ quantity: 5, proration_behavior: "none" });
    } finally {
      stripe.client.subscriptions.retrieve = orig;
    }
  });

  it("syncSeats never bills fewer than the chosen seats", async () => {
    await setSeats(CO, 4);
    stripe.clearCalls();
    const r = await syncSeats(CO); // no active drivers in this db
    expect(r.seats).toBe(4);
    expect(calls.find((c) => c.method === "subscriptionItems.update")!.args[1]).toEqual({ quantity: 4, proration_behavior: "none" });
  });

  it("cancel at period end flips the flag and mirrors the state", async () => {
    await cancelAtPeriodEnd(CO, true);
    expect(calls.find((c) => c.method === "subscriptions.update")!.args[1]).toEqual({ cancel_at_period_end: true });
  });

  it("closeAccount cancels now and seals the company", async () => {
    await closeAccount(CO);
    expect(calls.find((c) => c.method === "subscriptions.cancel")!.args[0]).toBe("sub_1");
    const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, CO));
    expect(co!.status).toBe("closed");
    expect(co!.billingStatus).toBe("canceled");
  });
});

/* -------------------------------------------------------------------------- */
/*  Who is billed: field staff + every office user after the included one      */
/* -------------------------------------------------------------------------- */

const LIC = "billtest-lic";

type PersonOpts = { userRole?: string | null; status?: string; rider?: "active" | "suspended"; riderSample?: boolean; userSample?: boolean };
async function addPerson(id: string, membershipRole: string, opts: PersonOpts = {}) {
  const sql = (db as any).$client;
  await sql.execute({
    sql: 'INSERT INTO "user" (id, name, email, role, company_id, email_verified, is_sample) VALUES (?,?,?,?,?,TRUE,?)',
    args: [id, id, `${id}@t.test`, opts.userRole === undefined ? membershipRole : opts.userRole, LIC, opts.userSample ?? false],
  });
  await sql.execute({ sql: "INSERT INTO memberships (id, user_id, company_id, role, status) VALUES (?,?,?,?,?)", args: [`m-${id}`, id, LIC, membershipRole, opts.status ?? "active"] });
  if (opts.rider) {
    await sql.execute({ sql: "INSERT INTO riders (id, user_id, company_id, approval, is_sample) VALUES (?,?,?,?,?)", args: [`rd-${id}`, id, LIC, opts.rider, opts.riderSample ?? false] });
  }
}
const addTech = (id: string, opts: PersonOpts = {}) => addPerson(id, "rider", { rider: "active", ...opts });

describe("billable licenses", () => {
  beforeEach(async () => {
    const sql = (db as any).$client;
    for (const t of ["memberships", "riders"]) await sql.execute(`DELETE FROM ${t} WHERE company_id = '${LIC}'`);
    await sql.execute(`DELETE FROM "user" WHERE company_id = '${LIC}'`);
    await sql.execute(`DELETE FROM companies WHERE id = '${LIC}'`);
    await sql.execute({
      sql: "INSERT INTO companies (id, name, billing_customer_id, billing_subscription_id, billing_status, billing_seats) VALUES (?,?,?,?,?,?)",
      args: [LIC, "License Co", "cus_1", "sub_1", "trialing", 1],
    });
  });

  it("billableFromCounts is field + max(0, office - 1)", () => {
    expect([0, 1, 2, 3].map((office) => billableFromCounts(4, office))).toEqual([4, 4, 5, 6]);
    expect([0, 1, 2, 3].map((office) => billableFromCounts(0, office))).toEqual([0, 0, 1, 2]);
    expect([0, 1, 2, 3].map(officeRemovable)).toEqual([0, 0, 1, 2]);
  });

  it("counts 0, 1, 2 and 3 office users: the first is included, each one after is a license", async () => {
    await addTech("lic-t1");
    await addTech("lic-t2");
    expect(await billableSeatCounts(LIC)).toEqual({ field: 2, office: 0, billable: 2 });
    await addPerson("lic-admin", "admin");
    expect(await billableSeatCounts(LIC)).toEqual({ field: 2, office: 1, billable: 2 });
    await addPerson("lic-disp", "dispatcher");
    expect(await billableSeatCounts(LIC)).toEqual({ field: 2, office: 2, billable: 3 });
    await addPerson("lic-mgr", "manager");
    expect(await billableSeatCounts(LIC)).toEqual({ field: 2, office: 3, billable: 4 });
    await addPerson("lic-pm", "project_manager");
    expect(await billableSeatCounts(LIC)).toEqual({ field: 2, office: 4, billable: 5 });
  });

  it("an office user with a rider profile counts once, as office", async () => {
    await addPerson("lic-disp", "dispatcher", { rider: "active" });
    expect(await billableSeatCounts(LIC)).toEqual({ field: 0, office: 1, billable: 0 });
    await addPerson("lic-mgr", "manager", { rider: "active" });
    expect(await billableSeatCounts(LIC)).toEqual({ field: 0, office: 2, billable: 1 });
    expect(await driverSeatCount(LIC)).toBe(0);
  });

  it("platform staff, deleted, sample, inactive and customer accounts are not office users", async () => {
    await addPerson("lic-admin", "admin");
    await addPerson("lic-super-m", "superadmin"); // superadmin membership
    await addPerson("lic-super-u", "admin", { userRole: "superadmin" }); // platform staff with an admin membership
    await addPerson("lic-deleted", "manager", { userRole: "deleted" });
    await addPerson("lic-sample", "dispatcher", { userSample: true });
    await addPerson("lic-invited", "dispatcher", { status: "invited" });
    await addPerson("lic-disabled", "manager", { status: "disabled" });
    await addPerson("lic-cust", "customer");
    expect(await billableSeatCounts(LIC)).toEqual({ field: 0, office: 1, billable: 0 });
    // A user row with no base role is still a real office user.
    await addPerson("lic-norole", "dispatcher", { userRole: null });
    expect(await billableSeatCounts(LIC)).toEqual({ field: 0, office: 2, billable: 1 });
  });

  it("field staff are unchanged: sample, suspended and disabled techs are not billed", async () => {
    await addTech("lic-sample", { riderSample: true });
    await addTech("lic-susp", { rider: "suspended" });
    await addTech("lic-off", { status: "disabled" });
    expect(await billableSeatCounts(LIC)).toEqual({ field: 0, office: 0, billable: 0 });
    await addTech("lic-t1");
    expect(await billableSeatCounts(LIC)).toEqual({ field: 1, office: 0, billable: 1 });
  });

  it("syncSeats raises the subscription to the billable count", async () => {
    for (const id of ["lic-t1", "lic-t2", "lic-t3", "lic-t4"]) await addTech(id);
    await addPerson("lic-admin", "admin");
    await addPerson("lic-disp", "dispatcher");
    await addPerson("lic-mgr", "manager");
    stripe.clearCalls();
    const r = await syncSeats(LIC); // 4 field + (3 office - 1) = 6
    expect(r).toEqual({ seats: 6, updated: true });
    expect(calls.find((c) => c.method === "subscriptionItems.update")!.args[1]).toEqual({ quantity: 6, proration_behavior: "none" });
    const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, LIC));
    expect(co!.billingSeats).toBe(6);
  });

  it("syncSeats keeps a higher seat count the tenant chose", async () => {
    await addTech("lic-t1");
    await addPerson("lic-admin", "admin");
    await addPerson("lic-disp", "dispatcher");
    await (db as any).$client.execute(`UPDATE companies SET billing_seats = 9 WHERE id = '${LIC}'`);
    expect((await syncSeats(LIC)).seats).toBe(9);
  });

  it("plannedSeatsFor (onboarding's technician count) adds a license per office user after the included one", async () => {
    await addPerson("lic-admin", "admin");
    expect(await plannedSeatsFor(LIC, 5)).toEqual({ seats: 5, extraOffice: 0 });
    await addPerson("lic-mgr", "manager"); // e.g. the manager made at provisioning
    expect(await plannedSeatsFor(LIC, 5)).toEqual({ seats: 6, extraOffice: 1 });
    // Invited office staff aren't active yet; syncSeats picks them up once they accept.
    await addPerson("lic-disp", "dispatcher", { status: "invited" });
    expect(await plannedSeatsFor(LIC, 5)).toEqual({ seats: 6, extraOffice: 1 });
  });

  it("billingSummary reports drivers, office users and the billable count", async () => {
    await addTech("lic-t1");
    await addTech("lic-t2");
    await addPerson("lic-admin", "admin");
    await addPerson("lic-disp", "dispatcher");
    // The stub subscription is on 3 seats; 2 field + 1 extra office = 3.
    let s = await billingSummary(LIC);
    expect(s).toMatchObject({ seats: 3, activeDrivers: 2, activeOffice: 2, includedOffice: 1, billableUsers: 3, excessActive: 0 });
    expect(s.stripeError).toBeUndefined();
    await addPerson("lic-mgr", "manager");
    s = await billingSummary(LIC);
    expect(s).toMatchObject({ activeOffice: 3, billableUsers: 4, excessActive: 1 });
  });
});

describe("activate a plan for a company set up before self-serve signup", () => {
  const LEG = "legacy-co";
  const row = async () => (await db.select().from(schema.companies).where(eq(schema.companies.id, LEG)))[0]!;
  beforeEach(async () => {
    const sql = (db as any).$client;
    await sql.execute({ sql: "DELETE FROM companies WHERE id = ?", args: [LEG] });
    await sql.execute({ sql: "INSERT INTO companies (id, name, contact_email, plan) VALUES (?,?,?,?)", args: [LEG, "Legacy Materials", "office@legacy.test", "pro"] });
  });

  it("is open to an unbilled company, closed to ArrivePing's own account", async () => {
    expect(await activationBlock(LEG)).toBeNull();
    expect(await activationBlock("default")).toBe("own_account");
  });

  it("charges the first month now (no trial) and fills in only the billing fields", async () => {
    const setup = await startActivation(LEG, { email: "admin@legacy.test", name: "Admin" });
    expect(setup).toEqual({ clientSecret: "seti_1_secret", setupIntentId: "seti_1" });
    expect((calls.find((c) => c.method === "customers.create")!.args[0] as any).email).toBe("office@legacy.test");
    expect((await row()).billingCustomerId).toBe("cus_1");

    const r = await completeActivation(LEG, "seti_1");
    expect(r).toEqual({ ok: true, seats: 1, status: "active" });
    const sub = calls.find((c) => c.method === "subscriptions.create")!.args[0] as any;
    expect(sub.trial_period_days).toBeUndefined();
    expect(sub.payment_behavior).toBe("error_if_incomplete");
    expect(sub.default_payment_method).toBe("pm_1");
    expect(sub.metadata).toEqual({ companyId: LEG, source: "arriveping-activate" });
    const co = await row();
    expect(co).toMatchObject({ name: "Legacy Materials", billingSubscriptionId: "sub_act", billingStatus: "active", billingSeats: 1, plan: "starter", billingTrialEndsAt: null });
    expect(await activationBlock(LEG)).toBe("already_billed");
  });

  it("reuses a customer already on file instead of making another", async () => {
    const sql = (db as any).$client;
    await sql.execute({ sql: "UPDATE companies SET billing_customer_id = ? WHERE id = ?", args: ["cus_1", LEG] });
    await startActivation(LEG, {});
    expect(calls.some((c) => c.method === "customers.create")).toBe(false);
  });

  it("leaves no plan behind when the first payment is declined", async () => {
    await startActivation(LEG, {});
    stripe.subCreateError = "Your card was declined.";
    const r = await completeActivation(LEG, "seti_1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("declined");
    const co = await row();
    expect(co.billingSubscriptionId).toBeNull();
    expect(co.billingStatus).toBe("none");
    expect(await activationBlock(LEG)).toBeNull();
  });

  it("refuses a card setup that belongs to another customer", async () => {
    await startActivation(LEG, {});
    stripe.setupState = { status: "succeeded", customer: "cus_other", payment_method: "pm_x" };
    expect((await completeActivation(LEG, "seti_1")).ok).toBe(false);
    expect(calls.some((c) => c.method === "subscriptions.create")).toBe(false);
  });
});

describe("activation never leaves two plans", () => {
  const LEG = "legacy-race";
  const row = async () => (await db.select().from(schema.companies).where(eq(schema.companies.id, LEG)))[0]!;
  beforeEach(async () => {
    const sql = (db as any).$client;
    await sql.execute({ sql: "DELETE FROM companies WHERE id = ?", args: [LEG] });
    await sql.execute({ sql: "INSERT INTO companies (id, name, billing_customer_id) VALUES (?,?,?)", args: [LEG, "Race Co", "cus_1"] });
  });

  it("links a plan Stripe already holds (e.g. the database write failed last time) instead of charging again", async () => {
    stripe.subList = () => [{ id: "sub_earlier", status: "active", created: 100, items: { data: [{ quantity: 4 }] }, metadata: { companyId: LEG } }];
    const r = await completeActivation(LEG, "seti_1");
    expect(r).toEqual({ ok: true, seats: 4, status: "active" });
    expect(calls.some((c) => c.method === "subscriptions.create")).toBe(false);
    expect((await row()).billingSubscriptionId).toBe("sub_earlier");
  });

  it("two confirms at once (two tabs) create one subscription", async () => {
    stripe.subCreateDelay = 20;
    let created = false;
    stripe.subList = () => (created ? [{ id: "sub_act", status: "active", created: 200, items: { data: [{ quantity: 1 }] }, metadata: { companyId: LEG } }] : []);
    const orig = stripe.client.subscriptions.create;
    stripe.client.subscriptions.create = async (...a: unknown[]) => {
      const r = await orig(...a);
      created = true;
      return r;
    };
    try {
      const [a, b] = await Promise.all([completeActivation(LEG, "seti_1"), completeActivation(LEG, "seti_2")]);
      expect(a.ok && b.ok).toBe(true);
      expect(calls.filter((c) => c.method === "subscriptions.create")).toHaveLength(1);
    } finally {
      stripe.client.subscriptions.create = orig;
    }
  });

  it("if another server won the race, cancels and refunds the newer plan and keeps the older", async () => {
    let n = 0;
    stripe.subList = () => (n++ === 0 ? [] : [
      { id: "sub_other", status: "active", created: 150, items: { data: [{ quantity: 1 }] }, metadata: { companyId: LEG } },
      { id: "sub_act", status: "active", created: 200, items: { data: [{ quantity: 1 }] }, metadata: { companyId: LEG } },
    ]);
    const r = await completeActivation(LEG, "seti_1");
    expect(r.ok).toBe(true);
    expect(calls.find((c) => c.method === "subscriptions.cancel")!.args[0]).toBe("sub_act");
    expect((calls.find((c) => c.method === "refunds.create")!.args[0] as any).payment_intent).toBe("pi_dup");
    expect((await row()).billingSubscriptionId).toBe("sub_other");
  });

  it("the Billing summary offers activation only when it can work", async () => {
    expect((await billingSummary(LEG)).activatable).toBe(true);
    expect((await billingSummary("default")).activatable).toBe(false);
  });
});

describe("a demo starts the free trial instead of paying now", () => {
  const DEMO = "trial-demo-co";
  const row = async () => (await db.select().from(schema.companies).where(eq(schema.companies.id, DEMO)))[0]!;
  beforeEach(async () => {
    const sql = (db as any).$client;
    await sql.execute({ sql: "DELETE FROM companies WHERE id = ?", args: [DEMO] });
    await sql.execute({ sql: "INSERT INTO companies (id, name, contact_email, plan, kind) VALUES (?,?,?,?,?)", args: [DEMO, "Bow River Heating", "owner@bowriver.test", "pro", "demo"] });
  });

  it("opens the trial to a demo and closes plain activation, and the reverse for a customer", async () => {
    expect(await trialBlock(DEMO)).toBeNull();
    expect(await activationBlock(DEMO)).toBe("demo");
    expect(await trialBlock("default")).toBe("own_account");
    const sql = (db as any).$client;
    await sql.execute({ sql: "DELETE FROM companies WHERE id = ?", args: ["trial-cust-co"] });
    await sql.execute({ sql: "INSERT INTO companies (id, name, kind) VALUES (?,?,?)", args: ["trial-cust-co", "Real Customer", "customer"] });
    expect(await trialBlock("trial-cust-co")).toBe("not_demo");
    expect(await activationBlock("trial-cust-co")).toBeNull();
  });

  it("starts a 30-day trial with no charge and records when it ends", async () => {
    await startActivation(DEMO, { email: "owner@bowriver.test", name: "Owner" });
    const r = await completeActivation(DEMO, "seti_1", { trial: true });
    expect(r).toMatchObject({ ok: true, status: "trialing" });
    const sub = calls.find((c) => c.method === "subscriptions.create")!.args[0] as any;
    expect(sub.trial_period_days).toBe(30);
    expect(sub.trial_settings).toEqual({ end_behavior: { missing_payment_method: "cancel" } });
    expect(sub.payment_behavior).toBeUndefined();
    expect(sub.metadata).toEqual({ companyId: DEMO, source: "arriveping-demo-trial" });
    const co = await row();
    expect(co).toMatchObject({ billingSubscriptionId: "sub_1", billingStatus: "trialing", plan: "starter" });
    const days = (co.billingTrialEndsAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it("refuses a card setup that belongs to another customer", async () => {
    await startActivation(DEMO, {});
    setupState = { status: "succeeded", customer: "cus_other", payment_method: "pm_x" };
    expect((await completeActivation(DEMO, "seti_1", { trial: true })).ok).toBe(false);
    expect(calls.some((c) => c.method === "subscriptions.create")).toBe(false);
  });

  it("the Billing summary offers the trial to a demo, not activation", async () => {
    const s = await billingSummary(DEMO);
    expect(s.trialAvailable).toBe(true);
    expect(s.activatable).toBe(false);
    expect((await billingSummary("default")).trialAvailable).toBe(false);
  });
});
