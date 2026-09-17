ALTER TABLE "campaign" ADD COLUMN "payout_lock_token" text;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "payout_lock_until" timestamp with time zone;