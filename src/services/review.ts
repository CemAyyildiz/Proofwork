import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db/client";
import { campaigns, decisions, payouts, reviewTimes, roleGrants, submissions, type Decision, type Submission } from "@/db/schema";
import { publicFundingSources } from "@/config/env";
import { publicEnv } from "@/config/public-env";
import { evaluate, reasonCodeSchema, SIGNALS, signalsSchema, validateReason, type SignalId } from "@/domain/rubric";
import type { DecisionLedger } from "@/ledger/decision-ledger";
import type { DecisionRecord } from "@/ledger/canonical";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { log } from "@/lib/logger";
import { canManageCampaign } from "./access";
import { rolesFor } from "./auth";
import { closeInFlight } from "./escrow-ops";

/**
 * Blind review queue. The reviewer sees the work URL, a short id and the
 * campaign brief — never the contributor's identity beyond what the URL
 * itself reveals, and never any hint of which submissions were planted
 * (there is no such column, by design).
 */
export interface QueueItem {
  submissionId: string;
  shortId: string;
  workUrl: string;
  submittedAt: Date;
  status: Submission["status"];
  campaign: { id: string; slug: string; title: string; brief: string };
  priorDecision: Decision | null;
  /**
   * Other submissions in the same campaign linked to this one by funding
   * source; null when this wallet's source was not checked. A count only:
   * no address and no id of a linked submission ever reaches the reviewer.
   */
  sharedFundingCount: number | null;
}

/** What the link rule needs from a submission row. */
export type FundingLinkRow = Pick<Submission, "id" | "campaignId" | "contributorPubkey" | "fundingSource">;

/**
 * Two submissions are linked when the same non-public account created both
 * wallets, or one wallet created the other. Callers pass rows of one campaign
 * whose sources are known.
 */
function fundingLinked(a: FundingLinkRow, b: FundingLinkRow, publicSources: ReadonlySet<string>): boolean {
  const shared = (source: string | null, other: string | null): boolean => source !== null && source === other && !publicSources.has(source);
  return shared(a.fundingSource, b.fundingSource) || shared(a.fundingSource, b.contributorPubkey) || shared(b.fundingSource, a.contributorPubkey);
}

/**
 * Shared-funding count per submission id: how many other submissions of the
 * same campaign it is linked to. Null when the submission's own source is
 * unknown ("not checked"); such a row is never counted for another one either.
 * Rows of different campaigns are never compared.
 */
export function sharedFundingCounts(rows: readonly FundingLinkRow[], publicSources: ReadonlySet<string>): Map<string, number | null> {
  const checkedByCampaign = new Map<string, FundingLinkRow[]>();
  for (const r of rows) {
    if (r.fundingSource === null) continue;
    const group = checkedByCampaign.get(r.campaignId);
    if (group) group.push(r);
    else checkedByCampaign.set(r.campaignId, [r]);
  }
  const counts = new Map<string, number | null>();
  for (const r of rows) {
    if (r.fundingSource === null) {
      counts.set(r.id, null);
      continue;
    }
    const peers = checkedByCampaign.get(r.campaignId) ?? [];
    counts.set(r.id, peers.filter((other) => other.id !== r.id && fundingLinked(r, other, publicSources)).length);
  }
  return counts;
}

/** Link counts for every submission of the given campaigns, decided ones included. */
async function campaignFundingCounts(campaignIds: string[], publicSources: ReadonlySet<string>, conn: Db): Promise<Map<string, number | null>> {
  if (campaignIds.length === 0) return new Map();
  const rows = await conn
    .select({ id: submissions.id, campaignId: submissions.campaignId, contributorPubkey: submissions.contributorPubkey, fundingSource: submissions.fundingSource })
    .from(submissions)
    .where(inArray(submissions.campaignId, campaignIds));
  return sharedFundingCounts(rows, publicSources);
}

