CREATE TABLE "decision_intent" (
	"submission_id" text PRIMARY KEY NOT NULL,
	"reviewer_pubkey" text NOT NULL,
	"canonical_json" text NOT NULL,
	"input" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decision_intent" ADD CONSTRAINT "decision_intent_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;