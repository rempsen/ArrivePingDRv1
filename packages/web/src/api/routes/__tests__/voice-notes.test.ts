/**
 * A technician can list and delete their own voice notes on a job, and only
 * their own: GET /api/bookings/:id/voice-notes, DELETE .../voice-notes/:eventId.
 * Deleting takes the recording, the timeline entry and the transcript line it
 * put in the job's field notes.
 *
 * Harness: in-memory PGlite; a stub middleware stands in for auth (user and
 * company from test headers). Ids prefixed "vn-".
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

const CO = "vn-company";
const JOB = "vn-job";

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", c.req.header("X-Test-Company") || CO);
  const uid = c.req.header("X-Test-User");
  c.set("user", uid ? { id: uid, role: "technician", email: `${uid}@t.test`, name: uid } : null);
  return next();
});
app.route("/bookings", bookingsRoutes);
app.onError((err, c) => {
  if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
  return c.json({ message: String((err as Error).message) }, 500);
});

const as = (user: string, company = CO) => ({ "X-Test-User": user, "X-Test-Company": company });

async function record(user: string, text: string) {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([1, 2, 3, 4])], "note.m4a", { type: "audio/m4a" }));
  fd.append("durationSecs", "7");
  fd.append("transcript", text);
  const res = await app.request(`/bookings/${JOB}/voice-note`, { method: "POST", headers: as(user), body: fd });
  expect(res.status).toBe(201);
  return (await res.json()) as { url: string };
}

const list = async (user: string, company = CO) =>
  (await (await app.request(`/bookings/${JOB}/voice-notes`, { headers: as(user, company) })).json()) as {
    notes: { id: string; url: string; durationSecs: number; transcript: string }[];
  };

beforeAll(async () => {
  await ensureTables(schema.bookings, schema.jobEvents, schema.companySettings);
  await db.insert(schema.bookings).values({
    id: JOB,
    companyId: CO,
    customerId: "vn-cust",
    serviceId: "vn-svc",
    status: "in_progress",
    scheduledAt: new Date(),
    address: "1 Test St",
    driverNotes: "Gate code is 1234.",
  } as never);
});

describe("voice notes: listen back and delete your own", () => {
  it("lists only the caller's notes", async () => {
    await record("vn-jo", "Replaced the valve.");
    await record("vn-al", "Customer not home.");
    const jo = await list("vn-jo");
    expect(jo.notes.map((n) => n.transcript)).toEqual(["Replaced the valve."]);
    expect(jo.notes[0]).toMatchObject({ durationSecs: 7 });
    expect(jo.notes[0]!.url).toContain("voice-notes");
    expect((await list("vn-al")).notes.map((n) => n.transcript)).toEqual(["Customer not home."]);
  });

  it("refuses to delete someone else's note, and keeps everything of it", async () => {
    const [al] = (await list("vn-al")).notes;
    const res = await app.request(`/bookings/${JOB}/voice-notes/${al!.id}`, { method: "DELETE", headers: as("vn-jo") });
    expect(res.status).toBe(403);
    expect((await list("vn-al")).notes).toHaveLength(1);
    const [b] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, JOB));
    expect(b!.driverNotes).toContain("Customer not home.");
  });

  it("deletes the recording, the timeline entry and the transcript line", async () => {
    const [jo] = (await list("vn-jo")).notes;
    const key = decodeURIComponent(jo!.url.split("/api/public/file/")[1] ?? jo!.url.replace(/^\/uploads\//, ""));
    const res = await app.request(`/bookings/${JOB}/voice-notes/${jo!.id}`, { method: "DELETE", headers: as("vn-jo") });
    expect(res.status).toBe(200);
    expect((await list("vn-jo")).notes).toEqual([]);
    const [b] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, JOB));
    expect(b!.driverNotes).not.toContain("Replaced the valve.");
    // Another tech's line and the typed note survive.
    expect(b!.driverNotes).toContain("Gate code is 1234.");
    expect(b!.driverNotes).toContain("Customer not home.");
    expect(await getObjectBody(key)).toBeNull();
  });

  it("treats a note recorded before authors were kept as nobody's", async () => {
    await db.insert(schema.jobEvents).values({
      id: "vn-legacy",
      companyId: CO,
      bookingId: JOB,
      kind: "voice_note",
      actorName: "vn-jo",
      detail: "Old note.",
      meta: JSON.stringify({ url: "/api/public/file/voice-notes%2Fvn-job%2Fold.m4a", durationSecs: 3 }),
    } as never);
    // Not listed, and not deletable even by the name it was stamped with.
    expect((await list("vn-jo")).notes.map((n) => n.id)).not.toContain("vn-legacy");
    const res = await app.request(`/bookings/${JOB}/voice-notes/vn-legacy`, { method: "DELETE", headers: as("vn-jo") });
    expect(res.status).toBe(403);
    expect(await db.select().from(schema.jobEvents).where(eq(schema.jobEvents.id, "vn-legacy"))).toHaveLength(1);
  });

  it("404s for a note that isn't there, or a job in another company", async () => {
    expect((await app.request(`/bookings/${JOB}/voice-notes/nope`, { method: "DELETE", headers: as("vn-jo") })).status).toBe(404);
    const [al] = (await list("vn-al")).notes;
    expect((await app.request(`/bookings/${JOB}/voice-notes/${al!.id}`, { method: "DELETE", headers: as("vn-al", "other-company") })).status).toBe(404);
    expect((await list("vn-al")).notes).toHaveLength(1);
  });
});
