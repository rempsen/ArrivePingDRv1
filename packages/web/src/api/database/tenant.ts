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
 * Escape hatches:
 *  - `db` (the raw drizzle client, still exported from ./index): fine for
 *    genuinely GLOBAL tables (see GLOBAL_TABLES below) — there's no RLS
 *    policy on those, so `app_runtime`'s plain table grants are all that's
 *    needed. Using it on a tenant-owned table without first resolving a
 *    companyId will just get zero rows/a no-op update under RLS, not a leak.
 *  - `sdb` (./index, `app_system` role, BYPASSRLS): the deliberate exception
 *    for the small set of call sites that must query a tenant table BEFORE
 *    a tenant is known — auth-by-email/session-token lookups and API-key
 *    hash resolution. Once those resolve a companyId, everything after goes
 *    back through `tdb(companyId)`. See ./index.ts's doc comment on `sdb`.
 */
import { and, eq, exists, or, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db } from "./index";
import { user, memberships } from "./schema";

/**
 * Tables that are GLOBAL (not tenant-owned). Reads/writes pass through unscoped.
 * Everything else MUST carry a `companyId` column and is auto-scoped.
 */
const GLOBAL_TABLES = new Set<string>([
  "role_permissions", // shared role->permission catalog
  "idempotency_keys", // payment/webhook dedup, keyed by provider event id
  "companies", // GLOBAL tenant registry / allow-list (managed by superadmin)
  "oauth_app_credentials", // GLOBAL platform OAuth app keys (managed by superadmin)
  // better-auth managed AND carry no company_id column at all (keyed by
  // userId/token instead) — there is no company predicate to write for them,
  // so they get no RLS policy. `user` DOES carry company_id and IS tenant-
  // scoped (see tenantReadPredicate below) — it is deliberately NOT listed
  // here.
  "session",
  "account",
  "verification",
  // Curated ICP research reference data, keyed by `industry` (not
  // company_id) — genuinely global, read via plain `db` in
  // company-provisioning.ts. Has no company_id column at all, so without
  // this entry a future tdb() call against it would fail closed (throw),
  // not leak — but it belongs in the allow-list for clarity.
  "icp_knowledge_base",
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

/**
 * `user` is the one tenant table where "belongs to this tenant" is broader
 * than `companyId = X`: a technician or client can be shared across several
 * companies via an active `memberships` row while their `companyId` column
 * only ever records their HOME company (see api/lib/memberships.ts). A plain
 * equality predicate here would make every shared-user lookup vanish the
 * moment RLS enforces it, so both the app-level scope below AND the matching
 * Postgres RLS policy (see the RLS migration) use:
 *   companyId = tenant OR EXISTS (an active/invited membership at tenant)
 * for READS. Writes through tdb() still only ever stamp/require the home
 * companyId (see insert/update below) — you cannot reassign someone's home
 * company just by sharing a membership.
 */
function tenantReadPredicate(table: PgTable, companyId: string): SQL {
  const home = eq(companyCol(table), companyId);
  if (tableName(table) !== "user") return home;
  return or(
    home,
    exists(
      db
        .select({ one: sql`1` })
        .from(memberships)
        .where(and(eq(memberships.userId, user.id), eq(memberships.companyId, companyId))),
    ),
  )!;
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
export type Executor = typeof db | PgTransaction<any, any, any>;

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
  /**
   * Run a hand-written query (joins, orderBy, limit, selectDistinct, ...)
   * inside a transaction with the RLS session var already set, so `scope()`
   * predicates are actually enforceable at the database layer. Use this
   * instead of the raw `db`/`raw` escape hatch whenever the query still
   * touches a tenant-owned table.
   */
  transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;
  /** The raw drizzle client — explicit escape hatch for system/cross-tenant work. */
  raw: typeof db;
}

/** Create a tenant-bound DB facade. `companyId` must be a resolved tenant id. */
export function tdb(companyId: string): TenantDb {
  if (!companyId) throw new Error("tdb: companyId is required (fail-closed)");

  function scope<T extends PgTable>(table: T, extra?: SQL): SQL | undefined {
    if (isGlobal(table)) return extra;
    const base = tenantReadPredicate(table, companyId);
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
    transaction: withTenantTx,

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
