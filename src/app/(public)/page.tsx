import { stageOf, type Stage } from "@/components/contributor-state";
import { amount } from "@/components/site/amount";
import { Home, type HomeData } from "@/components/site/home";
import { publicEnv } from "@/config/public-env";
import { currentUser } from "@/lib/current-user";
import { formatDateShort, formatRelative, truncateMiddle } from "@/lib/format";
import { log } from "@/lib/logger";
import { publicDirectory, publicTotals, recentPayouts } from "@/services/public-directory";

export const dynamic = "force-dynamic";

const STATUS: Record<Stage, string> = { open: "Open", closed: "Closed", ended: "Deadline passed", unfunded: "Not funded yet" };

/** Reads the live figures; the landing page must still render when the database cannot be reached. */
async function load(now: Date) {
  try {
    const [list, totals, paid] = await Promise.all([publicDirectory(undefined, now), publicTotals(), recentPayouts(8)]);
    return { list, totals, paid };
  } catch (e) {
    log.warn("landing data not read", { err: e instanceof Error ? e.message : String(e) });
    return { list: [], totals: null, paid: [] };
  }
}

export default async function HomePage() {
  const now = new Date();
  const [user, { list, totals, paid }] = await Promise.all([currentUser(), load(now)]);
  const cta = user?.roles.has("funder")
    ? { href: "/campaigns", label: "Open your campaigns" }
    : user?.roles.has("reviewer")
      ? { href: "/review", label: "Open the review queue" }
      : { href: "/explore", label: "Find a bounty" };

  const data: HomeData = {
    network: publicEnv.networkName,
    totals: totals ? { paid: amount(totals.paidAmount), payouts: totals.payouts, decisions: totals.decisions, campaigns: totals.campaigns } : null,
    payouts: paid.map((p) => ({
      amount: amount(p.amount),
      campaign: p.campaignTitle,
      slug: p.campaignSlug,
      hash: truncateMiddle(p.releaseTxHash, 6, 6),
      href: publicEnv.explorerTxUrl(p.releaseTxHash),
      ago: formatRelative(p.releasedAt, now),
    })),
    bounties: list.map((c) => {
      const stage = stageOf(c, now.getTime());
      return {
        slug: c.slug,
        title: c.title,
        team: c.team ?? "Independent",
        reward: amount(c.rewardAmount),
        budget: amount(c.budget),
        paid: c.paid,
        submissions: c.submissions,
        open: c.open,
        deadline: c.deadlineAt.toISOString(),
        distance: formatRelative(c.deadlineAt, now),
        status: STATUS[stage],
        dateLabel: formatDateShort(c.closedAt ?? c.deadlineAt),
      };
    }),
    cta,
  };
  return <Home data={data} />;
}
