import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, type Db } from "@/db/client";
import { campaigns, decisions, payouts, submissions, type Campaign, type Decision, type Payout, type Submission } from "@/db/schema";
import { env } from "@/config/env";
import { canonicalizeSubmissionUrl, submissionUrlSchema } from "@/domain/submission-url";
import { AppError } from "@/lib/errors";
import { newId, newShortId } from "@/lib/ids";
import { log } from "@/lib/logger";
import { hasUsdcTrustline } from "@/wallet/onboarding";

/** Answers whether a wallet can receive USDC. Injected so unit tests need no network. */
export type TrustlineReader = (pubkey: string) => Promise<boolean>;

/** Default reader: one Horizon read against the configured testnet host. */
export const horizonTrustlineReader: TrustlineReader = (pubkey) =>
  hasUsdcTrustline(pubkey, { horizonUrl: env.HORIZON_URL, usdcIssuer: env.USDC_ISSUER });

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
}

function isOpen(c: Campaign, now = new Date()): boolean {
  return c.fundedAt !== null && c.closedAt === null && c.deadlineAt.getTime() > now.getTime();
}

export async function publicCampaign(slug: string, conn: Db = db): Promise<PublicCampaign | null> {
  const c = (await conn.select().from(campaigns).where(eq(campaigns.slug, slug)).limit(1))[0];
  if (!c) return null;
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    brief: c.brief,
    rewardAmount: c.rewardAmount,
    budget: c.budget,
    deadlineAt: c.deadlineAt,
    escrowContractId: c.escrowContractId,
    open: isOpen(c),
    closedAt: c.closedAt,
  };
}

export async function createSubmission(
  input: { campaignSlug: string; workUrl: string },
  actor: { pubkey: string },
  conn: Db = db,
  trustline: TrustlineReader = horizonTrustlineReader,
): Promise<Submission> {
  const c = (await conn.select().from(campaigns).where(eq(campaigns.slug, input.campaignSlug)).limit(1))[0];
  if (!c) throw AppError.notFound("campaign");
  if (!isOpen(c)) throw AppError.conflict("campaign is not accepting submissions");
  if (actor.pubkey === c.funderPubkey || actor.pubkey === c.disputeResolverPubkey) {
    throw AppError.forbidden("campaign roles cannot submit to their own campaign");
  }
  const parsed = submissionUrlSchema.safeParse(input.workUrl);
  if (!parsed.success) throw AppError.validation(parsed.error.issues[0]?.message ?? "invalid url");
  const { url } = canonicalizeSubmissionUrl(parsed.data);

  const existing = (
    await conn
      .select()
      .from(submissions)
      .where(and(eq(submissions.campaignId, c.id), eq(submissions.contributorPubkey, actor.pubkey)))
      .limit(1)
  )[0];
  if (existing) throw AppError.conflict("you already submitted to this campaign");

  const dup = (await conn.select({ id: submissions.id }).from(submissions).where(eq(submissions.workUrl, url)).limit(1))[0];
  if (dup) throw AppError.conflict("this post has already been submitted");

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

  const [row] = await conn
    .insert(submissions)
    .values({ id: newId("sub"), shortId: newShortId(), campaignId: c.id, contributorPubkey: actor.pubkey, workUrl: url })
    .returning();
  return row as Submission;
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
