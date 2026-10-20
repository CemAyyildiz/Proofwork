import { describe, expect, it } from "vitest";
import {
  campaignStage,
  closeBlockers,
  countSubmissions,
  isReadyToPay,
  NO_SUBMISSIONS,
  nextStep,
  type CountRow,
  type StageFields,
  type SubmissionCounts,
} from "@/domain/campaign-status";

const NOW = new Date("2026-10-14T12:00:00Z");
const FUTURE = new Date("2026-10-20T12:00:00Z");
const PAST = new Date("2026-10-05T20:59:00Z");
const TX = "a".repeat(64);

const base: StageFields = { escrowContractId: null, fundedAt: null, closedAt: null, remainderTxHash: null, deadlineAt: FUTURE };
const funded: StageFields = { ...base, escrowContractId: "C1", fundedAt: PAST };
const ended: StageFields = { ...funded, deadlineAt: PAST };

const counts = (over: Partial<SubmissionCounts> = {}): SubmissionCounts => ({ ...NO_SUBMISSIONS, ...over });

describe("campaignStage", () => {
  it("walks draft → awaiting funding → open", () => {
    expect(campaignStage(base, counts(), NOW)).toBe("draft");
    expect(campaignStage({ ...base, escrowContractId: "C1" }, counts(), NOW)).toBe("awaiting_funding");
    expect(campaignStage(funded, counts({ inReview: 3 }), NOW)).toBe("open");
  });

  it("is reviewing and paying after the deadline while anything waits on review, approval or release, never open", () => {
    expect(campaignStage(ended, counts({ inReview: 1 }), NOW)).toBe("reviewing_and_paying");
    expect(campaignStage(ended, counts({ readyToPay: 1 }), NOW)).toBe("reviewing_and_paying");
    expect(campaignStage(ended, counts({ awaitingSignature: 2 }), NOW)).toBe("reviewing_and_paying");
  });

  it("is ready to close after the deadline with nothing pending, and exactly at the deadline", () => {
    expect(campaignStage(ended, counts({ total: 3, paid: 2, rejected: 1 }), NOW)).toBe("ready_to_close");
    expect(campaignStage({ ...funded, deadlineAt: NOW }, counts(), NOW)).toBe("ready_to_close");
  });

  it("is closed awaiting return until the remainder tx is recorded, then settled", () => {
    const closed = { ...ended, closedAt: NOW };
    expect(campaignStage(closed, counts(), NOW)).toBe("closed_awaiting_return");
    expect(campaignStage({ ...closed, remainderTxHash: TX }, counts(), NOW)).toBe("settled");
  });

  it("is abandoned when closed without ever being funded", () => {
    expect(campaignStage({ ...base, escrowContractId: "C1", closedAt: NOW }, counts(), NOW)).toBe("abandoned");
  });

  it("keeps a draft or unfunded campaign past its deadline in its own stage", () => {
    expect(campaignStage({ ...base, deadlineAt: PAST }, counts(), NOW)).toBe("draft");
    expect(campaignStage({ ...base, escrowContractId: "C1", deadlineAt: PAST }, counts(), NOW)).toBe("awaiting_funding");
  });

  it("never shows a stage the chain-confirmed columns do not support: no funded_at, no open or later", () => {
    // Counts and the deadline alone never move a campaign past funding.
    for (const c of [counts({ paid: 2, total: 2 }), counts({ inReview: 1 }), counts()]) {
      expect(campaignStage({ ...base, escrowContractId: "C1", deadlineAt: PAST }, c, NOW)).toBe("awaiting_funding");
    }
    // A closed campaign without a remainder tx is never settled.
    expect(campaignStage({ ...ended, closedAt: NOW }, counts({ paid: 1, total: 1 }), NOW)).toBe("closed_awaiting_return");
  });
});

const row = (status: CountRow["status"], payoutStatus: CountRow["payoutStatus"] = null, payoutAmount: string | null = payoutStatus ? "5" : null): CountRow => ({
  status,
  payoutStatus,
  payoutAmount,
});

describe("countSubmissions", () => {
  it("counts every bucket and sums paid money", () => {
    const c = countSubmissions([
      row("pending"),
      row("appealed"),
      row("rejected"),
      row("decided"),
      row("decided", "milestone_added"),
      row("decided", "delivered"),
      row("decided", "approved"),
      row("paid", "released", "5"),
      row("paid", "released", "2.5"),
    ]);
    expect(c).toEqual({ total: 9, inReview: 2, rejected: 1, readyToPay: 3, unfinished: 2, awaitingSignature: 1, paid: 2, paidAmount: "7.5" });
  });

  it("treats a failed payout as ready to pay again, not unfinished", () => {
    const c = countSubmissions([row("decided", "failed")]);
    expect(c.readyToPay).toBe(1);
    expect(c.unfinished).toBe(0);
  });

  it("is all zero for no submissions", () => {
    expect(countSubmissions([])).toEqual(NO_SUBMISSIONS);
    expect(NO_SUBMISSIONS).toMatchObject({ total: 0, inReview: 0, readyToPay: 0, paid: 0, paidAmount: "0" });
  });
});

