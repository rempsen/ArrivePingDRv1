ALTER TABLE "companies" ADD COLUMN "hubspot_company_id" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "hubspot_deal_id" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "hubspot_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "hubspot_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "hubspot_contact_id" text;