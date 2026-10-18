/**
 * HubSpot mirror: a tenant becomes Company + staff Contacts + one Deal, the
 * Deal follows billing, and unchanged tenants cost no API calls. HubSpot is
 * a fetch stub; no network.
 */
import { describe, it, expect, beforeAll, beforeEach } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.HUBSPOT_ACCESS_TOKEN = "pat-test";
process.env.HUBSPOT_OWNER_ID = "83114636";

const { syncCompanyToHubspot, buildSyncPlan, planFingerprint, _setHubspotFetch, _resetHubspotForTests, isSyncedCompany, CUSTOM_PROPERTIES } =
  await import("../hubspot-sync");
const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { getTableConfig } = await import("drizzle-orm/pg-core");
const { eq } = await import("drizzle-orm");

type Call = { method: string; path: string; body: any };
let calls: Call[] = [];
let existingProps: Record<string, string[]> = { companies: [], contacts: [], deals: [] };
let searchHits: Record<string, any[]> = {};
let dealStage = "contractsent";
let nextId = 1000;

function stubFetch(url: string, init?: RequestInit): Promise<Response> {
  const path = url.replace("https://api.hubapi.com", "");
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, path, body });
  const json = (status: number, data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }));
  const m = /^\/crm\/v3\/properties\/(\w+)(\/groups)?(\?.*)?$/.exec(path);
  if (m) {
    if (method === "GET") return json(200, { results: existingProps[m[1]!]!.map((name) => ({ name })) });
    if (m[2]) return json(201, {});
    existingProps[m[1]!]!.push(body.name);
    return json(201, body);
  }
  const s = /^\/crm\/v3\/objects\/(\w+)\/search$/.exec(path);
  if (s) {
    const key = `${s[1]}:${body.filterGroups[0].filters[0].propertyName}=${body.filterGroups[0].filters[0].value}`;
    return json(200, { results: searchHits[key] ?? [] });
  }
  const o = /^\/crm\/v3\/objects\/(\w+)(?:\/(\d+))?(\?.*)?$/.exec(path);
  if (o) {
    if (method === "POST") return json(201, { id: String(nextId++) });
    if (method === "PATCH") return json(200, { id: o[2] });
    if (method === "GET") return json(200, { id: o[2], properties: { dealstage: dealStage } });
  }
  if (path.startsWith("/crm/v4/objects/")) return json(200, {});
  return json(404, { message: `unhandled ${method} ${path}` });
}

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

const CO = "prairie-comfort";
beforeAll(async () => {
  const sql = (db as any).$client;
  for (const t of [schema.companies, schema.companySettings, schema.riders, schema.user, schema.memberships]) await sql.execute(ddlFor(t));
  await sql.execute({
    sql: "INSERT OR IGNORE INTO companies (id, name, industry, billing_customer_id, billing_subscription_id, billing_status, billing_seats, billing_trial_ends_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    args: [CO, "Prairie Comfort HVAC", "hvac-plumbing", "cus_1", "sub_1", "trialing", 3, "2026-11-15T00:00:00.000Z", "2026-10-16T12:00:00.000Z"],
  });
  await sql.execute({
    sql: "INSERT OR IGNORE INTO company_settings (id, company_id, name, phone, address, website, worker_noun, customer_noun, job_noun, tagline, services, service_area) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    args: [`${CO}-settings`, CO, "Prairie Comfort HVAC", "204-555-0100", "12 Main St, Winnipeg, MB", "https://www.prairiecomfort.ca", "Technician", "Customer", "Job", "Warm homes, cool heads", JSON.stringify(["Furnace repair", "AC install"]), "Winnipeg"],
  });
  await sql.execute({ sql: "INSERT OR IGNORE INTO user (id, name, email, phone, first_name, last_name, company_id) VALUES (?,?,?,?,?,?,?)", args: ["u-ann", "Ann Lee", "ann@prairiecomfort.ca", "204-555-0101", "Ann", "Lee", CO] });
  await sql.execute({ sql: "INSERT OR IGNORE INTO user (id, name, email, phone, company_id) VALUES (?,?,?,?,?)", args: ["u-bob", "Bob Ng", "bob@prairiecomfort.ca", "", CO] });
  await sql.execute({ sql: "INSERT OR IGNORE INTO user (id, name, email, company_id) VALUES (?,?,?,?)", args: ["u-cust", "Cathy Customer", "cathy@example.com", CO] });
  await sql.execute({ sql: "INSERT OR IGNORE INTO memberships (id, user_id, company_id, role, status) VALUES (?,?,?,?,?)", args: ["m-ann", "u-ann", CO, "admin", "active"] });
  await sql.execute({ sql: "INSERT OR IGNORE INTO memberships (id, user_id, company_id, role, status) VALUES (?,?,?,?,?)", args: ["m-bob", "u-bob", CO, "rider", "invited"] });
  await sql.execute({ sql: "INSERT OR IGNORE INTO memberships (id, user_id, company_id, role, status) VALUES (?,?,?,?,?)", args: ["m-cust", "u-cust", CO, "customer", "active"] });
});

