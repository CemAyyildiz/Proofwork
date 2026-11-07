CREATE TYPE "public"."sealed_review_status" AS ENUM('draft', 'open', 'revealing', 'cleared', 'finalizing', 'finalized', 'expired', 'failed');--> statement-breakpoint
CREATE TABLE "sealed_review_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"sealed_review_id" text NOT NULL,
	"reviewer_pubkey" text NOT NULL,
	"commitment" text,
	"commit_tx_hash" text,
	"reveal_tx_hash" text,
	"revealed_review" jsonb,
	"committed_at" timestamp with time zone,
	"revealed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sealed_review" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"status" "sealed_review_status" DEFAULT 'draft' NOT NULL,
	"item_ref" text NOT NULL,
	"schema_ref" text NOT NULL,
	"contract_id" text,
	"round_id" text,
	"reveal_round" integer NOT NULL,
	"commit_deadline" timestamp with time zone NOT NULL,
	"reveal_deadline" timestamp with time zone NOT NULL,
	"auditor_pubkey" text NOT NULL,
	"operator_pubkey" text NOT NULL,
	"create_tx_hash" text,
	"clear_tx_hash" text,
	"receipt_json" text,
	"receipt_sha256" text,
	"receipt_verified" boolean DEFAULT false NOT NULL,
	"final_decision_id" text,
	"failure_code" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sealed_review_submission_id_unique" UNIQUE("submission_id")
);
--> statement-breakpoint
ALTER TABLE "sealed_review_assignment" ADD CONSTRAINT "sealed_review_assignment_sealed_review_id_sealed_review_id_fk" FOREIGN KEY ("sealed_review_id") REFERENCES "public"."sealed_review"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_review" ADD CONSTRAINT "sealed_review_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_review" ADD CONSTRAINT "sealed_review_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_review" ADD CONSTRAINT "sealed_review_final_decision_id_decision_id_fk" FOREIGN KEY ("final_decision_id") REFERENCES "public"."decision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sealed_review_assignment_unique_idx" ON "sealed_review_assignment" USING btree ("sealed_review_id","reviewer_pubkey");--> statement-breakpoint
CREATE INDEX "sealed_review_assignment_reviewer_idx" ON "sealed_review_assignment" USING btree ("reviewer_pubkey");--> statement-breakpoint
CREATE INDEX "sealed_review_campaign_idx" ON "sealed_review" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sealed_review_round_idx" ON "sealed_review" USING btree ("contract_id","round_id");