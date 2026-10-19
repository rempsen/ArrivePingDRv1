/**
 * THE DIRECTORY, BY PROPERTY AND MANAGER (Dan, 2026-10-18).
 *
 * A property manager with thousands of residents needs each one at a named
 * property, with a unit, and each property with the team member who manages
 * it. Drives the real directory, import and admin routes on an in-memory
 * database, mounted under /api so the office-access rules apply as in the app:
 *   - properties: create, adopt a job's address row, rename, change manager,
 *     remove (residents unassigned, job history kept);
 *   - assign: customers only, this company's only;
 *   - GET /directory: sorted, grouped, filtered, with open requests and the
 *     last visit from job history, and nothing from another company;
 *   - import: a Property and Unit column on the resident list, and a
 *     property list with its managers.
 * Ids prefixed "dr-".
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { and, eq } from "drizzle-orm";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.RESEND_API_KEY = "";
process.env.TWILIO_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { directoryRoutes } = await import("../directory");
const { importRoutes } = await import("../import");
const { adminRoutes } = await import("../admin");

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

const CO = "dr-co";
const OTHER = "dr-other";
const BOSS = "dr-boss";
const JORDAN = "dr-jordan"; // field staff (this tenant calls them Property Managers)
const SAM = "dr-sam"; // office: a dispatcher

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  const role = c.req.header("X-Test-Role") || "admin";
  c.set("companyId", c.req.header("X-Test-Company") || CO);
  c.set("user", { id: c.req.header("X-Test-User") || BOSS, role, email: "boss@dr.test", name: "Dana Boss", permissions: c.req.header("X-Test-Perms") || null } as any);
  return next();
});
app.route("/api/directory", directoryRoutes);
app.route("/api/import", importRoutes);
app.route("/api/admin", adminRoutes);
app.onError((e, c) => c.json({ message: e.message }, ((e as { status?: number }).status ?? 500) as 400));

type Opts = { company?: string; role?: string; user?: string; perms?: string[] };
const headers = (o: Opts = {}) => ({
  "content-type": "application/json",
  "X-Test-Company": o.company ?? CO,
  "X-Test-Role": o.role ?? "admin",
  ...(o.user ? { "X-Test-User": o.user } : {}),
  ...(o.perms ? { "X-Test-Perms": JSON.stringify(o.perms) } : {}),
});
const get = (path: string, o?: Opts) => app.request(path, { headers: headers(o) });
const send = (method: string, path: string, body: unknown, o?: Opts) =>
  app.request(path, { method, headers: headers(o), body: JSON.stringify(body) });
const upload = (type: string, csv: string, o?: Opts) => {
  const fd = new FormData();
  fd.append("file", new File([csv], `${type}.csv`, { type: "text/csv" }));
  const h = headers(o) as Record<string, string>;
  delete h["content-type"];
  return app.request(`/api/import/${type}`, { method: "POST", headers: h, body: fd });
};
const json = async (res: Response) => (await res.json()) as any;

async function membershipOf(userId: string, company = CO) {
  const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.companyId, company)));
  return m;
}

const RESIDENTS = ["dr-zoe", "dr-ben", "dr-amy", "dr-carl"];
let maple = "";
let birch = "";

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTable(v);
  // A property manager (its industry works by property); the other company is unset.
  await db.insert(schema.companies).values([
    { id: CO, name: "Towers Realty", industry: "property-management-maintenance" } as any,
    { id: OTHER, name: "Other Co" } as any,
  ]);
  await db.insert(schema.companySettings).values({ id: CO, companyId: CO, name: "Towers Realty" } as any);
  await db.insert(schema.user).values([
    { id: BOSS, name: "Dana Boss", email: "boss@dr.test", role: "admin", companyId: CO } as any,
    { id: JORDAN, name: "Jordan Patel", email: "jordan@dr.test", role: "rider", companyId: CO } as any,
    { id: SAM, name: "Sam Ortiz", email: "sam@dr.test", role: "dispatcher", companyId: CO } as any,
    { id: "dr-zoe", name: "Zoe Adams", email: "zoe@dr.test", phone: "(204) 555-0101", role: "customer", companyId: CO } as any,
    { id: "dr-ben", name: "Ben Kowalczyk", email: "ben@dr.test", phone: "204-555-0102", role: "customer", companyId: CO } as any,
    { id: "dr-amy", name: "Amy Chen", email: "amy@dr.test", role: "customer", companyId: CO } as any,
    { id: "dr-carl", name: "Carl Diaz", email: "carl@dr.test", role: "customer", companyId: CO } as any,
    { id: "dr-x", name: "Xena Elsewhere", email: "xena@dr.test", role: "customer", companyId: OTHER } as any,
    { id: "dr-x-staff", name: "Other Staff", email: "ostaff@dr.test", role: "rider", companyId: OTHER } as any,
  ]);
  await db.insert(schema.memberships).values([
    { id: "dr-m-boss", userId: BOSS, companyId: CO, role: "admin", status: "active" } as any,
    { id: "dr-m-jordan", userId: JORDAN, companyId: CO, role: "rider", status: "active" } as any,
    { id: "dr-m-sam", userId: SAM, companyId: CO, role: "dispatcher", status: "active" } as any,
    ...RESIDENTS.map((u) => ({ id: `dr-m-${u}`, userId: u, companyId: CO, role: "customer", status: "active" }) as any),
    { id: "dr-m-x", userId: "dr-x", companyId: OTHER, role: "customer", status: "active" } as any,
    { id: "dr-m-x-staff", userId: "dr-x-staff", companyId: OTHER, role: "rider", status: "active" } as any,
  ]);
  // A job already recorded this building's address, before it had a name.
  await db.insert(schema.properties).values({ id: "dr-addr-maple", companyId: CO, addressNormalized: "12 maple st", addressDisplay: "12 Maple St" } as any);
  await db.insert(schema.services).values({ id: "dr-svc", companyId: CO, name: "Furnace repair", price: 100 } as any);
  await db.insert(schema.bookings).values([
    { id: "dr-j1", companyId: CO, customerId: "dr-zoe", serviceId: "dr-svc", title: "No heat", status: "confirmed", address: "12 Maple St", scheduledAt: new Date(), propertyId: "dr-addr-maple" } as any,
    { id: "dr-j2", companyId: CO, customerId: "dr-zoe", serviceId: "dr-svc", title: "Filter", status: "completed", address: "12 Maple St", scheduledAt: new Date("2026-09-01T15:00:00Z"), finishedAt: new Date("2026-09-01T17:00:00Z"), propertyId: "dr-addr-maple" } as any,
    { id: "dr-j3", companyId: CO, customerId: "dr-zoe", serviceId: "dr-svc", title: "Archived", status: "pending", address: "12 Maple St", scheduledAt: new Date(), deletedAt: new Date() } as any,
  ]);
});

describe("properties", () => {
  it("adding one at an address a job already used adopts that row, so its history stays", async () => {
    const res = await send("POST", "/api/directory/properties", { name: "Maple Court", address: "12 Maple St.", managerId: JORDAN });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body).toMatchObject({ ok: true, id: "dr-addr-maple", adopted: true });
    maple = body.id;
  });

  it("a new one, managed by office staff", async () => {
    const res = await send("POST", "/api/directory/properties", { name: "Birch Towers", address: "400 Birch Ave", managerId: SAM });
    expect(res.status).toBe(201);
    birch = (await json(res)).id;
    expect(birch).not.toBe(maple);
  });

  it("names are unique, whatever the case; one named property per address", async () => {
    expect((await send("POST", "/api/directory/properties", { name: "maple court" })).status).toBe(409);
    expect((await send("POST", "/api/directory/properties", { name: "Maple Annex", address: "12 maple st" })).status).toBe(409);
    expect((await send("PATCH", `/api/directory/properties/${birch}`, { name: "MAPLE COURT" })).status).toBe(409);
  });

  it("the manager has to be on this company's team: not a resident, not someone elsewhere", async () => {
    expect((await send("POST", "/api/directory/properties", { name: "Cedar", managerId: "dr-zoe" })).status).toBe(400);
    expect((await send("POST", "/api/directory/properties", { name: "Cedar", managerId: "dr-x-staff" })).status).toBe(400);
  });

  it("lists them with their manager, and lists the team as possible managers", async () => {
    const body = await json(await get("/api/directory/properties"));
    expect(body.properties.map((p: any) => [p.name, p.managerName]).sort()).toEqual([
      ["Birch Towers", "Sam Ortiz"],
      ["Maple Court", "Jordan Patel"],
    ]);
    expect(body.staff.map((s: any) => s.id).sort()).toEqual([BOSS, SAM, JORDAN].sort());
  });

  it("another company sees none of them, and can't change them", async () => {
    expect((await json(await get("/api/directory/properties", { company: OTHER }))).properties).toEqual([]);
    expect((await send("PATCH", `/api/directory/properties/${maple}`, { name: "Mine now" }, { company: OTHER })).status).toBe(404);
    expect((await send("DELETE", `/api/directory/properties/${maple}`, {}, { company: OTHER })).status).toBe(404);
  });
});

describe("assigning residents", () => {
  it("puts one resident at a property with their unit", async () => {
    const res = await send("POST", "/api/directory/assign", { userIds: ["dr-zoe"], propertyId: maple, unit: "10" });
    expect(res.status).toBe(200);
    expect(await membershipOf("dr-zoe")).toMatchObject({ propertyId: maple, unit: "10" });
  });

  it("moves several at once, each keeping their own unit", async () => {
    await send("POST", "/api/directory/assign", { userIds: ["dr-ben"], propertyId: birch, unit: "2" });
    const res = await send("POST", "/api/directory/assign", { userIds: ["dr-ben", "dr-amy"], propertyId: maple });
    expect((await json(res)).updated).toBe(2);
    expect(await membershipOf("dr-ben")).toMatchObject({ propertyId: maple, unit: "2" });
    expect(await membershipOf("dr-amy")).toMatchObject({ propertyId: maple, unit: "" });
  });

  it("refuses staff (they manage properties, they don't live in them), and does nothing", async () => {
    const res = await send("POST", "/api/directory/assign", { userIds: ["dr-carl", JORDAN], propertyId: birch });
    expect(res.status).toBe(400);
    expect((await membershipOf("dr-carl"))?.propertyId ?? null).toBeNull();
  });

  it("refuses people and properties from another company", async () => {
    expect((await send("POST", "/api/directory/assign", { userIds: ["dr-x"], propertyId: maple })).status).toBe(404);
    expect((await send("POST", "/api/directory/assign", { userIds: ["dr-carl"], propertyId: maple }, { company: OTHER })).status).toBe(404);
    expect((await membershipOf("dr-x", OTHER))?.propertyId ?? null).toBeNull();
  });

  it("taking someone off their property clears their unit too", async () => {
    await send("POST", "/api/directory/assign", { userIds: ["dr-carl"], propertyId: birch, unit: "7" });
    await send("POST", "/api/directory/assign", { userIds: ["dr-carl"], propertyId: null });
    expect(await membershipOf("dr-carl")).toMatchObject({ propertyId: null, unit: "" });
    await send("POST", "/api/directory/assign", { userIds: ["dr-carl"], propertyId: birch, unit: "1" });
  });
});

describe("GET /directory", () => {
  it("every resident with their property, unit, contact and the property's manager", async () => {
    const body = await json(await get("/api/directory?kind=customer&sort=property"));
    expect(body.rows.map((r: any) => [r.name, r.propertyName, r.unit, r.managerName])).toEqual([
      ["Carl Diaz", "Birch Towers", "1", "Sam Ortiz"],
      ["Amy Chen", "Maple Court", "", "Jordan Patel"],
      ["Ben Kowalczyk", "Maple Court", "2", "Jordan Patel"],
      ["Zoe Adams", "Maple Court", "10", "Jordan Patel"],
    ]);
    expect(body.rows[3]).toMatchObject({ email: "zoe@dr.test", phone: "(204) 555-0101" });
    expect(body.facets.kinds).toEqual({ all: 7, customer: 4, field: 1, office: 2 });
    expect(body.propertyCount).toBe(2);
  });

  it("open requests and last visit come from job history; archived jobs don't count", async () => {
    const body = await json(await get("/api/directory?kind=customer&q=zoe"));
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].openJobs).toBe(1);
    expect(body.rows[0].lastVisitAt).toBe("2026-09-01T17:00:00.000Z");
  });

  it("filters to one manager's residents, and groups by property", async () => {
    const byMgr = await json(await get(`/api/directory?managerId=${JORDAN}&sort=unit`));
    // By unit in number order; Amy has no unit yet, so she's last.
    expect(byMgr.rows.map((r: any) => r.id)).toEqual(["dr-ben", "dr-zoe", "dr-amy"]);
    const grouped = await json(await get("/api/directory?kind=customer&groupBy=property"));
    expect(grouped.groups.map((g: any) => [g.label, g.count])).toEqual([
      ["Birch Towers", 1],
      ["Maple Court", 3],
    ]);
    expect(grouped.groups[1].sublabel).toBe("12 Maple St. · Property Manager: Jordan Patel");
  });

  it("staff show how many properties they manage", async () => {
    const body = await json(await get("/api/directory?kind=field"));
    expect(body.rows.map((r: any) => [r.name, r.managedCount])).toEqual([["Jordan Patel", 1]]);
  });

  it("select-all gives every matching id", async () => {
    const body = await json(await get(`/api/directory?propertyId=${maple}&withIds=1&pageSize=1`));
    expect(body.rows).toHaveLength(1);
    expect(body.ids.sort()).toEqual(["dr-amy", "dr-ben", "dr-zoe"]);
  });

  it("ignores junk in the query string", async () => {
    const res = await get("/api/directory?sort=DROP&dir=sideways&groupBy=x&page=-4&pageSize=abc&kind=everyone");
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ sort: "name", dir: "asc", groupBy: "none", page: 1, pageSize: 25 });
  });

  it("another company's Directory has only its own people", async () => {
    const body = await json(await get("/api/directory", { company: OTHER }));
    expect(body.rows.map((r: any) => r.id).sort()).toEqual(["dr-x", "dr-x-staff"]);
    expect(body.propertyCount).toBe(0);
  });
});

describe("changing and removing a property", () => {
  it("a new manager shows on every resident", async () => {
    await send("PATCH", `/api/directory/properties/${maple}`, { managerId: SAM });
    const body = await json(await get(`/api/directory?propertyId=${maple}`));
    expect(new Set(body.rows.map((r: any) => r.managerName))).toEqual(new Set(["Sam Ortiz"]));
    await send("PATCH", `/api/directory/properties/${maple}`, { managerId: JORDAN });
  });

  it("removing one with no jobs deletes it; its residents stay, with no property", async () => {
    const res = await send("DELETE", `/api/directory/properties/${birch}`, {});
    expect(await json(res)).toMatchObject({ ok: true, unassigned: 1 });
    expect(await membershipOf("dr-carl")).toMatchObject({ propertyId: null, unit: "" });
    expect(await db.select().from(schema.properties).where(eq(schema.properties.id, birch))).toHaveLength(0);
  });

  it("removing one with job history keeps the address row (unnamed), so the history stays", async () => {
    const temp = await json(await send("POST", "/api/directory/properties", { name: "Temp", address: "77 Job Rd" }));
    await db.insert(schema.bookings).values({ id: "dr-j4", companyId: CO, customerId: "dr-carl", serviceId: "dr-svc", title: "Leak", status: "completed", address: "77 Job Rd", scheduledAt: new Date(), propertyId: temp.id } as any);
    await send("DELETE", `/api/directory/properties/${temp.id}`, {});
    const [row] = await db.select().from(schema.properties).where(eq(schema.properties.id, temp.id));
    expect(row).toMatchObject({ name: "", managerId: null, addressDisplay: "77 Job Rd" });
    expect((await json(await get("/api/directory/properties"))).properties.map((p: any) => p.name)).toEqual(["Maple Court"]);
  });
});

describe("a property's open requests follow the job", () => {
  it("a job linked to another named property counts there; a job at a unit's own address counts at the resident's property", async () => {
    const oak = (await json(await send("POST", "/api/directory/properties", { name: "Spruce House" }))).id;
    const before = Object.fromEntries((await json(await get("/api/directory/properties"))).properties.map((p: any) => [p.name, p.openJobs]));
    // Zoe lives at Maple Court; this open job is at Spruce House.
    await db.insert(schema.bookings).values({ id: "dr-j5", companyId: CO, customerId: "dr-zoe", serviceId: "dr-svc", title: "Visit", status: "pending", address: "9 Oak St", scheduledAt: new Date(), propertyId: oak } as any);
    // A unit-level address row (no name): counts at Zoe's own property.
    await db.insert(schema.properties).values({ id: "dr-unit-10", companyId: CO, addressNormalized: "12 maple st unit 10", addressDisplay: "12 Maple St Unit 10" } as any);
    await db.insert(schema.bookings).values({ id: "dr-j6", companyId: CO, customerId: "dr-zoe", serviceId: "dr-svc", title: "Visit", status: "pending", address: "12 Maple St Unit 10", scheduledAt: new Date(), propertyId: "dr-unit-10" } as any);
    const after = Object.fromEntries((await json(await get("/api/directory/properties"))).properties.map((p: any) => [p.name, p.openJobs]));
    expect(after["Spruce House"]).toBe(before["Spruce House"] + 1);
    expect(after["Maple Court"]).toBe(before["Maple Court"] + 1);
    // The resident's own count has both.
    const zoe = (await json(await get("/api/directory?q=zoe"))).rows[0];
    expect(zoe.openJobs).toBe(3);
  });
});

describe("who can do what", () => {
  it("field staff and customers can't open the Directory", async () => {
    expect((await get("/api/directory", { role: "rider", user: JORDAN })).status).toBe(403);
    expect((await get("/api/directory", { role: "customer", user: "dr-zoe" })).status).toBe(403);
  });

  it("a dispatcher can view and assign, but not remove a property (no clients:delete)", async () => {
    expect((await get("/api/directory", { role: "dispatcher", user: SAM })).status).toBe(200);
    expect((await send("POST", "/api/directory/assign", { userIds: ["dr-carl"], propertyId: maple }, { role: "dispatcher", user: SAM })).status).toBe(200);
    expect((await send("DELETE", `/api/directory/properties/${maple}`, {}, { role: "dispatcher", user: SAM })).status).toBe(403);
  });
});

describe("import", () => {
  it("a property list with managers by email or name; an unknown manager is a warning, not a failure", async () => {
    const csv = [
      "Property Name,Address,Property Manager,Notes",
      "Cedar Lofts,5 Cedar Way,jordan@dr.test,Side door",
      "Oak Place,9 Oak St,Sam Ortiz,",
      "Pine Row,3 Pine Rd,Nobody Here,",
      "Maple Court,,sam@dr.test,Lockbox 4471",
    ].join("\n");
    const res = await upload("property", csv);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ total: 4, created: 3, updated: 1, failedCount: 0, welcoming: 0 });
    expect(body.warnings).toEqual([{ row: 4, email: "Pine Row", message: 'No team member matches "Nobody Here", so it has no property manager yet' }]);
    const props = (await json(await get("/api/directory/properties"))).properties;
    const by = Object.fromEntries(props.map((p: any) => [p.name, p]));
    expect(by["Cedar Lofts"]).toMatchObject({ managerId: JORDAN, address: "5 Cedar Way", notes: "Side door" });
    expect(by["Oak Place"].managerId).toBe(SAM);
    expect(by["Pine Row"].managerId).toBeNull();
    // An existing property keeps its address when the cell is blank, and takes the new manager and notes.
    expect(by["Maple Court"]).toMatchObject({ managerId: SAM, address: "12 Maple St.", notes: "Lockbox 4471" });
  });

  it("re-importing the resident list sets each existing resident's property and unit", async () => {
    const csv = ["Name,Email,Building,Apt", "Carl Diaz,carl@dr.test,Oak Place,3C", "Amy Chen,amy@dr.test,Willow Gardens,12"].join("\n");
    const body = await json(await upload("customer", csv));
    expect(body).toMatchObject({ total: 2, created: 0, updated: 2, failedCount: 0 });
    expect(await membershipOf("dr-carl")).toMatchObject({ unit: "3C" });
    const props = (await json(await get("/api/directory/properties"))).properties;
    const willow = props.find((p: any) => p.name === "Willow Gardens");
    expect(willow).toBeTruthy();
    expect(await membershipOf("dr-amy")).toMatchObject({ propertyId: willow.id, unit: "12" });
  });

  it("a row with no Unit cell keeps the unit they have", async () => {
    await upload("customer", ["Name,Email,Property", "Carl Diaz,carl@dr.test,Oak Place"].join("\n"));
    expect(await membershipOf("dr-carl")).toMatchObject({ unit: "3C" });
  });

  it("existing members without a property column are still 'already in your account'", async () => {
    const body = await json(await upload("customer", ["Name,Email", "Carl Diaz,carl@dr.test"].join("\n")));
    expect(body).toMatchObject({ updated: 0, failedCount: 1 });
    expect(body.failed[0].reason).toBe("Already in your account");
  });

  it("a new resident is created at their property", async () => {
    const body = await json(await upload("customer", ["First Name,Last Name,Email,Property,Unit", "Nia,Okafor,nia@dr.test,Cedar Lofts,8"].join("\n")));
    expect(body).toMatchObject({ created: 1, failedCount: 0 });
    const list = await json(await get("/api/directory?kind=customer&q=nia"));
    expect(list.rows[0]).toMatchObject({ name: "Nia Okafor", propertyName: "Cedar Lofts", unit: "8", managerName: "Jordan Patel" });
  });

  it("someone who can add clients but not edit them can't change existing ones through an import (Codex on #113)", async () => {
    const createOnly = { role: "dispatcher", user: SAM, perms: ["clients:view", "clients:create"] };
    const before = await membershipOf("dr-carl");
    const people = await json(await upload("customer", ["Name,Email,Property,Unit", "Carl Diaz,carl@dr.test,Maple Court,99"].join("\n"), createOnly));
    expect(people).toMatchObject({ updated: 0, failedCount: 1 });
    expect(people.failed[0].reason).toContain("needs permission to edit clients");
    expect(await membershipOf("dr-carl")).toMatchObject({ propertyId: before!.propertyId, unit: before!.unit });
    const props = await json(await upload("property", ["Property Name,Notes", "Maple Court,Changed", "Larch House,New one"].join("\n"), createOnly));
    expect(props).toMatchObject({ created: 1, updated: 0, failedCount: 1 });
    expect(props.failed[0].reason).toContain("already a property called");
  });

  it("the property template downloads", async () => {
    const res = await app.request("/api/import/template/property?format=csv", { headers: headers() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("properties");
    expect((await res.text()).split("\n")[0]).toBe("Property Name,Address,Property Manager (email or name),Notes");
  });
});

describe("one person's record for the drawer", () => {
  it("comes back in full for this company", async () => {
    const body = await json(await get("/api/admin/users/dr-zoe"));
    expect(body.user).toMatchObject({ id: "dr-zoe", name: "Zoe Adams", role: "customer", email: "zoe@dr.test" });
  });

  it("is not found for someone at another company", async () => {
    expect((await get("/api/admin/users/dr-x")).status).toBe(404);
  });
});
