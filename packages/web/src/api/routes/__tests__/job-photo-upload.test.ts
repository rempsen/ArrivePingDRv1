/**
 * Job photo upload can't lose a photo (Dan, Oct 28 2026: a photo taken on a
 * BMD test job hit a server error while being saved and never appeared).
 *
 *   - the app names each photo once (clientId) and sends it until it gets an
 *     answer: a photo that already landed comes back as-is, never twice;
 *   - a storage failure answers 503 storage_unavailable, stores nothing, and
 *     the next send of the same photo goes through;
 *   - a photo sent again later for a form question is added to that
 *     question's answer by the server (the tech may be off the job screen);
 *   - storage writes retry before giving up.
 *
 * Ids prefixed "pu-".
 */
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { PgTable } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.RESEND_API_KEY = "";
process.env.TWILIO_ACCOUNT_SID = "";
process.env.TWILIO_AUTH_TOKEN = "";

// Storage that can be made to fail on demand.
let storageDown = false;
const realStorage = { ...(await import("../../lib/storage")) };
mock.module("../../lib/storage", () => ({
  ...realStorage,
  putObject: async (key: string) => {
    if (storageDown) throw new Error("S3 write timed out");
    return { key, url: `/api/public/file/${encodeURIComponent(key)}` };
  },
}));

// Other test files in the same run use the real local-disk storage.
afterAll(() => {
  mock.module("../../lib/storage", () => realStorage);
});

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { ensureTables } = await import("../../../test-support/tables");
const { templatesRoutes } = await import("../templates");
const { jobFormsRoutes } = await import("../job-forms");
const { bookingsRoutes } = await import("../bookings");
const { currentVersion } = await import("../../../services/job-forms");
const { withRetry } = realStorage;

const CO = "pu-co";
const TECH = "pu-tech";
const ADMIN = "pu-admin";

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", CO);
  c.set("requestId", "pu-req");
  const uid = c.req.header("X-Test-User") ?? ADMIN;
  c.set("user", { id: uid, role: uid === ADMIN ? "admin" : "rider", email: `${uid}@t.test`, name: uid === ADMIN ? "Office" : "Tech Tom" } as never);
  return next();
});
app.route("/templates", templatesRoutes);
app.route("/job-forms", jobFormsRoutes);
app.route("/bookings", bookingsRoutes);

const send = (jobId: string, fields: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([255, 216, 255, 224])], "job.jpg", { type: "image/jpeg" }));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return app.request(`/bookings/${jobId}/photos`, { method: "POST", body: fd, headers: { "X-Test-User": TECH } });
};
const photosOf = (jobId: string) => db.select().from(schema.jobPhotos).where(eq(schema.jobPhotos.bookingId, jobId));

let jobId = "";
let otherJobId = "";

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTables(v);
  await db.insert(schema.companies).values({ id: CO, name: "Photo Co", kind: "test", isInternal: true } as never);
  await db.insert(schema.user).values([
    { id: ADMIN, name: "Office", email: "office@t.test", role: "admin", companyId: CO },
    { id: TECH, name: "Tech Tom", email: "tom@t.test", role: "rider", companyId: CO },
    { id: "pu-cust", name: "Cust", email: "cust@t.test", role: "customer", companyId: CO },
  ] as never);
  await db.insert(schema.riders).values({ id: "pu-rider", userId: TECH, companyId: CO } as never);
  await db.insert(schema.services).values({ id: "pu-svc", name: "Site visit", basePrice: 0, companyId: CO } as never);
  const r = await app.request("/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Site visit",
      form: { schema: 2, items: [{ id: "floor", type: "photo", label: "Floor photo", required: true, maxPhotos: 5 }] },
    }),
  });
  const tpl = ((await r.json()) as any).template;
  const v = await currentVersion(CO, tpl.id);
  const job = { companyId: CO, customerId: "pu-cust", serviceId: "pu-svc", riderId: "pu-rider", templateId: tpl.id, templateVersionId: v!.id, status: "arrived", scheduledAt: new Date(), address: "428 Boreham Blvd" };
  const [a] = await db.insert(schema.bookings).values(job as never).returning();
  const [b] = await db.insert(schema.bookings).values(job as never).returning();
  jobId = a!.id;
  otherJobId = b!.id;
});

