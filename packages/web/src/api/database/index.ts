import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Supabase's session pooler can drop idle connections; postgres.js already
 * retries connection-level failures internally, but we keep a thin retry
 * wrapper around the one-shot warm-up ping so a cold start never surfaces a
 * transient failure as a boot-time crash.
 */
const TRANSIENT = [
  "ECONNRESET",
  "Connection terminated",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
  "EAI_AGAIN", // transient DNS failure during cold start
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
];

function isTransient(err: unknown): boolean {
  const msg =
    (err as { message?: string })?.message ??
    (err as { code?: string })?.code ??
    String(err);
  const code = String((err as any)?.code ?? "");
  return TRANSIENT.some((t) => msg.includes(t) || code.includes(t));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BASE_DELAYS = [100, 250, 600, 1200, 2000];

function nextDelay(attempt: number): number {
  const base = BASE_DELAYS[Math.min(attempt, BASE_DELAYS.length - 1)];
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const maxRetries = BASE_DELAYS.length;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries && isTransient(err)) {
        const delay = nextDelay(attempt);
        console.warn(
          `[db] transient ${label} failure (attempt ${attempt + 1}/${maxRetries}); retrying in ${delay}ms`,
        );
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * Test harness only: `DATABASE_URL=":memory:"` is the sentinel the test suite
 * has always used (previously libsql's native in-memory SQLite; now an
 * ephemeral embedded Postgres via pglite, so ~30 test files that build their
 * own throwaway schema/seed data via `(db as any).$client` didn't all need
 * rewriting). The shim below speaks the same libsql-`Client`-shaped
 * `.execute(sql | { sql, args })` surface those tests already call, translated
 * to real Postgres: `?` placeholders -> `$1..$n`, and SQLite's
 * `INSERT OR IGNORE` -> `ON CONFLICT DO NOTHING`.
 */
function isTestMemoryUrl(url: string | undefined): boolean {
  return url === ":memory:";
}

/**
 * Test-fixture SQLite raw SQL uses integer 0/1 literals for boolean columns
 * (`... email_verified) VALUES (?,?,?,?,?,0)`). Real Postgres boolean
 * columns reject that with `42804`. Rather than editing ~30 test files by
 * hand, build a table -> boolean-column-name-set map from the actual schema
 * once, and rewrite bare `0`/`1` literals landing in a boolean column's
 * VALUES slot to `FALSE`/`TRUE` before the statement reaches pglite.
 */
function buildBooleanColumnMap(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (!value || typeof value !== "object") continue;
    try {
      const config = getTableConfig(value as PgTable);
      const boolCols = new Set(
        config.columns.filter((c) => c.dataType === "boolean").map((c) => c.name),
      );
      if (boolCols.size > 0) map.set(config.name, boolCols);
    } catch {
      // not a table export (e.g. a relations helper) - skip it
    }
  }
  return map;
}

const BOOLEAN_COLUMNS = buildBooleanColumnMap();

function coerceBooleanLiterals(text: string): string {
  return text.replace(
    /(insert\s+into\s+"?)(\w+)("?\s*)\(([^)]+)\)(\s*values\s*)\(([^)]+)\)/i,
    (whole, pre, tableName, mid, colsRaw, valsKw, valsRaw) => {
      const boolCols = BOOLEAN_COLUMNS.get(tableName);
      if (!boolCols) return whole;
      const cols = colsRaw.split(",").map((c: string) => c.trim());
      const vals = valsRaw.split(",").map((v: string) => v.trim());
      if (cols.length !== vals.length) return whole;
      const newVals = vals.map((v: string, idx: number) => {
        const col = cols[idx]?.replace(/"/g, "");
        if (col && boolCols.has(col) && (v === "0" || v === "1")) {
          return v === "1" ? "TRUE" : "FALSE";
        }
        return v;
      });
      return `${pre}${tableName}${mid}(${cols.join(", ")})${valsKw}(${newVals.join(", ")})`;
    },
  );
}

async function buildPgliteDb(): Promise<PostgresJsDatabase<typeof schema>> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  const pglite = new PGlite();

  (pglite as any).execute = async (
    stmt: string | { sql: string; args?: unknown[] },
  ) => {
    if (typeof stmt === "string") return pglite.query(stmt);
    let text = stmt.sql;
    const wasIgnore = /^\s*insert\s+or\s+ignore\s+into/i.test(text);
    if (wasIgnore) {
      text = text.replace(/^\s*insert\s+or\s+ignore\s+into\s+(\w+)/i, "INSERT INTO $1");
    }
    // Postgres treats bare `user` as the CURRENT_USER expression, not the
    // table name, wherever it appears as a table reference (INSERT INTO,
    // DELETE FROM, UPDATE, FROM, JOIN). SQLite's test fixtures have no such
    // reserved-word clash, so quote it generically rather than per-verb.
    text = text.replace(
      /\b(from|into|update|join)(\s+)user\b/gi,
      (_m, kw, ws) => `${kw}${ws}"user"`,
    );
    text = coerceBooleanLiterals(text);
    let i = 0;
    text = text.replace(/\?/g, () => "$" + ++i);
    if (wasIgnore) text = `${text.replace(/;\s*$/, "")} ON CONFLICT DO NOTHING`;
    return pglite.query(text, (stmt.args ?? []) as unknown[]);
  };

  return drizzlePglite(pglite, { schema }) as unknown as PostgresJsDatabase<typeof schema>;
}

