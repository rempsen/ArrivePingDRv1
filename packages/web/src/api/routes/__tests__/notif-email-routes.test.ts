/**
 * Notification emails v2 over the API: the company theme, designs stored as
 * clean v2 JSON, previews with unsaved brand changes, the built-in template
 * library, logo uploads and the AI draft guard. Each company only sees its own.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.RESEND_API_KEY = "";
process.env.TWILIO_ACCOUNT_SID = "";
process.env.TWILIO_AUTH_TOKEN = "";

const { db } = await import("../../database/index");
const schema = await import("../../database/schema");
const { notifConfigRoutes } = await import("../notif-config");
const { AppError } = await import("../../lib/errors");

const CO = "nem-co";
const OTHER = "nem-other";

const app = new Hono<AppEnv>().use("*", async (c, next) => {
  c.set("companyId", c.req.header("X-Test-Company") || CO);
  const role = c.req.header("X-Test-Role") || "admin";
  c.set("user", { id: `nem-${role}`, role, email: `${role}@example.test`, name: role } as any);
  return next();
});
app.route("/n", notifConfigRoutes);
app.onError((err, c) =>
  err instanceof AppError ? c.json({ message: err.message }, err.status as 400) : c.json({ message: String((err as Error).message) }, 500),
);

const call = (method: string, path: string, body?: unknown, co = CO, role = "admin") =>
  app.request(`/n${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Test-Company": co, "X-Test-Role": role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function colDdl(col: PgColumn, withPk: boolean): string {
  const parts = [`"${col.name}"`, col.getSQLType()];
  if (withPk && col.primary) parts.push("PRIMARY KEY");
  const dflt = (col as any).default;
  const lit =
    dflt === undefined ? null
    : typeof dflt === "string" ? `'${dflt.replace(/'/g, "''")}'`
    : typeof dflt === "boolean" ? (dflt ? "TRUE" : "FALSE")
    : typeof dflt === "number" ? String(dflt)
    : null;
  if (lit !== null) parts.push(`DEFAULT ${lit}`);
  return parts.join(" ");
}

beforeAll(async () => {
  const s = (db as any).$client;
  for (const v of Object.values(schema)) {
    if (!(v instanceof PgTable)) continue;
    const cfg = getTableConfig(v);
    await s.execute(`CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cfg.columns.map((c) => colDdl(c, true)).join(", ")})`);
    for (const c of cfg.columns) if (!c.primary) await s.execute(`ALTER TABLE "${cfg.name}" ADD COLUMN IF NOT EXISTS ${colDdl(c, false)}`);
  }
  await db.insert(schema.companies).values([
    { id: CO, name: "Email Co" },
    { id: OTHER, name: "Other Co" },
  ] as any);
});

describe("company email theme", () => {
  it("is stored cleaned and only for this company", async () => {
    const r = await call("PATCH", "/channels", {
      emailTheme: { font: "modern", header: "none", buttonShape: "pill", social: [{ label: "Facebook", url: "https://facebook.com/x" }, { label: "Bad", url: "javascript:alert(1)" }], extra: "dropped" },
    });
    expect(r.status).toBe(200);
    const row = (await r.json()).channels;
    const theme = JSON.parse(row.emailTheme);
    expect(theme).toMatchObject({ font: "modern", header: "none", buttonShape: "pill" });
    expect(theme.social).toEqual([{ label: "Facebook", url: "https://facebook.com/x" }]);
    expect("extra" in theme).toBe(false);
    // No other company's row was touched.
    const rows = (await db.select().from(schema.notificationChannels)) as any[];
    expect(rows.filter((x) => x.companyId === OTHER && x.emailTheme).length).toBe(0);
    expect(rows.filter((x) => x.companyId === CO).length).toBe(1);
  });

  it("accepts the Minimal header the old Channels card sends", async () => {
    expect((await call("PATCH", "/channels", { emailHeaderStyle: "minimal" })).status).toBe(200);
    expect((await call("PATCH", "/channels", { emailHeaderStyle: "fancy" })).status).toBe(400);
  });

  it("only admins change it", async () => {
    expect((await call("PATCH", "/channels", { emailTheme: {} }, CO, "rider")).status).toBe(403);
  });
});

describe("designs", () => {
  it("stores a v1 list as a clean v2 design, and blank clears it", async () => {
    const rules = (await (await call("GET", "/rules")).json()).rules as any[];
    const rule = rules.find((x) => x.event === "created" && x.recipient === "client");
    expect(rule).toBeTruthy();
    let r = await call("PATCH", `/rules/${rule.id}`, { emailDesign: [{ type: "heading", text: "Hi {{firstName}}", size: "lg" }, { type: "button", label: "Go", url: "javascript:alert(1)" }] });
    expect(r.status).toBe(200);
    const stored = JSON.parse((await r.json()).rule?.emailDesign ?? (await db.select().from(schema.notificationRules)).find((x: any) => x.id === rule.id)!.emailDesign);
    expect(stored.v).toBe(2);
    expect(stored.blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(stored.blocks[1].url).toBe("");
    r = await call("PATCH", `/rules/${rule.id}`, { emailDesign: "" });
    expect(r.status).toBe(200);
    const after = (await db.select().from(schema.notificationRules)).find((x: any) => x.id === rule.id)!;
    expect(after.emailDesign).toBe("");
  });

  it("a blank subject is allowed (the default subject is used)", async () => {
    const rules = (await (await call("GET", "/rules")).json()).rules as any[];
    const rule = rules.find((x) => x.event === "arrived" && x.recipient === "client");
    expect((await call("PATCH", `/rules/${rule.id}`, { emailSubject: "", emailDesign: [{ type: "text", text: "Hi" }] })).status).toBe(200);
  });

  it("escapes every value in the company footer", async () => {
    const { buildEmailFooter } = await import("../../../services/dispatch");
    const f = buildEmailFooter({ name: "<img src=x onerror=alert(1)>", address: "1 <b>Main</b>", email: 'a"@x.test', website: 'evil.test" onmouseover="x' });
    expect(f).not.toContain("<img");
    expect(f).not.toContain("<b>");
    expect(f).not.toContain('onmouseover="');
  });

  it("previews with unsaved brand changes", async () => {
    const r = await call("POST", "/email/render", {
      design: { v: 2, preheader: "Peek", blocks: [{ type: "text", text: "Hello {{firstName}}" }] },
      brand: { brandColor: "#123456", theme: { header: "brand", logoBacking: false } },
    });
    expect(r.status).toBe(200);
    const { html } = await r.json();
    expect(html).toContain("Hello Alex");
    expect(html).toContain('bgcolor="#123456"');
    expect(html).toContain("Peek");
    expect((await call("POST", "/email/render", { brand: { brandColor: "red" } })).status).toBe(400);
  });
});

describe("template library", () => {
  it("adds the new built-ins once and refreshes old ones", async () => {
    await db.insert(schema.emailTemplates).values({ companyId: CO, name: "Job Update", description: "old", subject: "old", design: JSON.stringify([{ type: "text", text: "old" }]), isBuiltin: true } as any);
    const a = (await (await call("GET", "/email/templates")).json()).templates as any[];
    const b = (await (await call("GET", "/email/templates")).json()).templates as any[];
    expect(a.length).toBe(b.length);
    const names = b.filter((t) => t.isBuiltin).map((t) => t.name);
    expect(names).toContain("On the Way");
    expect(names.filter((n: string) => n === "Job Update").length).toBe(1);
    const ju = b.find((t) => t.name === "Job Update");
    expect(JSON.parse(ju.design).v).toBe(2);
    const theirs = (await (await call("GET", "/email/templates", undefined, OTHER)).json()).templates as any[];
    expect(theirs.every((t) => t.companyId !== CO)).toBe(true);
  });

  it("saves a tenant template as a clean design", async () => {
    const r = await call("POST", "/email/templates", { name: "Mine", design: { v: 2, preheader: "", blocks: [{ type: "callout", text: "Hi", tone: "nope" }] } });
    expect(r.status).toBe(201);
    const t = (await r.json()).template;
    expect(JSON.parse(t.design).blocks[0].tone).toBe("info");
  });
});

describe("uploads and AI drafts", () => {
  it("turns away SVG logos with a plain reason", async () => {
    const fd = new FormData();
    fd.append("file", new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "logo.svg", { type: "image/svg+xml" }));
    const r = await app.request("/n/email/logo", { method: "POST", body: fd, headers: { "X-Test-Company": CO, "X-Test-Role": "admin" } });
    expect(r.status).toBe(400);
    expect((await r.json()).message).toMatch(/Gmail and Outlook can't show SVG/);
  });

  it("asks for a real description before drafting", async () => {
    const r = await call("POST", "/email/generate", { description: "hi" });
    expect(r.status).toBe(400);
    expect((await call("POST", "/email/generate", { description: "A friendly on-the-way email" }, CO, "rider")).status).toBe(403);
  });
});
