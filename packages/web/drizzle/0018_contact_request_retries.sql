ALTER TABLE "contact_requests" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_requests" ADD COLUMN "last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "contact_requests_retry_idx" ON "contact_requests" USING btree ("email_status","hubspot_status");