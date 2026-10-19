ALTER TABLE "memberships" ADD COLUMN "property_id" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "unit" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "manager_id" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_manager_id_user_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_company_property_idx" ON "memberships" USING btree ("company_id","property_id");--> statement-breakpoint
CREATE INDEX "prop_manager_idx" ON "properties" USING btree ("company_id","manager_id");