export async function reviewQueue(conn: Db = db, publicSources: ReadonlySet<string> = publicFundingSources()): Promise<QueueItem[]> {
  const rows = await conn
    .select({ s: submissions, c: campaigns })
    .from(submissions)
    .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
    .where(and(inArray(submissions.status, ["pending", "appealed"]), isNull(campaigns.closedAt)))
    .orderBy(asc(submissions.status), sql`md5(${submissions.id})`); // stable but not chronological: order reveals nothing

  const appealed = rows.filter((r) => r.s.status === "appealed").map((r) => r.s.id);
  const priors = appealed.length
    ? await conn.select().from(decisions).where(inArray(decisions.submissionId, appealed)).orderBy(desc(decisions.decidedAt))
    : [];
  const priorBySub = new Map<string, Decision>();
  for (const d of priors) if (!priorBySub.has(d.submissionId)) priorBySub.set(d.submissionId, d);

  const shared = await campaignFundingCounts([...new Set(rows.map((r) => r.c.id))], publicSources, conn);

  return rows.map((r) => ({
    submissionId: r.s.id,
    shortId: r.s.shortId,
    workUrl: r.s.workUrl,
    submittedAt: r.s.submittedAt,
    status: r.s.status,
    campaign: { id: r.c.id, slug: r.c.slug, title: r.c.title, brief: r.c.brief },
    priorDecision: priorBySub.get(r.s.id) ?? null,
    sharedFundingCount: shared.get(r.s.id) ?? null,
  }));
}

export const decideSchema = z.object({
  submissionId: z.string().min(1),
  signals: signalsSchema,
  reasonCode: reasonCodeSchema,
  note: z.string().trim().min(3).max(1000),
  secondsTotal: z.number().int().min(0).max(24 * 3600),
  secondsPerSignal: z.record(z.string(), z.number().int().min(0)).default({}),
  /** The shared-funding count the card rendered with; null or missing = it showed "not checked". Bounded to fit the column. */
  sharedFundingCount: z.number().int().min(0).max(100_000).nullable().default(null),
});
export type DecideInput = z.infer<typeof decideSchema>;

/**
 * Records a decision and commits it on-chain in the same call. If the chain
 * write fails the decision row is still stored with tx_hash null and the
 * error is surfaced; `retryCommit` can finish it. The submission status
 * only advances once the on-chain reference exists (AD-9).
 *
 * The shared-funding count is the one the card rendered with, posted with the
 * decision and stored beside the review time as given: it is not recomputed
 * here, so the log states what the reviewer saw. It is not part of the record
 * that is hashed and committed, and nothing here derives a signal, outcome or
 * reason from it.
 */
export async function decide(
  input: DecideInput,
  actor: { pubkey: string },
  ledger: DecisionLedger,
  conn: Db = db,
): Promise<Decision> {
  const reason = validateReason(input.signals, input.reasonCode);
  if (!reason.ok) throw AppError.validation(reason.message);
  const { outcome } = evaluate(input.signals);

  const row = (
    await conn
      .select({ s: submissions, c: campaigns })
      .from(submissions)
      .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
      .where(eq(submissions.id, input.submissionId))
      .limit(1)
  )[0];
  if (!row) throw AppError.notFound("submission");
  if (row.c.closedAt) throw AppError.conflict("campaign is closed");
  if (row.s.status !== "pending" && row.s.status !== "appealed") {
    throw AppError.conflict(`submission is ${row.s.status}, not reviewable`);
  }

  const prior = (await conn.select().from(decisions).where(eq(decisions.submissionId, row.s.id)).orderBy(desc(decisions.decidedAt)).limit(1))[0];
  const isAppeal = row.s.status === "appealed";
  if (isAppeal && !prior) throw AppError.conflict("appealed submission has no prior decision");
  if (!isAppeal && prior) throw AppError.conflict("submission already decided");

  const record: DecisionRecord = {
    v: 1,
    submission: row.s.shortId,
    campaign: row.c.slug,
    reviewer: actor.pubkey,
    outcome,
    reason: input.reasonCode,
    signals: input.signals,
    appealOf: isAppeal ? (prior as Decision).decisionHash : null,
    decidedAt: new Date().toISOString(),
  };

  const committed = await ledger.commit(record);

  const id = newId("dec");
  const [decision] = await conn
    .insert(decisions)
    .values({
      id,
      submissionId: row.s.id,
      reviewerPubkey: actor.pubkey,
      outcome,
      reasonCode: input.reasonCode,
      signals: input.signals,
      note: input.note,
      appealOf: isAppeal ? (prior as Decision).id : null,
      canonicalJson: committed.canonicalJson,
      decisionHash: committed.decisionHash,
      ledgerKey: committed.ledgerKey,
      txHash: committed.txHash,
      decidedAt: new Date(record.decidedAt),
    })
    .returning();
  await conn
    .insert(reviewTimes)
    .values({ decisionId: id, secondsTotal: input.secondsTotal, secondsPerSignal: input.secondsPerSignal, blind: true, sharedFundingCount: input.sharedFundingCount });
  await conn
    .update(submissions)
    .set({ status: outcome === "PASS" ? "decided" : "rejected" })
    .where(eq(submissions.id, row.s.id));

  log.info("decision recorded", { decisionId: id, submission: row.s.shortId, outcome, txHash: committed.txHash, appeal: isAppeal });
  return decision as Decision;
}

