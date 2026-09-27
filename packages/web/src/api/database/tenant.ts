/**
 * Enforced tenant-scoped database access.
 *
 * The core risk with hand-applied `companyId` filters is that the NEXT query a
 * developer writes is one forgotten `.where()` away from leaking across tenants.
 * This module removes that footgun: `tdb(companyId)` returns a thin wrapper whose
 * read/write builders AUTOMATICALLY constrain to the active company for every
 * tenant-owned table — and refuse to touch a tenant table without a companyId.
 *
 * Global tables (role catalog, idempotency keys) are explicitly allow-listed and
 * pass through unscoped.
 *
 * RLS BACKSTOP: every operation below runs inside a Postgres transaction that
 * first calls `set_config('app.tenant_id', companyId, true)` — a session
 * variable scoped to just that transaction (the `true` = "is_local"). Every
 * tenant-owned table on Supabase carries a row-level-security policy that
 * requires `company_id = current_setting('app.tenant_id', true)`. This means
 * a bug in THIS file, or a future call site that bypasses tdb() entirely and
 * queries the tenant table directly, still cannot cross tenants as long as
 * the app's runtime Postgres role (`app_runtime`) has RLS enforced and no
 * BYPASSRLS — the app-level scoping below and the database's own RLS are two
 * independent enforcement layers, not one relying on the other.
 *
 * Usage:
 *   const t = tdb(tenantId(c));
 *   const rows = await t.select(schema.services);                 // auto WHERE company_id = ?
 *   const rows = await t.select(schema.services, eq(schema.services.active, true)); // ANDed
 *   const [row] = await t.insert(schema.services, { name: "X" });  // company_id stamped
 *   await t.update(schema.services, { active: false }, eq(schema.services.id, id)); // scoped
 *   await t.delete(schema.services, eq(schema.services.id, id));   // scoped
 *
 * Escape hatch: `db` (the raw drizzle client) is still exported from ./index for
 * the rare cross-tenant/system path (migrations, retention sweeps, webhooks that
 * resolve their own tenant). Those call sites are intentionally explicit and do
 * NOT get the RLS session variable set, so they rely on the `app_runtime` role's
 * plain table grants (still no BYPASSRLS — a raw cross-tenant read still has to
 * go through a policy that allows it, e.g. because it queries a genuinely global
 * table, or the raw call is itself already id-prefiltered by a trusted key).
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db } from "./index";

/**
 * Tables that are GLOBAL (not tenant-owned). Reads/writes pass through unscoped.
 * Everything else MUST carry a `companyId` column and is auto-scoped.
 */
const GLOBAL_TABLES = new Set<string>([
  "role_permissions", // shared role->permission catalog
  "idempotency_keys", // payment/webhook dedup, keyed by provider event id
  "companies", // GLOBAL tenant registry / allow-list (managed by superadmin)
  "oauth_app_credentials", // GLOBAL platform OAuth app keys (managed by superadmin)
  // better-auth managed tables — auth owns their lifecycle; tenant lives on `user`
  "user",
  "session",
  "account",
  "verification",
]);

/** Drizzle exposes the SQL table name via this internal symbol. */
function tableName(table: PgTable): string {
  // drizzle-orm stores the name on a well-known symbol; fall back defensively.
  const sym = Object.getOwnPropertySymbols(table).find(
    (s) => s.description === "drizzle:Name",
  );
  return sym ? ((table as unknown as Record<symbol, string>)[sym] ?? "") : "";
}

function isGlobal(table: PgTable): boolean {
  return GLOBAL_TABLES.has(tableName(table));
}

/** The companyId column for a tenant table, or throws (fail-closed). */
function companyCol(table: PgTable) {
  const col = (table as unknown as Record<string, unknown>)["companyId"];
  if (!col) {
    throw new Error(
      `tenant scope error: table "${tableName(table)}" has no companyId column. ` +
        `Add it to the schema or allow-list it in GLOBAL_TABLES.`,
    );
  }
  return col as Parameters<typeof eq>[0];
}

