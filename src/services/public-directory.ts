import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, type Db } from "@/db/client";
import { campaigns, decisions, funderRequests, payouts, submissions } from "@/db/schema";
import { listPublicCampaigns, type PublicCampaign } from "./submission";
import { countSubmissionsByCampaign } from "./submission-counts";

/**
 * What the public pages show about campaigns as a whole: the directory rows,
 * the latest payouts and the running totals. Everything here is already
 * public on chain or on a campaign page; no wallet or X account is returned.
 */
export interface DirectoryRow extends PublicCampaign {
  /** Team name from the funder's approved access request, when there is one. */
  team: string | null;
  submissions: number;
  paid: number;
}

export async function publicDirectory(conn: Db = db, now = new Date()): Promise<DirectoryRow[]> {
  const list = await listPublicCampaigns(conn, now);
  if (list.length === 0) return [];
  const ids = list.map((c) => c.id);
  const counts = await countSubmissionsByCampaign(ids, conn);
  const funders = await conn.select({ id: campaigns.id, funder: campaigns.funderPubkey }).from(campaigns).where(inArray(campaigns.id, ids));
  const teams = await conn
    .select({ pubkey: funderRequests.pubkey, team: funderRequests.team })
    .from(funderRequests)
    .where(and(eq(funderRequests.status, "approved"), inArray(funderRequests.pubkey, [...new Set(funders.map((f) => f.funder))])))
    .orderBy(desc(funderRequests.decidedAt));
  const teamOf = new Map<string, string>();
  // Newest first, so the first name seen for a wallet is its current one.
  for (const t of teams) if (!teamOf.has(t.pubkey)) teamOf.set(t.pubkey, t.team);
  const funderOf = new Map(funders.map((f) => [f.id, f.funder]));
  return list.map((c) => {
    const n = counts.get(c.id);
    return { ...c, team: teamOf.get(funderOf.get(c.id) ?? "") ?? null, submissions: n?.total ?? 0, paid: n?.paid ?? 0 };
  });
}

export interface RecentPayout {
  amount: string;
  releaseTxHash: string;
  releasedAt: Date;
  campaignTitle: string;
  campaignSlug: string;
}

/** Released payouts that carry their transaction, newest first; `contributor` narrows them to one wallet's. */
async function releasedPayouts(limit: number, contributor: string | null, conn: Db): Promise<RecentPayout[]> {
  const rows = await conn
    .select({ amount: payouts.amount, releaseTxHash: payouts.releaseTxHash, releasedAt: payouts.releasedAt, campaignTitle: campaigns.title, campaignSlug: campaigns.slug })
    .from(payouts)
    .innerJoin(submissions, eq(submissions.id, payouts.submissionId))
    .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
    .where(
      and(
        eq(payouts.status, "released"),
        isNotNull(payouts.releaseTxHash),
        isNotNull(payouts.releasedAt),
        isNull(campaigns.unlistedAt),
        contributor === null ? undefined : eq(submissions.contributorPubkey, contributor),
      ),
    )
    .orderBy(desc(payouts.releasedAt))
    .limit(limit);
  return rows.flatMap((r) => (r.releaseTxHash && r.releasedAt ? [{ ...r, releaseTxHash: r.releaseTxHash, releasedAt: r.releasedAt }] : []));
}

/** The latest released payouts, each with the transaction that paid it. */
export async function recentPayouts(limit = 6, conn: Db = db): Promise<RecentPayout[]> {
  return releasedPayouts(limit, null, conn);
}

/** One contributor's released payouts, for their public profile. */
export async function contributorPayouts(pubkey: string, limit = 50, conn: Db = db): Promise<RecentPayout[]> {
  return releasedPayouts(limit, pubkey, conn);
}

export interface PublicTotals {
  /** Sum of released payouts, a USDC decimal string. */
  paidAmount: string;
  payouts: number;
  /** Decisions that are on chain. */
  decisions: number;
  campaigns: number;
}

