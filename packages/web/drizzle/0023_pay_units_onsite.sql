ALTER TABLE "bookings" ADD COLUMN "mileage_to_job_km" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "mileage_return_km" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "tech_pay_model" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "collect_payment" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "distance_unit" text DEFAULT 'metric' NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "mileage_pay" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "flat_pay" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "riders" ADD COLUMN "pay_rate_per_km" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "task_templates" ADD COLUMN "tech_pay_model" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_templates" ADD COLUMN "collect_payment" text DEFAULT '' NOT NULL;