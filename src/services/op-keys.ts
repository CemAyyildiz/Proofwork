/**
 * Idempotency key parts for per-submission escrow ops. Shared by the payout
 * pipeline that writes them and the evidence dump that maps them back to a
 * submission, so the two cannot drift. No "server-only": scripts import it.
 */
export function deliverKeyParts(campaignId: string, submissionId: string): Array<string | number> {
  return ["deliver", campaignId, submissionId];
}

export function approveKeyParts(campaignId: string, submissionId: string): Array<string | number> {
  return ["approve", campaignId, submissionId];
}
