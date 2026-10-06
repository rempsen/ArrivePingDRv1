// Production/staging migration runner. Executed as a one-off ECS task (see
// infra/terraform/modules/nvc360/migrate.tf and deploy-staging.yml) because
// the database is not reachable from outside the VPC.
//
// Env:
//   MIGRATION_DATABASE_URL  master/owner role URL (RLS-bypassing DDL)
//   APP_RUNTIME_PASSWORD    password to set on the app_runtime login role
//   APP_SYSTEM_PASSWORD     password to set on the app_system login role
//
// Order matters: 0001_app_roles_and_rls.sql creates the roles only IF NOT
// EXISTS with a placeholder password, so we pre-create them, migrate, then set
// the real passwords. Every step is idempotent, so re-running is safe.

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { join } from "node:path";

const url = process.env.MIGRATION_DATABASE_URL;
const runtimePw = process.env.APP_RUNTIME_PASSWORD;
const systemPw = process.env.APP_SYSTEM_PASSWORD;
if (!url || !runtimePw || !systemPw) {
  console.error("MIGRATION_DATABASE_URL, APP_RUNTIME_PASSWORD and APP_SYSTEM_PASSWORD are required");
  process.exit(1);
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sql = postgres(url, { ssl: "require", max: 1, connect_timeout: 15 });

try {
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
        CREATE ROLE app_runtime WITH LOGIN NOBYPASSRLS;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system') THEN
        CREATE ROLE app_system WITH LOGIN BYPASSRLS;
      END IF;
    END $$;
  `);
  console.log("roles ensured");

  await migrate(drizzle(sql), { migrationsFolder: join(import.meta.dir, "../../../drizzle") });
  console.log("migrations applied");

  await sql.unsafe(`ALTER ROLE app_runtime WITH PASSWORD ${lit(runtimePw)}`);
  await sql.unsafe(`ALTER ROLE app_system WITH PASSWORD ${lit(systemPw)}`);
  console.log("role passwords set");
} catch (err) {
  console.error("migration failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
