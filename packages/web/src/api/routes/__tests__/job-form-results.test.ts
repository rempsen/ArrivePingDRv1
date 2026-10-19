/**
 * Job forms v2 — the results, end to end through the real routes
 * (in-memory PGlite):
 *   - the per-template CSV export: office only, one column per question id
 *     across versions (header = newest label), office-only questions kept;
 *   - the job PDF's form section: answers and flags for the office, and a
 *     customer copy that leaves out office-only questions, sections and flags;
 *   - the job report payload carries the form;
 *   - the customer's emailed copy: only when the template asks for one, once,
 *     and never with office-only questions in it.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { inflateSync } from "node:zlib";
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
const { exportRoutes, buildJobPdf } = await import("../export");
const { bookingsRoutes } = await import("../bookings");
const { jobSearchRoutes } = await import("../job-search");
const { AppError } = await import("../../lib/errors");
const { currentVersion, publishVersion, saveJobAnswers, jobForm } = await import("../../../services/job-forms");
const { formCopyDeps, sendFormCopy } = await import("../../../services/form-copy");
const { invalidateFeatures } = await import("../../../services/features");

const CO = "jfr-co";
const ADMIN = "jfr-admin";
const TECH = "jfr-tech";
const CUST = "jfr-cust";

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", CO);
  const uid = c.req.header("X-Test-User") ?? ADMIN;
  const role = c.req.header("X-Test-Role") ?? "admin";
  c.set("user", { id: uid, role, email: `${uid}@t.test`, name: uid === ADMIN ? "Office Olga" : "Tech Tom" } as never);
  return next();
});
app.route("/export", exportRoutes);
app.route("/bookings", bookingsRoutes);
app.route("/jobs", jobSearchRoutes);
app.onError((err, c) =>
  err instanceof AppError
    ? c.json({ message: err.message }, err.status as 400)
    : c.json({ message: String((err as Error).message) }, 500),
);

const call = (method: string, path: string, body?: unknown, user = ADMIN, role = "admin") =>
  app.request(path, {
    method,
    headers: { "Content-Type": "application/json", "X-Test-User": user, "X-Test-Role": role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// 1x1 PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const FORM = (filterLabel = "Filter condition") => ({
  schema: 2,
  items: [
    { id: "s1", type: "section", label: "Inspection" },
    { id: "filter", type: "pass_fail", label: filterLabel, required: true, flagOn: ["fail"] },
    { id: "temp", type: "number", label: "Supply temp", unit: "C" },
    { id: "cost", type: "short_text", label: "Internal cost note", internal: true },
    { id: "sig", type: "signature", label: "Customer signature", signer: "customer" },
    { id: "s2", type: "section", label: "Office review", internal: true },
    { id: "review", type: "long_text", label: "Reviewer notes" },
  ],
});

let tplId = "";
let tplNoCopyId = "";

async function newJob(templateId: string, status = "in_progress") {
  const v = await currentVersion(CO, templateId);
  const [b] = await db
    .insert(schema.bookings)
    .values({
      companyId: CO,
      customerId: CUST,
      serviceId: "jfr-svc",
      riderId: "jfr-rider",
      templateId,
      templateVersionId: v!.id,
      title: "Furnace tune-up",
      status,
      scheduledAt: new Date("2026-10-10T15:00:00Z"),
      address: "1 Test St",
    } as never)
    .returning();
  return b!;
}

async function answer(b: { id: string; templateVersionId: string | null }) {
  const at = new Date(Date.now() - 1000).toISOString();
  await saveJobAnswers(
    CO,
    b,
    {
      filter: { value: "fail", at },
      temp: { value: 41, at },
      cost: { value: "Parts at cost $12", at },
      sig: { value: PNG, name: "Pat Customer", at },
      review: { value: "Check again next visit", at },
    },
    "Tech Tom",
  );
}

/** All the text a pdf-lib PDF draws (its content streams, inflated). */
function pdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
    } catch {
      continue;
    }
    // Standard fonts draw WinAnsi (cp1252): map the few non-Latin-1 bytes back.
    const cp1252: Record<string, string> = { "\x97": "—", "\x96": "–", "\x85": "…", "\x95": "•" };
    for (const t of content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
      out.push(Buffer.from(t[1]!, "hex").toString("latin1").replace(/[\x85\x95\x96\x97]/g, (ch) => cp1252[ch] ?? ch));
    }
  }
  return out.join("\n");
}

async function waitFor(fn: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
}

