CREATE TABLE "company_history" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"seq" bigserial NOT NULL,
	"company_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"billing_status" text DEFAULT 'none' NOT NULL,
	"billing_seats" integer DEFAULT 0 NOT NULL,
	"billing_trial_ends_at" timestamp with time zone,
	"industry" text,
	"is_internal" boolean DEFAULT false NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'live' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "technician_history" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"seq" bigserial NOT NULL,
	"rider_id" text NOT NULL,
	"company_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean NOT NULL,
	"source" text DEFAULT 'live' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "company_history_company_at_idx" ON "company_history" USING btree ("company_id","at");--> statement-breakpoint
CREATE INDEX "company_history_at_idx" ON "company_history" USING btree ("at");--> statement-breakpoint
CREATE INDEX "technician_history_rider_at_idx" ON "technician_history" USING btree ("rider_id","at");--> statement-breakpoint
CREATE INDEX "technician_history_company_at_idx" ON "technician_history" USING btree ("company_id","at");--> statement-breakpoint
-- Platform-only history: RLS on with no policy, so the tenant runtime role
-- can neither read nor write it. The triggers below write as the owner.
ALTER TABLE "company_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "technician_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Backfill: each company's state at signup. A company that has since moved
-- off a trial (paying, cancelled) started on one, so its signup row says
-- trialing and a second row, below, records where it is now.
INSERT INTO "company_history" ("company_id", "at", "name", "status", "billing_status", "billing_seats", "billing_trial_ends_at", "industry", "is_internal", "source")
SELECT c."id", c."created_at", c."name", 'active',
  CASE WHEN c."billing_trial_ends_at" IS NOT NULL THEN 'trialing' ELSE c."billing_status" END,
  c."billing_seats", c."billing_trial_ends_at", c."industry", c."is_internal", 'backfill'
FROM "companies" c;
--> statement-breakpoint
INSERT INTO "company_history" ("company_id", "at", "name", "status", "billing_status", "billing_seats", "billing_trial_ends_at", "industry", "is_internal", "source")
SELECT c."id",
  GREATEST(c."created_at" + interval '1 second', COALESCE(
    CASE WHEN c."billing_status" IN ('active', 'past_due') AND c."billing_trial_ends_at" <= now() THEN c."billing_trial_ends_at" END,
    c."updated_at", now())),
  c."name", c."status", c."billing_status", c."billing_seats", c."billing_trial_ends_at", c."industry", c."is_internal", 'backfill'
FROM "companies" c
WHERE c."status" <> 'active'
   OR (c."billing_trial_ends_at" IS NOT NULL AND c."billing_status" <> 'trialing');
--> statement-breakpoint
INSERT INTO "technician_history" ("rider_id", "company_id", "at", "active", "source")
SELECT r."id", r."company_id", r."created_at", (r."approval" = 'active' AND NOT r."is_sample"), 'backfill'
FROM "riders" r;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION record_company_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO company_history (company_id, at, name, status, billing_status, billing_seats, billing_trial_ends_at, industry, is_internal, removed)
    VALUES (OLD.id, clock_timestamp(), OLD.name, OLD.status, OLD.billing_status, OLD.billing_seats, OLD.billing_trial_ends_at, OLD.industry, OLD.is_internal, true);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.billing_status IS NOT DISTINCT FROM OLD.billing_status
     AND NEW.billing_seats IS NOT DISTINCT FROM OLD.billing_seats
     AND NEW.billing_trial_ends_at IS NOT DISTINCT FROM OLD.billing_trial_ends_at
     AND NEW.industry IS NOT DISTINCT FROM OLD.industry
     AND NEW.is_internal IS NOT DISTINCT FROM OLD.is_internal THEN
    RETURN NEW;
  END IF;
  INSERT INTO company_history (company_id, at, name, status, billing_status, billing_seats, billing_trial_ends_at, industry, is_internal)
  VALUES (NEW.id, clock_timestamp(), NEW.name, NEW.status, NEW.billing_status, NEW.billing_seats, NEW.billing_trial_ends_at, NEW.industry, NEW.is_internal);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER company_history_trg AFTER INSERT OR UPDATE OR DELETE ON "companies"
FOR EACH ROW EXECUTE FUNCTION record_company_history();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION record_technician_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  was boolean := false;
  now_on boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    was := (OLD.approval = 'active' AND NOT OLD.is_sample);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    now_on := (NEW.approval = 'active' AND NOT NEW.is_sample);
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO technician_history (rider_id, company_id, at, active) VALUES (NEW.id, NEW.company_id, clock_timestamp(), now_on);
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF was THEN
      INSERT INTO technician_history (rider_id, company_id, at, active) VALUES (OLD.id, OLD.company_id, clock_timestamp(), false);
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    IF was THEN
      INSERT INTO technician_history (rider_id, company_id, at, active) VALUES (OLD.id, OLD.company_id, clock_timestamp(), false);
    END IF;
    INSERT INTO technician_history (rider_id, company_id, at, active) VALUES (NEW.id, NEW.company_id, clock_timestamp(), now_on);
  ELSIF was IS DISTINCT FROM now_on THEN
    INSERT INTO technician_history (rider_id, company_id, at, active) VALUES (NEW.id, NEW.company_id, clock_timestamp(), now_on);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER technician_history_trg AFTER INSERT OR UPDATE OR DELETE ON "riders"
FOR EACH ROW EXECUTE FUNCTION record_technician_history();