/** Contributor asks for the one re-review the SOW allows. */
export async function requestAppeal(submissionId: string, actor: { pubkey: string }, conn: Db = db): Promise<void> {
  const row = (
    await conn
      .select({ s: submissions, closedAt: campaigns.closedAt })
      .from(submissions)
      .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
      .where(eq(submissions.id, submissionId))
      .limit(1)
  )[0];
  if (!row) throw AppError.notFound("submission");
  const { s } = row;
  if (s.contributorPubkey !== actor.pubkey) throw AppError.forbidden("not your submission");
  if (row.closedAt) throw AppError.conflict("campaign is closed");
  // The close's confirm would re-reject the appeal without a re-review.
  if (await closeInFlight(s.campaignId, conn)) throw AppError.conflict("campaign is closing");
  if (s.status !== "rejected") throw AppError.conflict("only a rejected submission can be appealed");
  const count = (await conn.select({ n: sql<number>`count(*)::int` }).from(decisions).where(eq(decisions.submissionId, s.id)))[0]?.n ?? 0;
  if (count === 0) throw AppError.conflict("no decision to appeal");
  if (count >= 2) throw AppError.conflict("the one re-review has already been used");
  // Conditional so an appeal racing a close or another appeal cannot land.
  const moved = await conn
    .update(submissions)
    .set({ status: "appealed" })
    .where(
      and(
        eq(submissions.id, s.id),
        eq(submissions.status, "rejected"),
        notExists(conn.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.id, submissions.campaignId), isNotNull(campaigns.closedAt)))),
      ),
    )
    .returning({ id: submissions.id });
  if (moved.length !== 1) throw AppError.conflict("submission changed concurrently; retry");
}

export async function getDecision(id: string, conn: Db = db) {
  const row = (
    await conn
      .select({ d: decisions, s: submissions, c: campaigns })
      .from(decisions)
      .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
      .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
      .where(eq(decisions.id, id))
      .limit(1)
  )[0];
  return row ?? null;
}

/**
 * Review log export (SOW §6.1 Deliverable 2 evidence): one row per decision,
 * re-reviews included, ordered by decision time. Column names are shared by
 * the CSV and JSON forms. There is no planted/genuine column: that list never
 * enters the app and is joined to this export offline (AD-10).
 *
 * `shared_funding_count` is the count the review card showed for the decision:
 * above 0 the card warned, 0 no link was found, empty the source was not checked.
 */
export const REVIEW_LOG_COLUMNS = [
  "campaign_slug",
  "submission_short_id",
  "work_url",
  "contributor_pubkey",
  "decision_id",
  "is_appeal",
  "appeal_of",
  "reviewer_pubkey",
  ...SIGNALS.map((s) => `signal_${s.id}` as const),
  "pass_count",
  "outcome",
  "reason_code",
  "note",
  "decision_hash",
  "ledger_key",
  "tx_hash",
  "explorer_url",
  "decided_at",
  "review_seconds",
  "blind",
  "shared_funding_count",
  "submission_status",
  "payout_status",
  "release_tx_hash",
] as const;

export type ReviewLogColumn = (typeof REVIEW_LOG_COLUMNS)[number];
export type ReviewLogRow = Record<ReviewLogColumn, string | number | boolean | null>;

/**
 * Reviewer (global or for this campaign) or the campaign's own funder; anyone
 * else is refused. Returns whether the caller is that funder. A funder whose
 * access was revoked keeps the log of a campaign it funded (`canManageCampaign`).
 */
