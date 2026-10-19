/**
 * A public lead form offers its own services and books within them.
 *
 * Towers Realty's "Book a Suite Viewing or Leasing Inquiry" form listed all 14
 * of the company's services, office work included ("Owner Approval — NTE
 * Review", "Financial Reporting & Accounting Review"), and a submission could
 * be booked under any service id the browser sent. Now:
 *
 *   - the form's GET returns only the services on its Service type field;
 *   - submit books the visitor's pick only when the form offers it, else the
 *     form's default;
 *   - an emergency request lands urgent;
 *   - a picked day is that day on the company's clock, not UTC midnight;
 *   - the internal work-order form still lists every service.
 *
 * Harness mirrors intake-form-hygiene.test.ts: in-memory libsql, DDL from
 * drizzle, ids prefixed "intakesvc-" (Bun shares one ":memory:" store across
 * test files). Every submission carries coordinates inside the zone, so no
 * geocoding; no provider credentials under `bun test`, so nobody is notified.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { getTableConfig, type PgColumn } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { publicFormsRoutes } = await import("../public-forms");
const { hashApiKey } = await import("../../middleware/auth");
const { normalizeFields } = await import("../forms");

const CO = "intakesvc-company";
const PUB_KEY = "nvcpub_intakesvctestkey000000000000";
const INSIDE = { lat: 49.895, lng: -97.138 };
const ZONE_POLY: [number, number][] = [
  [49.87, -97.2],
  [49.92, -97.2],
  [49.92, -97.08],
  [49.87, -97.08],
];

const app = new Hono();
app.route("/public/forms", publicFormsRoutes);

function ddlFor(table: any): string {
  const cfg = getTableConfig(table);
  const cols = cfg.columns.map((col: PgColumn) => {
    const parts = [`"${col.name}"`, col.getSQLType()];
    if (col.primary) parts.push("PRIMARY KEY");
    const dflt = (col as any).default;
    let lit: string | null = null;
    if (dflt !== undefined) {
      lit =
        typeof dflt === "string" ? `'${dflt.replace(/'/g, "''")}'`
        : typeof dflt === "boolean" ? (dflt ? "TRUE" : "FALSE")
        : typeof dflt === "number" ? String(dflt)
        : null;
    }
    if (col.notNull && (lit !== null || col.primary)) parts.push("NOT NULL");
    if (lit !== null) parts.push(`DEFAULT ${lit}`);
    return parts.join(" ");
  });
  return `CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cols.join(", ")})`;
}

const SERVICES: Array<[string, string, string, number]> = [
  ["intakesvc-wo", "Work Order — Tenant Request", "Maintenance", 1],
  ["intakesvc-em", "Work Order — Emergency Dispatch", "Maintenance", 1],
  ["intakesvc-lease", "Leasing & Tenant Screening", "Leasing", 1],
  ["intakesvc-view", "Apartment Rental Viewing", "Leasing", 1],
  ["intakesvc-nte", "Owner Approval — NTE Review", "Office", 1],
  ["intakesvc-fin", "Financial Reporting & Accounting Review", "Office", 1],
];

const fieldsWith = (serviceIds: string[]) =>
  JSON.stringify([
    { key: "name", enabled: true, required: true },
    { key: "email", enabled: true, required: true },
    { key: "address", enabled: true, required: true },
    { key: "serviceType", enabled: true, required: false, serviceIds },
    { key: "preferredAt", enabled: true, required: false },
  ]);

beforeAll(async () => {
  const sql = (db as any).$client;
  for (const t of [
    schema.companies, schema.companySettings, schema.bookings, schema.services, schema.invoices,
    schema.serviceZones, schema.user, schema.memberships, schema.apiKeys,
    schema.intakeForms, schema.intakeSubmissions, schema.jobEvents,
    schema.notificationRules, schema.notificationChannels,
    schema.notificationDeliveries, schema.notifications, schema.automationRules,
    schema.customMilestones, schema.customMilestoneFires,
  ]) {
    await sql.execute(ddlFor(t));
  }
  await sql.execute({
    sql: "INSERT OR IGNORE INTO api_keys (id, company_id, hashed_key, key_type, public_key) VALUES (?,?,?,?,?)",
    args: ["intakesvc-key", CO, await hashApiKey(PUB_KEY), "public", PUB_KEY],
  });
  for (const [id, name, category, active] of SERVICES) {
    await sql.execute({
      sql: "INSERT OR IGNORE INTO services (id, company_id, name, category, base_price, active) VALUES (?,?,?,?,?,?)",
      args: [id, CO, name, category, 0, active],
    });
  }
  const forms: Array<[string, string, string, string, string, string]> = [
    ["intakesvc-f-lease", "leasing", "Book a Suite Viewing or Leasing Inquiry", fieldsWith(["intakesvc-view", "intakesvc-lease"]), "intakesvc-view", "lead"],
    ["intakesvc-f-maint", "maintenance", "Submit a Maintenance Work Order", fieldsWith(["intakesvc-wo", "intakesvc-em"]), "intakesvc-wo", "lead"],
    ["intakesvc-f-all", "anything", "Request Service", fieldsWith([]), "", "lead"],
    ["intakesvc-f-wo", "staff", "Create Work Order", "[]", "", "work_order"],
  ];
  for (const [id, slug, title, fields, dflt, type] of forms) {
    await sql.execute({
      sql: "INSERT OR IGNORE INTO intake_forms (id, company_id, slug, title, fields, active, default_service_id, form_type) VALUES (?,?,?,?,?,?,?,?)",
      args: [id, CO, slug, title, fields, 1, dflt, type],
    });
  }
  await sql.execute({
    sql: "INSERT OR IGNORE INTO service_zones (id, company_id, name, polygon, active) VALUES (?,?,?,?,?)",
    args: ["intakesvc-zone", CO, "Winnipeg", JSON.stringify(ZONE_POLY), 1],
  });
});

const getForm = async (slug: string) => {
  const res = await app.request(`/public/forms/${CO}/${slug}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { form: { fields: any[] }; services: Array<{ id: string; name: string }> };
};

/** Submit, then return the booking it created. */
async function submit(slug: string, body: Record<string, unknown>) {
  const email = `svc-${crypto.randomUUID().slice(0, 8)}@t.test`;
  const res = await app.request(`/public/forms/${CO}/${slug}/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Public-Key": PUB_KEY,
      "X-Forwarded-For": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
    body: JSON.stringify({ name: "Pat Prospect", email, address: "1 Main St", ...INSIDE, ...body }),
  });
  expect(res.status).toBe(201);
  const [u] = (await db.select().from(schema.user)).filter((x) => x.email === email);
  const [b] = await db.select().from(schema.bookings).where(eq(schema.bookings.customerId, u!.id));
  return b!;
}

describe("public lead form — the services it offers", () => {
  it("lists only the form's own services", async () => {
    const d = await getForm("leasing");
    expect(d.services.map((s) => s.name).sort()).toEqual(["Apartment Rental Viewing", "Leasing & Tenant Screening"]);
  });

  it("does not publish the service ids on the field", async () => {
    const d = await getForm("leasing");
    const svcField = d.form.fields.find((f) => f.key === "serviceType");
    expect(svcField).toBeDefined();
    expect("serviceIds" in svcField).toBe(false);
  });

  it("a form never narrowed down still lists every service", async () => {
    const d = await getForm("anything");
    expect(d.services).toHaveLength(SERVICES.length);
  });

  it("the internal work-order form lists every service", async () => {
    const d = await getForm("staff");
    expect(d.services).toHaveLength(SERVICES.length);
  });
});

describe("public lead form — booking the submission", () => {
  it("books the visitor's pick when the form offers it", async () => {
    const b = await submit("leasing", { serviceId: "intakesvc-lease" });
    expect(b.serviceId).toBe("intakesvc-lease");
    expect(b.priority).toBe("normal");
  });

  it("ignores a service the form does not offer and books the form's default", async () => {
    const b = await submit("leasing", { serviceId: "intakesvc-nte" });
    expect(b.serviceId).toBe("intakesvc-view");
  });

  it("books the form's default when the visitor skips the dropdown", async () => {
    const b = await submit("leasing", {});
    expect(b.serviceId).toBe("intakesvc-view");
  });

  it("an emergency request lands urgent", async () => {
    const b = await submit("maintenance", { serviceId: "intakesvc-em" });
    expect(b.serviceId).toBe("intakesvc-em");
    expect(b.priority).toBe("urgent");
  });

  it("a picked day is that day on the company's clock", async () => {
    // No company settings row: the platform default zone (America/Winnipeg,
    // UTC-5 in July) — 9:00 AM local, not 7 PM the evening before.
    const b = await submit("leasing", { preferredAt: "2026-07-15" });
    expect(new Date(b.scheduledAt as any).toISOString()).toBe("2026-07-15T14:00:00.000Z");
  });
});

describe("form editor — saving the list", () => {
  it("keeps the service list on the Service type field only, cleaned", () => {
    const out = normalizeFields([
      { key: "serviceType", serviceIds: ["a", "a", 7, " b "] },
      { key: "notes", serviceIds: ["a"] },
    ]);
    expect(out[0].serviceIds).toEqual(["a", "b"]);
    expect("serviceIds" in out[1]).toBe(false);
  });
});
