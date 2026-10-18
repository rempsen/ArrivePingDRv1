-- Already applied to production on 2026-10-17 (as "platform_analytics"); written
-- with IF NOT EXISTS so running it again is harmless.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "is_internal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifdeliv_created_idx" ON "notification_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_updatedAt_idx" ON "session" USING btree ("updated_at");--> statement-breakpoint
-- Start with the tenants that are plainly not customers: ArrivePing's own
-- tenant, the self-refreshing sales demo, NVC360's signup test, and the
-- test / app-review accounts. Superadmins change any of these in Analytics.
UPDATE "companies" SET "is_internal" = true WHERE "id" IN ('default', 'prairie-comfort-hvac', 'nvc360', 'test-sunny-sitters', 'e2e-test-plumbing', 'arriveping-review-co');
