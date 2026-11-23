ALTER TABLE "decision_intent" ADD COLUMN "tx_hash" text;--> statement-breakpoint
ALTER TABLE "decision_intent" ADD COLUMN "envelope_xdr" text;--> statement-breakpoint
ALTER TABLE "decision_intent" ADD COLUMN "envelope_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_first_pass_idx" ON "decision" USING btree ("submission_id") WHERE "decision"."appeal_of" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_appeal_idx" ON "decision" USING btree ("submission_id") WHERE "decision"."appeal_of" is not null;