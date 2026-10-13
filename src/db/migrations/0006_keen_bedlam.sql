CREATE TYPE "public"."access_action" AS ENUM('grant', 'revoke');--> statement-breakpoint
CREATE TYPE "public"."access_via" AS ENUM('admin', 'script');--> statement-breakpoint
CREATE TYPE "public"."funder_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "access_log" (
	"id" text PRIMARY KEY NOT NULL,
	"pubkey" text NOT NULL,
	"role" "role_name" NOT NULL,
	"action" "access_action" NOT NULL,
	"actor_pubkey" text,
	"via" "access_via" NOT NULL,
	"campaign_id" text,
	"request_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funder_request" (
	"id" text PRIMARY KEY NOT NULL,
	"pubkey" text NOT NULL,
	"team" text NOT NULL,
	"note" text NOT NULL,
	"status" "funder_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text
);
--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_request_id_funder_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."funder_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_log_at_idx" ON "access_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "funder_request_pending_idx" ON "funder_request" USING btree ("pubkey") WHERE "funder_request"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "funder_request_pubkey_idx" ON "funder_request" USING btree ("pubkey");