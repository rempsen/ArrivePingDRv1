CREATE TABLE "site_crawls" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"pages" text DEFAULT '[]' NOT NULL,
	"structured" text DEFAULT 'null' NOT NULL,
	"excerpts" text DEFAULT '' NOT NULL,
	"proposal" text DEFAULT '{}' NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'signup' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "site_crawls_company_idx" ON "site_crawls" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "site_crawls" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "site_crawls" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "site_crawls" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
