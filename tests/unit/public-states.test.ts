import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { stageOf, timelineView } from "@/components/contributor-state";
import { sealFor } from "@/components/hash-check";
import type { Decision, Payout, Submission } from "@/db/schema";
import type { MySubmission } from "@/services/submission";
import { submissionUrlSchema } from "@/domain/submission-url";
import { budgetMeter } from "@/lib/format";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const { SubmitForm, urlGate } = await import("@/components/submit-form");

const HASH = "6a72919fdfbd4426a88b50a293779bede72201987328912e593acbffd721220f";

describe("budget meter", () => {
  it("reads 95 of 100 USDC left at 95%", () => {
    expect(budgetMeter("95", "100")).toEqual({ pct: 95, label: "95 of 100 USDC left" });
  });

  it("shows no meter when the balance read failed", () => {
    expect(budgetMeter(null, "100")).toBeNull();
  });

  it("clamps to 0–100 and shows no meter for a zero budget", () => {
    expect(budgetMeter("120", "100")?.pct).toBe(100);
    expect(budgetMeter("0", "100")?.pct).toBe(0);
    expect(budgetMeter("5", "0")).toBeNull();
  });
});

describe("verify seal", () => {
  it("is pending until the browser has a hash", () => {
    expect(sealFor(null, HASH)).toBeNull();
  });

  it("fails red when the recomputed hash differs", () => {
    expect(sealFor(`${HASH.slice(0, -1)}0`, HASH)).toEqual({ tone: "fail", title: "Does not match the recorded hash" });
  });

  it("claims only a match with the recorded hash, never an on-chain read", () => {
    expect(sealFor(HASH, HASH)).toEqual({ tone: "pass", title: "Matches the recorded hash" });
  });
});

describe("submit form", () => {
  it("starts with Submit disabled until the field holds an X status link", () => {
    const html = renderToStaticMarkup(createElement(SubmitForm, { campaignSlug: "c", payTo: "GDXGQ7VJ2Y6XJ3KZ5L4M8N2P7R9S3T6U1W4X8Y2Z5A7B9C3D6EQR4F2A" }));
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*\bdisabled=""/);
  });

  it("gates on the same schema the server enforces", () => {
    expect(submissionUrlSchema.safeParse("https://example.com/post").success).toBe(false);
    expect(submissionUrlSchema.safeParse("https://x.com/deniz_k/status/1841200000000000000").success).toBe(true);
  });
});

describe("submit gate", () => {
  it("enables for x.com and twitter.com status links", () => {
    expect(urlGate("https://x.com/deniz_k/status/1841200000000000000")).toEqual({ valid: true, wrong: false });
    expect(urlGate("https://twitter.com/deniz_k/status/1841200000000000000")).toEqual({ valid: true, wrong: false });
  });

  it("stays disabled with the hint for a URL that is not an X post", () => {
    expect(urlGate("https://example.com/not-an-x-post")).toEqual({ valid: false, wrong: true });
  });

  it("stays disabled without the hint while a short input is still being typed", () => {
    expect(urlGate("https://x.c")).toEqual({ valid: false, wrong: false });
    expect(urlGate("")).toEqual({ valid: false, wrong: false });
  });
});

const NOW = Date.UTC(2026, 9, 1);

describe("stageOf", () => {
  it("is open when the campaign is open", () => {
    expect(stageOf({ open: true, closedAt: null, deadlineAt: new Date(NOW + 1) }, NOW)).toBe("open");
  });
  it("is closed when closedAt is set", () => {
    expect(stageOf({ open: false, closedAt: new Date(NOW - 1), deadlineAt: new Date(NOW - 2) }, NOW)).toBe("closed");
  });
  it("is ended when the deadline has passed", () => {
    expect(stageOf({ open: false, closedAt: null, deadlineAt: new Date(NOW - 1) }, NOW)).toBe("ended");
  });
  it("is unfunded when not open with a future deadline", () => {
    expect(stageOf({ open: false, closedAt: null, deadlineAt: new Date(NOW + 1) }, NOW)).toBe("unfunded");
  });
});

function submission(status: Submission["status"]): Submission {
  return { id: "sub_1", shortId: "s1", campaignId: "cmp_1", contributorPubkey: "G_C1", workUrl: "https://x.com/a/status/1", status, submittedAt: new Date(NOW) };
}

function decision(id: string, outcome: "PASS" | "FAIL", txHash: string | null): Decision {
  return {
    id,
    submissionId: "sub_1",
    reviewerPubkey: "G_REV",
    outcome,
    reasonCode: outcome === "PASS" ? "R00_PASS" : "R03_TASK",
    signals: {},
    note: "n",
    appealOf: null,
    canonicalJson: "{}",
    decisionHash: "h",
    ledgerKey: `pw:${id}`,
    txHash,
    decidedAt: new Date(NOW),
  };
}

function payout(status: Payout["status"], releaseTxHash: string | null): Payout {
  return { id: "pay_1", submissionId: "sub_1", milestoneIndex: 1, amount: "5", status, releaseTxHash, releasedAt: null, createdAt: new Date(NOW) };
}

function mine(status: Submission["status"], decisions: Decision[], p: Payout | null = null): MySubmission {
  return { submission: submission(status), decisions, payout: p };
}

describe("timelineView", () => {
  it("is not paid when released without a release tx", () => {
    expect(timelineView(mine("decided", [decision("d1", "PASS", "tx")], payout("released", null)), true).paid).toBeNull();
  });

  it("is not paid when only approved", () => {
    expect(timelineView(mine("decided", [decision("d1", "PASS", "tx")], payout("approved", null)), true).paid).toBeNull();
  });

  it("is paid when released with a release tx", () => {
    expect(timelineView(mine("paid", [decision("d1", "PASS", "tx")], payout("released", "rtx")), true).paid?.releaseTxHash).toBe("rtx");
  });

  it("does not show a decision without a tx hash as decided", () => {
    const v = timelineView(mine("pending", [decision("d1", "FAIL", null)]), true);
    expect(v.recorded).toHaveLength(0);
    expect(v.unrecorded).toBe(true);
    expect(v.canAppeal).toBe(false);
  });

  it("offers a re-review on a recorded FAIL with one decision while open", () => {
    expect(timelineView(mine("rejected", [decision("d1", "FAIL", "tx")]), true).canAppeal).toBe(true);
  });

  it("offers no re-review when the campaign is closed or after two decisions", () => {
    expect(timelineView(mine("rejected", [decision("d1", "FAIL", "tx")]), false).canAppeal).toBe(false);
    expect(timelineView(mine("rejected", [decision("d1", "FAIL", "tx"), decision("d2", "FAIL", "tx2")]), true).canAppeal).toBe(false);
  });
});
