import { notFound } from "next/navigation";
import { stageOf } from "@/components/contributor-state";
import { publicEnv } from "@/config/public-env";
import { formatDateShort, formatRelative, truncateMiddle } from "@/lib/format";
import { campaignFacts, campaignPayouts } from "@/services/public-directory";
import { publicCampaign } from "@/services/submission";
import { plain } from "../../data";
import { Bounty, type BountyData } from "./bounty";

export const dynamic = "force-dynamic";

/** Direction E, the bounty page: what the job is, how it is judged, and what it has paid. */
export default async function LabEBounty({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await publicCampaign(slug);
  if (!c) notFound();
  const now = new Date();
  const [facts, payouts] = await Promise.all([campaignFacts(c.id), campaignPayouts(c.id)]);
  const paidTotal = payouts.reduce((sum, p) => sum + Number(p.amount), 0);
  const data: BountyData = {
    slug: c.slug,
    title: c.title,
    brief: c.brief,
    team: facts.team ?? "Independent",
    stage: stageOf(c, now.getTime()),
    reward: plain(c.rewardAmount),
    budget: plain(c.budget),
    left: plain(String(Math.max(0, Number(c.budget) - paidTotal))),
    deadline: c.deadlineAt.toISOString(),
    deadlineLabel: formatDateShort(c.deadlineAt),
    distance: formatRelative(c.deadlineAt, now),
    submissions: facts.submissions,
    paid: facts.paid,
    network: publicEnv.networkName,
    testnet: !publicEnv.isMainnet,
    escrow: c.escrowContractId ? { short: truncateMiddle(c.escrowContractId, 6, 6), href: publicEnv.explorerContractUrl(c.escrowContractId) } : null,
    payouts: payouts.map((p) => ({
      shortId: p.shortId,
      amount: plain(p.amount),
      hash: truncateMiddle(p.releaseTxHash, 6, 6),
      href: publicEnv.explorerTxUrl(p.releaseTxHash),
      ago: formatRelative(p.releasedAt, now),
      verify: p.decisionId ? `/verify/${p.decisionId}` : null,
    })),
  };
  return <Bounty data={data} />;
}
