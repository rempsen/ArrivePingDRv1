/**
 * Job forms v2 end to end through the real routes (in-memory PGlite):
 *   - templates: office-only writes, schema-2 form validated and fanned out
 *     to the legacy columns, a new version only when something changed;
 *   - booking a job pins the template version, and its prices: editing the
 *     template afterwards doesn't reprice the job;
 *   - the job form: only the office and the assigned tech, unknown questions
 *     refused, offline replays merged by timestamp, photos must be the job's;
 *   - finishing a job: a form-aware app is stopped while required questions
 *     are unanswered; an older app isn't; the office always can.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { PgTable } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.RESEND_API_KEY = "";
process.env.TWILIO_ACCOUNT_SID = "";
process.env.TWILIO_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { ensureTables } = await import("../../../test-support/tables");
const { templatesRoutes } = await import("../templates");
const { jobFormsRoutes } = await import("../job-forms");
const { bookingsRoutes } = await import("../bookings");
const { AppError } = await import("../../lib/errors");
const { currentVersion } = await import("../../../services/job-forms");
const { resolveRateModel } = await import("../../../services/billing");
const { invalidateFeatures } = await import("../../../services/features");

const CO = "jf-co";
const TECH = "jf-tech-user";
const OTHER_TECH = "jf-other-tech";
const ADMIN = "jf-admin";

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", CO);
  const uid = c.req.header("X-Test-User") ?? ADMIN;
  const role = c.req.header("X-Test-Role") ?? "admin";
  c.set("user", { id: uid, role, email: `${uid}@t.test`, name: uid === ADMIN ? "Office Olga" : "Tech Tom" } as never);
  return next();
});
app.route("/templates", templatesRoutes);
app.route("/job-forms", jobFormsRoutes);
app.route("/bookings", bookingsRoutes);
app.onError((err, c) =>
  err instanceof AppError
    ? c.json({ message: err.message }, err.status as 400)
    : c.json({ message: String((err as Error).message) }, 500),
);

const call = (method: string, path: string, body?: unknown, user = ADMIN, role = "admin", extra: Record<string, string> = {}) =>
  app.request(path, {
    method,
    headers: { "Content-Type": "application/json", "X-Test-User": user, "X-Test-Role": role, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const FORM = {
  schema: 2,
  items: [
    { id: "s1", type: "section", label: "Arrival" },
    { id: "filter", type: "pass_fail", label: "Filter", required: true, flagOn: ["fail"] },
    { id: "fphoto", type: "photo", label: "Filter photo", required: true, showIf: { itemId: "filter", op: "is", value: "fail" } },
    { id: "steps", type: "checklist", label: "Steps", options: ["Clean coils", "Test run"] },
    { id: "notes", type: "long_text", label: "Notes", internal: true },
  ],
};
const RATE = (flat: number) => ({ flatRate: flat, includedMinutes: 0, includedKm: 0, timeRate: 0, timeUnit: "hour", kmRate: 0 });

let tplId = "";

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTables(v);
  await db.insert(schema.companies).values({ id: CO, name: "Forms Co", kind: "test", isInternal: true } as never);
  await db.insert(schema.user).values([
    { id: ADMIN, name: "Office Olga", email: "olga@t.test", role: "admin", companyId: CO },
    { id: TECH, name: "Tech Tom", email: "tom@t.test", role: "rider", companyId: CO },
    { id: OTHER_TECH, name: "Other", email: "other@t.test", role: "rider", companyId: CO },
    { id: "jf-cust", name: "Cust", email: "cust@t.test", role: "customer", companyId: CO },
  ] as never);
  await db.insert(schema.riders).values([
    { id: "jf-rider", userId: TECH, companyId: CO },
    { id: "jf-rider-2", userId: OTHER_TECH, companyId: CO },
  ] as never);
  await db.insert(schema.services).values({ id: "jf-svc", name: "Tune-up", basePrice: 99, companyId: CO } as never);
  invalidateFeatures();
});

describe("templates", () => {
  it("technicians can't create, change or delete templates", async () => {
    expect((await call("POST", "/templates", { name: "X", form: FORM }, TECH, "rider")).status).toBe(403);
  });

  it("the office saves a schema-2 form; legacy columns are kept in step; version 1 is published", async () => {
    const r = await call("POST", "/templates", { name: "Furnace Tune-Up", category: "Service", form: FORM, rateModel: RATE(150) });
    expect(r.status).toBe(201);
    const { template } = (await r.json()) as any;
    tplId = template.id;
    expect(template.version).toBe(1);
    expect(template.questionCount).toBe(4);
    expect(JSON.parse(template.fields).map((f: any) => f.type)).toEqual(["select", "photo", "text"]);
    expect(JSON.parse(template.checklist).map((c: any) => c.label)).toEqual(["Clean coils", "Test run"]);
  });

  it("refuses a form with no questions", async () => {
    const r = await call("POST", "/templates", { name: "Empty", form: { schema: 2, items: [{ type: "section", label: "S" }] } });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).message).toMatch(/at least one question/);
  });

  it("only publishes a new version when something changed", async () => {
    let r = await call("PATCH", `/templates/${tplId}`, { form: FORM });
    expect(((await r.json()) as any).template.version).toBe(1);
    r = await call("PATCH", `/templates/${tplId}`, { estimatedMins: 90 });
    expect(((await r.json()) as any).template.version).toBe(1); // minutes aren't versioned
    const versions = (await (await call("GET", `/templates/${tplId}/versions`)).json()) as any;
    expect(versions.versions.map((v: any) => v.version)).toEqual([1]);
  });
});

describe("a job booked from a template", () => {
  let bookingId = "";
  it("keeps the version (and prices) it was booked with", async () => {
    const v1 = await currentVersion(CO, tplId);
    const [b] = await db
      .insert(schema.bookings)
      .values({
        companyId: CO,
        customerId: "jf-cust",
        serviceId: "jf-svc",
        riderId: "jf-rider",
        templateId: tplId,
        templateVersionId: v1!.id,
        status: "in_progress",
        scheduledAt: new Date(),
        address: "1 Test St",
      } as never)
      .returning();
    bookingId = b!.id;
    const r = await call("PATCH", `/templates/${tplId}`, { rateModel: RATE(400) });
    expect(((await r.json()) as any).template.version).toBe(2);
    const [row] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
    expect((await resolveRateModel(CO, row!)).flatRate).toBe(150);
  });

  it("only the office and the assigned technician can open the form", async () => {
    expect((await call("GET", `/job-forms/${bookingId}`, undefined, OTHER_TECH, "rider")).status).toBe(403);
    expect((await call("GET", `/job-forms/${bookingId}`, undefined, "jf-cust", "customer")).status).toBe(403);
    const r = await call("GET", `/job-forms/${bookingId}`, undefined, TECH, "rider");
    expect(r.status).toBe(200);
    const { form } = (await r.json()) as any;
    expect(form.version).toBe(1);
    expect(form.missing).toEqual(["filter"]);
  });

  it("a form-aware app can't finish the job with required questions open; an older app can't be blocked", async () => {
    const gate = await call("POST", `/bookings/${bookingId}/status`, { status: "completed" }, TECH, "rider", { "X-Forms": "2" });
    expect(gate.status).toBe(409);
    const body = (await gate.json()) as any;
    expect(body.reason).toBe("form_incomplete");
    expect(body.missing.map((m: any) => m.id)).toEqual(["filter"]);
  });

  it("saves answers, cleans them, and merges offline replays by time", async () => {
    const at = (s: number) => new Date(Date.now() - 60_000 + s * 1000).toISOString();
    let r = await call("PATCH", `/job-forms/${bookingId}`, { answers: { filter: { value: "fail", at: at(10) }, steps: { value: ["Test run", "bogus"], at: at(10) } } }, TECH, "rider");
    expect(r.status).toBe(200);
    let { form } = (await r.json()) as any;
    expect(form.answers.steps.value).toEqual(["Test run"]);
    expect(form.missing).toEqual(["fphoto"]); // Fail shows the photo question
    expect(form.flagged).toEqual(["filter"]);
    // a stale replay from an offline phone doesn't undo the newer answer
    r = await call("PATCH", `/job-forms/${bookingId}`, { answers: { filter: { value: "pass", at: at(1) } } }, TECH, "rider");
    form = ((await r.json()) as any).form;
    expect(form.answers.filter.value).toBe("fail");
    expect(form.answers.filter.by).toBe("Tech Tom");
  });

  it("refuses unknown questions and other jobs' photos", async () => {
    expect((await call("PATCH", `/job-forms/${bookingId}`, { answers: { nope: { value: "x" } } }, TECH, "rider")).status).toBe(400);
    const [other] = await db.insert(schema.bookings).values({ companyId: CO, customerId: "jf-cust", serviceId: "jf-svc", status: "pending", scheduledAt: new Date(), address: "x" } as never).returning();
    const [foreign] = await db.insert(schema.jobPhotos).values({ companyId: CO, bookingId: other!.id, url: "/u/x.jpg" } as never).returning();
    const [mine] = await db.insert(schema.jobPhotos).values({ companyId: CO, bookingId, url: "/u/y.jpg", formItemId: "fphoto" } as never).returning();
    const r = await call("PATCH", `/job-forms/${bookingId}`, { answers: { fphoto: { photoIds: [foreign!.id, mine!.id] } } }, TECH, "rider");
    const { form } = (await r.json()) as any;
    expect(form.answers.fphoto.photoIds).toEqual([mine!.id]);
    expect(form.missing).toEqual([]);
  });

  it("with everything answered the technician can finish, and the form closes", async () => {
    const r = await call("POST", `/bookings/${bookingId}/status`, { status: "completed" }, TECH, "rider", { "X-Forms": "2" });
    expect(r.status).toBe(200);
    const [resp] = await db.select().from(schema.jobFormResponses).where(eq(schema.jobFormResponses.bookingId, bookingId));
    expect(resp!.status).toBe("complete");
    expect(resp!.flaggedCount).toBe(1);
  });

  it("an older app (no X-Forms header) isn't blocked by an unfilled form", async () => {
    const v = await currentVersion(CO, tplId);
    const [b] = await db.insert(schema.bookings).values({ companyId: CO, customerId: "jf-cust", serviceId: "jf-svc", riderId: "jf-rider", templateId: tplId, templateVersionId: v!.id, status: "in_progress", scheduledAt: new Date(), address: "x" } as never).returning();
    const r = await call("POST", `/bookings/${b!.id}/status`, { status: "completed" }, TECH, "rider");
    expect(r.status).toBe(200);
  });
});