describe("a photo the app sends more than once", () => {
  const clientId = "0f8b2c4e-1a2b-4c3d-8e9f-a0b1c2d3e4f5";

  it("is stored once, under the app's id", async () => {
    const first = await send(jobId, { clientId, phase: "before" });
    expect(first.status).toBe(201);
    expect(((await first.json()) as any).photo.id).toBe(clientId);
    const again = await send(jobId, { clientId, phase: "before" });
    expect(again.status).toBe(200);
    const body = (await again.json()) as any;
    expect(body.duplicate).toBe(true);
    expect(body.photo.id).toBe(clientId);
    expect((await photosOf(jobId)).length).toBe(1);
  });

  it("can't be claimed by another job", async () => {
    const r = await send(otherJobId, { clientId });
    expect(r.status).toBe(409);
    expect((await photosOf(otherJobId)).length).toBe(0);
  });

  it("ignores an id that isn't a UUID and stores the photo anyway", async () => {
    const r = await send(otherJobId, { clientId: "../../etc" });
    expect(r.status).toBe(201);
    expect(((await r.json()) as any).photo.id).not.toBe("../../etc");
  });
});

describe("when storage fails", () => {
  const clientId = "1f8b2c4e-1a2b-4c3d-8e9f-a0b1c2d3e4f5";

  it("answers 503 storage_unavailable, with a message the app can show, and stores nothing", async () => {
    storageDown = true;
    const r = await send(jobId, { clientId });
    storageDown = false;
    expect(r.status).toBe(503);
    const body = (await r.json()) as any;
    expect(body.error.code).toBe("storage_unavailable");
    expect(body.message).toMatch(/kept on your phone/);
    expect(body.requestId).toBe("pu-req");
    expect((await photosOf(jobId)).some((p) => p.id === clientId)).toBe(false);
  });

  it("the next send of the same photo goes through", async () => {
    const r = await send(jobId, { clientId });
    expect(r.status).toBe(201);
    expect((await photosOf(jobId)).some((p) => p.id === clientId)).toBe(true);
  });
});

describe("a photo for a form question, sent again later", () => {
  const clientId = "2f8b2c4e-1a2b-4c3d-8e9f-a0b1c2d3e4f5";

  it("is added to the question's answer by the server, once", async () => {
    let r = await send(jobId, { clientId, formItemId: "floor", attachToAnswer: "1" });
    expect(r.status).toBe(201);
    r = await send(jobId, { clientId, formItemId: "floor", attachToAnswer: "1" });
    expect(r.status).toBe(200);
    const form = ((await (await app.request(`/job-forms/${jobId}`, { headers: { "X-Test-User": TECH } })).json()) as any).form;
    expect(form.answers.floor.photoIds).toEqual([clientId]);
    expect(form.missing).toEqual([]);
  });

  it("isn't added when the app attaches it itself (first send, still on screen)", async () => {
    const id = "3f8b2c4e-1a2b-4c3d-8e9f-a0b1c2d3e4f5";
    expect((await send(jobId, { clientId: id, formItemId: "floor" })).status).toBe(201);
    const form = ((await (await app.request(`/job-forms/${jobId}`, { headers: { "X-Test-User": TECH } })).json()) as any).form;
    expect(form.answers.floor.photoIds).not.toContain(id);
  });
});

describe("storage writes retry", () => {
  const noWait = async () => {};
  it("succeeds when a later try works", async () => {
    let tries = 0;
    const out = await withRetry(async () => {
      tries++;
      if (tries < 3) throw new Error("blip");
      return "ok";
    }, [1, 1], "test write", noWait);
    expect(out).toBe("ok");
    expect(tries).toBe(3);
  });

  it("gives up after the last try, saying how many it made", async () => {
    let tries = 0;
    await expect(
      withRetry(async () => {
        tries++;
        throw new Error("down");
      }, [1, 1], "test write", noWait),
    ).rejects.toThrow("test write failed after 3 attempts: down");
    expect(tries).toBe(3);
  });
});
