import { publicEnv } from "@/config/public-env";
import { formatRelative, truncateMiddle } from "@/lib/format";
import { labData, plain } from "../data";
import { Stage, type StageData } from "./stage";

export const dynamic = "force-dynamic";

/** Direction E: the life of one post, told in motion. Everything shown is real data. */
export default async function LabE() {
  const { now, items, totals, paid } = await labData();
  const data: StageData = {
    network: publicEnv.networkName,
    totals: { paid: plain(totals.paidAmount), payouts: totals.payouts, decisions: totals.decisions, campaigns: totals.campaigns },
    payouts: paid.map((p) => ({
      amount: plain(p.amount),
      campaign: p.campaignTitle,
      slug: p.campaignSlug,
      hash: truncateMiddle(p.releaseTxHash, 6, 6),
      href: publicEnv.explorerTxUrl(p.releaseTxHash),
      ago: formatRelative(p.releasedAt, now),
    })),
    bounties: items.map((i) => ({
      slug: i.slug,
      title: i.title,
      team: i.team,
      reward: i.reward,
      budget: i.budget,
      paid: i.paid,
      submissions: i.submissions,
      paidPct: i.paidPct,
      open: i.open,
      deadline: i.deadlineAt.toISOString(),
      distance: i.distance,
    })),
  };
  return <Stage data={data} />;
}