/**
 * Runtime connection: uses the app_runtime Postgres role (NOT the `postgres`
 * owner role), which has RLS enforced with no BYPASSRLS. `DATABASE_URL`
 * points at the Supabase session pooler (IPv4-reachable, connection-limited
 * transport-safe pooling) so this works from serverless/edge-ish hosts too.
 *
 * `SET LOCAL app.tenant_id` (see ./tenant.ts) requires session state to
 * survive within one logical transaction, which the pooler's transaction
 * mode would silently reset — so this client is left in "session" pooling
 * (the default `postgres()` behavior against Supabase's session pooler
 * port 5432) rather than pointed at the transaction-pooler port 6543.
 */
const memoryMode = isTestMemoryUrl(process.env.DATABASE_URL);

const queryClient = memoryMode
  ? undefined
  : postgres(process.env.DATABASE_URL!, {
      ssl: "require",
      // BUG FIX (root cause of intermittent 500s across every route, incl.
      // sign-in and the dashboard's onboarding-status widget): Supabase's
      // session-mode pooler caps this project at 15 concurrent connections
      // total. This pool's `max: 10` PLUS the system pool's `max: 5` below
      // summed to exactly 15 — the entire budget, with zero headroom. Any
      // extra connection (a second instance briefly alive during a deploy, a
      // developer's local script pointed at the same DATABASE_URL, even
      // ordinary connection churn) pushed the project over its cap and
      // Postgres started rejecting NEW connections with `EMAXCONNSESSION:
      // max clients reached in session mode`, which surfaced to users as a
      // generic 500 on whatever route happened to need a fresh connection at
      // that moment — sign-in included. Lowered so the two pools together
      // (7 + 3 = 10) leave real headroom under the 15-connection ceiling.
      max: 7,
      idle_timeout: 20,
      connect_timeout: 10,
    });

export const db: PostgresJsDatabase<typeof schema> = memoryMode
  ? (await buildPgliteDb())
  : drizzlePg(queryClient!, { schema });

/**
 * System/bypass connection: uses the `app_system` Postgres role, which has
 * BYPASSRLS. This is a DELIBERATE, NARROW escape hatch for the handful of
 * call sites that must run BEFORE a tenant is known — authentication itself
 * (better-auth's session/user/account lookups, API-key hash resolution) and
 * the couple of webhook/callback handlers that resolve their own tenant from
 * a provider-supplied opaque id (Stripe payment intent id, OAuth state).
 * Those cannot set `app.tenant_id` first because determining the tenant IS
 * the point of the query.
 *
 * Every other query MUST go through `tdb()` (or the plain `db` export for
 * genuinely global, non-tenant-owned tables). Grep for `sdb` before adding a
 * new usage — each one is a hole in the RLS backstop and should be reviewed
 * as carefully as a new raw SQL string.
 *
 * In the pglite test harness there are no Postgres roles/RLS at all, so this
 * just aliases to the same in-memory client.
 */
const systemQueryClient = memoryMode
  ? undefined
  : postgres(process.env.DATABASE_SYSTEM_URL || process.env.DATABASE_URL!, {
      ssl: "require",
      // See the matching comment on `queryClient` above — this pool's max
      // was lowered from 5 to 3 for the same reason (Supabase's 15-connection
      // session-mode ceiling had zero headroom between the two pools).
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
    });

export const sdb: PostgresJsDatabase<typeof schema> = memoryMode
  ? db
  : drizzlePg(systemQueryClient!, { schema });

/**
 * Warm-up / liveness ping. Called on server boot so the very first real user
 * request never races a cold connection. Also reusable by the /ready probe.
 * Returns true if the DB answered, false otherwise (never throws).
 */
export async function pingDb(): Promise<boolean> {
  try {
    if (memoryMode) {
      await db.execute(sql`select 1`);
    } else {
      await withRetry(() => queryClient!`select 1`, "ping");
    }
    return true;
  } catch (err) {
    console.warn("[db] warm-up ping failed:", (err as Error)?.message ?? err);
    return false;
  }
}

/**
 * Boot-time warm-up: retry the ping a few times so a host-resume cold start
 * settles the connection before traffic arrives. Fire-and-forget from server.ts.
 */
export async function warmUpDb(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    if (await pingDb()) {
      if (i > 0) console.log(`[db] connection warmed up after ${i + 1} tries`);
      return;
    }
    await sleep(nextDelay(i));
  }
  console.warn("[db] warm-up did not confirm a connection (will retry on first request)");
}
