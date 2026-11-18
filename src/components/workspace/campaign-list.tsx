import Link from "next/link";
import { cx } from "@/components/ui/cx";
import type { Campaign } from "@/db/schema";
import { campaignStage, deadlinePassed, nextStep, type CampaignStage, type NextStep, type SubmissionCounts } from "@/domain/campaign-status";
import { fromStroops, toStroops } from "@/escrow/amount";
import { dateLine, describeStep, foundersStep, stageLabel, StagePill, stepOwner } from "./campaign-phase";
import { ax, figure, figureAxes, isZero, Label, Pieces, SlotLegend, SlotMeter, slotCount, type Slots } from "./kit";
import { CountUp, Reveal } from "./motion-bits";

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

/** Steps that wait on the funder's own wallet, most urgent first: money already approved, then passes to approve, then the rest. */
const URGENCY: Partial<Record<NextStep["kind"], number>> = { release: 0, approve: 1, close: 2, fund: 3, deploy: 4 };

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

/** The campaign id whose next step is the funder's most urgent one, or null when nothing waits on the funder. A founder-sealed campaign's payouts wait on the founder, not the funder. */
export function mostUrgent(items: readonly CampaignListItem[], now: Date): string | null {
  let best: { id: string; rank: number } | null = null;
  for (const g of groupByStage(items, now)) {
    for (const item of g.items) {
      const step = nextStep(g.stage, item.campaign, item.counts, now);
      const rank = foundersStep(step, item.campaign) ? undefined : URGENCY[step.kind];
      if (rank !== undefined && (best === null || rank < best.rank)) best = { id: item.campaign.id, rank };
    }
  }
  return best?.id ?? null;
}

/** Budget less what was released, never below zero. Decimal strings in, decimal string out. */
export function leftOf(budget: string, paid: string): string {
  const left = toStroops(budget) - toStroops(paid);
  return fromStroops(left > 0n ? left : 0n);
}

/**
 * The meter's stretches for one campaign, from its submission counts. Given
 * `now`, a campaign past its deadline or closed calls its empty slots unused:
 * no submission can fill them any more.
 */
export function slotParts(
  c: Pick<Campaign, "budget" | "rewardAmount"> & Partial<Pick<Campaign, "deadlineAt" | "closedAt">>,
  counts: SubmissionCounts,
  now?: Date,
): { total: number; parts: Slots[] } {
  const total = slotCount(c.budget, c.rewardAmount);
  const ended = (c.closedAt ?? null) !== null || (now !== undefined && c.deadlineAt !== undefined && deadlinePassed({ deadlineAt: c.deadlineAt }, now));
  const taken = counts.paid + counts.awaitingSignature + counts.readyToPay + counts.inReview;
  return {
    total,
    parts: [
      { key: "paid", n: counts.paid, label: "paid" },
      { key: "signature", n: counts.awaitingSignature, label: "to release" },
      { key: "ready", n: counts.readyToPay, label: "to approve" },
      { key: "review", n: counts.inReview, label: "in review" },
      { key: "left", n: Math.max(0, total - taken), label: ended ? "unused" : "free" },
    ],
  };
}

/**
 * `viewer` is the signed-in wallet: a step that waits on it reads "Waits on you".
 */
