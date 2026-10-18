CREATE TABLE "custom_milestone_fires" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"milestone_id" text NOT NULL,
	"booking_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_milestones" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"trigger_event" text DEFAULT '' NOT NULL,
	"checklist_label" text DEFAULT '' NOT NULL,
	"offset_minutes" integer DEFAULT 0 NOT NULL,
	"customer_timeline" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "custom_milestone_fire_company_idx" ON "custom_milestone_fires" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_milestone_fire_once_uidx" ON "custom_milestone_fires" USING btree ("milestone_id","booking_id");--> statement-breakpoint
CREATE INDEX "custom_milestone_company_idx" ON "custom_milestones" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "custom_milestones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "custom_milestones" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "custom_milestones" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "custom_milestone_fires" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "custom_milestone_fires" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "custom_milestone_fires" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
