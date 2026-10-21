CREATE TABLE "onboarding_chats" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text DEFAULT 'default' NOT NULL,
	"user_id" text DEFAULT '' NOT NULL,
	"client_key" text NOT NULL,
	"finished" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_chats_company_key_idx" ON "onboarding_chats" USING btree ("company_id","client_key");--> statement-breakpoint
CREATE INDEX "onboarding_chats_updated_idx" ON "onboarding_chats" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "onboarding_chats" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "onboarding_chats" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "onboarding_chats" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
CREATE TABLE "onboarding_chat_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL CONSTRAINT "onboarding_chat_turns_chat_id_onboarding_chats_id_fk" REFERENCES "onboarding_chats"("id") ON DELETE cascade,
	"company_id" text DEFAULT 'default' NOT NULL,
	"seq" integer NOT NULL,
	"user_message" text DEFAULT '' NOT NULL,
	"assistant_message" text DEFAULT '' NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"finished" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_chat_turns_chat_seq_idx" ON "onboarding_chat_turns" USING btree ("chat_id","seq");--> statement-breakpoint
CREATE INDEX "onboarding_chat_turns_company_idx" ON "onboarding_chat_turns" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "onboarding_chat_turns" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "onboarding_chat_turns" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "onboarding_chat_turns" FOR ALL USING (company_id = current_setting('app.tenant_id', true)) WITH CHECK (company_id = current_setting('app.tenant_id', true));
