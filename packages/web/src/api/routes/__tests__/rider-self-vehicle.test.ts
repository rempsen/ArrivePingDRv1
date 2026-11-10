/**
 * A technician edits their own vehicle from the app (PATCH /riders/me):
 * make & model, colour and plate. Colour and plate can be cleared; the make
 * and model can't be blanked, and a plate is stored upper-cased.
 *
 * Harness: in-memory PGlite, ids prefixed "selfveh-".
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { ensureTables } = await import("../../../test-support/tables");
const { ridersRoutes } = await import("../riders");
const { AppError } = await import("../../lib/errors");

const CO = "selfveh-co";
const USER = "selfveh-user";
const RIDER = "selfveh-rider";

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", CO);
  c.set("user", { id: USER, role: "rider", email: "tech@example.test", name: "Tech" } as any);
  return next();
});
app.route("/riders", ridersRoutes);
// The real handler lives in api/index.ts; validation failures must come back as their 4xx.
app.onError((err, c) =>
  err instanceof AppError ? c.json({ message: err.message }, err.status as 400) : c.json({ message: "Internal error" }, 500),
);

const patchMe = (json: Record<string, unknown>) =>
  app.request("/riders/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) });

const row = async () => (await db.select().from(schema.riders).where(eq(schema.riders.id, RIDER)))[0]!;

beforeEach(async () => {
  await ensureTables(schema.riders, schema.bookings);
  await db.delete(schema.riders).where(eq(schema.riders.companyId, CO));
  await db.insert(schema.riders).values({
    id: RIDER,
    companyId: CO,
    userId: USER,
    status: "available",
    vehicle: "Ford Transit",
    vehicleColor: "White",
    licensePlate: "ABC 123",
  } as never);
});

describe("PATCH /riders/me — own vehicle", () => {
  it("updates make & model, colour and plate together", async () => {
    const res = await patchMe({ vehicle: "Ram ProMaster", vehicleColor: "Grey", licensePlate: "xyz 789" });
    expect(res.status).toBe(200);
    const after = await row();
    expect([after.vehicle, after.vehicleColor]).toEqual(["Ram ProMaster", "Grey"]);
    expect(after.licensePlate).toBe("XYZ 789");
  });

  it("trims whitespace", async () => {
    await patchMe({ vehicle: "  Ram ProMaster  ", vehicleColor: " Grey " });
    const after = await row();
    expect([after.vehicle, after.vehicleColor]).toEqual(["Ram ProMaster", "Grey"]);
  });

  it("clears the colour and plate when they're sent blank", async () => {
    await patchMe({ vehicleColor: "", licensePlate: "" });
    const after = await row();
    expect([after.vehicleColor, after.licensePlate]).toEqual(["", ""]);
    expect(after.vehicle).toBe("Ford Transit");
  });

  it("never blanks the make and model", async () => {
    await patchMe({ vehicle: "", vehicleColor: "Red" });
    const after = await row();
    expect(after.vehicle).toBe("Ford Transit");
    expect(after.vehicleColor).toBe("Red");
  });

  it("leaves the vehicle alone on an unrelated call", async () => {
    await patchMe({ heartbeat: true });
    const after = await row();
    expect([after.vehicle, after.vehicleColor, after.licensePlate]).toEqual(["Ford Transit", "White", "ABC 123"]);
  });

  it("rejects an over-long plate", async () => {
    const res = await patchMe({ licensePlate: "X".repeat(33) });
    expect(res.status).toBe(400);
    expect((await row()).licensePlate).toBe("ABC 123");
  });
});
