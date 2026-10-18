/**
 * Homepage "contact me" leads: saved to contact_requests, pushed to HubSpot as
 * a Contact + note, emailed to sales. HubSpot is a fetch stub and email is
 * mocked; the database is the in-memory pglite harness.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.HUBSPOT_ACCESS_TOKEN = "pat-test";
process.env.HUBSPOT_OWNER_ID = "83114636";
process.env.HUBSPOT_PORTAL_ID = "4455";
delete process.env.CONTACT_REQUEST_TO;

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

const { parseContact, splitName, normalizePhone, phoneVariants, displayPhone, pushContactRequestToHubspot, emailContactRequest, submitContactRequest, retryContactRequests, retryDelayMs, MAX_ATTEMPTS, LEAD_SOURCE } =
  await import("../contact-request");
const { _setHubspotFetch, _resetHubspotForTests } = await import("../hubspot-sync");
const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { eq } = await import("drizzle-orm");
const { Hono } = await import("hono");
const { contactRequestRoutes } = await import("../../api/routes/contact-request");

type Call = { method: string; path: string; body: any };
let calls: Call[] = [];
let searchHits: Record<string, any[]> = {};
let failCreate: number | null = null;
let failCreateTimes = Infinity;
let failNotes = false;
let nextId = 5000;

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
  if (path === "/crm/v3/objects/contacts" && method === "POST") {
    if (failCreate === 409) return json(409, { message: "Contact already exists. Existing ID: 777" });
    if (failCreate && failCreateTimes-- > 0) return json(failCreate, { message: "boom" });
    return json(201, { id: String(nextId++) });
  }
  if (path === "/crm/v3/objects/notes" && method === "POST") return failNotes ? json(403, { message: "missing scope" }) : json(201, { id: "n1" });
  return json(404, { message: `unhandled ${method} ${path}` });
}

beforeAll(async () => {
  // Build the table from the real migrations, so the test also proves 0017 + 0018 apply cleanly.
  // The test database is shared, and a suite that ran earlier may already have made this table
  // from the schema (sample-day.test.ts creates every table), so start from nothing.
  await (db as any).execute(`DROP TABLE IF EXISTS "contact_requests"`);
  for (const f of ["0017_contact_requests.sql", "0018_contact_request_retries.sql"]) {
    const sqlText = await Bun.file(new URL(`../../../drizzle/${f}`, import.meta.url)).text();
    for (const stmt of sqlText.split("--> statement-breakpoint").map((x) => x.trim()).filter(Boolean)) await (db as any).execute(stmt);
  }
  _setHubspotFetch(stubFetch as unknown as typeof fetch);
});
afterAll(() => _setHubspotFetch(null));

beforeEach(async () => {
  calls = [];
  sent = [];
  searchHits = {};
  failCreate = null;
  failCreateTimes = Infinity;
  failNotes = false;
  nextId = 5000;
  emailResult = { ok: true };
  process.env.HUBSPOT_ACCESS_TOKEN = "pat-test";
  _resetHubspotForTests();
  await db.delete(schema.contactRequests);
});

const lead = { name: "Marcus Bell", email: "marcus@prairiecomfort.ca", company: "Prairie Comfort HVAC", source: "homepage" };

describe("parseContact", () => {
  it("accepts an email (lower-cased) or a phone with 10–15 digits", () => {
    expect(parseContact(" Marcus@PrairieComfort.ca ")).toEqual({ email: "marcus@prairiecomfort.ca" });
    expect(parseContact("(204) 555-0199")).toEqual({ phone: "+12045550199" });
    expect(parseContact("+1 204 555 0199")).toEqual({ phone: "+12045550199" });
    expect(parseContact("+44 20 7946 0958")).toEqual({ phone: "+442079460958" });
  });
  it("rejects anything else", () => {
    for (const bad of ["", "marcus@", "555-0199", "call me", "204-555-0199 ext 4", "1".repeat(16)]) expect(parseContact(bad)).toBeNull();
  });
  it("normalises phones to E.164 and looks them up under common spellings", () => {
    expect(normalizePhone("1-204-555-0199")).toBe("+12045550199");
    expect(normalizePhone("555-0199")).toBeNull();
    expect(displayPhone("+12045550199")).toBe("(204) 555-0199");
    expect(displayPhone("+442079460958")).toBe("+442079460958");
    const v = phoneVariants("+12045550199");
    for (const x of ["+12045550199", "2045550199", "(204) 555-0199", "204-555-0199", "+1 (204) 555-0199"]) expect(v).toContain(x);
  });

  it("splits a name into first and last", () => {
    expect(splitName("Marcus Bell")).toEqual({ firstname: "Marcus", lastname: "Bell" });
    expect(splitName("Mary Ann  O'Neil")).toEqual({ firstname: "Mary Ann", lastname: "O'Neil" });
    expect(splitName("Cher")).toEqual({ firstname: "Cher", lastname: "" });
  });
});

describe("pushContactRequestToHubspot", () => {
  it("creates a new lead with owner, lead status and source, then adds a timeline note", async () => {
    const r = await pushContactRequestToHubspot(lead);
    expect(r).toEqual({ status: "synced", contactId: "5000", existing: false });
    const create = calls.find((c) => c.method === "POST" && c.path === "/crm/v3/objects/contacts")!;
    expect(create.body.properties).toEqual({
      firstname: "Marcus",
      lastname: "Bell",
      email: "marcus@prairiecomfort.ca",
      company: "Prairie Comfort HVAC",
      lifecyclestage: "lead",
      hs_lead_status: "NEW",
      arriveping_lead_source: LEAD_SOURCE,
      hubspot_owner_id: "83114636",
    });
    const note = calls.find((c) => c.path === "/crm/v3/objects/notes")!;
    expect(note.body.associations[0].to.id).toBe("5000");
    expect(note.body.associations[0].types[0].associationTypeId).toBe(202);
    expect(note.body.properties.hs_note_body).toContain("Prairie Comfort HVAC");
  });

  it("finds a phone-only lead by phone and never edits an existing contact", async () => {
    // HubSpot has it stored the way someone once typed it; we search every common spelling.
    searchHits["contacts:phone=204-555-0199"] = [{ id: "42" }];
    const r = await pushContactRequestToHubspot({ name: "Someone Else", phone: "+12045550199" });
    expect(r).toEqual({ status: "synced", contactId: "42", existing: true });
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(calls.some((c) => c.method === "POST" && c.path === "/crm/v3/objects/contacts")).toBe(false);
    expect(calls.find((c) => c.path === "/crm/v3/objects/notes")!.body.properties.hs_note_body).toContain("Someone Else");
  });

  it("escapes what the visitor typed in the note", async () => {
    await pushContactRequestToHubspot({ ...lead, company: "<script>x</script>" });
    expect(calls.find((c) => c.path === "/crm/v3/objects/notes")!.body.properties.hs_note_body).toContain("&lt;script&gt;");
  });

  it("uses the existing id when HubSpot reports a 409 race", async () => {
    failCreate = 409;
    expect(await pushContactRequestToHubspot(lead)).toEqual({ status: "synced", contactId: "777", existing: true });
  });

  it("still counts as synced when only the note fails", async () => {
    failNotes = true;
    expect((await pushContactRequestToHubspot(lead)).status).toBe("synced");
  });

  it("reports failed on a HubSpot error and skipped when not configured", async () => {
    failCreate = 500;
    expect((await pushContactRequestToHubspot(lead)).status).toBe("failed");
    delete process.env.HUBSPOT_ACCESS_TOKEN;
    calls = [];
    expect(await pushContactRequestToHubspot(lead)).toEqual({ status: "skipped" });
    expect(calls).toHaveLength(0);
  });
});

describe("emailContactRequest", () => {
  it("emails contact@ with Reply-To and a HubSpot link", async () => {
    expect(await emailContactRequest(lead, { status: "synced", contactId: "5000", existing: false })).toBe("sent");
    expect(sent[0].to).toBe("contact@nvc360.com");
    expect(sent[0].replyTo).toBe("marcus@prairiecomfort.ca");
    expect(sent[0].subject).toBe("Contact request — Marcus Bell (Prairie Comfort HVAC)");
    expect(sent[0].html).toContain("https://app.hubspot.com/contacts/4455/record/0-1/5000");
  });
  it("has no Reply-To for a phone-only lead and flags a failed HubSpot push", async () => {
    await emailContactRequest({ name: "Pat", phone: "+12045550199" }, { status: "failed", error: "x" });
    expect(sent[0].replyTo).toBeUndefined();
    expect(sent[0].text).toContain("Phone: (204) 555-0199");
    expect(sent[0].text).toContain("add it by hand");
  });
});

describe("submitContactRequest", () => {
  it("saves the lead, then records the HubSpot and email outcome on the row", async () => {
    const r = await submitContactRequest(lead);
    expect(r.delivered).toBe(true);
    await r.done;
    const [row] = await db.select().from(schema.contactRequests).where(eq(schema.contactRequests.id, r.id!));
    expect(row).toMatchObject({
      name: "Marcus Bell",
      email: "marcus@prairiecomfort.ca",
      phone: "",
      company: "Prairie Comfort HVAC",
      source: "homepage",
      status: "new",
      hubspotStatus: "synced",
      hubspotContactId: "5000",
      emailStatus: "sent",
    });
  });

  it("keeps the lead and records failures when HubSpot and email both fail", async () => {
    failCreate = 500;
    emailResult = { ok: false };
    const r = await submitContactRequest({ name: "Pat", phone: "+12045550199" });
    expect(r.delivered).toBe(true); // it's saved
    await r.done;
    const [row] = await db.select().from(schema.contactRequests).where(eq(schema.contactRequests.id, r.id!));
    expect(row!.hubspotStatus).toBe("failed");
    expect(row!.hubspotError).toContain("HubSpot 500");
    expect(row!.emailStatus).toBe("failed");
  });
});

describe("retryContactRequests", () => {
  const T0 = new Date("2026-10-18T15:00:00Z");
  const later = (min: number) => new Date(T0.getTime() + min * 60_000);
  async function failedLead() {
    failCreate = 500;
    failCreateTimes = 1; // HubSpot down for the first try only
    emailResult = { ok: true };
    const r = await submitContactRequest(lead);
    await r.done;
    await db.update(schema.contactRequests).set({ lastAttemptAt: T0, createdAt: T0 }).where(eq(schema.contactRequests.id, r.id!));
    sent = [];
    calls = [];
    return r.id!;
  }
  const row = async (id: string) => (await db.select().from(schema.contactRequests).where(eq(schema.contactRequests.id, id)))[0]!;

  it("waits out the backoff, then retries only the channel that failed", async () => {
    const id = await failedLead();
    expect((await row(id)).hubspotStatus).toBe("failed");
    expect(retryDelayMs(1)).toBe(10 * 60_000);

    expect((await retryContactRequests(later(5))).retried).toBe(0); // too soon
    const out = await retryContactRequests(later(11));
    expect(out.retried).toBe(1);
    const r = await row(id);
    expect(r).toMatchObject({ hubspotStatus: "synced", hubspotError: "", emailStatus: "sent", attempts: 2 });
    expect(sent).toHaveLength(0); // the email had already gone; not sent twice
    expect(calls.some((c) => c.method === "POST" && c.path === "/crm/v3/objects/contacts")).toBe(true);

    expect((await retryContactRequests(later(60))).checked).toBe(0); // nothing left owed
  });

  it("picks up a lead left pending by a restart", async () => {
    const [ins] = await db
      .insert(schema.contactRequests)
      .values({ name: "Pat Lee", phone: "+12045550199", lastAttemptAt: T0, createdAt: T0 })
      .returning({ id: schema.contactRequests.id });
    await retryContactRequests(later(15));
    expect(await row(ins!.id)).toMatchObject({ hubspotStatus: "synced", emailStatus: "sent", attempts: 2 });
    expect(sent[0].text).toContain("(204) 555-0199");
  });

  it("stops after MAX_ATTEMPTS and reports it", async () => {
    const id = await failedLead();
    failCreateTimes = Infinity; // HubSpot stays down
    let t = 0;
    let gaveUp = 0;
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      t += retryDelayMs(i) / 60_000 + 1;
      gaveUp += (await retryContactRequests(later(t))).gaveUp;
    }
    expect((await row(id)).attempts).toBe(MAX_ATTEMPTS);
    expect(gaveUp).toBe(1);
    expect((await retryContactRequests(later(t + 10_000))).checked).toBe(0);
  });

  it("never lets two sweeps retry the same lead", async () => {
    await failedLead();
    failCreateTimes = 0;
    const [a, b] = await Promise.all([retryContactRequests(later(11)), retryContactRequests(later(11))]);
    expect(a.retried + b.retried).toBe(1);
  });
});

describe("POST /api/public/contact-request", () => {
  const app = new Hono().route("/c", contactRequestRoutes);
  app.onError((e: any, c) => c.json({ error: { code: e.code, details: e.details } }, e.status ?? 500));
  const post = (body: any, ip = "10.0.0.1") =>
    app.request("/c", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });

  it("accepts a phone lead and saves it", async () => {
    const r = await post({ name: "Pat Lee", contact: "204-555-0199", company: "" }, "10.0.0.2");
    expect(r.status).toBe(200);
    const rows = await db.select().from(schema.contactRequests);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.phone).toBe("+12045550199");
  });

  it("rejects a missing name or an unusable contact with field errors", async () => {
    const r = await post({ name: "", contact: "call me maybe" }, "10.0.0.3");
    expect(r.status).toBe(400);
    const r2 = await post({ name: "Pat", contact: "call me maybe" }, "10.0.0.3");
    expect(r2.status).toBe(400);
    expect(((await r2.json()) as any).error.details.fields.contact).toContain("valid email");
    expect(await db.select().from(schema.contactRequests)).toHaveLength(0);
  });

  it("drops honeypot submissions silently", async () => {
    const r = await post({ name: "Bot", contact: "b@x.co", website: "http://spam" }, "10.0.0.4");
    expect(r.status).toBe(200);
    expect(await db.select().from(schema.contactRequests)).toHaveLength(0);
  });

  it("rate-limits a single IP after 5 requests", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post({ name: "Pat", contact: "p@x.co" }, "10.0.0.9")).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });
});