export function CampaignList({ items, now, urgent = null, viewer = null }: { items: readonly CampaignListItem[]; now: Date; urgent?: string | null; viewer?: string | null }) {
  return (
    <div className="space-y-12">
      {groupByStage(items, now).map((g) => (
        <section key={g.stage} aria-label={stageLabel(g.stage)}>
          <h2 className="mb-4 flex items-center gap-2.5">
            <Label as="span">{stageLabel(g.stage)}</Label>
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-[11px] font-medium text-white/70">{g.items.length}</span>
          </h2>
          <ul className="space-y-4">
            {g.items.map((item, i) => (
              <Reveal as="li" key={item.campaign.id} delay={i * 70}>
                <CampaignRow item={item} stage={g.stage} now={now} urgent={item.campaign.id === urgent} viewer={viewer} />
              </Reveal>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CampaignRow({ item, stage, now, urgent, viewer }: { item: CampaignListItem; stage: CampaignStage; now: Date; urgent: boolean; viewer: string | null }) {
  const { campaign: c, counts } = item;
  const step = nextStep(stage, c, counts, now);
  const owner = stepOwner(step, c);
  const yours = viewer !== null && owner !== null && owner.wallet === viewer;
  const { title } = describeStep(step, c);
  const funded = c.fundedAt !== null;
  const tally = [
    `${counts.total} ${counts.total === 1 ? "submission" : "submissions"}`,
    counts.inReview > 0 ? `${counts.inReview} in review` : null,
    counts.readyToPay > 0 ? `${counts.readyToPay} ready to pay` : null,
    counts.awaitingSignature > 0 ? `${counts.awaitingSignature} awaiting your signature` : null,
    counts.paid > 0 ? `${counts.paid} paid` : null,
    counts.rejected > 0 ? `${counts.rejected} rejected` : null,
  ].filter((s): s is string => s !== null);
  const toPay = counts.readyToPay + counts.awaitingSignature;
  const main = !funded
    ? { value: figure(c.budget), label: "USDC budget, not in escrow yet" }
    : c.closedAt
      ? { value: figure(counts.paidAmount), label: "USDC paid out" }
      : { value: figure(leftOf(c.budget, counts.paidAmount)), label: `USDC left of ${figure(c.budget)}` };
  const meter = slotParts(c, counts, now);

  return (
    <Link
      href={`/campaigns/${c.slug}`}
      className={cx(
        "group relative block overflow-hidden rounded-[28px] border bg-[#0d0d0d] p-5 transition-[border-color,transform,background-color] duration-300 ease-expo hover:-translate-y-0.5 hover:bg-[#111] md:p-7",
        urgent ? "border-white/25 hover:border-white/40" : "border-white/[0.07] hover:border-white/20",
      )}
    >
      <div className="grid gap-x-10 gap-y-6 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <StagePill stage={stage} />
          <h3
            className="mt-3 font-display text-[clamp(1.55rem,2.6vw,2.25rem)] leading-[0.98] [overflow-wrap:anywhere]"
            style={{ fontVariationSettings: ax(88, 780) }}
          >
            {c.title}
          </h3>
          <p className="mt-2.5 font-mono text-[11.5px] text-white/55"><Pieces text={dateLine(c, stage, now)} /></p>
        </div>

        <dl className="flex items-end gap-8 md:justify-end">
          <div>
            <dt className="sr-only">Amount</dt>
            <dd>
              <span
                className={cx("block font-display text-[clamp(3.2rem,6vw,4.75rem)] leading-[0.8]", isZero(main.value) && "text-white/60")}
                style={{ fontVariationSettings: figureAxes(main.value) }}
              >
                <CountUp value={main.value} />
              </span>
              <span className="mt-2 block text-[12.5px] text-white/60">{main.label}</span>
            </dd>
          </div>
          {funded && !c.closedAt ? (
            <div>
              <dt className="sr-only">Ready to pay</dt>
              <dd>
                <span
                  className={cx("block font-display text-[clamp(2rem,3.4vw,2.75rem)] leading-[0.8]", toPay > 0 ? "text-text" : "text-white/60")}
                  style={{ fontVariationSettings: figureAxes(String(toPay), 64, 900) }}
                >
                  <CountUp value={String(toPay)} />
                </span>
                <span className="mt-2 block text-[12.5px] text-white/60">ready to pay</span>
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="mt-6">
        {funded ? (
          <SlotMeter total={meter.total} parts={meter.parts} size="sm" />
        ) : (
          <div aria-hidden="true" className="flex gap-[3px]">
            {Array.from({ length: Math.min(meter.total, 48) }, (_, i) => (
              <span key={i} className="h-4 min-w-0 flex-1 rounded-[3px] border border-dashed border-white/15" />
            ))}
          </div>
        )}
        {funded ? <SlotLegend parts={meter.parts} className="mt-2.5" /> : <p className="mt-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-white/55">{`${meter.total} rewards once funded`}</p>}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-white/[0.06] pt-4">
        <p className="min-w-0 text-[13px] text-white/60">{funded ? tally.join(" · ") : null}</p>
        {/* Read in order as "Next: Release 2 · Funder"; shown as the button with whose step it is in small print beside it. */}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="sr-only">Next:</span>
          <span
            className={cx(
              "inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-semibold transition-colors duration-200",
              urgent ? "bg-accent text-accent-ink" : "border border-white/15 text-white/80 group-hover:border-white/40 group-hover:text-text",
            )}
          >
            {title}
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="ml-1 transition-transform duration-200 group-hover:translate-x-0.5">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </span>
          {owner ? (
            <span className={cx("order-first font-mono text-[10.5px] uppercase tracking-[0.16em]", yours ? "text-text" : "text-white/55")}>
              {/* "Waits on" is drawn by CSS (with empty alt text) so the row still reads "Next: Release 2 · Funder". */}
              <span className="sr-only">·</span>{" "}
              {yours ? (
                <span className="before:content-['Waits_on_you'_/_'']">
                  <span className="sr-only">{owner.label}</span>
                </span>
              ) : (
                <span className="before:content-['Waits_on_'_/_'']">{owner.label}</span>
              )}
            </span>
          ) : null}
        </p>
      </div>
    </Link>
  );
}
