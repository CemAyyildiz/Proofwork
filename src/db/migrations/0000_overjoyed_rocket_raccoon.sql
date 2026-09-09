CREATE TYPE "public"."decision_outcome" AS ENUM('PASS', 'FAIL');--> statement-breakpoint
CREATE TYPE "public"."escrow_op_kind" AS ENUM('deploy', 'fund', 'append_milestones', 'mark_delivered', 'approve', 'release', 'dispute', 'resolve', 'withdraw_remaining');--> statement-breakpoint
CREATE TYPE "public"."escrow_op_status" AS ENUM('intent', 'submitted', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('milestone_added', 'delivered', 'approved', 'released', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reason_code" AS ENUM('R00_PASS', 'R01_ACCOUNT', 'R02_ORIGINAL', 'R03_TASK', 'R04_BRIEF', 'R05_MULTI', 'R06_SPAM');--> statement-breakpoint
CREATE TYPE "public"."role_name" AS ENUM('funder', 'reviewer', 'ops');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'decided', 'appealed', 'paid', 'rejected');--> statement-breakpoint
CREATE TABLE "auth_nonce" (
	"nonce" text PRIMARY KEY NOT NULL,
	"pubkey" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"reward_amount" numeric(18, 7) NOT NULL,
	"budget" numeric(18, 7) NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"funder_pubkey" text NOT NULL,
	"dispute_resolver_pubkey" text NOT NULL,
	"escrow_contract_id" text,
	"funded_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"remainder_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_slug_unique" UNIQUE("slug"),
	CONSTRAINT "campaign_escrow_contract_id_unique" UNIQUE("escrow_contract_id")
);
--> statement-breakpoint
CREATE TABLE "decision" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"reviewer_pubkey" text NOT NULL,
	"outcome" "decision_outcome" NOT NULL,
	"reason_code" "reason_code" NOT NULL,
	"signals" jsonb NOT NULL,
	"note" text NOT NULL,
	"appeal_of" text,
	"canonical_json" text NOT NULL,
	"decision_hash" text NOT NULL,
	"ledger_key" text NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escrow_op" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"kind" "escrow_op_kind" NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "escrow_op_status" DEFAULT 'intent' NOT NULL,
	"tx_hash" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "escrow_op_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "payout" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"milestone_index" integer,
	"amount" numeric(18, 7) NOT NULL,
	"status" "payout_status" NOT NULL,
	"release_tx_hash" text,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_submission_id_unique" UNIQUE("submission_id")
);
--> statement-breakpoint
CREATE TABLE "review_time" (
	"decision_id" text PRIMARY KEY NOT NULL,
	"seconds_total" integer NOT NULL,
	"seconds_per_signal" jsonb NOT NULL,
	"blind" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_grant" (
	"pubkey" text NOT NULL,
	"role" "role_name" NOT NULL,
	"campaign_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission" (
	"id" text PRIMARY KEY NOT NULL,
	"short_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"contributor_pubkey" text NOT NULL,
	"work_url" text NOT NULL,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_short_id_unique" UNIQUE("short_id")
);
--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_op" ADD CONSTRAINT "escrow_op_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout" ADD CONSTRAINT "payout_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_time" ADD CONSTRAINT "review_time_decision_id_decision_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_submission_idx" ON "decision" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "escrow_op_campaign_idx" ON "escrow_op" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "escrow_op_status_idx" ON "escrow_op" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payout_status_idx" ON "payout" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "role_grant_unique_idx" ON "role_grant" USING btree ("pubkey","role",coalesce("campaign_id", ''));--> statement-breakpoint
CREATE INDEX "submission_campaign_idx" ON "submission" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_campaign_contributor_idx" ON "submission" USING btree ("campaign_id","contributor_pubkey");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_work_url_idx" ON "submission" USING btree ("work_url");