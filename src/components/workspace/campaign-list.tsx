import Link from "next/link";
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
        <section key={g.stage} aria-label={stageLabel(g.stage)}>
          <h2 className="flex items-center gap-2.5 pb-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
            {stageLabel(g.stage)} <span className="rounded-full border border-line-strong px-2 py-px text-[10.5px] tracking-normal">{g.items.length}</span>
          </h2>
          <ul className="border-t border-line">
            {g.items.map((item) => (
              <li key={item.campaign.id} className="border-b border-line">
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
    <Link
      href={`/campaigns/${c.slug}`}
      className="group -mx-3 grid grid-cols-[minmax(0,1fr)] items-center gap-x-8 gap-y-3 rounded-lg px-3 py-4 transition-colors duration-150 hover:bg-white/3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.9fr)]"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {/* The stage is read before the title; it is shown after it. */}
          <span className="order-2">
            <StagePill stage={stage} />
          </span>
          <h3 className="order-1 text-[16px] font-semibold leading-snug tracking-[-0.02em] [overflow-wrap:anywhere]">{c.title}</h3>
        </div>
        <p className="mt-1.5 font-mono text-[12px] text-muted">{dateLine(c, stage, now)}</p>
      </div>
      <div className="min-w-0">
        <p className="font-mono text-[12.5px] text-text-2">
          <span className="font-medium text-text">{formatUsdc(c.budget)}</span> budget ·{" "}
          <span className="font-medium text-text">{formatUsdc(c.rewardAmount)}</span> per pass
        </p>
        {c.fundedAt ? <p className="mt-1.5 text-[12px] leading-snug text-muted">{tally.join(" · ")}</p> : null}
      </div>
      <p className="min-w-0 text-[13px] text-text-2 md:text-right">
        <span className="text-muted">Next:</span> <span className="font-semibold text-text group-hover:text-accent">{title}</span>
        {step.owner ? <span className="text-muted"> · {OWNER_LABEL[step.owner]}</span> : null}
      </p>
    </Link>
  );
}