beforeEach(() => {
  calls = [];
  existingProps = { companies: [], contacts: [], deals: [] };
  searchHits = {};
  dealStage = "contractsent";
  _resetHubspotForTests();
  _setHubspotFetch(stubFetch as any);
});

describe("buildSyncPlan", () => {
  it("maps the tenant, its staff (not customers) and a trial deal", async () => {
    const plan = (await buildSyncPlan(CO))!;
    expect(plan.company.name).toBe("Prairie Comfort HVAC");
    expect(plan.company.domain).toBe("prairiecomfort.ca");
    expect(plan.company.arriveping_industry).toBe("HVAC & Plumbing");
    expect(plan.company.arriveping_billing_seats).toBe("3");
    expect(plan.company.arriveping_trial_ends).toBe("2026-11-15");
    expect(plan.company.arriveping_services).toBe("Furnace repair, AC install");
    expect(plan.company.arriveping_terminology).toBe("Technician / Customer / Job");
    expect(plan.company.lifecyclestage).toBeUndefined(); // still a lead while trialing
    expect(plan.companyOnCreate).toEqual({ type: "PROSPECT", lifecyclestage: "lead", hs_lead_status: "NEW", hubspot_owner_id: "83114636" });
    expect(plan.contacts.map((c) => c.email).sort()).toEqual(["ann@prairiecomfort.ca", "bob@prairiecomfort.ca"]);
    const ann = plan.contacts.find((c) => c.email.startsWith("ann"))!;
    expect(ann.props).toMatchObject({ firstname: "Ann", lastname: "Lee", jobtitle: "Administrator", phone: "204-555-0101", arriveping_role: "admin" });
    const bob = plan.contacts.find((c) => c.email.startsWith("bob"))!;
    expect(bob.props).toMatchObject({ firstname: "Bob", lastname: "Ng", jobtitle: "Technician", arriveping_member_status: "invited" });
    expect(plan.deal.stage).toBe("contractsent");
    expect(plan.deal.props.dealname).toBe("Prairie Comfort HVAC — ArrivePing");
    expect(Number(plan.deal.props.amount)).toBeGreaterThan(0);
  });

  it("every custom property we send is declared", async () => {
    const plan = (await buildSyncPlan(CO))!;
    const declared = (t: keyof typeof CUSTOM_PROPERTIES) => new Set(CUSTOM_PROPERTIES[t].map((p) => p.name));
    for (const k of Object.keys(plan.company)) if (k.startsWith("arriveping_")) expect(declared("companies").has(k)).toBe(true);
    for (const k of Object.keys(plan.contacts[0]!.props)) if (k.startsWith("arriveping_")) expect(declared("contacts").has(k)).toBe(true);
    for (const k of Object.keys(plan.deal.props)) if (k.startsWith("arriveping_")) expect(declared("deals").has(k)).toBe(true);
  });
});

