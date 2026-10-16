/**
 * Reversible user deactivation and seat downsizing (services/user-access.ts).
 * Real pglite database, Stripe disabled so setSeats only writes billingSeats.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const realStripe = { ...(await import("../stripe")) };
beforeAll(() => {
  mock.module("../stripe", () => ({ ...realStripe, stripeEnabled: false }));
});
afterAll(() => {
  mock.module("../stripe", () => realStripe);
});

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { getTableConfig } = await import("drizzle-orm/pg-core");
const { eq, and } = await import("drizzle-orm");
const { openJobsFor, seatCandidates, deactivateUser, reactivateUser, downsize, AccessError, deps } = await import("../user-access");
const { driverSeatCount } = await import("../billing-subscription");

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

const CO = "ua-co";
const ADMIN = { id: "ua-admin", role: "admin", name: "Ada Admin" };
const DAY = 86_400_000;

async function reseed() {
  const sql = (db as any).$client;
  for (const t of ["bookings", "memberships", "riders", "audit_log"]) await sql.execute(`DELETE FROM ${t} WHERE company_id = '${CO}'`);
  await sql.execute(`DELETE FROM "user" WHERE id LIKE 'ua-%'`);
  await sql.execute(`DELETE FROM companies WHERE id = '${CO}'`);
  await sql.execute({ sql: "INSERT INTO companies (id, name, billing_customer_id, billing_subscription_id, billing_status, billing_seats) VALUES (?,?,?,?,?,?)", args: [CO, "UA Co", "cus_ua", "sub_ua", "active", 10] });
  const users: [string, string, string][] = [
    ["ua-admin", "Ada Admin", "admin"],
    ["ua-admin2", "Bob Admin", "admin"],
    ["ua-r1", "Rae One", "rider"],
    ["ua-r2", "Ray Two", "rider"],
    ["ua-r3", "Roy Three", "rider"],
    ["ua-disp", "Dee Dispatch", "dispatcher"],
  ];
  for (const [id, name, role] of users) {
    await sql.execute({ sql: 'INSERT INTO "user" (id, name, email, role, company_id, email_verified) VALUES (?,?,?,?,?,TRUE)', args: [id, name, `${id}@t.test`, role, CO] });
    await sql.execute({ sql: "INSERT INTO memberships (id, user_id, company_id, role, status, staff_type) VALUES (?,?,?,?,?,?)", args: [`m-${id}`, id, CO, role, "active", role === "rider" ? "technician" : null] });
  }
  const now = Date.now();
  const riders: [string, string, number | null][] = [
    ["rd-r1", "ua-r1", now - 3 * DAY],
    ["rd-r2", "ua-r2", null],
    ["rd-r3", "ua-r3", now - 1 * DAY],
    ["rd-disp", "ua-disp", now],
  ];
  for (const [id, uid, seen] of riders) {
    await sql.execute({ sql: "INSERT INTO riders (id, user_id, company_id, approval, location_updated_at) VALUES (?,?,?,?,?)", args: [id, uid, CO, "active", seen === null ? null : new Date(seen).toISOString()] });
  }
  const jobs: [string, string | null, string][] = [
    ["bk-1", "rd-r1", "assigned"],
    ["bk-2", "rd-r1", "enroute"],
    ["bk-3", "rd-r1", "completed"],
    ["bk-4", "rd-disp", "confirmed"],
  ];
  for (const [id, rid, status] of jobs) {
    await sql.execute({ sql: "INSERT INTO bookings (id, company_id, customer_id, service_id, title, status, address, scheduled_at, rider_id, assign_status, enroute_at, clock_state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", args: [id, CO, "cust", "svc", id, status, "", new Date().toISOString(), rid, status === "completed" ? "" : "accepted", status === "enroute" ? new Date().toISOString() : null, status === "enroute" ? "running" : "idle"] });
  }
}

beforeAll(async () => {
  const sql = (db as any).$client;
  for (const t of [schema.companies, schema.user, schema.memberships, schema.riders, schema.bookings, schema.auditLog]) await sql.execute(ddlFor(t));
});
const notified: string[] = [];
deps.fireEvent = async (_event, bookingId) => {
  notified.push(bookingId);
};
beforeEach(async () => {
  notified.length = 0;
  await reseed();
});

async function membership(userId: string) {
  const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.companyId, CO)));
  return m!;
}
async function rider(id: string) {
  const [r] = await db.select().from(schema.riders).where(eq(schema.riders.id, id));
  return r!;
}
async function booking(id: string) {
  const [b] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
  return b!;
}
async function seats() {
  const [c] = await db.select().from(schema.companies).where(eq(schema.companies.id, CO));
  return c!.billingSeats;
}
async function expectAccessError(p: Promise<unknown>, status: number, code: string) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AccessError);
    expect((e as InstanceType<typeof AccessError>).status).toBe(status);
    expect((e as InstanceType<typeof AccessError>).code).toBe(code);
    return e as InstanceType<typeof AccessError>;
  }
  throw new Error(`expected AccessError ${status} ${code}`);
}

describe("openJobsFor", () => {
  it("returns only OPEN_STATUSES jobs", async () => {
    expect((await openJobsFor(CO, "ua-r1")).map((j) => j.id).sort()).toEqual(["bk-1", "bk-2"]);
    expect(await openJobsFor(CO, "ua-r2")).toEqual([]);
  });
});

describe("seatCandidates", () => {
  it("lists field staff only, least recently active first", async () => {
    const list = await seatCandidates(CO);
    expect(list.map((c) => c.userId)).toEqual(["ua-r2", "ua-r1", "ua-r3"]);
    expect(list.find((c) => c.userId === "ua-r1")!.openJobs).toBe(2);
    expect(list[0]!.lastActiveAt).toBeNull();
  });
});

describe("driverSeatCount", () => {
  it("excludes office staff", async () => {
    expect(await driverSeatCount(CO)).toBe(3);
  });
});

describe("deactivateUser", () => {
  it("blocks when open jobs and no reassignTo", async () => {
    await expectAccessError(deactivateUser(CO, ADMIN, "ua-r1", {}), 409, "has_open_jobs");
    expect((await membership("ua-r1")).status).toBe("active");
  });

  it("with reassignTo moves open jobs and flips state", async () => {
    const r = await deactivateUser(CO, ADMIN, "ua-r1", { reassignTo: "ua-r3" });
    expect(r.deactivatedAt).toBeInstanceOf(Date);
    expect((await booking("bk-1")).riderId).toBe("rd-r3");
    expect((await booking("bk-2")).riderId).toBe("rd-r3");
    expect((await booking("bk-3")).riderId).toBe("rd-r1");
    const m = await membership("ua-r1");
    expect(m.status).toBe("disabled");
    expect(m.deactivatedAt).toBeInstanceOf(Date);
    expect((await rider("rd-r1")).approval).toBe("suspended");
    const [log] = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.companyId, CO), eq(schema.auditLog.action, "team.deactivate")));
    expect(log?.entityId).toBe("ua-r1");
  });

  it("with reassignTo null returns jobs to the board as confirmed with assignment cleared", async () => {
    await deactivateUser(CO, ADMIN, "ua-r1", { reassignTo: null });
    const b = await booking("bk-2");
    expect(b.riderId).toBeNull();
    expect(b.status).toBe("confirmed");
    expect(b.assignStatus).toBe("released");
    expect(b.enrouteAt).toBeNull();
    expect(b.clockState).toBe("idle");
    expect(notified).toEqual([]);
  });

  it("with reassignTo offers the jobs to the new tech and resets the clock", async () => {
    await deactivateUser(CO, ADMIN, "ua-r1", { reassignTo: "ua-r3" });
    const b = await booking("bk-2");
    expect(b.riderId).toBe("rd-r3");
    expect(b.status).toBe("assigned");
    expect(b.assignStatus).toBe("offered");
    expect(b.acceptedAt).toBeNull();
    expect(b.enrouteAt).toBeNull();
    expect(b.clockState).toBe("idle");
    expect(notified.sort()).toEqual(["bk-1", "bk-2"]);
  });

  it("refuses self", async () => {
    await expectAccessError(deactivateUser(CO, ADMIN, "ua-admin", {}), 400, "self");
  });

  it("refuses last admin", async () => {
    const SUPER = { id: "ua-super", role: "superadmin" };
    await deactivateUser(CO, SUPER, "ua-admin2", {});
    await expectAccessError(deactivateUser(CO, SUPER, "ua-admin", {}), 400, "last_admin");
  });

  it("admin-tier target needs a superadmin actor", async () => {
    await expectAccessError(deactivateUser(CO, ADMIN, "ua-admin2", {}), 403, "superadmin_required");
  });

  it("office staff with open jobs is blocked", async () => {
    await expectAccessError(deactivateUser(CO, ADMIN, "ua-disp", {}), 409, "has_open_jobs");
  });
});

describe("reactivateUser", () => {
  it("restores state", async () => {
    await deactivateUser(CO, ADMIN, "ua-r2", {});
    const r = await reactivateUser(CO, ADMIN, "ua-r2", {});
    expect(r.seats).toBe(10);
    const m = await membership("ua-r2");
    expect(m.status).toBe("active");
    expect(m.deactivatedAt).toBeNull();
    expect((await rider("rd-r2")).approval).toBe("active");
  });

  it("needs a seat when at capacity", async () => {
    await deactivateUser(CO, ADMIN, "ua-r2", {});
    await (db as any).$client.execute(`UPDATE companies SET billing_seats = 2 WHERE id = '${CO}'`);
    const err = await expectAccessError(reactivateUser(CO, ADMIN, "ua-r2", {}), 409, "seat_required");
    expect(err.meta).toEqual({ seatsNeeded: 1, monthlyDelta: 30 });
    const r = await reactivateUser(CO, ADMIN, "ua-r2", { addSeat: true });
    expect(r.seats).toBe(3);
    expect(await seats()).toBe(3);
  });

  it("404 for unknown membership", async () => {
    await expectAccessError(reactivateUser(CO, ADMIN, "ua-nobody", {}), 404, "not_found");
  });

  it("404 when the user exists but their membership here was deleted", async () => {
    await (db as any).$client.execute(`DELETE FROM memberships WHERE user_id = 'ua-r2' AND company_id = '${CO}'`);
    await expectAccessError(reactivateUser(CO, ADMIN, "ua-r2", {}), 404, "not_found");
  });
});

describe("downsize", () => {
  it("is atomic", async () => {
    const r = await downsize(CO, ADMIN, { seats: 1, deactivate: ["ua-r1", "ua-r2"], reassign: { "ua-r1": "ua-r3" } });
    expect(r).toEqual({ seats: 1, deactivated: ["ua-r1", "ua-r2"] });
    expect((await membership("ua-r1")).status).toBe("disabled");
    expect((await membership("ua-r2")).status).toBe("disabled");
    expect((await booking("bk-1")).riderId).toBe("rd-r3");
    expect(await seats()).toBe(1);
  });

  it("rejects reassignment to a user in the deactivate list", async () => {
    await expectAccessError(downsize(CO, ADMIN, { seats: 1, deactivate: ["ua-r1", "ua-r3"], reassign: { "ua-r1": "ua-r3" } }), 400, "reassign_target_deactivated");
    expect((await membership("ua-r1")).status).toBe("active");
    expect((await booking("bk-1")).riderId).toBe("rd-r1");
    expect(await seats()).toBe(10);
  });

  it("rejects ids that are not seat candidates", async () => {
    await expectAccessError(downsize(CO, ADMIN, { seats: 2, deactivate: ["ua-disp"], reassign: {} }), 400, "not_a_seat");
    expect((await membership("ua-disp")).status).toBe("active");
  });

  it("leaves everything unchanged when the seat update fails", async () => {
    const real = deps.setSeats;
    deps.setSeats = async () => {
      throw new Error("stripe down");
    };
    try {
      await expect(downsize(CO, ADMIN, { seats: 1, deactivate: ["ua-r1", "ua-r2"], reassign: { "ua-r1": "ua-r3" } })).rejects.toThrow("stripe down");
    } finally {
      deps.setSeats = real;
    }
    expect((await membership("ua-r1")).status).toBe("active");
    expect((await membership("ua-r2")).status).toBe("active");
    expect((await booking("bk-1")).riderId).toBe("rd-r1");
    expect((await rider("rd-r1")).approval).toBe("active");
    expect(await seats()).toBe(10);
  });

  it("rejects stale seats", async () => {
    await expectAccessError(downsize(CO, ADMIN, { seats: 5, deactivate: ["ua-r2", "ua-r3"], reassign: {} }), 409, "stale");
    expect(await seats()).toBe(10);
  });
});
