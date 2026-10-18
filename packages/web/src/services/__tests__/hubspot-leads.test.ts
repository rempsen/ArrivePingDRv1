/**
 * Website leads into HubSpot: Help Center messages become tickets on the
 * sender's contact, and a signup that reaches the card step becomes a lead.
 * Existing contacts are never edited. HubSpot is a fetch stub.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const realEmail = { ...(await import("../email")) };
beforeAll(() => {
  mock.module("../email", () => ({ ...realEmail, sendEmail: async () => ({ ok: true }) }));
});
afterAll(() => {
  mock.module("../email", () => realEmail);
});

const { findOrCreateLeadContact, createSupportTicket, pushSignupStarted, SIGNUP_LEAD_SOURCE, pushSetupDemoLead, SETUP_DEMO_LEAD_SOURCE } = await import("../hubspot-leads");
const { deliverSupportMessage, ticketSubject, SUPPORT_LEAD_SOURCE } = await import("../support-message");
const { _setHubspotFetch, _resetHubspotForTests } = await import("../hubspot-sync");

type Call = { method: string; path: string; body: any };
let calls: Call[] = [];
let searchHits: Record<string, any[]> = {};
let failTickets = false;
let nextId = 9000;

function stubFetch(url: string, init?: RequestInit): Promise<Response> {
  const path = url.replace("https://api.hubapi.com", "");
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, path, body });
  const json = (status: number, data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }));
  if (/^\/crm\/v3\/properties\/\w+\/groups$/.test(path)) return json(201, {});
  if (/^\/crm\/v3\/properties\/\w+/.test(path)) return method === "GET" ? json(200, { results: [] }) : json(201, body);
  const s = /^\/crm\/v3\/objects\/(\w+)\/search$/.exec(path);
  if (s) {
    const f = body.filterGroups[0].filters[0];
    const vals: string[] = f.operator === "IN" ? f.values : [f.value];
    const hit = vals.map((v) => searchHits[`${s[1]}:${f.propertyName}=${v}`]).find(Boolean);
    return json(200, { results: hit ?? [] });
  }
  if (path === "/crm/v3/objects/tickets" && method === "POST") return failTickets ? json(403, { message: "no tickets scope" }) : json(201, { id: "t-1" });
  if (/^\/crm\/v3\/objects\/(contacts|notes)$/.test(path) && method === "POST") return json(201, { id: String(nextId++) });
  return json(404, { message: `unhandled ${method} ${path}` });
}

beforeAll(() => _setHubspotFetch(stubFetch as unknown as typeof fetch));
afterAll(() => _setHubspotFetch(null));
beforeEach(() => {
  calls = [];
  searchHits = {};
  failTickets = false;
  nextId = 9000;
  process.env.HUBSPOT_ACCESS_TOKEN = "pat-test";
  process.env.HUBSPOT_OWNER_ID = "83114636";
  delete process.env.SLACK_SUPPORT_WEBHOOK_URL;
  _resetHubspotForTests();
});

const created = () => calls.filter((c) => c.method === "POST" && c.path === "/crm/v3/objects/contacts");

describe("findOrCreateLeadContact", () => {
  it("creates a new lead with source and owner", async () => {
    const r = await findOrCreateLeadContact({ name: "Pat Lee", email: "Pat@Example.com", company: "Lee HVAC", source: "Test" });
    expect(r).toEqual({ contactId: "9000", existing: false });
    expect(created()[0]!.body.properties).toMatchObject({
      firstname: "Pat",
      lastname: "Lee",
      email: "pat@example.com",
      company: "Lee HVAC",
      lifecyclestage: "lead",
      hs_lead_status: "NEW",
      arriveping_lead_source: "Test",
      hubspot_owner_id: "83114636",
    });
  });

  it("returns an existing contact without editing it", async () => {
    searchHits["contacts:email=pat@example.com"] = [{ id: "55" }];
    expect(await findOrCreateLeadContact({ name: "Someone Else", email: "pat@example.com", source: "Test" })).toEqual({ contactId: "55", existing: true });
    expect(created()).toHaveLength(0);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});

describe("support messages → HubSpot tickets", () => {
  const msg = { name: "Marcus Bell", email: "marcus@prairiecomfort.ca", company: "Prairie Comfort", topic: "Technician app", message: "ETAs stuck since 2pm.\nJordan is on the clock.", page: "/support/troubleshooting" };

  it("opens a ticket in Support Pipeline / New on the sender's contact", async () => {
    const r = await deliverSupportMessage(msg);
    expect(r.hubspot).toBe("synced");
    expect(r.delivered).toBe(true);
    expect(created()[0]!.body.properties.arriveping_lead_source).toBe(SUPPORT_LEAD_SOURCE);
    const t = calls.find((c) => c.path === "/crm/v3/objects/tickets")!;
    expect(t.body.properties).toMatchObject({ subject: "Technician app: ETAs stuck since 2pm. Jordan is on the clock.", hs_pipeline: "0", hs_pipeline_stage: "1", source_type: "FORM" });
    expect(t.body.properties.content).toContain("Sent from: arriveping.com/support/troubleshooting");
    expect(t.body.associations[0]).toEqual({ to: { id: "9000" }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 16 }] });
  });

  it("puts the ticket on an existing customer without touching their record", async () => {
    searchHits["contacts:email=marcus@prairiecomfort.ca"] = [{ id: "42" }];
    await deliverSupportMessage(msg);
    expect(created()).toHaveLength(0);
    expect(calls.find((c) => c.path === "/crm/v3/objects/tickets")!.body.associations[0].to.id).toBe("42");
  });

  it("counts as delivered by HubSpot alone, and degrades when tickets fail", async () => {
    const onlyHubspot = await deliverSupportMessage(msg);
    expect(onlyHubspot.delivered).toBe(true);
    failTickets = true;
    const r = await deliverSupportMessage(msg);
    expect(r.hubspot).toBe("failed");
    expect(r.delivered).toBe(true); // the email still went
  });

  it("keeps long subjects to one readable line", () => {
    expect(ticketSubject({ ...msg, topic: "", message: "x".repeat(300) }).length).toBeLessThanOrEqual(93);
  });
});

describe("pushSignupStarted", () => {
  it("makes the person a lead with a note, normalising the phone", async () => {
    expect(await pushSignupStarted({ email: "ann@prairiecomfort.ca", name: "Ann Lee", companyName: "Prairie Comfort", phone: "204-555-0101" })).toBe("synced");
    expect(created()[0]!.body.properties).toMatchObject({ arriveping_lead_source: SIGNUP_LEAD_SOURCE, phone: "+12045550101", company: "Prairie Comfort" });
    const note = calls.find((c) => c.path === "/crm/v3/objects/notes")!;
    expect(note.body.properties.hs_note_body).toContain("Started an ArrivePing signup");
  });

  it("is skipped without a HubSpot token", async () => {
    delete process.env.HUBSPOT_ACCESS_TOKEN;
    expect(await pushSignupStarted({ email: "a@b.co", name: "A" })).toBe("skipped");
    expect(calls).toHaveLength(0);
  });
});

describe("pushSetupDemoLead", () => {
  it("makes the visitor a lead with their website and a note", async () => {
    expect(await pushSetupDemoLead({ email: "Ann@BluestemPlumbing.ca", website: "bluestemplumbing.ca" })).toBe("synced");
    const p = created()[0]!.body.properties;
    expect(p).toMatchObject({ arriveping_lead_source: SETUP_DEMO_LEAD_SOURCE, email: "ann@bluestemplumbing.ca", website: "bluestemplumbing.ca", lifecyclestage: "lead" });
    expect(p.firstname).toBeUndefined();
    const note = calls.find((c) => c.path === "/crm/v3/objects/notes")!;
    expect(note.body.properties.hs_note_body).toContain("Tried the setup demo");
    expect(note.body.properties.hs_note_body).toContain("bluestemplumbing.ca");
  });

  it("only adds the note to an existing contact", async () => {
    searchHits["contacts:email=ann@bluestemplumbing.ca"] = [{ id: "77" }];
    expect(await pushSetupDemoLead({ email: "ann@bluestemplumbing.ca", website: "bluestemplumbing.ca" })).toBe("synced");
    expect(created()).toHaveLength(0);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(calls.some((c) => c.path === "/crm/v3/objects/notes")).toBe(true);
  });

  it("is skipped without a HubSpot token", async () => {
    delete process.env.HUBSPOT_ACCESS_TOKEN;
    expect(await pushSetupDemoLead({ email: "a@b.co", website: "b.co" })).toBe("skipped");
    expect(calls).toHaveLength(0);
  });
});

describe("createSupportTicket", () => {
  it("honours a custom pipeline and stage", async () => {
    process.env.HUBSPOT_TICKET_PIPELINE = "77";
    process.env.HUBSPOT_TICKET_STAGE = "88";
    await createSupportTicket({ subject: "s", content: "c", contactId: "1" });
    expect(calls[0]!.body.properties).toMatchObject({ hs_pipeline: "77", hs_pipeline_stage: "88" });
    delete process.env.HUBSPOT_TICKET_PIPELINE;
    delete process.env.HUBSPOT_TICKET_STAGE;
  });
});