/** Public figures leave out unlisted campaigns (test runs); the operator's metrics still count them. */
export async function publicTotals(conn: Db = db): Promise<PublicTotals> {
  const [paid] = await conn
    .select({ amount: sql<string>`coalesce(sum(${payouts.amount}), 0)::text`, n: sql<number>`count(*)::int` })
    .from(payouts)
    .innerJoin(submissions, eq(submissions.id, payouts.submissionId))
    .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
    .where(and(eq(payouts.status, "released"), isNull(campaigns.unlistedAt)));
  const [decided] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(decisions)
    .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
    .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
    .where(and(isNotNull(decisions.txHash), isNull(campaigns.unlistedAt)));
  const [funded] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(campaigns)
    .where(and(isNotNull(campaigns.fundedAt), isNull(campaigns.unlistedAt)));
  return { paidAmount: paid?.amount ?? "0", payouts: paid?.n ?? 0, decisions: decided?.n ?? 0, campaigns: funded?.n ?? 0 };
}

/** The newest decision already written to Stellar, for the landing's "check it" link; null before the first one. */
export async function latestDecisionId(conn: Db = db): Promise<string | null> {
  const [row] = await conn
    .select({ id: decisions.id })
    .from(decisions)
    .innerJoin(submissions, eq(submissions.id, decisions.submissionId))
    .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
    .where(and(isNotNull(decisions.txHash), isNull(campaigns.unlistedAt)))
    .orderBy(desc(decisions.decidedAt))
    .limit(1);
  return row?.id ?? null;
}

/** Team name and submission counts of one campaign, for its public page. */
export async function campaignFacts(campaignId: string, conn: Db = db): Promise<{ team: string | null; submissions: number; paid: number }> {
  const counts = (await countSubmissionsByCampaign([campaignId], conn)).get(campaignId);
  const [team] = await conn
    .select({ team: funderRequests.team })
    .from(funderRequests)
    .innerJoin(campaigns, eq(campaigns.funderPubkey, funderRequests.pubkey))
    .where(and(eq(campaigns.id, campaignId), eq(funderRequests.status, "approved")))
    .orderBy(desc(funderRequests.decidedAt))
    .limit(1);
  return { team: team?.team ?? null, submissions: counts?.total ?? 0, paid: counts?.paid ?? 0 };
}

export interface CampaignPayout {
  shortId: string;
  amount: string;
  releaseTxHash: string;
  releasedAt: Date;
  decisionId: string | null;
}

/** Released payouts of one campaign, newest first, each with the decision that passed it. */
export async function campaignPayouts(campaignId: string, conn: Db = db): Promise<CampaignPayout[]> {
  const rows = await conn
    .select({ submissionId: submissions.id, shortId: submissions.shortId, amount: payouts.amount, releaseTxHash: payouts.releaseTxHash, releasedAt: payouts.releasedAt })
    .from(payouts)
    .innerJoin(submissions, eq(submissions.id, payouts.submissionId))
    .where(and(eq(submissions.campaignId, campaignId), eq(payouts.status, "released"), isNotNull(payouts.releaseTxHash), isNotNull(payouts.releasedAt)))
    .orderBy(desc(payouts.releasedAt));
  if (rows.length === 0) return [];
  const passed = await conn
    .select({ id: decisions.id, submissionId: decisions.submissionId })
    .from(decisions)
    .where(and(inArray(decisions.submissionId, rows.map((r) => r.submissionId)), eq(decisions.outcome, "PASS")))
    .orderBy(desc(decisions.decidedAt));
  const decisionOf = new Map<string, string>();
  for (const d of passed) if (!decisionOf.has(d.submissionId)) decisionOf.set(d.submissionId, d.id);
  return rows.flatMap((r) =>
    r.releaseTxHash && r.releasedAt
      ? [{ shortId: r.shortId, amount: r.amount, releaseTxHash: r.releaseTxHash, releasedAt: r.releasedAt, decisionId: decisionOf.get(r.submissionId) ?? null }]
      : [],
  );
}
