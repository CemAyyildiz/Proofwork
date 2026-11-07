ALTER TABLE "campaign" ADD COLUMN "release_signer_pubkey" text;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "founder_sealed_review" boolean DEFAULT false NOT NULL;