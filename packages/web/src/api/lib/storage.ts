/**
 * Object storage abstraction.
 *
 * Uses S3 (creds in env) when configured, else falls back to local disk for
 * dev. Call sites don't care which — they get back a stable URL. Local disk is
 * ephemeral and must NOT be used in production (logged as a warning at boot).
 *
 * Backed by Bun's built-in S3 client (`Bun.S3Client`) rather than the AWS SDK:
 * same S3/R2/MinIO wire protocol, zero extra dependencies. The AWS SDK pulled
 * ~570 modules / 1.4 MB into the server bundle, which was enough to make the
 * deploy bundler run out of memory.
 */
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { log } from "./logger";

const S3_BUCKET = process.env.S3_BUCKET;
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_REGION = process.env.S3_REGION ?? "auto";
const S3_PUBLIC_BASE = process.env.S3_PUBLIC_BASE_URL; // optional CDN/base for public URLs
const USE_S3 = Boolean(
  S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY,
);

const LOCAL_DIR = join(process.cwd(), "uploads");

/** Bun's built-in S3 client, referenced off the global so no bundler has to
 * resolve the virtual "bun" module. */
type BunS3Client = InstanceType<typeof Bun.S3Client>;

let s3: BunS3Client | null = null;
function client(): BunS3Client {
  if (!s3) {
    s3 = new Bun.S3Client({
      bucket: S3_BUCKET,
      region: S3_REGION,
      endpoint: S3_ENDPOINT,
      // R2/MinIO-style endpoints need path-style URLs (bucket in the path);
      // plain AWS S3 wants virtual-hosted style. Mirrors the old
      // `forcePathStyle: Boolean(S3_ENDPOINT)`.
      virtualHostedStyle: !S3_ENDPOINT,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    });
  }
  return s3;
}

export interface StoredObject {
  key: string;
  /** URL clients use to fetch the object */
  url: string;
}

if (!USE_S3) {
  log.warn("storage: S3 not configured — using EPHEMERAL local disk (dev only)", {
    hint: "set S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY for production",
  });
}

/** Waits between storage write attempts: try, wait 0.4 s, try, wait 1.5 s, try. */
export const WRITE_RETRY_DELAYS_MS = [400, 1500] as const;

/**
 * Run `fn`, and run it again after each delay if it throws. A single blip at
 * the storage provider (a dropped connection, a 503, a slow handshake) must
 * not cost a technician the photo they just took. The last error is rethrown,
 * with the attempt count, when every try fails.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  delays: readonly number[] = WRITE_RETRY_DELAYS_MS,
  what = "storage write",
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= delays.length) {
        const e = err instanceof Error ? err : new Error(String(err));
        e.message = `${what} failed after ${attempt + 1} attempts: ${e.message}`;
        throw e;
      }
      log.warn(`${what} failed, retrying`, { attempt: attempt + 1, err: err instanceof Error ? err.message : String(err) });
      await sleep(delays[attempt]!);
      attempt++;
    }
  }
}

/** Persist a buffer. Returns the storage key + a fetch URL. */
export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<StoredObject> {
  if (USE_S3) {
    await withRetry(() => client().write(key, body, { type: contentType }), WRITE_RETRY_DELAYS_MS, `storage write ${key}`);
    const url = S3_PUBLIC_BASE
      ? `${S3_PUBLIC_BASE.replace(/\/$/, "")}/${key}`
      : `/api/public/file/${encodeURIComponent(key)}`; // public proxy route
    return { key, url };
  }
  // local fallback
  await mkdir(LOCAL_DIR, { recursive: true });
  await writeFile(join(LOCAL_DIR, key.replace(/\//g, "_")), Buffer.from(body));
  return { key, url: `/uploads/${key.replace(/\//g, "_")}` };
}

/** Remove an object by key. */
export async function deleteObject(key: string): Promise<void> {
  if (USE_S3) {
    await client()
      .delete(key)
      .catch(() => {});
    return;
  }
  await unlink(join(LOCAL_DIR, key.replace(/\//g, "_"))).catch(() => {});
}

/** Time-limited signed GET URL (S3 only). Returns null on local fallback. */
export async function signedGetUrl(key: string, expiresIn = 300): Promise<string | null> {
  if (!USE_S3) return null;
  return client().presign(key, { expiresIn, method: "GET" });
}

/**
 * Fetch an object's bytes for streaming through our own server (public proxy).
 * Works for both S3 and local fallback. Returns null if the object is missing.
 * Used by the public `/api/public/file/:key` route so that <img> tags and
 * outbound email logos load WITHOUT a session — while the underlying bucket
 * can stay private.
 */
export async function getObjectBody(
  key: string,
): Promise<{ body: Uint8Array; contentType: string } | null> {
  if (USE_S3) {
    try {
      const file = client().file(key);
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Prefer the content type stored on the object (HEAD), so images sent
      // through the public proxy render instead of downloading. Bun's
      // `file.type` only guesses from the key, so it's the fallback.
      const stored = await file.stat().then(
        (s) => s.type,
        () => null,
      );
      return {
        body: bytes,
        contentType: stored || file.type || "application/octet-stream",
      };
    } catch {
      return null;
    }
  }
  // local fallback
  const file = Bun.file(join(LOCAL_DIR, key.replace(/\//g, "_")));
  if (!(await file.exists())) return null;
  return {
    body: new Uint8Array(await file.arrayBuffer()),
    contentType: file.type || "application/octet-stream",
  };
}

export const storageMode = USE_S3 ? "s3" : "local";
