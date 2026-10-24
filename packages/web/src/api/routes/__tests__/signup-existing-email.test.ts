/**
 * Self-serve signup with an email that already has a login (a customer of
 * another company, say). Logins are global and one person can belong to many
 * companies, so the signup may add a new company to that login, but only
 * after the person proves the inbox is theirs with an emailed code. Before
 * this, signup simply failed with "Email already in use".
 *
 * Ids prefixed "sx-".
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { PgTable } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.RESEND_API_KEY = "";

const { sdb } = await import("../../database/index");
const schema = await import("../../database/schema");
const { ensureTables } = await import("../../../test-support/tables");
const proof = await import("../../../services/signup-email-proof");
const { onboardingPublicRoutes } = await import("../onboarding");

const app = new Hono().route("/o", onboardingPublicRoutes as never);
const post = (path: string, body: unknown) =>
  app.request(`/o${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify(body),
  });

const EMAIL = "sx-client@towers.test";
const sent: { to: string; subject: string; html: string }[] = [];
const send = (async (m: { to: string; subject: string; html: string }) => {
  sent.push(m);
  return { ok: true };
}) as never;

beforeAll(async () => {
  await ensureTables(...(Object.values(schema).filter((v) => v instanceof PgTable) as PgTable[]));
  await sdb.insert(schema.user).values({ id: "sx-u1", name: "Matt Client", email: EMAIL, role: "customer", companyId: "sx-bmd" } as never);
});

describe("proving an existing email", () => {
  it("does nothing for a new email", async () => {
    expect(await proof.requestSignupCode("sx-new@nowhere.test", { send })).toEqual({ exists: false, sent: false });
    expect(sent.length).toBe(0);
  });

  it("emails a code, and the right code gives a single-use proof", async () => {
    const r = await proof.requestSignupCode(EMAIL, { send, code: "123456" });
    expect(r).toEqual({ exists: true, sent: true });
    expect(sent.at(-1)!.to).toBe(EMAIL);
    expect(sent.at(-1)!.subject).toContain("123456");
    // A second click straight away doesn't send another.
    expect(await proof.requestSignupCode(EMAIL, { send })).toEqual({ exists: true, sent: false });

    expect(await proof.verifySignupCode(EMAIL, "000000")).toEqual({ ok: false, reason: "wrong" });
    const ok = await proof.verifySignupCode(EMAIL.toUpperCase(), "123456");
    expect(ok.ok).toBe(true);
    const token = ok.ok ? ok.proof : "";
    expect(await proof.checkSignupProof(EMAIL, token)).toBe(true);
    expect(await proof.checkSignupProof(EMAIL, "forged")).toBe(false);
    // The code is spent.
    expect((await proof.verifySignupCode(EMAIL, "123456")).ok).toBe(false);
    await proof.consumeSignupProof(EMAIL);
    expect(await proof.checkSignupProof(EMAIL, token)).toBe(false);
  });

  it("throws a code away after too many wrong guesses", async () => {
    await proof.requestSignupCode(EMAIL, { send, code: "654321", now: Date.now() + 60_000 });
    for (let i = 0; i < proof.MAX_CODE_TRIES - 1; i++) expect(await proof.verifySignupCode(EMAIL, "111111")).toEqual({ ok: false, reason: "wrong" });
    expect(await proof.verifySignupCode(EMAIL, "111111")).toEqual({ ok: false, reason: "expired" });
    expect((await proof.verifySignupCode(EMAIL, "654321")).ok).toBe(false);
  });

  it("expires a proof after an hour", async () => {
    await proof.requestSignupCode(EMAIL, { send, code: "222222", now: Date.now() + 120_000 });
    const ok = await proof.verifySignupCode(EMAIL, "222222", { now: Date.now() + 120_000 });
    const token = ok.ok ? ok.proof : "";
    expect(await proof.checkSignupProof(EMAIL, token, Date.now() + 2 * 3_600_000)).toBe(false);
  });

  it("doesn't treat a deleted account as an existing login", async () => {
    await sdb.insert(schema.user).values({ id: "sx-gone", name: "Gone", email: "sx-gone@x.test", role: "deleted", companyId: "sx-bmd" } as never);
    expect(await proof.existingLogin("sx-gone@x.test")).toBeNull();
  });
});

describe("POST /signup with an existing email", () => {
  const body = {
    name: "Towers Realty",
    adminName: "Matt Client",
    adminEmail: EMAIL,
    adminPassword: "a-good-password-1",
  };

  it("asks for the emailed code instead of failing with 'already in use'", async () => {
    const res = await post("/signup", body);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "email_needs_code" });
    // Nothing was created.
    const [co] = await sdb.select().from(schema.companies).where(eq(schema.companies.id, "towers-realty"));
    expect(co).toBeUndefined();
  });

  it("refuses a made-up proof", async () => {
    const res = await post("/signup", { ...body, emailProof: "made-up" });
    expect(res.status).toBe(409);
  });

  it("/email/verify refuses a wrong code with a plain message", async () => {
    await proof.requestSignupCode(EMAIL, { send, code: "333333", now: Date.now() + 180_000 });
    const res = await post("/email/verify", { email: EMAIL, code: "999999" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).message).toContain("isn't right");
  });
});
