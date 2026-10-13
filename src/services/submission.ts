import "server-only";
import { and, asc, desc, eq, isNotNull, like, or } from "drizzle-orm";
import { db, type Db } from "@/db/client";
import { campaigns, decisions, payouts, submissions, type Campaign, type Decision, type Payout, type Submission } from "@/db/schema";
import { env } from "@/config/env";
import { canonicalizeSubmissionUrl, submissionUrlSchema } from "@/domain/submission-url";
import { AppError, isAppError, isUniqueViolation } from "@/lib/errors";
import { newId, newShortId } from "@/lib/ids";
import { log } from "@/lib/logger";
import { hasUsdcTrustline, readFundingSource } from "@/wallet/onboarding";
import { getX } from "@/x";
import type { PostAuthor } from "@/x/port";
import { closeInFlight } from "./escrow-ops";
import { xAccountFor } from "./x-account";

/** Answers whether a wallet can receive USDC. Injected so unit tests need no network. */
export type TrustlineReader = (pubkey: string) => Promise<boolean>;

/** Default reader: one Horizon read against the configured testnet host. */
export const horizonTrustlineReader: TrustlineReader = (pubkey) =>
  hasUsdcTrustline(pubkey, { horizonUrl: env.HORIZON_URL, usdcIssuer: env.USDC_ISSUER });

/** Answers which account created a wallet, or null when Horizon has no creation record. Injected like `TrustlineReader`. */
export type FundingSourceReader = (pubkey: string) => Promise<string | null>;

/** Default reader: one Horizon read against the configured testnet host. */
export const horizonFundingSourceReader: FundingSourceReader = (pubkey) =>
  readFundingSource(pubkey, { horizonUrl: env.HORIZON_URL });

/** Answers who wrote a post on X, by its numeric ID. Injected like `TrustlineReader`. */
export type PostAuthorReader = (postId: string) => Promise<PostAuthor>;

/**
 * Default reader: one call to X with the app's own token. A deployment
 * without X credentials cannot check anything, and that is a failed lookup,
 * never a pass.
 */
export const xPostAuthorReader: PostAuthorReader = async (postId) => {
  const x = getX();
  if (!x) throw new AppError("X", "x is not configured", { step: "post", reason: "not_configured" });
  return x.postAuthor(postId);
};

/** Answers which X account a wallet has connected, or null. Injected like `TrustlineReader`; the default reads `x_account`. */
export type XAccountReader = (pubkey: string, conn: Db) => Promise<{ xUserId: string } | null>;

export interface PublicCampaign {
  id: string;
  slug: string;
  title: string;
  brief: string;
  rewardAmount: string;
  /** Total budget the funder committed, for the "N of M USDC left" meter. */
  budget: string;
  deadlineAt: Date;
  escrowContractId: string | null;
  open: boolean;
  closedAt: Date | null;
  /** Resolver's remainder return to the funder; set only once that withdraw is confirmed. */
  remainderTxHash: string | null;
}

function isOpen(c: Campaign, now = new Date()): boolean {
  return c.fundedAt !== null && c.closedAt === null && c.deadlineAt.getTime() > now.getTime();
}

export async function publicCampaign(slug: string, conn: Db = db): Promise<PublicCampaign | null> {
  const c = (await conn.select().from(campaigns).where(eq(campaigns.slug, slug)).limit(1))[0];
  return c ? toPublic(c) : null;
}

/**
 * Every funded campaign, open ones first, newest first within each group.
 * Drafts and escrows that were never funded are not listed; their pages stay
 * reachable by link only.
 */
export async function listPublicCampaigns(conn: Db = db, now = new Date()): Promise<PublicCampaign[]> {
  const rows = await conn.select().from(campaigns).where(isNotNull(campaigns.fundedAt)).orderBy(desc(campaigns.createdAt));
  const listed = rows.map((c) => toPublic(c, now));
  return [...listed.filter((c) => c.open), ...listed.filter((c) => !c.open)];
}

function toPublic(c: Campaign, now = new Date()): PublicCampaign {
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    brief: c.brief,
    rewardAmount: c.rewardAmount,
    budget: c.budget,
    deadlineAt: c.deadlineAt,
    escrowContractId: c.escrowContractId,
    open: isOpen(c, now),
    closedAt: c.closedAt,
    remainderTxHash: c.remainderTxHash,
  };
}

/**
 * Why a submission cannot be stored: this wallet already submitted to the
 * campaign, or the post is already in the app. Null when neither holds.
 */
async function alreadySubmitted(campaignId: string, pubkey: string, postId: string, conn: Db): Promise<AppError | null> {
  const own = (
    await conn
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.campaignId, campaignId), eq(submissions.contributorPubkey, pubkey)))
      .limit(1)
  )[0];
  if (own) return AppError.conflict("you already submitted to this campaign");

  // One post, one submission across the app, whatever handle or host the link
  // carried. Rows without a post ID are matched by the ID that ends their
  // stored link; the ID is digits only, so it holds no LIKE wildcard.
  const dup = (
    await conn
      .select({ id: submissions.id })
      .from(submissions)
      .where(or(eq(submissions.postId, postId), like(submissions.workUrl, `%/status/${postId}`)))
      .limit(1)
  )[0];
  return dup ? AppError.conflict("this post has already been submitted") : null;
}

