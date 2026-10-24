/**
 * Signing up a new company with an email that already has an ArrivePing login.
 *
 * Logins are global and one person can belong to several companies (see
 * api/lib/memberships.ts), so a customer of one tenant, or a technician at one,
 * can start a company of their own with the same email. What they can't do is
 * take over that login by typing a new password into a public form, so the
 * signup asks them to prove they own the inbox first:
 *
 *   1. requestSignupCode(email): a 6-digit code is emailed to that address.
 *   2. verifySignupCode(email, code): the right code returns a proof token.
 *   3. /signup sends the proof; consumeSignupProof() checks and spends it,
 *      and the new company is attached to the existing login.
 *
 * Codes and proofs live in better-auth's `verification` table, hashed.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { emailTemplates, sendEmail } from "./email";

const CODE_TTL_MS = 15 * 60_000;
const PROOF_TTL_MS = 60 * 60_000;
/** Wrong guesses allowed per code before it is thrown away. */
export const MAX_CODE_TRIES = 5;
/** A new code isn't sent sooner than this after the last one. */
const RESEND_AFTER_MS = 45_000;

const norm = (email: string) => email.trim().toLowerCase();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const codeId = (email: string) => `signup-code:${norm(email)}`;
const proofId = (email: string) => `signup-proof:${norm(email)}`;

/** The existing login for this email, if there is one (and it isn't a deleted account). */
export async function existingLogin(email: string): Promise<{ id: string; name: string } | null> {
  const [u] = await sdb
    .select({ id: schema.user.id, name: schema.user.name, role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.email, norm(email)));
  if (!u || u.role === "deleted") return null;
  return { id: u.id, name: u.name };
}

/**
 * Email a code when the address already has a login. Returns whether it does.
 * A code sent in the last 45 s is not resent (`sent: false`), so a double
 * click doesn't send two.
 */
export async function requestSignupCode(
  email: string,
  opts: { now?: number; send?: typeof sendEmail; code?: string } = {},
): Promise<{ exists: boolean; sent: boolean }> {
  const login = await existingLogin(email);
  if (!login) return { exists: false, sent: false };
  const now = opts.now ?? Date.now();
  const [prev] = await sdb.select().from(schema.verification).where(eq(schema.verification.identifier, codeId(email)));
  if (prev && prev.expiresAt.getTime() - CODE_TTL_MS > now - RESEND_AFTER_MS) return { exists: true, sent: false };
  const code = opts.code ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
  await sdb.delete(schema.verification).where(eq(schema.verification.identifier, codeId(email)));
  await sdb.insert(schema.verification).values({
    id: crypto.randomUUID(),
    identifier: codeId(email),
    value: JSON.stringify({ h: sha(code), tries: 0 }),
    expiresAt: new Date(now + CODE_TTL_MS),
  });
  const tpl = emailTemplates.signupCode({ name: login.name, code });
  await (opts.send ?? sendEmail)({ to: norm(email), subject: tpl.subject, html: tpl.html });
  return { exists: true, sent: true };
}

/** Check a code. The right one returns a single-use proof for /signup. */
export async function verifySignupCode(
  email: string,
  code: string,
  opts: { now?: number } = {},
): Promise<{ ok: true; proof: string } | { ok: false; reason: "wrong" | "expired" }> {
  const now = opts.now ?? Date.now();
  const [row] = await sdb.select().from(schema.verification).where(eq(schema.verification.identifier, codeId(email)));
  if (!row || row.expiresAt.getTime() <= now) return { ok: false, reason: "expired" };
  let stored: { h?: string; tries?: number } = {};
  try {
    stored = JSON.parse(row.value);
  } catch {
    /* treated as expired below */
  }
  if (!stored.h) return { ok: false, reason: "expired" };
  if (sha(String(code).trim()) !== stored.h) {
    const tries = (stored.tries ?? 0) + 1;
    if (tries >= MAX_CODE_TRIES) {
      await sdb.delete(schema.verification).where(eq(schema.verification.id, row.id));
      return { ok: false, reason: "expired" };
    }
    await sdb
      .update(schema.verification)
      .set({ value: JSON.stringify({ h: stored.h, tries }) })
      .where(eq(schema.verification.id, row.id));
    return { ok: false, reason: "wrong" };
  }
  await sdb.delete(schema.verification).where(eq(schema.verification.id, row.id));
  const proof = randomBytes(24).toString("base64url");
  await sdb.delete(schema.verification).where(eq(schema.verification.identifier, proofId(email)));
  await sdb.insert(schema.verification).values({
    id: crypto.randomUUID(),
    identifier: proofId(email),
    value: sha(proof),
    expiresAt: new Date(now + PROOF_TTL_MS),
  });
  return { ok: true, proof };
}

/** Is this a valid, unexpired proof for this email? Doesn't spend it. */
export async function checkSignupProof(email: string, proof: string | undefined | null, now = Date.now()): Promise<boolean> {
  if (!proof) return false;
  const [row] = await sdb
    .select()
    .from(schema.verification)
    .where(and(eq(schema.verification.identifier, proofId(email)), gt(schema.verification.expiresAt, new Date(now))));
  return !!row && row.value === sha(proof);
}

/** Spend a proof once the new company exists. */
export async function consumeSignupProof(email: string): Promise<void> {
  await sdb.delete(schema.verification).where(eq(schema.verification.identifier, proofId(email)));
}
