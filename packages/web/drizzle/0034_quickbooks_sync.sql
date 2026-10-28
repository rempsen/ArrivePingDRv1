CREATE TABLE "oauth_states" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_id" text NOT NULL,
	"provider" text NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qbo_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"booking_id" text,
	"kind" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "qbo_links" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"kind" text NOT NULL,
	"local_id" text NOT NULL,
	"qbo_id" text NOT NULL,
	"sync_token" text DEFAULT '' NOT NULL,
	"fingerprint" text DEFAULT '' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "vendor_bill_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "subtrade_paid_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "qbo_issues_company_idx" ON "qbo_issues" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "qbo_issues_booking_idx" ON "qbo_issues" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qbo_links_local_uq" ON "qbo_links" USING btree ("company_id","kind","local_id");--> statement-breakpoint
CREATE INDEX "qbo_links_qbo_idx" ON "qbo_links" USING btree ("company_id","kind","qbo_id");--> statement-breakpoint
CREATE INDEX "oauth_states_expires_idx" ON "oauth_states" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "qbo_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "qbo_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "qbo_links" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "qbo_issues" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "qbo_issues" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "qbo_issues" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
