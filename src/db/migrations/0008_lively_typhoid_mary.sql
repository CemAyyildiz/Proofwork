CREATE UNIQUE INDEX "sealed_review_assignment_commit_tx_idx" ON "sealed_review_assignment" USING btree ("commit_tx_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sealed_review_assignment_reveal_tx_idx" ON "sealed_review_assignment" USING btree ("reveal_tx_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sealed_review_create_tx_idx" ON "sealed_review" USING btree ("create_tx_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sealed_review_clear_tx_idx" ON "sealed_review" USING btree ("clear_tx_hash");