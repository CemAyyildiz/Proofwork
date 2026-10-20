import type { Campaign, Payout, Submission } from "@/db/schema";
import { addAmounts } from "@/escrow/amount";

/**
 * Where a campaign stands. Derived from chain-confirmed columns only
 * (`escrow_contract_id`, `funded_at`, `closed_at` and `remainder_tx_hash` are
 * each written after their transaction confirmed) plus submission and payout
 * counts:
 *
 *   draft → awaiting_funding → open → reviewing_and_paying ⇄ ready_to_close
 *         → closed_awaiting_return → settled
 *
 * `abandoned` is a deployed campaign closed before any budget went in: it
 * has no remainder to return, so it is neither of the closed stages.
 */
export type CampaignStage =
  | "draft"
  | "awaiting_funding"
  | "open"
  | "reviewing_and_paying"
  | "ready_to_close"
  | "closed_awaiting_return"
  | "settled"
  | "abandoned";

export type StageFields = Pick<Campaign, "escrowContractId" | "fundedAt" | "closedAt" | "remainderTxHash" | "deadlineAt">;

/** What the funder's table and the list count, per campaign. Amounts are USDC decimal strings. */
export interface SubmissionCounts {
  total: number;
  /** pending or appealed: a reviewer still has to decide. */
  inReview: number;
  /** Passed the rubric, not yet approved on chain (no payout, one stopped before approval, or a failed one). */
  readyToPay: number;
  /** Of `readyToPay`: a payout run started on chain and stopped before approval. Approving again finishes it. */
  unfinished: number;
  /** Approved on chain, waiting for the funder's release signature. */
  awaitingSignature: number;
  paid: number;
  rejected: number;
  /** Sum of released payouts. */
  paidAmount: string;
}

export interface CountRow {
  status: Submission["status"];
  payoutStatus: Payout["status"] | null;
  payoutAmount: string | null;
}

/** Payout states that approving again resumes: the server finishes them from chain state. */
const RESUMABLE: ReadonlySet<Payout["status"] | null> = new Set([null, "milestone_added", "delivered", "failed"]);

/** True when the funder can select this submission to approve for payout. */
export function isReadyToPay(r: Pick<CountRow, "status" | "payoutStatus">): boolean {
  return r.status === "decided" && RESUMABLE.has(r.payoutStatus);
}

export function countSubmissions(rows: readonly CountRow[]): SubmissionCounts {
  let paidAmount = "0";
  const counts = { total: rows.length, inReview: 0, readyToPay: 0, unfinished: 0, awaitingSignature: 0, paid: 0, rejected: 0 };
  for (const r of rows) {
    if (r.status === "pending" || r.status === "appealed") counts.inReview += 1;
    else if (r.status === "rejected") counts.rejected += 1;
    if (r.payoutStatus === "released") {
      counts.paid += 1;
      if (r.payoutAmount) paidAmount = addAmounts(paidAmount, r.payoutAmount);
    } else if (r.payoutStatus === "approved") {
      counts.awaitingSignature += 1;
    } else if (isReadyToPay(r)) {
      counts.readyToPay += 1;
      if (r.payoutStatus === "milestone_added" || r.payoutStatus === "delivered") counts.unfinished += 1;
    }
  }
  return { ...counts, paidAmount };
}

export const NO_SUBMISSIONS: SubmissionCounts = countSubmissions([]);

/** Something still waits on review, approval or release. */
function pending(c: SubmissionCounts): boolean {
  return c.inReview > 0 || c.readyToPay > 0 || c.awaitingSignature > 0;
}

/** True once submissions are shut by the deadline (at the deadline itself included). */
export function deadlinePassed(c: Pick<Campaign, "deadlineAt">, now: Date): boolean {
  return c.deadlineAt.getTime() <= now.getTime();
}

export function campaignStage(c: StageFields, counts: SubmissionCounts, now: Date): CampaignStage {
  if (c.closedAt) {
    if (!c.fundedAt) return "abandoned";
    return c.remainderTxHash ? "settled" : "closed_awaiting_return";
  }
  if (!c.fundedAt) return c.escrowContractId ? "awaiting_funding" : "draft";
  if (!deadlinePassed(c, now)) return "open";
  return pending(counts) ? "reviewing_and_paying" : "ready_to_close";
}

/** Whose move it is. Null when nothing waits on anyone. */
export type StepOwner = "funder" | "reviewer" | "contributors" | "resolver";

export type StepKind =
  | "deploy"
  | "fund"
  /** A draft or unfunded campaign past its deadline: it is not nudged to deploy or fund. */
  | "expired"
  | "release"
  | "approve"
  | "review"
  | "share"
  | "collect"
  | "close"
  | "remainder"
  | "done";

export interface NextStep {
  kind: StepKind;
  /** Submissions the step covers, for release, approve and review. */
  count?: number;
  owner: StepOwner | null;
}

/**
 * The one next step and whose it is. Payouts come before review: approved
 * money waits on the funder alone.
 */
export function nextStep(stage: CampaignStage, c: Pick<Campaign, "deadlineAt">, counts: SubmissionCounts, now: Date): NextStep {
  switch (stage) {
    case "draft":
    case "awaiting_funding":
      if (deadlinePassed(c, now)) return { kind: "expired", owner: null };
      return { kind: stage === "draft" ? "deploy" : "fund", owner: "funder" };
    case "closed_awaiting_return":
      return { kind: "remainder", owner: "resolver" };
    case "settled":
    case "abandoned":
      return { kind: "done", owner: null };
    case "ready_to_close":
      return { kind: "close", owner: "funder" };
    case "open":
    case "reviewing_and_paying":
      if (counts.awaitingSignature > 0) return { kind: "release", count: counts.awaitingSignature, owner: "funder" };
      if (counts.readyToPay > 0) return { kind: "approve", count: counts.readyToPay, owner: "funder" };
      if (counts.inReview > 0) return { kind: "review", count: counts.inReview, owner: "reviewer" };
      return { kind: counts.total === 0 ? "share" : "collect", owner: "contributors" };
  }
}

/**
 * Why Close is not available yet, in the order the funder has to clear them.
 * Mirrors the server's close guard: a live payout lease, submissions in
 * review, and payouts started but not released. Passes the funder chose not
 * to pay do not block; their money comes back with the remainder.
 */
export type CloseBlocker =
  | { kind: "lease" }
  | { kind: "review"; count: number }
  | { kind: "unfinished"; count: number }
  | { kind: "release"; count: number };

const CLOSABLE: ReadonlySet<CampaignStage> = new Set(["open", "reviewing_and_paying", "ready_to_close"]);

export function closeBlockers(stage: CampaignStage, c: Pick<Campaign, "payoutLockUntil">, counts: SubmissionCounts, now: Date): CloseBlocker[] {
  if (!CLOSABLE.has(stage)) return [];
  const out: CloseBlocker[] = [];
  if (c.payoutLockUntil !== null && c.payoutLockUntil.getTime() > now.getTime()) out.push({ kind: "lease" });
  if (counts.inReview > 0) out.push({ kind: "review", count: counts.inReview });
  if (counts.unfinished > 0) out.push({ kind: "unfinished", count: counts.unfinished });
  if (counts.awaitingSignature > 0) out.push({ kind: "release", count: counts.awaitingSignature });
  return out;
}
