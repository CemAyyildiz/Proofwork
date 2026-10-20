import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { payouts, submissions } from "@/db/schema";
import { countSubmissions, type CountRow, type SubmissionCounts } from "@/domain/campaign-status";

/**
 * Submission and payout counts for each of `campaignIds`, read in one query.
 * A campaign without submissions gets all-zero counts. Takes its connection
 * and does not import "server-only", so `access.ts` (which the role script
 * also runs) can use it.
 */
export async function countSubmissionsByCampaign(campaignIds: readonly string[], conn: Db): Promise<Map<string, SubmissionCounts>> {
  const out = new Map<string, SubmissionCounts>();
  if (campaignIds.length === 0) return out;
  const rows = await conn
    .select({ campaignId: submissions.campaignId, status: submissions.status, payoutStatus: payouts.status, payoutAmount: payouts.amount })
    .from(submissions)
    .leftJoin(payouts, eq(payouts.submissionId, submissions.id))
    .where(inArray(submissions.campaignId, [...campaignIds]));
  const byCampaign = new Map<string, CountRow[]>(campaignIds.map((id) => [id, []]));
  for (const r of rows) byCampaign.get(r.campaignId)?.push(r);
  for (const [id, list] of byCampaign) out.set(id, countSubmissions(list));
  return out;
}
