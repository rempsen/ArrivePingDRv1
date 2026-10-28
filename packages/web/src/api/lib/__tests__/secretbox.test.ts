/**
 * Secrets at rest: OAuth tokens and app secrets are sealed with AES-256-GCM
 * under INTEGRATIONS_KEK. Rows written before the key existed stay readable.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";

const KEK = randomBytes(32).toString("base64");

async function load() {
  // fresh module per test so the key is read from the current env
  const mod = await import(`../secretbox?${Math.random()}`);
  return mod as typeof import("../secretbox");
}

describe("secretbox", () => {
  afterEach(() => {
    delete process.env.INTEGRATIONS_KEK;
  });

  it("seals and opens a value", async () => {
    process.env.INTEGRATIONS_KEK = KEK;
    const { seal, open, isSealed } = await load();
    const sealed = seal("refresh-token-123");
    expect(sealed.startsWith("enc:v1:")).toBe(true);
    expect(sealed).not.toContain("refresh-token-123");
    expect(isSealed(sealed)).toBe(true);
    expect(open(sealed)).toBe("refresh-token-123");
  });

  it("passes legacy plaintext through open()", async () => {
    process.env.INTEGRATIONS_KEK = KEK;
    const { open, isSealed } = await load();
    expect(open("plain-old-token")).toBe("plain-old-token");
    expect(open("")).toBe("");
    expect(isSealed("plain-old-token")).toBe(false);
  });

  it("rejects a tampered ciphertext", async () => {
    process.env.INTEGRATIONS_KEK = KEK;
    const { seal, open } = await load();
    const sealed = seal("secret");
    const tampered = sealed.slice(0, -4) + (sealed.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(() => open(tampered)).toThrow();
  });

  it("returns the plaintext when no key is configured", async () => {
    const { seal, open } = await load();
    expect(seal("x")).toBe("x");
    expect(open("x")).toBe("x");
  });
});
