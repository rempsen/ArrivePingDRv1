ALTER TABLE "bookings" ADD COLUMN "is_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "sample_data" text;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "is_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_sample_idx" ON "bookings" ("company_id") WHERE "is_sample";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "riders_sample_idx" ON "riders" ("company_id") WHERE "is_sample";
