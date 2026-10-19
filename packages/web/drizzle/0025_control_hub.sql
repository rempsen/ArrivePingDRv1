CREATE TABLE "act_as_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_name" text DEFAULT '' NOT NULL,
	"target_user_id" text NOT NULL,
	"target_name" text DEFAULT '' NOT NULL,
	"company_id" text NOT NULL,
	"reason" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_reason" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text DEFAULT '' NOT NULL,
	"actor_name" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"company_id" text DEFAULT '' NOT NULL,
	"entity_type" text DEFAULT '' NOT NULL,
	"entity_id" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"meta" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_staff" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"added_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_feature_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"feature_key" text NOT NULL,
	"enabled" boolean NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone,
	"set_by" text DEFAULT '' NOT NULL,
	"set_by_name" text DEFAULT '' NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "support_actor_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "support_actor_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "kind" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "demo_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "allow_support_access" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "act_as_sessions_actor_idx" ON "act_as_sessions" USING btree ("actor_user_id","ended_at");--> statement-breakpoint
CREATE INDEX "act_as_sessions_company_idx" ON "act_as_sessions" USING btree ("company_id","started_at");--> statement-breakpoint
CREATE INDEX "platform_audit_created_idx" ON "platform_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_company_idx" ON "platform_audit" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_actor_idx" ON "platform_audit" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_feature_overrides_company_key_uidx" ON "tenant_feature_overrides" USING btree ("company_id","feature_key");--> statement-breakpoint
-- Platform-only Control Hub tables: RLS on with no policy, so the tenant
-- runtime role can neither read nor write them; the system connection
-- (app_system, BYPASSRLS) is the only way in.
ALTER TABLE "platform_staff" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_feature_overrides" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "act_as_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "platform_audit" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Tenant kinds from what we know today. The platform's own tenant is
-- internal; tenants already marked "test" stay test, except the sales demo,
-- which becomes a demo. Everyone else is a customer. is_internal is
-- unchanged, so analytics and the history trigger see no difference.
UPDATE "companies" SET "kind" = 'internal' WHERE "id" = 'default';
--> statement-breakpoint
UPDATE "companies" SET "kind" = 'test' WHERE "is_internal" AND "id" <> 'default';
--> statement-breakpoint
UPDATE "companies" SET "kind" = 'demo' WHERE "is_internal" AND "id" <> 'default' AND "name" ILIKE 'Prairie Comfort%';
--> statement-breakpoint
-- Everyone who is a super admin today becomes a Control Hub owner, so nobody
-- loses access. Owners trim the list from Control Hub → Team.
INSERT INTO "platform_staff" ("user_id", "role", "added_by")
SELECT u."id", 'owner', 'migration' FROM "user" u WHERE u."role" = 'superadmin'
ON CONFLICT ("user_id") DO NOTHING;
