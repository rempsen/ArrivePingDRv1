ALTER TABLE "tech_invites" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "tech_invites" ADD COLUMN "role" text DEFAULT 'rider' NOT NULL;--> statement-breakpoint
ALTER TABLE "tech_invites" ADD COLUMN "staff_type" text DEFAULT 'technician' NOT NULL;