beforeAll(async () => {
  for (const v of Object.values(schema)) if (v instanceof PgTable) await ensureTables(v);
  await db.insert(schema.companies).values({ id: CO, name: "Results Co", kind: "test", isInternal: true } as never);
  await db.insert(schema.user).values([
    { id: ADMIN, name: "Office Olga", email: "olga@jfr.test", role: "admin", companyId: CO },
    { id: TECH, name: "Tech Tom", email: "tom@jfr.test", role: "rider", companyId: CO },
    { id: CUST, name: "Pat Customer", email: "pat@jfr.test", role: "customer", companyId: CO },
  ] as never);
  await db.insert(schema.riders).values({ id: "jfr-rider", userId: TECH, companyId: CO } as never);
  await db.insert(schema.services).values({ id: "jfr-svc", name: "Tune-up", basePrice: 99, companyId: CO } as never);
  const [a, b] = await db
    .insert(schema.taskTemplates)
    .values([
      { companyId: CO, name: "Furnace Tune-Up", form: JSON.stringify(FORM()), sendCustomerCopy: true },
      { companyId: CO, name: "Quiet Form", form: JSON.stringify(FORM()), sendCustomerCopy: false },
    ] as never)
    .returning();
  tplId = a!.id;
  tplNoCopyId = b!.id;
  invalidateFeatures();
});