async function assertCanReadReviewLog(
  campaign: { id: string; funderPubkey: string; fundedAt: Date | null },
  actor: { pubkey: string },
  conn: Db,
): Promise<{ isFunder: boolean }> {
  const roles = await rolesFor(actor.pubkey, campaign.id, conn);
  const isFunder = canManageCampaign(campaign, { pubkey: actor.pubkey, roles });
  if (isFunder || roles.has("reviewer")) return { isFunder };
  throw AppError.forbidden("review log is for reviewers and the campaign funder");
}

export async function reviewLog(
  campaignId: string,
  actor: { pubkey: string },
  conn: Db = db,
): Promise<{ campaign: { id: string; slug: string }; rows: ReviewLogRow[] }> {
  const c = (await conn.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1))[0];
  if (!c) throw AppError.notFound("campaign");
  const { isFunder } = await assertCanReadReviewLog(c, actor, conn);
  // Review stays blind while the campaign is open: only the funder sees contributor keys before close.
  const showContributor = isFunder || c.closedAt !== null;

  const found = await conn
    .select({ d: decisions, s: submissions, t: reviewTimes, p: payouts })
    .from(decisions)
    .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
    .leftJoin(reviewTimes, eq(reviewTimes.decisionId, decisions.id))
    .leftJoin(payouts, eq(payouts.submissionId, submissions.id))
    .where(eq(submissions.campaignId, c.id))
    .orderBy(asc(decisions.decidedAt), asc(decisions.id));

  const rows = found.map(({ d, s, t, p }): ReviewLogRow => {
    const signal = (id: SignalId): boolean | null => (typeof d.signals[id] === "boolean" ? d.signals[id] : null);
    const signals = Object.fromEntries(SIGNALS.map((x) => [`signal_${x.id}`, signal(x.id)])) as Record<`signal_${SignalId}`, boolean | null>;
    return {
      campaign_slug: c.slug,
      submission_short_id: s.shortId,
      work_url: s.workUrl,
      contributor_pubkey: showContributor ? s.contributorPubkey : null,
      decision_id: d.id,
      is_appeal: d.appealOf !== null,
      appeal_of: d.appealOf,
      reviewer_pubkey: d.reviewerPubkey,
      ...signals,
      pass_count: SIGNALS.filter((x) => d.signals[x.id] === true).length,
      outcome: d.outcome,
      reason_code: d.reasonCode,
      note: d.note,
      decision_hash: d.decisionHash,
      ledger_key: d.ledgerKey,
      tx_hash: d.txHash,
      explorer_url: d.txHash ? publicEnv.explorerTxUrl(d.txHash) : null,
      decided_at: d.decidedAt.toISOString(),
      review_seconds: t?.secondsTotal ?? null,
      blind: t?.blind ?? null,
      shared_funding_count: t?.sharedFundingCount ?? null,
      submission_status: s.status,
      payout_status: p?.status ?? null,
      release_tx_hash: p?.releaseTxHash ?? null,
    };
  });
  return { campaign: { id: c.id, slug: c.slug }, rows };
}

/** Campaigns with at least one decision whose log this reviewer may download, newest first. */
export async function reviewLogCampaigns(actor: { pubkey: string }, conn: Db = db): Promise<Array<{ id: string; slug: string; title: string; decisions: number }>> {
  const grants = await conn
    .select({ campaignId: roleGrants.campaignId })
    .from(roleGrants)
    .where(and(eq(roleGrants.pubkey, actor.pubkey), eq(roleGrants.role, "reviewer")));
  if (grants.length === 0) return [];
  const global = grants.some((g) => g.campaignId === null);
  const scoped = grants.flatMap((g) => (g.campaignId === null ? [] : [g.campaignId]));
  return conn
    .select({ id: campaigns.id, slug: campaigns.slug, title: campaigns.title, decisions: sql<number>`count(${decisions.id})::int` })
    .from(campaigns)
    .innerJoin(submissions, eq(submissions.campaignId, campaigns.id))
    .innerJoin(decisions, eq(decisions.submissionId, submissions.id))
    .where(global ? undefined : inArray(campaigns.id, scoped))
    .groupBy(campaigns.id)
    .orderBy(desc(campaigns.createdAt));
}
