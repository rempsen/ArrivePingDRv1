ALTER TABLE "company_settings" ADD COLUMN "logo_plate" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "logo_plate_auto" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "logo_plate_for" text DEFAULT '' NOT NULL;