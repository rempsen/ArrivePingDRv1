/**
 * nvc360.com forms → HubSpot + inboxes (+ Slack for support), via
 * POST /api/public/website-inquiry. HubSpot, email and Slack are stubs.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import { Hono } from "hono";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

let sent: any[] = [];
let emailResult: any = { ok: true };
const realEmail = { ...(await import("../email")) };
beforeAll(() => {
  mock.module("../email", () => ({
    ...realEmail,
    sendEmail: async (opts: any) => {
      sent.push(opts);
      return emailResult;
    },
  }));
});
afterAll(() => {
  mock.module("../email", () => realEmail);
});

const { deliverWebsiteInquiry, inquiryNote, INQUIRY_SOURCES } = await import("../website-inquiry");
const { websiteInquiryRoutes } = await import("../../api/routes/website-inquiry");
const { AppError } = await import("../../api/lib/errors");
const { _setHubspotFetch, _resetHubspotForTests } = await import("../hubspot-sync");

type Call = { method: string; path: string; body: any };
let calls: Call[] = [];
let slackPosts: any[] = [];
let searchHits: Record<string, any[]> = {};
let hubspotDown = false;
let nextId = 7000;

function stubFetch(url: string, init?: RequestInit): Promise<Response> {
  const json = (status: number, data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }));
  if (url.startsWith("https://hooks.slack.com")) {
    slackPosts.push(JSON.parse(String(init?.body)));
    return Promise.resolve(new Response("ok", { status: 200 }));
  }
  const path = url.replace("https://api.hubapi.com", "");
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, path, body });
  if (hubspotDown) return json(503, { message: "down" });
  if (/^\/crm\/v3\/properties\/\w+\/groups$/.test(path)) return json(201, {});
  if (/^\/crm\/v3\/properties\/\w+/.test(path)) return method === "GET" ? json(200, { results: [] }) : json(201, body);
  const s = /^\/crm\/v3\/objects\/(\w+)\/search$/.exec(path);
  if (s) {
    const f = body.filterGroups[0].filters[0];
    return json(200, { results: searchHits[`${s[1]}:${f.propertyName}=${f.value}`] ?? [] });
  }
  if (/^\/crm\/v3\/objects\/(contacts|notes|tickets)$/.test(path) && method === "POST") return json(201, { id: String(nextId++) });
  return json(404, { message: `unhandled ${method} ${path}` });
}

const realFetch = globalThis.fetch;
beforeAll(() => {
  _setHubspotFetch(stubFetch as unknown as typeof fetch);
  // Slack is posted with the global fetch.
  globalThis.fetch = stubFetch as unknown as typeof fetch;
});
afterAll(() => {
  _setHubspotFetch(null);
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  calls = [];
  sent = [];
  slackPosts = [];
  searchHits = {};
  hubspotDown = false;
  emailResult = { ok: true };
  nextId = 7000;
  process.env.HUBSPOT_ACCESS_TOKEN = "pat-test";
  process.env.HUBSPOT_OWNER_ID = "83114636";
  process.env.HUBSPOT_PORTAL_ID = "342390247";
  process.env.SLACK_SUPPORT_WEBHOOK_URL = "https://hooks.slack.com/services/T/B/x";
  delete process.env.CONTACT_REQUEST_TO;
  delete process.env.SUPPORT_MESSAGE_TO;
  _resetHubspotForTests();
});

const contact = {
  kind: "contact" as const,
  name: "Priya Shah",
  email: "Priya@NorthlineLogistics.ca",
  company: "Northline Logistics",
  topic: "Custom AI solution",
  message: "We dispatch 40 trucks by spreadsheet.\nCan you help? <b>soon</b>",
  page: "/contact",
};
const created = (obj: string) => calls.filter((c) => c.method === "POST" && c.path === `/crm/v3/objects/${obj}`);

describe("contact form", () => {
  it("creates a NEW lead with the nvc360.com source, notes the message, and emails sales with a HubSpot link", async () => {
    const r = await deliverWebsiteInquiry(contact);
    expect(r).toMatchObject({ delivered: true, hubspot: "synced", email: "sent", contactId: "7000" });
    expect(created("contacts")[0]!.body.properties).toMatchObject({
      firstname: "Priya",
      lastname: "Shah",
      email: "priya@northlinelogistics.ca",
      company: "Northline Logistics",
      lifecyclestage: "lead",
      hs_lead_status: "NEW",
      arriveping_lead_source: INQUIRY_SOURCES.contact,
      hubspot_owner_id: "83114636",
    });
    const note = created("notes")[0]!.body;
    expect(note.associations[0].to.id).toBe("7000");
    expect(note.properties.hs_note_body).toContain("Sent from: nvc360.com/contact");
    expect(note.properties.hs_note_body).toContain("&lt;b&gt;soon&lt;/b&gt;");
    expect(sent[0]).toMatchObject({ to: "contact@nvc360.com", replyTo: "Priya@NorthlineLogistics.ca", subject: "Website inquiry — Northline Logistics · Custom AI solution" });
    expect(sent[0].html).toContain("https://app.hubspot.com/contacts/342390247/record/0-1/7000");
    expect(slackPosts).toHaveLength(0);
  });

  it("adds a note to an existing contact without editing it", async () => {
    searchHits["contacts:email=priya@northlinelogistics.ca"] = [{ id: "55" }];
    const r = await deliverWebsiteInquiry(contact);
    expect(r.contactId).toBe("55");
    expect(created("contacts")).toHaveLength(0);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(created("notes")[0]!.body.associations[0].to.id).toBe("55");
  });

  it("still delivers by email when HubSpot is down, and fails only when both fail", async () => {
    hubspotDown = true;
    expect(await deliverWebsiteInquiry(contact)).toMatchObject({ delivered: true, hubspot: "failed", email: "sent" });
    emailResult = { ok: false };
    expect((await deliverWebsiteInquiry(contact)).delivered).toBe(false);
  });

  it("note escapes HTML", () => {
    expect(inquiryNote({ ...contact, name: "<script>" })).not.toContain("<script>");
  });
});

describe("support form", () => {
  const support = { ...contact, kind: "support" as const, topic: "Billing or account", message: "Invoice 1042 looks doubled.", page: "/support" };

  it("opens a ticket, posts to Slack and emails support, all marked nvc360.com", async () => {
    const r = await deliverWebsiteInquiry(support);
    expect(r).toMatchObject({ delivered: true, hubspot: "synced", email: "sent", slack: true });
    expect(created("contacts")[0]!.body.properties.arriveping_lead_source).toBe(INQUIRY_SOURCES.support);
    const t = created("tickets")[0]!.body.properties;
    expect(t.subject).toBe("Billing or account: Invoice 1042 looks doubled.");
    expect(t.content).toContain("Sent from: nvc360.com/support");
    expect(sent[0].to).toBe("support@nvc360.com");
    expect(sent[0].text).toContain("Support message from nvc360.com");
    expect(JSON.stringify(slackPosts[0])).toContain("Sent from nvc360.com");
  });
});

describe("POST /api/public/website-inquiry", () => {
  const app = new Hono()
    .onError((e, c) => (e instanceof AppError ? c.json({ error: { code: e.code, details: e.details } }, e.status as 400) : c.json({ error: "boom" }, 500)))
    .route("/", websiteInquiryRoutes);
  const post = (body: unknown, ip = "203.0.113.9") =>
    app.request("/", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, "cf-connecting-ip": ip }, body: JSON.stringify(body) });

  it("accepts a valid contact message", async () => {
    const res = await post(contact, "203.0.113.1");
    expect(res.status).toBe(200);
    expect(created("contacts")).toHaveLength(1);
  });

  it("rejects a missing name or message with field errors", async () => {
    const res = await post({ ...contact, name: "", message: "" }, "203.0.113.2");
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("swallows honeypot submissions without sending anything", async () => {
    const res = await post({ ...contact, website: "spam.example" }, "203.0.113.3");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("drops a page that isn't a site-relative path", async () => {
    await post({ ...contact, page: "https://evil.example/x" }, "203.0.113.4");
    expect(created("notes")[0]!.body.properties.hs_note_body).toContain("Sent from: nvc360.com/contact");
    expect(created("notes")[0]!.body.properties.hs_note_body).not.toContain("evil");
  });

  it("returns 502 with the right inbox when nothing took the message", async () => {
    hubspotDown = true;
    emailResult = { ok: false };
    const res = await post({ ...contact, kind: "support" }, "203.0.113.5");
    // Slack still took it, so it's delivered.
    expect(res.status).toBe(200);
    delete process.env.SLACK_SUPPORT_WEBHOOK_URL;
    const res2 = await post({ ...contact, kind: "support" }, "203.0.113.6");
    expect(res2.status).toBe(502);
    expect(((await res2.json()) as any).error.message).toContain("support@nvc360.com");
  });
});
