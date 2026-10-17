CREATE TABLE "contact_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'homepage' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"hubspot_contact_id" text,
	"hubspot_status" text DEFAULT 'pending' NOT NULL,
	"hubspot_error" text DEFAULT '' NOT NULL,
	"email_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "contact_requests_created_idx" ON "contact_requests" USING btree ("created_at");--> statement-breakpoint
-- Global marketing leads: RLS on with no policy, so app_runtime (tenant traffic) sees nothing;
-- only app_system (BYPASSRLS, the `sdb` connection) reads and writes this table.
ALTER TABLE "contact_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contact_requests" FORCE ROW LEVEL SECURITY;
