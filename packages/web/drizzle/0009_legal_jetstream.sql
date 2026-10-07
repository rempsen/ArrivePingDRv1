ALTER TABLE "automation_rules" ADD COLUMN "mode" text DEFAULT 'suggest' NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD COLUMN "template_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "auto_assigned_rule_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "auto_assigned_at" timestamp with time zone;