/** Any drizzle query executor with the shared select/insert/update/delete builder API. */
type Executor = typeof db | PgTransaction<any, any, any>;

/** Stamp the RLS session variable for the lifetime of one transaction. */
async function setTenantContext(tx: Executor, companyId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.tenant_id', ${companyId}, true)`);
}

export interface TenantDb {
  companyId: string;
  /** SELECT * FROM table WHERE company_id = ? [AND extra]. Returns the rows. */
  select<T extends PgTable>(table: T, extra?: SQL): Promise<T["$inferSelect"][]>;
  /** First matching row or undefined. */
  selectOne<T extends PgTable>(table: T, extra?: SQL): Promise<T["$inferSelect"] | undefined>;
  /** INSERT with company_id auto-stamped. Returns inserted rows. */
  insert<T extends PgTable>(
    table: T,
    values: Partial<T["$inferInsert"]> | Partial<T["$inferInsert"]>[],
  ): Promise<T["$inferSelect"][]>;
  /** UPDATE ... WHERE company_id = ? [AND extra]. */
  update<T extends PgTable>(
    table: T,
    values: Partial<T["$inferInsert"]>,
    extra?: SQL,
  ): Promise<T["$inferSelect"][]>;
  /** DELETE WHERE company_id = ? [AND extra]. */
  delete<T extends PgTable>(table: T, extra?: SQL): Promise<void>;
  /** Build the tenant predicate to AND into a hand-written query. */
  scope<T extends PgTable>(table: T, extra?: SQL): SQL | undefined;
  /** The raw drizzle client — explicit escape hatch for system/cross-tenant work. */
  raw: typeof db;
}

/** Create a tenant-bound DB facade. `companyId` must be a resolved tenant id. */
export function tdb(companyId: string): TenantDb {
  if (!companyId) throw new Error("tdb: companyId is required (fail-closed)");

  function scope<T extends PgTable>(table: T, extra?: SQL): SQL | undefined {
    if (isGlobal(table)) return extra;
    const base = eq(companyCol(table), companyId);
    return extra ? and(base, extra) : base;
  }

  /** Run one operation inside a transaction with the RLS session var set. */
  function withTenantTx<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await setTenantContext(tx, companyId);
      return fn(tx);
    });
  }

  return {
    companyId,
    raw: db,
    scope,

    async select(table, extra) {
      const where = scope(table, extra);
      return withTenantTx(async (tx) => {
        const q = tx.select().from(table as PgTable);
        return (where ? await q.where(where) : await q) as never;
      });
    },

    async selectOne(table, extra) {
      const where = scope(table, extra);
      return withTenantTx(async (tx) => {
        const q = tx.select().from(table as PgTable);
        const rows = where ? await q.where(where).limit(1) : await q.limit(1);
        return rows[0] as never;
      });
    },

    async insert(table, values) {
      const stamp = (v: Record<string, unknown>) =>
        isGlobal(table) ? v : { ...v, companyId };
      const payload = Array.isArray(values)
        ? values.map((v) => stamp(v as Record<string, unknown>))
        : stamp(values as Record<string, unknown>);
      return withTenantTx(
        async (tx) =>
          (await tx
            .insert(table as PgTable)
            .values(payload as never)
            .returning()) as never,
      );
    },

    async update(table, values, extra) {
      const where = scope(table, extra);
      // never allow companyId to be reassigned through update
      const safe = { ...(values as Record<string, unknown>) };
      delete safe.companyId;
      return withTenantTx(async (tx) => {
        const q = tx.update(table as PgTable).set(safe as never);
        return (where ? await q.where(where).returning() : await q.returning()) as never;
      });
    },

    async delete(table, extra) {
      const where = scope(table, extra);
      await withTenantTx(async (tx) => {
        const q = tx.delete(table as PgTable);
        if (where) await q.where(where);
        else await q;
      });
    },
  };
}
