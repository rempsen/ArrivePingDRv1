/**
 * A job has one customer sign-off: once it's captured, capturing another is
 * refused (409) until the signature is deleted, which only the job's
 * technician or the office may do. Deleting clears the booking, the stored
 * image and the customer-facing timeline entry, and leaves an office-only note.
 *
 * Harness: in-memory PGlite; a stub middleware stands in for auth (user, role
 * and company from test headers). Ids prefixed "sig-".
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { ensureTables } = await import("../../../test-support/tables");
const { bookingsRoutes } = await import("../bookings");
const { getObjectBody } = await import("../../lib/storage");
const { AppError } = await import("../../lib/errors");

const CO = "sig-company";
const JOB = "sig-job";

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", CO);
  const uid = c.req.header("X-Test-User");
  const role = c.req.header("X-Test-Role") || "technician";
  c.set("user", uid ? { id: uid, role, email: `${uid}@t.test`, name: uid } : null);
  return next();
});
app.route("/bookings", bookingsRoutes);
app.onError((err, c) => {
  if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
  return c.json({ message: String((err as Error).message) }, 500);
});

const as = (user: string, role = "technician") => ({ "X-Test-User": user, "X-Test-Role": role, "Content-Type": "application/json" });
const sign = (name: string) =>
  app.request(`/bookings/${JOB}/signature`, {
    method: "POST",
    headers: as("sig-tech"),
    body: JSON.stringify({ strokes: [[[1, 1], [20, 20]]], width: 300, height: 100, name }),
  });
const events = async (kind: string) =>
  (await db.select().from(schema.jobEvents).where(eq(schema.jobEvents.bookingId, JOB))).filter((e) => e.kind === kind);
const booking = async () => (await db.select().from(schema.bookings).where(eq(schema.bookings.id, JOB)))[0]!;

beforeAll(async () => {
  await ensureTables(schema.bookings, schema.riders, schema.jobEvents, schema.companySettings);
  await db.insert(schema.riders).values({ id: "sig-rider", companyId: CO, userId: "sig-tech", name: "Tech" } as never);
  await db.insert(schema.bookings).values({
    id: JOB,
    companyId: CO,
    customerId: "sig-cust",
    serviceId: "sig-svc",
    riderId: "sig-rider",
    status: "in_progress",
    scheduledAt: new Date(),
    address: "1 Test St",
  } as never);
});

describe("one sign-off per job", () => {
  it("captures the first signature", async () => {
    const res = await sign("Pat Customer");
    expect(res.status).toBe(201);
    expect((await booking()).signedAt).not.toBeNull();
    expect(await events("signature_captured")).toHaveLength(1);
  });

  it("refuses a second one while the first stands", async () => {
    const before = (await booking()).signatureUrl;
    const res = await sign("Someone Else");
    expect(res.status).toBe(409);
    const b = await booking();
    expect(b.signatureUrl).toBe(before);
    expect(b.signatureName).toBe("Pat Customer");
  });

  it("only the job's technician or the office can delete it", async () => {
    const stranger = await app.request(`/bookings/${JOB}/signature`, { method: "DELETE", headers: as("sig-other") });
    expect(stranger.status).toBe(403);
    const customer = await app.request(`/bookings/${JOB}/signature`, { method: "DELETE", headers: as("sig-cust", "customer") });
    expect(customer.status).toBe(403);
    expect((await booking()).signedAt).not.toBeNull();
  });

  it("deleting clears the signature, its image and its customer-facing entry", async () => {
    const url = (await booking()).signatureUrl;
    const key = decodeURIComponent(url.split("/api/public/file/")[1] ?? url.replace(/^\/uploads\//, "").replace(/^(signatures)_(.*?)_/, "$1/$2/"));
    const res = await app.request(`/bookings/${JOB}/signature`, { method: "DELETE", headers: as("sig-tech") });
    expect(res.status).toBe(200);
    const b = await booking();
    expect(b).toMatchObject({ signatureUrl: "", signatureName: "", signedAt: null });
    expect(await events("signature_captured")).toHaveLength(0);
    const [removed] = await events("signature_removed");
    expect(removed).toMatchObject({ customerVisible: false, actorName: "sig-tech" });
    expect(removed!.label).toContain("Pat Customer");
    expect(await getObjectBody(key)).toBeNull();
    // Nothing left to delete.
    expect((await app.request(`/bookings/${JOB}/signature`, { method: "DELETE", headers: as("sig-tech") })).status).toBe(404);
  });

  it("a new signature can be captured after deleting, and the office can delete too", async () => {
    expect((await sign("Second Signer")).status).toBe(201);
    expect((await booking()).signatureName).toBe("Second Signer");
    const res = await app.request(`/bookings/${JOB}/signature`, { method: "DELETE", headers: as("sig-office", "admin") });
    expect(res.status).toBe(200);
    expect((await booking()).signedAt).toBeNull();
    const removed = await events("signature_removed");
    expect(removed.map((e) => e.actorRole)).toEqual(expect.arrayContaining(["tech", "dispatch"]));
  });
});
