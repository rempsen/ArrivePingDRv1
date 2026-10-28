ALTER TABLE "riders" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
-- Until now the app's check-ins stamped location_updated_at, so that is the
-- best record of when each phone was last seen. Keeps presence steady at deploy.
UPDATE "riders" SET "last_seen_at" = "location_updated_at" WHERE "last_seen_at" IS NULL;
