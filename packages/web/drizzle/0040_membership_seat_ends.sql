ALTER TABLE "memberships" ADD COLUMN "seat_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "seat_ends_reassign_to" text;