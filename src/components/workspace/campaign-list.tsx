import Link from "next/link";
import { Card } from "@/components/ui/card";
import type { Campaign } from "@/db/schema";
import { campaignStage, nextStep, type CampaignStage, type SubmissionCounts } from "@/domain/campaign-status";
import { formatUsdc } from "@/lib/format";
import { dateLine, describeStep, OWNER_LABEL, stageLabel, StagePill } from "./campaign-phase";

export interface CampaignListItem {
  campaign: Campaign;
  counts: SubmissionCounts;
}

/** Section order on the list: what needs closing or paying first, what is over last. */
const ORDER: readonly CampaignStage[] = [
  "ready_to_close",
  "reviewing_and_paying",
  "open",
  "awaiting_funding",
  "draft",
  "closed_awaiting_return",
  "settled",
  "abandoned",
];

/** Campaigns grouped by their stage, in list order; stages without a campaign are left out. */
export function groupByStage(items: readonly CampaignListItem[], now: Date): Array<{ stage: CampaignStage; items: CampaignListItem[] }> {
  const by = new Map<CampaignStage, CampaignListItem[]>();
  for (const item of items) {
    const stage = campaignStage(item.campaign, item.counts, now);
    by.set(stage, [...(by.get(stage) ?? []), item]);
  }
  return ORDER.flatMap((stage) => {
    const list = by.get(stage);
    return list ? [{ stage, items: list }] : [];
  });
}

export function CampaignList({ items, now }: { items: readonly CampaignListItem[]; now: Date }) {
  return (
    <div className="space-y-8">
      {groupByStage(items, now).map((g) => (
        <section key={g.stage} className="space-y-3" aria-label={stageLabel(g.stage)}>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
            {stageLabel(g.stage)} <span className="ml-1 font-mono text-[12px] font-medium text-muted">{g.items.length}</span>
          </h2>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {g.items.map((item) => (
              <li key={item.campaign.id}>
                <CampaignRow item={item} stage={g.stage} now={now} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CampaignRow({ item, stage, now }: { item: CampaignListItem; stage: CampaignStage; now: Date }) {
  const { campaign: c, counts } = item;
  const step = nextStep(stage, c, counts, now);
  const { title } = describeStep(step, c);
  const tally = [
    `${counts.total} ${counts.total === 1 ? "submission" : "submissions"}`,
    counts.inReview > 0 ? `${counts.inReview} in review` : null,
    counts.readyToPay > 0 ? `${counts.readyToPay} ready to pay` : null,
    counts.awaitingSignature > 0 ? `${counts.awaitingSignature} awaiting your signature` : null,
    counts.paid > 0 ? `${counts.paid} paid` : null,
    counts.rejected > 0 ? `${counts.rejected} rejected` : null,
  ].filter((s): s is string => s !== null);

  return (
    <Link href={`/campaigns/${c.slug}`} className="group block rounded-xl">
      <Card className="grid grid-cols-[minmax(0,1fr)] gap-4 p-5 transition-colors duration-200 group-hover:border-line-strong md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:items-center">
        <div className="min-w-0">
          <StagePill stage={stage} />
          <h3 className="mt-3 text-lg font-semibold leading-snug tracking-[-0.02em] [overflow-wrap:anywhere]">{c.title}</h3>
          <p className="mt-1 font-mono text-[12px] text-muted">{dateLine(c, stage, now)}</p>
        </div>
        <div className="min-w-0 space-y-2">
          <p className="text-[13px] text-text-2">
            <span className="font-medium text-text">{formatUsdc(c.budget)}</span> budget ·{" "}
            <span className="font-medium text-text">{formatUsdc(c.rewardAmount)}</span> per pass
          </p>
          {c.fundedAt ? <p className="text-[12px] text-muted">{tally.join(" · ")}</p> : null}
          <p className="text-[13px] text-text-2">
            <span className="text-muted">Next:</span> <span className="font-semibold text-text">{title}</span>
            {step.owner ? <span className="text-muted"> · {OWNER_LABEL[step.owner]}</span> : null}
          </p>
        </div>
      </Card>
    </Link>
  );
}
