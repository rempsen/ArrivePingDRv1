ALTER TABLE "companies" ADD COLUMN "billing_customer_id" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "billing_subscription_id" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "billing_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "billing_trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "billing_seats" integer DEFAULT 0 NOT NULL;