/**
 * Accepts a submission into the review queue, or refuses it. The post must
 * have been written by the X account connected to the submitting wallet: X is
 * asked for the post's author by post ID, and nothing is accepted unverified.
 * This gate decides acceptance only; no review outcome follows from it.
 */
export async function createSubmission(
  input: { campaignSlug: string; workUrl: string },
  actor: { pubkey: string },
  conn: Db = db,
  trustline: TrustlineReader = horizonTrustlineReader,
  fundingSource: FundingSourceReader = horizonFundingSourceReader,
  postAuthor: PostAuthorReader = xPostAuthorReader,
  xAccount: XAccountReader = xAccountFor,
): Promise<Submission> {
  const c = (await conn.select().from(campaigns).where(eq(campaigns.slug, input.campaignSlug)).limit(1))[0];
  if (!c) throw AppError.notFound("campaign");
  if (!isOpen(c)) throw AppError.conflict("campaign is not accepting submissions");
  // closeConfirmed rejects every pending submission without a decision.
  if (await closeInFlight(c.id, conn)) throw AppError.conflict("campaign is closing");
  if (actor.pubkey === c.funderPubkey || actor.pubkey === c.disputeResolverPubkey) {
    throw AppError.forbidden("campaign roles cannot submit to their own campaign");
  }
  const parsed = submissionUrlSchema.safeParse(input.workUrl);
  if (!parsed.success) throw AppError.validation(parsed.error.issues[0]?.message ?? "invalid url");
  const { url, statusId: postId } = canonicalizeSubmissionUrl(parsed.data);

  const taken = await alreadySubmitted(c.id, actor.pubkey, postId, conn);
  if (taken) throw taken;

  const account = await xAccount(actor.pubkey, conn);
  if (!account) throw AppError.conflict("connect your X account first");

  // A release to a wallet without the trustline fails on chain, so a submission
  // it could never be paid for is refused here, not only in the UI.
  let canReceive: boolean;
  try {
    canReceive = await trustline(actor.pubkey);
  } catch (e) {
    log.warn("trustline check failed", { err: e instanceof Error ? e.message : String(e) });
    throw new AppError("LEDGER", "couldn't check your wallet on Stellar, try again", undefined, { cause: e });
  }
  if (!canReceive) throw AppError.conflict("wallet needs a USDC trustline");

  // Asked last of the gates, so X quota is spent only on a submission that
  // could otherwise be accepted. Only the author's ID comes back.
  let author: PostAuthor;
  try {
    author = await postAuthor(postId);
  } catch (e) {
    // Four named fields of the adapter's own error, never the error itself: nothing X sent and no credential is written down.
    const failure = isAppError(e) && e.code === "X" ? e.details : undefined;
    log.warn("post author lookup failed", {
      campaign: c.slug,
      wallet: actor.pubkey,
      step: failure?.["step"],
      reason: failure?.["reason"] ?? "unexpected",
      status: failure?.["status"],
      resetAt: failure?.["resetAt"],
    });
    throw new AppError("X", "couldn't check the post with X, try again");
  }
  if (!author.found) throw new AppError("NOT_FOUND", "this post could not be found on X, it must be public");
  if (author.authorId !== account.xUserId) throw AppError.forbidden("this post was written by another X account");

  // The source only feeds a reviewer warning, so a failed lookup never costs
  // the contributor their submission: it stays unknown and the card says so.
  let source: string | null = null;
  try {
    source = await fundingSource(actor.pubkey);
  } catch (e) {
    log.warn("funding source lookup failed", { campaign: c.slug, wallet: actor.pubkey, err: e instanceof Error ? e.message : String(e) });
  }

  try {
    const [row] = await conn
      .insert(submissions)
      .values({ id: newId("sub"), shortId: newShortId(), campaignId: c.id, contributorPubkey: actor.pubkey, workUrl: url, postId, fundingSource: source })
      .returning();
    return row as Submission;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Another request stored the same post, or this wallet's submission, since
    // the check above: the database refused this one, so answer as that check would.
    throw (await alreadySubmitted(c.id, actor.pubkey, postId, conn)) ?? e;
  }
}

export interface MySubmission {
  submission: Submission;
  decisions: Decision[];
  /** The payout row, if one exists. Only `released` with a `releaseTxHash` means paid. */
  payout: Payout | null;
}

export async function mySubmission(campaignId: string, pubkey: string, conn: Db = db): Promise<MySubmission | null> {
  const s = (
    await conn
      .select()
      .from(submissions)
      .where(and(eq(submissions.campaignId, campaignId), eq(submissions.contributorPubkey, pubkey)))
      .limit(1)
  )[0];
  if (!s) return null;
  const ds = await conn.select().from(decisions).where(eq(decisions.submissionId, s.id)).orderBy(asc(decisions.decidedAt));
  const payout = (await conn.select().from(payouts).where(eq(payouts.submissionId, s.id)).limit(1))[0] ?? null;
  return { submission: s, decisions: ds, payout };
}
