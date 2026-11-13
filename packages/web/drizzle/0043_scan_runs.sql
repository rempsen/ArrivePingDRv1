CREATE TABLE "scan_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT '' NOT NULL,
	"host" text DEFAULT '' NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"via" text DEFAULT '' NOT NULL,
	"http_status" integer,
	"pages_read" integer DEFAULT 0 NOT NULL,
	"ms" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "scan_runs_created_idx" ON "scan_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "scan_runs_company_idx" ON "scan_runs" USING btree ("company_id","created_at");