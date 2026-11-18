import { cx } from "@/components/ui/cx";
import type { Campaign } from "@/db/schema";
import { deadlinePassed, type CampaignStage, type CloseBlocker, type NextStep, type StepOwner } from "@/domain/campaign-status";
import { formatDateShort, formatRelative, formatUsdc } from "@/lib/format";

type StageTone = "live" | "money" | "done" | "idle";

const STAGE: Record<CampaignStage, { tone: StageTone; label: string }> = {
  draft: { tone: "idle", label: "Draft" },
  awaiting_funding: { tone: "idle", label: "Awaiting funding" },
  open: { tone: "live", label: "Open" },
  reviewing_and_paying: { tone: "money", label: "Reviewing and paying" },
  ready_to_close: { tone: "money", label: "Ready to close" },
  closed_awaiting_return: { tone: "idle", label: "Closed, awaiting return" },
  settled: { tone: "done", label: "Settled" },
  abandoned: { tone: "idle", label: "Abandoned" },
};

// Yellow is kept for money that moved and the page's one action, so a stage is never yellow.
const TONE: Record<StageTone, string> = {
  live: "border border-white/30 text-text",
  money: "bg-white/[0.12] text-text",
  done: "border border-pass-line text-pass",
  idle: "bg-white/[0.08] text-white/70",
};

export function stageLabel(stage: CampaignStage): string {
  return STAGE[stage].label;
}

/** The stage as a word in a pill, dot first: status is never carried by colour alone. */
export function StagePill({ stage, className }: { stage: CampaignStage; className?: string }) {
  const s = STAGE[stage];
  return (
    <span
      className={cx(
        "inline-flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em]",
        TONE[s.tone],
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

export const OWNER_LABEL: Record<StepOwner, string> = {
  funder: "Funder",
  reviewer: "Reviewer",
  contributors: "Contributors",
  resolver: "Resolver",
};

/** "1 payout", "3 payouts". */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Short label and one explanatory line for a next step, shared by the list row and the campaign page. */
export function describeStep(step: NextStep, c: Pick<Campaign, "budget" | "rewardAmount">): { title: string; body: string } {
  const n = step.count ?? 0;
  switch (step.kind) {
    case "deploy":
      return { title: "Deploy escrow", body: "Sign one transaction to create this campaign's escrow on Stellar. No money moves yet." };
    case "fund":
      return { title: `Fund ${formatUsdc(c.budget)}`, body: "Sign the transfer of the budget into escrow. Submissions open the moment it lands." };
    case "expired":
      return { title: "Deadline passed", body: "The deadline passed before this campaign was funded, so it can take no submissions." };
    case "release":
      return { title: `Release ${n}`, body: `${plural(n, "payout is", "payouts are")} approved on chain and waiting for your signature. The reward moves when you sign.` };
    case "approve":
      return { title: `Approve ${n}`, body: `${plural(n, "submission", "submissions")} passed review. Approve the ones you want to pay: ${formatUsdc(c.rewardAmount)} each.` };
    case "review":
      return { title: `Review ${n}`, body: "A reviewer scores each submission against the rubric. Passes come back here to pay." };
    case "share":
      return { title: "Share the link", body: "The escrow holds the budget. Post the contributor link where contributors will see it." };
    case "collect":
      return { title: "Collect submissions", body: "Nothing waits on review or payment. New submissions go to review first." };
    case "close":
      return { title: "Close campaign", body: "Review and payouts are finished. Closing records the end on Stellar so the remainder can go back to your wallet." };
    case "remainder":
      return { title: "Return remainder", body: "The dispute resolver sends what is left in escrow back to the funder's wallet. Its transaction appears here." };
    case "done":
      return { title: "Nothing left to do", body: "Every transaction for this campaign is recorded on Stellar." };
  }
}

/** Why Close is off, one line per blocker. */
export function describeBlocker(b: CloseBlocker): string {
  switch (b.kind) {
    case "lease":
      return "payout run in progress";
    case "review":
      return `${plural(b.count, "submission", "submissions")} still in review`;
    case "unfinished":
      return `${plural(b.count, "payout was", "payouts were")} started and not approved; approve again to finish`;
    case "release":
      return `${plural(b.count, "approved payout", "approved payouts")} not yet released`;
  }
}

/** The dates for a campaign in its stage: the deadline always, the close date once closed. */
export function dateLine(c: Pick<Campaign, "deadlineAt" | "closedAt">, stage: CampaignStage, now: Date): string {
  const deadline = `${formatDateShort(c.deadlineAt)} · ${formatRelative(c.deadlineAt, now)}`;
  switch (stage) {
    case "draft":
    case "awaiting_funding":
      return deadlinePassed(c, now) ? `Deadline passed ${deadline}` : `Deadline ${deadline}`;
    case "open":
      return `Submissions close ${deadline}`;
    case "reviewing_and_paying":
    case "ready_to_close":
      return `Submissions closed ${deadline}`;
    case "closed_awaiting_return":
    case "settled":
      return `Deadline ${formatDateShort(c.deadlineAt)} · Closed ${c.closedAt ? formatDateShort(c.closedAt) : "—"}`;
    case "abandoned":
      return `Deadline ${formatDateShort(c.deadlineAt)} · Abandoned ${c.closedAt ? formatDateShort(c.closedAt) : "—"}`;
  }
}
