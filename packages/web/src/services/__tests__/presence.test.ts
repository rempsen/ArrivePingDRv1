/**
 * What makes a technician Busy. A real job that's in the field, or assigned and
 * starting within the lead window, does; a sample job (the practice job a new
 * technician is handed) that hasn't been started does not, or it would hold
 * them Busy after finishing real work until someone completed or removed it.
 *
 * Harness: in-memory PGlite, ids prefixed "pres-".
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../api/database/index");
const schema = await import("../../api/database/schema");
const { ensureTables } = await import("../../test-support/tables");
const { reconcileRiderStatus } = await import("../presence");

const CO = "pres-co";
const RIDER = "pres-rider";
const MIN = 60_000;

const job = (id: string, over: Record<string, unknown>) =>
  ({ id, companyId: CO, customerId: "pres-cust", serviceId: "pres-svc", riderId: RIDER, status: "assigned", assignStatus: "accepted", scheduledAt: new Date(Date.now() + 30 * MIN), address: "1 St", ...over }) as never;

const statusOf = async () => (await db.select().from(schema.riders).where(eq(schema.riders.id, RIDER)))[0]!.status;

beforeEach(async () => {
  await ensureTables(schema.riders, schema.bookings);
  await db.delete(schema.bookings);
  await db.delete(schema.riders);
  await db.insert(schema.riders).values({ id: RIDER, companyId: CO, userId: "pres-user", status: "available", locationUpdatedAt: new Date() } as never);
});

describe("reconcileRiderStatus: what makes a technician busy", () => {
  it("is available with nothing on", async () => {
    expect(await reconcileRiderStatus(CO, RIDER)).toBe("available");
  });

  it("is busy for a real job starting soon", async () => {
    await db.insert(schema.bookings).values(job("pres-real", {}));
    expect(await reconcileRiderStatus(CO, RIDER)).toBe("busy");
  });

  it("is not busy for a practice job that's only assigned, even one whose time has passed", async () => {
    await db.insert(schema.bookings).values([
      job("pres-practice-soon", { isSample: true }),
      job("pres-practice-past", { isSample: true, scheduledAt: new Date(Date.now() - 3 * 60 * MIN) }),
    ]);
    expect(await reconcileRiderStatus(CO, RIDER)).toBe("available");
  });

  it("is still not busy once the real job is done and only the practice job is left", async () => {
    await db.insert(schema.bookings).values([
      job("pres-done", { status: "completed" }),
      job("pres-practice", { isSample: true }),
    ]);
    expect(await reconcileRiderStatus(CO, RIDER)).toBe("available");
  });

  it("is busy while actually working a practice job, and free again when it's done", async () => {
    await db.insert(schema.bookings).values(job("pres-practice", { isSample: true, status: "arrived" }));
    expect(await reconcileRiderStatus(CO, RIDER)).toBe("busy");
    await db.update(schema.bookings).set({ status: "completed" }).where(eq(schema.bookings.id, "pres-practice"));
    expect(await reconcileRiderStatus(CO, RIDER)).toBe("available");
    expect(await statusOf()).toBe("available");
  });
});