describe("isReadyToPay", () => {
  it("is only a passed submission whose payout has not reached approval", () => {
    expect(isReadyToPay({ status: "decided", payoutStatus: null })).toBe(true);
    expect(isReadyToPay({ status: "decided", payoutStatus: "delivered" })).toBe(true);
    expect(isReadyToPay({ status: "decided", payoutStatus: "failed" })).toBe(true);
    expect(isReadyToPay({ status: "decided", payoutStatus: "approved" })).toBe(false);
    expect(isReadyToPay({ status: "paid", payoutStatus: "released" })).toBe(false);
    expect(isReadyToPay({ status: "rejected", payoutStatus: null })).toBe(false);
    expect(isReadyToPay({ status: "pending", payoutStatus: null })).toBe(false);
  });
});

describe("nextStep", () => {
  const step = (c: StageFields, n: SubmissionCounts) => nextStep(campaignStage(c, n, NOW), c, n, NOW);

  it("asks the funder to deploy, then fund", () => {
    expect(step(base, counts())).toEqual({ kind: "deploy", owner: "funder" });
    expect(step({ ...base, escrowContractId: "C1" }, counts())).toEqual({ kind: "fund", owner: "funder" });
  });

  it("does not nudge a draft or unfunded campaign past its deadline to deploy or fund", () => {
    expect(step({ ...base, deadlineAt: PAST }, counts())).toEqual({ kind: "expired", owner: null });
    expect(step({ ...base, escrowContractId: "C1", deadlineAt: PAST }, counts())).toEqual({ kind: "expired", owner: null });
  });

  it("open with nothing pending: share the link, the contributors' move", () => {
    expect(step(funded, counts())).toEqual({ kind: "share", owner: "contributors" });
    expect(step(funded, counts({ total: 2, paid: 2 }))).toEqual({ kind: "collect", owner: "contributors" });
  });

  it("puts release before approve before review, with whose step it is", () => {
    expect(step(funded, counts({ awaitingSignature: 2, readyToPay: 1, inReview: 4 }))).toEqual({ kind: "release", count: 2, owner: "funder" });
    expect(step(funded, counts({ readyToPay: 1, inReview: 4 }))).toEqual({ kind: "approve", count: 1, owner: "funder" });
    expect(step(ended, counts({ inReview: 1 }))).toEqual({ kind: "review", count: 1, owner: "reviewer" });
    expect(step(ended, counts({ awaitingSignature: 2 }))).toEqual({ kind: "release", count: 2, owner: "funder" });
  });

  it("asks the funder to close an ended campaign with nothing pending", () => {
    expect(step(ended, counts({ total: 5, paid: 3, rejected: 2 }))).toEqual({ kind: "close", owner: "funder" });
    expect(step(ended, counts())).toEqual({ kind: "close", owner: "funder" });
  });

  it("waits on the resolver after close and is done once settled or abandoned", () => {
    expect(step({ ...ended, closedAt: NOW }, counts())).toEqual({ kind: "remainder", owner: "resolver" });
    expect(step({ ...ended, closedAt: NOW, remainderTxHash: TX }, counts())).toEqual({ kind: "done", owner: null });
    expect(step({ ...base, escrowContractId: "C1", closedAt: NOW }, counts())).toEqual({ kind: "done", owner: null });
  });
});

describe("closeBlockers", () => {
  const free = { payoutLockUntil: null };

  it("lists the lease, review, unfinished and unreleased payouts, typed", () => {
    const held = { payoutLockUntil: new Date(NOW.getTime() + 60_000) };
    expect(closeBlockers("reviewing_and_paying", held, counts({ inReview: 1, unfinished: 2, awaitingSignature: 3 }), NOW)).toEqual([
      { kind: "lease" },
      { kind: "review", count: 1 },
      { kind: "unfinished", count: 2 },
      { kind: "release", count: 3 },
    ]);
  });

  it("blocks on a live lease alone, and not on one that has lapsed", () => {
    expect(closeBlockers("ready_to_close", { payoutLockUntil: new Date(NOW.getTime() + 1) }, counts(), NOW)).toEqual([{ kind: "lease" }]);
    expect(closeBlockers("ready_to_close", { payoutLockUntil: NOW }, counts(), NOW)).toEqual([]);
  });

  it("does not block on passes the funder chose not to pay", () => {
    expect(closeBlockers("reviewing_and_paying", free, counts({ readyToPay: 4 }), NOW)).toEqual([]);
  });

  it("is empty for a stage that cannot be closed", () => {
    for (const s of ["draft", "awaiting_funding", "closed_awaiting_return", "settled", "abandoned"] as const) {
      expect(closeBlockers(s, free, counts({ inReview: 1 }), NOW)).toEqual([]);
    }
  });
});