describe("CSV export of a template's answers", () => {
  it("is office only", async () => {
    expect((await call("GET", `/export/form-responses?templateId=${tplId}`, undefined, TECH, "rider")).status).toBe(403);
    expect((await call("GET", `/export/form-responses?templateId=${tplId}`, undefined, CUST, "customer")).status).toBe(403);
  });

  it("needs a template that exists, and plain dates", async () => {
    expect((await call("GET", "/export/form-responses")).status).toBe(400);
    expect((await call("GET", "/export/form-responses?templateId=nope")).status).toBe(404);
    expect((await call("GET", `/export/form-responses?templateId=${tplId}&from=last-week`)).status).toBe(400);
  });

  it("one row per job, one column per question across versions, office-only questions included", async () => {
    const j1 = await newJob(tplId);
    await answer(j1);
    // The question keeps its id through an edit: still one column, newest label.
    await db.update(schema.taskTemplates).set({ form: JSON.stringify(FORM("Filter (checked)")) }).where(eq(schema.taskTemplates.id, tplId));
    await publishVersion(CO, tplId);
    const j2 = await newJob(tplId);
    await saveJobAnswers(CO, j2, { filter: { value: "pass", at: new Date().toISOString() }, cost: { value: "=HYPERLINK(1)", at: new Date().toISOString() } }, "Tech Tom");

    const r = await call("GET", `/export/form-responses?templateId=${tplId}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
    const lines = (await r.text()).split("\n");
    const head = lines[0]!.split(",");
    expect(head.slice(0, 8)).toEqual(["Job #", "Job title", "Date", "Technician", "Customer", "Job status", "Form status", "Form version"]);
    expect(head.slice(8)).toEqual(["Filter (checked)", "Supply temp", "Internal cost note", "Customer signature", "Reviewer notes", "Flagged answers"]);
    expect(lines.length).toBe(3);
    const row1 = lines[1]!.split(",");
    expect(row1[3]).toBe("Tech Tom");
    expect(row1[4]).toBe("Pat Customer");
    expect(row1[7]).toBe("1");
    expect(row1.slice(8)).toEqual(["Fail", "41 C", "Parts at cost $12", "Signed by Pat Customer", "Check again next visit", "1"]);
    const row2 = lines[2]!.split(",");
    expect(row2[7]).toBe("2");
    // A typed formula never runs when the file opens in Excel.
    expect(row2.slice(8)).toEqual(["Pass", "", "'=HYPERLINK(1)", "", "", "0"]);
  });

  it("filters by date", async () => {
    const r = await call("GET", `/export/form-responses?templateId=${tplId}&from=2026-10-11`);
    expect((await r.text()).trim().split("\n").length).toBe(1); // header only
  });
});

describe("the job PDF's form section", () => {
  let jobId = "";
  beforeAll(async () => {
    const b = await newJob(tplId);
    jobId = b.id;
    await answer(b);
  });

  it("the office copy has every answer, flags and office-only questions", async () => {
    const form = await jobForm(CO, (await db.select().from(schema.bookings).where(eq(schema.bookings.id, jobId)))[0]!);
    const text = pdfText(await buildJobPdf([], [], "Job X", "1 Test St", [], null, [], "", { form, audience: "office" }));
    expect(text).toContain("Form — Furnace Tune-Up (version 2)");
    expect(text).toContain("FLAGGED: Fail");
    expect(text).toContain("Internal cost note (office only)");
    expect(text).toContain("Parts at cost $12");
    expect(text).toContain("Office review  (office only)");
    expect(text).toContain("Check again next visit");
    expect(text).toContain("Signed by Pat Customer");
    expect(text).toContain("INTERNAL COPY");
  });

  it("the customer copy leaves out office-only questions, sections and flags", async () => {
    const form = await jobForm(CO, (await db.select().from(schema.bookings).where(eq(schema.bookings.id, jobId)))[0]!);
    const unit = [{ name: "Duct", unit: "ft", qty: 2, unitPrice: 5, unitCost: 3, price: 10, cost: 6 }];
    const text = pdfText(await buildJobPdf([], unit, "Job X", "1 Test St", [], null, [], "", { form, audience: "customer" }));
    expect(text).toContain("Filter (checked)");
    expect(text).toContain("Fail");
    expect(text).toContain("Signed by Pat Customer");
    expect(text).toContain("3 of 3 answered");
    for (const hidden of ["Internal cost note", "Parts at cost", "Office review", "Reviewer notes", "Check again", "FLAGGED", "INTERNAL COPY", "Per-Unit Work & Pay"]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("an SVG signature doesn't break the PDF: the printed name stands on its own", async () => {
    const form = await jobForm(CO, (await db.select().from(schema.bookings).where(eq(schema.bookings.id, jobId)))[0]!);
    form!.answers.sig = { value: "data:image/svg+xml;base64,PHN2Zy8+", name: "Sam Signer", at: new Date().toISOString() };
    const text = pdfText(await buildJobPdf([], [], "Job X", undefined, [], null, [], "", { form }));
    expect(text).toContain("Signed by Sam Signer");
  });

  it("the office PDF download includes the form", async () => {
    const r = await call("GET", `/jobs/${jobId}/export?format=pdf`);
    expect(r.status).toBe(200);
    expect(pdfText(Buffer.from(await r.arrayBuffer()))).toContain("Internal cost note");
  });

  it("the job report payload carries the form; a job without forms v2 has none", async () => {
    const r = await call("GET", `/jobs/${jobId}/report`);
    const body = (await r.json()) as any;
    expect(body.form.templateName).toBe("Furnace Tune-Up");
    expect(body.form.flagged).toEqual(["filter"]);
    const [plain] = await db.insert(schema.bookings).values({ companyId: CO, customerId: CUST, serviceId: "jfr-svc", status: "pending", scheduledAt: new Date(), address: "x" } as never).returning();
    expect(((await (await call("GET", `/jobs/${plain!.id}/report`)).json()) as any).form).toBeNull();
  });
});

describe("the customer's emailed copy", () => {
  const sent: { to: string | string[]; subject: string; html: string; text?: string }[] = [];
  beforeAll(() => {
    formCopyDeps.send = (async (m: (typeof sent)[number]) => {
      sent.push(m);
      return { ok: true, id: "test" };
    }) as never;
  });

  it("isn't sent when the template doesn't ask for it", async () => {
    const b = await newJob(tplNoCopyId);
    await answer(b);
    expect(await sendFormCopy(CO, b.id)).toEqual({ sent: false, reason: "off" });
    const r = await call("POST", `/bookings/${b.id}/status`, { status: "completed" });
    expect(r.status).toBe(200);
    await new Promise((res) => setTimeout(res, 200));
    expect(sent.length).toBe(0);
  });

  it("is sent once when the job is completed, without office-only questions", async () => {
    const b = await newJob(tplId);
    await answer(b);
    const r = await call("POST", `/bookings/${b.id}/status`, { status: "completed" }, TECH, "rider");
    expect(r.status).toBe(200);
    let logged = false;
    await waitFor(() => sent.length > 0);
    const end = Date.now() + 3000;
    while (!logged && Date.now() < end) {
      logged = (await db.select().from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.bookingId, b.id))).length > 0;
      if (!logged) await new Promise((res) => setTimeout(res, 20));
    }
    expect(sent.length).toBe(1);
    const m = sent[0]!;
    expect(m.to).toBe("pat@jfr.test");
    expect(m.subject).toContain("Furnace Tune-Up");
    for (const body of [m.html, m.text ?? ""]) {
      expect(body).toContain("Filter (checked)");
      expect(body).toContain("Signed by Pat Customer");
      expect(body).toContain("/t/");
      for (const hidden of ["Internal cost note", "Parts at cost", "Office review", "Reviewer notes", "Check again", "Flagged"]) {
        expect(body).not.toContain(hidden);
      }
    }
    // Marking it completed again doesn't send a second copy.
    expect(await sendFormCopy(CO, b.id)).toEqual({ sent: false, reason: "already sent" });
    const [log] = await db.select().from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.bookingId, b.id));
    expect(log!.event).toBe("form_copy");
    expect(log!.status).toBe("sent");
  });

  it("a failing email never fails the status change", async () => {
    formCopyDeps.send = (async () => {
      throw new Error("provider down");
    }) as never;
    const b = await newJob(tplId);
    await answer(b);
    const r = await call("POST", `/bookings/${b.id}/status`, { status: "completed" });
    expect(r.status).toBe(200);
    expect(await sendFormCopy(CO, b.id)).toEqual({ sent: false, reason: "error" });
  });
});
