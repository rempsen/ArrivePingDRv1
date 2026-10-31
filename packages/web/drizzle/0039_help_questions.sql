CREATE TABLE "help_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"platform" text DEFAULT '' NOT NULL,
	"question" text NOT NULL,
	"matched" text DEFAULT '' NOT NULL,
	"answer_chars" integer DEFAULT 0 NOT NULL,
	"handed_off" boolean DEFAULT false NOT NULL,
	"failed" boolean DEFAULT false NOT NULL,
	"rating" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "help_questions_created_idx" ON "help_questions" USING btree ("created_at");