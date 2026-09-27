-- RLS backstop + low-privilege application roles.
--
-- Two Postgres roles carry the app's two connection modes described in
-- ./src/api/database/index.ts and ./src/api/database/tenant.ts:
--   app_runtime — the default runtime connection (DATABASE_URL). RLS
--                 ENFORCED, no BYPASSRLS. Every query against a tenant table
--                 must go through tdb(), which SET_CONFIGs app.tenant_id
--                 inside a transaction before the real query runs.
--   app_system  — the narrow escape hatch (DATABASE_SYSTEM_URL) for the
--                 handful of pre-tenant-resolution lookups (auth by email,
--                 session/token lookup, API-key hash resolution). BYPASSRLS.
--
-- Passwords are NOT set here (this file is committed to git). Roles are
-- created with a temporary unusable password; an operator sets the real
-- password out-of-band via `ALTER ROLE ... WITH PASSWORD '...'` run
-- directly against the database, never checked into source control.
--
-- Policy shape: one FOR ALL policy per tenant table,
--   USING/WITH CHECK (company_id = current_setting('app.tenant_id', true))
-- except `user`, which is broader (see tenantReadPredicate in tenant.ts): a
-- rider/client can be shared across companies via an active `memberships`
-- row, so both USING and WITH CHECK also allow rows reachable through an
-- active membership at the current tenant, matched exactly to tdb()'s real
-- behavior so the RLS backstop never rejects something tdb() itself allowed.
-- current_setting(..., true) returns NULL when unset (e.g. a bug bypassing
-- tdb() and using plain `db` on a tenant table) -- company_id = NULL is
-- never true, so that fails closed to zero rows/no-op, not a leak.

-- === Roles ===
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime WITH LOGIN PASSWORD 'change-me-set-via-alter-role' NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system') THEN
    CREATE ROLE app_system WITH LOGIN PASSWORD 'change-me-set-via-alter-role' BYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO app_runtime, app_system;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime, app_system;
--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_runtime, app_system;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime, app_system;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO app_runtime, app_system;
--> statement-breakpoint

ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "api_keys" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attachments" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_log" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "automation_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "automation_rules" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "booking_change_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_change_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "booking_change_requests" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "booking_option_selections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_option_selections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "booking_option_selections" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bookings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bookings" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "catalog_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog_items" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "company_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "company_settings" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "custom_field_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_values" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "custom_field_values" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "custom_fields" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_fields" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "custom_fields" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "deficiencies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deficiencies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deficiencies" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "email_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "email_templates" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "entity_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "entity_tags" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "entity_tags" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "form_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "form_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "form_categories" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "intake_forms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intake_forms" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "intake_forms" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "intake_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intake_submissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "intake_submissions" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integrations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "integrations" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invoices" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "job_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "job_events" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "job_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_photos" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "job_photos" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "maintenance_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maintenance_plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "maintenance_plans" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "memberships" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "messages" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "notification_channels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_channels" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notification_channels" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notification_deliveries" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "notification_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notification_rules" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notifications" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "option_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "option_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "option_categories" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "option_category_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "option_category_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "option_category_items" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "payment_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_ledger" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payment_ledger" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "payouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payouts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payouts" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "properties" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "properties" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "punchlist_projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "punchlist_projects" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "punchlist_projects" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "punchlist_trades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "punchlist_trades" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "punchlist_trades" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "push_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "push_tokens" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reviews" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reviews" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "riders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "riders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "riders" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "scheduled_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scheduled_tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "scheduled_tasks" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "service_zones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_zones" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "service_zones" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "services" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "services" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "skill_library" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skill_library" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "skill_library" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tags" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tags" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "task_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "task_templates" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "tech_invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tech_invites" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tech_invites" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "tech_shifts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tech_shifts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tech_shifts" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "tenant_email_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_email_domains" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_email_domains" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "tracking_pings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tracking_pings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tracking_pings" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "webhook_endpoints" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "user" FOR ALL USING (
  company_id = current_setting('app.tenant_id', true)
  OR EXISTS (
    SELECT 1 FROM "memberships" m
    WHERE m."user_id" = "user"."id"
      AND m."company_id" = current_setting('app.tenant_id', true)
  )
) WITH CHECK (
  company_id = current_setting('app.tenant_id', true)
  OR EXISTS (
    SELECT 1 FROM "memberships" m
    WHERE m."user_id" = "user"."id"
      AND m."company_id" = current_setting('app.tenant_id', true)
  )
);
--> statement-breakpoint
