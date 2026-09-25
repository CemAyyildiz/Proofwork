import type { Decision, Payout } from "@/db/schema";
import type { MySubmission, PublicCampaign } from "@/services/submission";
import type { AccountState } from "@/wallet/onboarding";

export type Stage = "open" | "closed" | "ended" | "unfunded";

/** Where the campaign is, from the contributor's side. */
export function stageOf(c: Pick<PublicCampaign, "open" | "closedAt" | "deadlineAt">, now = Date.now()): Stage {
  if (c.open) return "open";
  if (c.closedAt) return "closed";
  if (c.deadlineAt.getTime() <= now) return "ended";
  return "unfunded";
}

export interface TimelineView {
  /** Decisions with a confirmed on-chain tx: the only ones shown as made (AD-9). */
  recorded: Decision[];
  /** A decision row exists whose transaction has not confirmed. */
  unrecorded: boolean;
  reReviewPending: boolean;
  /** Re-review is offered on the latest recorded FAIL, once, while the campaign is open. */
  canAppeal: boolean;
  /** Paid only when released and the release tx hash is known. */
  paid: (Payout & { releaseTxHash: string }) | null;
}

export function timelineView(mine: MySubmission, campaignOpen: boolean): TimelineView {
  const { submission: s, decisions, payout } = mine;
  const recorded = decisions.filter((d) => d.txHash !== null);
  const unrecorded = recorded.length < decisions.length;
  const latest = recorded.at(-1) ?? null;
  const releaseTxHash = payout?.status === "released" ? payout.releaseTxHash : null;
  return {
    recorded,
    unrecorded,
    reReviewPending: s.status === "appealed" && !unrecorded,
    canAppeal: s.status === "rejected" && !unrecorded && latest?.outcome === "FAIL" && decisions.length < 2 && campaignOpen,
    paid: payout && releaseTxHash ? { ...payout, releaseTxHash } : null,
  };
}

/** The browser's latest read of the connected wallet on Horizon testnet. */
export type WalletCheck = { status: "checking" } | { status: "unreachable" } | { status: "read"; account: AccountState };

export type OnboardingStep = "checking" | "unreachable" | "no-account" | "no-trustline" | "ready";
export type OnboardingNode = "done" | "current" | "pending";

export interface OnboardingView {
  step: OnboardingStep;
  /** Submitting is allowed only once the wallet can receive USDC. */
  canSubmit: boolean;
  /** Per-step state for "Activate testnet account" and "Add USDC trustline". */
  activate: OnboardingNode;
  trustline: OnboardingNode;
}

/** What the contributor sees before the submit form, from one wallet check. */
export function onboardingView(check: WalletCheck): OnboardingView {
  const step: OnboardingStep = check.status === "read" ? check.account.kind : check.status;
  return {
    step,
    canSubmit: step === "ready",
    activate: step === "no-account" ? "current" : step === "no-trustline" || step === "ready" ? "done" : "pending",
    trustline: step === "no-trustline" ? "current" : step === "ready" ? "done" : "pending",
  };
}
