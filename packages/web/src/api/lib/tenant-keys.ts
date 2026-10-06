/**
 * Per-tenant default API key provisioning.
 *
 * Every company tenant is guaranteed exactly one auto-issued SECRET API key so
 * that "each new and existing company has its own unique API" holds true. The
 * key is full-scope ("*") and tenant-scoped via apiKeys.companyId, so it can
 * only ever read/write that one company's data (the tdb facade enforces this).
 *
 * Secret keys are unrecoverable after creation, so the RAW key is returned ONCE
 * to the caller (superadmin) at provisioning time and never stored in plaintext.
 */
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "../database/schema";
import { tdb } from "../database/tenant";
import { generateApiKey, generatePublicKey } from "../middleware/auth";

/** Stable label for the auto-issued per-tenant key, so we can detect it. */
export const DEFAULT_KEY_LABEL = "Default company key (auto)";

/** Stable label for the auto-issued per-tenant PUBLIC (form-submit) key. */
export const DEFAULT_PUBLIC_KEY_LABEL = "Default form key (auto)";

/**
 * Does this company already have at least one active (non-revoked) secret key?
 * Used to keep provisioning + backfill idempotent.
 */
export async function hasActiveSecretKey(companyId: string): Promise<boolean> {
  const row = await tdb(companyId).selectOne(
    schema.apiKeys,
    and(eq(schema.apiKeys.keyType, "secret"), isNull(schema.apiKeys.revokedAt)),
  );
  return !!row;
}

/**
 * Mint the auto-issued, full-scope secret key for a tenant. Returns the row plus
 * the RAW key (shown once). Caller decides whether/where to surface the raw key.
 */
export async function issueDefaultTenantKey(opts: {
  companyId: string;
  createdBy?: string;
  createdByName?: string;
  label?: string;
}): Promise<{ id: string; prefix: string; raw: string }> {
  const gen = await generateApiKey();
  const [row] = await tdb(opts.companyId).insert(schema.apiKeys, {
    label: opts.label ?? DEFAULT_KEY_LABEL,
    hashedKey: gen.hashed,
    prefix: gen.prefix,
    keyType: "secret",
    scopes: "*", // full access — but locked to this one tenant
    createdBy: opts.createdBy ?? "",
    createdByName: opts.createdByName ?? "system",
  });
  if (!row) throw new Error("failed to insert API key");
  return { id: row.id, prefix: row.prefix, raw: gen.raw };
}

/**
 * Ensure a tenant has at least one active PUBLIC (form-submit) key, returning
 * its id. Public keys are browser-safe and persisted in plaintext (publicKey),
 * so they can be re-read and auto-bound to intake forms. Idempotent: reuses an
 * existing active public key if present, otherwise mints a fresh one.
 */
export async function ensureDefaultPublicKey(opts: {
  companyId: string;
  createdBy?: string;
  createdByName?: string;
}): Promise<{ id: string; prefix: string; publicKey: string; created: boolean }> {
  const existing = await tdb(opts.companyId).selectOne(
    schema.apiKeys,
    and(eq(schema.apiKeys.keyType, "public"), isNull(schema.apiKeys.revokedAt)),
  );
  if (existing) {
    return {
      id: existing.id,
      prefix: existing.prefix,
      publicKey: existing.publicKey ?? "",
      created: false,
    };
  }
  const gen = await generatePublicKey();
  const [row] = await tdb(opts.companyId).insert(schema.apiKeys, {
    label: DEFAULT_PUBLIC_KEY_LABEL,
    hashedKey: gen.hashed,
    prefix: gen.prefix,
    keyType: "public",
    publicKey: gen.raw, // browser-safe; persisted for re-display & form binding
    scopes: "forms:submit",
    createdBy: opts.createdBy ?? "",
    createdByName: opts.createdByName ?? "system",
  });
  if (!row) throw new Error("failed to insert API key");
  return { id: row.id, prefix: row.prefix, publicKey: gen.raw, created: true };
}

/**
 * Ensure a tenant has a default key. If one already exists, returns it WITHOUT
 * the raw value (it's unrecoverable). If not, mints one and returns the raw key.
 */
export async function ensureDefaultTenantKey(opts: {
  companyId: string;
  createdBy?: string;
  createdByName?: string;
}): Promise<{ companyId: string; created: boolean; prefix: string; raw?: string }> {
  if (await hasActiveSecretKey(opts.companyId)) {
    const row = await tdb(opts.companyId).selectOne(
      schema.apiKeys,
      and(eq(schema.apiKeys.keyType, "secret"), isNull(schema.apiKeys.revokedAt)),
    );
    return { companyId: opts.companyId, created: false, prefix: row?.prefix ?? "" };
  }
  const k = await issueDefaultTenantKey(opts);
  return { companyId: opts.companyId, created: true, prefix: k.prefix, raw: k.raw };
}
