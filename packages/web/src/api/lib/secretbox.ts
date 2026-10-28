/**
 * Secrets at rest. OAuth tokens (integrations.access_token / refresh_token)
 * and platform app secrets (oauth_app_credentials.client_secret) are sealed
 * with AES-256-GCM under INTEGRATIONS_KEK (32 random bytes, base64).
 *
 *   seal("abc")  → "enc:v1:<base64(iv ‖ tag ‖ ciphertext)>"
 *   open(value)  → plaintext; a value without the prefix is returned as-is,
 *                  so rows written before the key existed keep working.
 *
 * Without INTEGRATIONS_KEK nothing is encrypted (local dev); one warning is
 * logged at first use so production can't run unsealed by accident.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
let warned = false;

function key(): Buffer | null {
  const raw = process.env.INTEGRATIONS_KEK;
  if (!raw) {
    if (!warned) {
      warned = true;
      console.warn("[secretbox] INTEGRATIONS_KEK is not set: integration tokens are stored unencrypted");
    }
    return null;
  }
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("INTEGRATIONS_KEK must be 32 bytes, base64-encoded");
  return k;
}

export function isSealed(value: string): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function seal(plain: string): string {
  const k = key();
  if (!k || !plain) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

export function open(value: string): string {
  if (!isSealed(value)) return value;
  const k = key();
  if (!k) throw new Error("INTEGRATIONS_KEK is not set but a sealed value was read");
  const buf = Buffer.from(value.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = createDecipheriv("aes-256-gcm", k, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
