CREATE TABLE "job_form_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"booking_id" text NOT NULL,
	"template_version_id" text NOT NULL,
	"answers" text DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"answered_count" integer DEFAULT 0 NOT NULL,
	"flagged_count" integer DEFAULT 0 NOT NULL,
	"missing_count" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_by" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"template_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"form" text DEFAULT '' NOT NULL,
	"rate_model" text DEFAULT '' NOT NULL,
	"tech_pay_model" text DEFAULT '' NOT NULL,
	"collect_payment" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "template_version_id" text;--> statement-breakpoint
ALTER TABLE "job_photos" ADD COLUMN "form_item_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_templates" ADD COLUMN "form" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_templates" ADD COLUMN "current_version_id" text;--> statement-breakpoint
ALTER TABLE "task_templates" ADD COLUMN "send_customer_copy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task_templates" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_templates" ADD COLUMN "updated_by" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_form_responses" ADD CONSTRAINT "job_form_responses_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobform_company_idx" ON "job_form_responses" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobform_booking_version_uq" ON "job_form_responses" USING btree ("booking_id","template_version_id");--> statement-breakpoint
CREATE INDEX "tplver_company_idx" ON "template_versions" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tplver_template_version_uq" ON "template_versions" USING btree ("template_id","version");--> statement-breakpoint
ALTER TABLE "template_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "template_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "template_versions" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));--> statement-breakpoint
ALTER TABLE "job_form_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_form_responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "job_form_responses" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