describe("syncCompanyToHubspot", () => {
  it("first run declares properties, creates company, contacts and deal, associates them, and remembers the ids", async () => {
    const r = await syncCompanyToHubspot(CO);
    expect(r.ok).toBe(true);
    expect(r.contacts).toBe(2);
    // properties declared under the arriveping group
    expect(calls.some((c) => c.method === "POST" && c.path === "/crm/v3/properties/companies/groups")).toBe(true);
    expect(calls.filter((c) => c.method === "POST" && c.path === "/crm/v3/properties/companies").length).toBe(CUSTOM_PROPERTIES.companies.length);
    // objects created
    const createCo = calls.find((c) => c.method === "POST" && c.path === "/crm/v3/objects/companies")!;
    expect(createCo.body.properties).toMatchObject({ name: "Prairie Comfort HVAC", domain: "prairiecomfort.ca", type: "PROSPECT", lifecyclestage: "lead", arriveping_company_id: CO });
    const createContacts = calls.filter((c) => c.method === "POST" && c.path === "/crm/v3/objects/contacts");
    expect(createContacts).toHaveLength(2);
    expect(createContacts[0]!.body.properties.lifecyclestage).toBe("lead");
    const createDeal = calls.find((c) => c.method === "POST" && c.path === "/crm/v3/objects/deals")!;
    expect(createDeal.body.properties).toMatchObject({ pipeline: "default", dealstage: "contractsent", hubspot_owner_id: "83114636" });
    // associations: each contact→company, deal→company, deal→each contact
    const assoc = calls.filter((c) => c.method === "PUT").map((c) => c.path);
    expect(assoc.filter((p) => /contacts\/\d+\/associations\/default\/companies/.test(p))).toHaveLength(2);
    expect(assoc.filter((p) => /deals\/\d+\/associations\/default\/companies/.test(p))).toHaveLength(1);
    expect(assoc.filter((p) => /deals\/\d+\/associations\/default\/contacts/.test(p))).toHaveLength(2);
    // ids stored
    const [co] = await db.select().from(schema.companies).where(eq(schema.companies.id, CO));
    expect(co!.hubspotCompanyId).toBe(r.hubspotCompanyId!);
    expect(co!.hubspotDealId).toBe(r.hubspotDealId!);
    expect(co!.hubspotHash).toBe(planFingerprint((await buildSyncPlan(CO))!));
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, "m-ann"));
    expect(m!.hubspotContactId).toMatch(/^\d+$/);
  });

  it("second run with nothing changed makes no API calls", async () => {
    await syncCompanyToHubspot(CO);
    calls = [];
    const r = await syncCompanyToHubspot(CO);
    expect(r.skipped).toBe("unchanged");
    expect(calls).toHaveLength(0);
  });

  it("a change updates in place (PATCH, no new objects) and a paid subscription closes the deal won", async () => {
    await syncCompanyToHubspot(CO);
    calls = [];
    await db.update(schema.companies).set({ billingStatus: "active", billingSeats: 5 }).where(eq(schema.companies.id, CO));
    const r = await syncCompanyToHubspot(CO);
    expect(r.ok).toBe(true);
    expect(r.skipped).toBeUndefined();
    expect(calls.filter((c) => c.method === "POST" && c.path.startsWith("/crm/v3/objects/") && !c.path.endsWith("/search"))).toHaveLength(0);
    const patchCo = calls.find((c) => c.method === "PATCH" && c.path.startsWith("/crm/v3/objects/companies/"))!;
    expect(patchCo.body.properties).toMatchObject({ lifecyclestage: "customer", arriveping_billing_seats: "5", arriveping_billing_status: "active" });
    expect(patchCo.body.properties.type).toBeUndefined(); // create-only
    const patchDeal = calls.find((c) => c.method === "PATCH" && c.path.startsWith("/crm/v3/objects/deals/"))!;
    expect(patchDeal.body.properties.dealstage).toBe("closedwon");
    const patchContact = calls.find((c) => c.method === "PATCH" && c.path.startsWith("/crm/v3/objects/contacts/"))!;
    expect(patchContact.body.properties.lifecyclestage).toBe("customer");
    await db.update(schema.companies).set({ billingStatus: "trialing", billingSeats: 3 }).where(eq(schema.companies.id, CO));
  });

  it("leaves a deal that sales already closed alone while the trial is still running", async () => {
    await syncCompanyToHubspot(CO);
    dealStage = "closedlost";
    await db.update(schema.companies).set({ billingSeats: 4 }).where(eq(schema.companies.id, CO));
    calls = [];
    await syncCompanyToHubspot(CO);
    const patchDeal = calls.find((c) => c.method === "PATCH" && c.path.startsWith("/crm/v3/objects/deals/"))!;
    expect(patchDeal.body.properties.dealstage).toBeUndefined();
    await db.update(schema.companies).set({ billingSeats: 3 }).where(eq(schema.companies.id, CO));
  });

  it("reuses a contact HubSpot already has for that email instead of creating a duplicate", async () => {
    await db.update(schema.memberships).set({ hubspotContactId: null }).where(eq(schema.memberships.id, "m-ann"));
    await db.update(schema.companies).set({ hubspotHash: "" }).where(eq(schema.companies.id, CO));
    searchHits["contacts:email=ann@prairiecomfort.ca"] = [{ id: "777" }];
    await syncCompanyToHubspot(CO);
    expect(calls.some((c) => c.method === "PATCH" && c.path === "/crm/v3/objects/contacts/777")).toBe(true);
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, "m-ann"));
    expect(m!.hubspotContactId).toBe("777");
  });

  it("reports failures instead of throwing, and only self-serve or already-linked tenants sync automatically", async () => {
    _setHubspotFetch((async () => new Response("boom", { status: 500 })) as any);
    await db.update(schema.companies).set({ hubspotHash: "" }).where(eq(schema.companies.id, CO));
    const r = await syncCompanyToHubspot(CO);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("HubSpot 500");
    expect(await isSyncedCompany(CO)).toBe(true);
    expect(await isSyncedCompany("nope")).toBe(false);
  });
});

