ALTER TABLE "submission" ADD COLUMN "post_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "submission_post_id_idx" ON "submission" USING btree ("post_id");--> statement-breakpoint
-- Backfill for rows stored before the column existed: the post ID is the
-- number that ends the canonical link (https://x.com/<handle>/status/<id>).
-- An ID carried by more than one row (one post under two handle spellings) is
-- left null on all of them, so the unique index can never fail on that data.
UPDATE "submission" AS s
SET "post_id" = u."pid"
FROM (
	SELECT substring("work_url" from '/status/([1-9][0-9]{0,18})$') AS "pid"
	FROM "submission"
	GROUP BY 1
	HAVING count(*) = 1
) AS u
WHERE u."pid" IS NOT NULL
	AND substring(s."work_url" from '/status/([1-9][0-9]{0,18})$') = u."pid";
