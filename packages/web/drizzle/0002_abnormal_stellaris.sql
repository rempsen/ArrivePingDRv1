ALTER TABLE "companies" ADD COLUMN "office_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "office_lat" real;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "office_lng" real;