describe("enrichment", () => {
  beforeAll(async () => {
    const sql = (db as any).$client;
    for (const t of [schema.bookings, schema.invoices, schema.techInvites, schema.integrations, schema.intakeForms, schema.intakeSubmissions, schema.reviews, schema.session])
      await sql.execute(ddlFor(t));
    const now = Date.now();
    const daysAgo = (d: number) => new Date(now - d * 86_400_000);
    await db.insert(schema.bookings).values([
      { id: "b1", companyId: CO, title: "Furnace", status: "completed", createdAt: daysAgo(90) } as any,
      { id: "b2", companyId: CO, title: "AC", status: "assigned", createdAt: daysAgo(3) } as any,
      { id: "b3", companyId: CO, title: "Sample", status: "completed", isSample: true, createdAt: daysAgo(2) } as any,
      { id: "b4", companyId: CO, title: "Deleted", status: "completed", deletedAt: daysAgo(1), createdAt: daysAgo(1) } as any,
      { id: "b5", companyId: "other-co", title: "Not ours", status: "completed", createdAt: daysAgo(1) } as any,
    ]);
    await db.insert(schema.invoices).values([{ id: "i1", companyId: CO, number: "1", status: "paid", createdAt: daysAgo(5) } as any]);
    await db.insert(schema.techInvites).values([{ id: "t1", companyId: CO, email: "new@x.ca", token: "tok", status: "pending", createdAt: daysAgo(1) } as any]);
    await db.insert(schema.integrations).values([
      { id: "g1", companyId: CO, provider: "quickbooks", status: "connected", createdAt: daysAgo(10) } as any,
      { id: "g2", companyId: CO, provider: "gmail", status: "disconnected", createdAt: daysAgo(10) } as any,
    ]);
    await db.insert(schema.reviews).values([
      { id: "r1", companyId: CO, bookingId: "b1", rating: 5, createdAt: daysAgo(80) } as any,
      { id: "r2", companyId: CO, bookingId: "b2", rating: 4, createdAt: daysAgo(2) } as any,
    ]);
    await db.insert(schema.session).values([
      { id: "s1", token: "t-1", userId: "u-ann", expiresAt: daysAgo(-30), createdAt: daysAgo(2), updatedAt: new Date("2026-10-17T15:00:00Z") } as any,
    ]);
    await db
      .update(schema.companySettings)
      .set({
        socials: JSON.stringify({ linkedin: "https://linkedin.com/company/prairie", facebook: "https://facebook.com/prairie", twitter: "https://x.com/prairiehvac" }),
        qualifyingProfile: JSON.stringify({ technicianCount: 6, vehicleCount: 5, jobsPerDay: 12, offersMaintenancePlans: true, offersEmergencyPremium: false, scoutedTeam: [{ name: "Secret" }] }),
      })
      .where(eq(schema.companySettings.companyId, CO));
    await db
      .update(schema.memberships)
      .set({ onboarding: JSON.stringify({ v: 1, persona: "owner", goal: "eta", teamSize: "3-9", tours: { a: { status: "completed", at: "x" }, b: { status: "skipped", at: "x" } } }) })
      .where(eq(schema.memberships.id, "m-ann"));
  });

  it("adds usage aggregates, the signup profile, socials and per-person activity", async () => {
    const plan = (await buildSyncPlan(CO))!;
    expect(plan.company).toMatchObject({
      arriveping_jobs_total: "2", // sample and deleted jobs excluded, other tenants never counted
      arriveping_jobs_30d: "1",
      arriveping_jobs_completed: "1",
      arriveping_invoices_paid: "1",
      arriveping_pending_invites: "1",
      arriveping_integrations: "quickbooks",
      arriveping_review_count: "2",
      arriveping_avg_rating: "4.5",
      arriveping_customer_count: "1",
      arriveping_last_active: "2026-10-17",
      arriveping_reported_technicians: "6",
      arriveping_reported_vehicles: "5",
      arriveping_reported_jobs_per_day: "12",
      arriveping_maintenance_plans: "true",
      arriveping_emergency_premium: "false",
      linkedin_company_page: "https://linkedin.com/company/prairie",
      facebook_company_page: "https://facebook.com/prairie",
      twitterhandle: "prairiehvac",
    });
    // scouted staff names and other profile internals are not sent
    expect(JSON.stringify(plan.company)).not.toContain("Secret");
    const ann = plan.contacts.find((c) => c.email.startsWith("ann"))!;
    expect(ann.props).toMatchObject({
      arriveping_last_active: "2026-10-17",
      arriveping_guide_persona: "owner",
      arriveping_guide_goal: "eta",
      arriveping_guide_team_size: "3-9",
      arriveping_guide_chapters_done: "1",
    });
    // every new arriveping_* property is declared
    const declared = new Set(CUSTOM_PROPERTIES.companies.map((p) => p.name));
    for (const k of Object.keys(plan.company)) if (k.startsWith("arriveping_")) expect(declared.has(k)).toBe(true);
    const cdeclared = new Set(CUSTOM_PROPERTIES.contacts.map((p) => p.name));
    for (const k of Object.keys(ann.props)) if (k.startsWith("arriveping_")) expect(cdeclared.has(k)).toBe(true);
  });
});

describe("which tenants sync", () => {
  it("HUBSPOT_SYNC_ALL adds hand-made tenants but never internal (demo/test) ones", async () => {
    await db.insert(schema.companies).values([
      { id: "hand-made", name: "Hand Made Co" } as any,
      { id: "demo-co", name: "Demo Co", isInternal: true } as any,
    ]);
    expect(await isSyncedCompany("hand-made")).toBe(false);
    process.env.HUBSPOT_SYNC_ALL = "1";
    try {
      expect(await isSyncedCompany("hand-made")).toBe(true);
      expect(await isSyncedCompany("demo-co")).toBe(false);
    } finally {
      delete process.env.HUBSPOT_SYNC_ALL;
    }
  });
});
