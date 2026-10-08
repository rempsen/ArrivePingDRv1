ALTER TABLE "tracking_pings" ALTER COLUMN "lat" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "tracking_pings" ALTER COLUMN "lng" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "route_snapped" text;