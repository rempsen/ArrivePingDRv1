import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/api/database/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Migrations run as the Supabase `postgres` owner role (bypasses RLS by
    // design — RLS is meaningless for schema DDL). The app's runtime
    // connection (DATABASE_URL, used by ./src/api/database/index.ts) is a
    // separate, lower-privileged `app_runtime` role — see database/tenant.ts.
    url: process.env.SUPABASE_MIGRATION_URL ?? process.env.DATABASE_URL!,
  },
});
