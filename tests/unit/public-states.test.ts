import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { stageOf, timelineView, xExploreNotice, xNotice, type XNotice } from "@/components/contributor-state";
import { sealFor } from "@/components/hash-check";
import type { Decision, Payout, Submission } from "@/db/schema";
import type { MySubmission } from "@/services/submission";
import { submissionUrlSchema } from "@/domain/submission-url";
import { noCampaignPath, returnPath, X_OUTCOMES, xOutcomeSchema } from "@/domain/x-connect";
import { budgetMeter } from "@/lib/format";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const { SubmitForm, urlGate } = await import("@/components/submit-form");
const { XConnectStep } = await import("@/components/x-connect");

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

  it("disables the link field while the wallet cannot receive USDC", () => {
    const html = renderToStaticMarkup(createElement(SubmitForm, { campaignSlug: "c", payTo: "GDXGQ7VJ2Y6XJ3KZ5L4M8N2P7R9S3T6U1W4X8Y2Z5A7B9C3D6EQR4F2A", locked: true }));
    const input = html.match(/<input[^>]*name="workUrl"[^>]*>/)?.[0] ?? "";
    expect(input).toMatch(/\bdisabled=""/);
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
  return { id: "sub_1", shortId: "s1", campaignId: "cmp_1", contributorPubkey: "G_C1", workUrl: "https://x.com/a/status/1", fundingSource: null, status, submittedAt: new Date(NOW) };
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

describe("X connect step", () => {
  const signedIn = { signedIn: true, connected: false };
  const step = (props: { connected: boolean; available?: boolean; notice?: XNotice | null }) =>
    renderToStaticMarkup(createElement(XConnectStep, { campaignSlug: "camp-1", available: true, notice: null, ...props }));

  it("offers a plain link that starts the flow for this campaign, and shows no account detail", () => {
    const html = step({ connected: false });
    expect(html).toMatch(/<a[^>]*href="\/api\/x\/connect\?slug=camp-1"[^>]*>Connect X<\/a>/);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("X account connected");
  });

  it("says what X will ask for and what Proofwork reads", () => {
    const html = step({ connected: false });
    expect(html).toContain("X will ask you to let Proofwork read your posts and profile");
    expect(html).toContain("Proofwork reads only the account&#x27;s ID");
    expect(html).not.toContain("no access to post");
  });

  it("says connected, with no link to connect again", () => {
    const html = step({ connected: true });
    expect(html).toContain("X account connected");
    expect(html).not.toContain("/api/x/connect");
  });

  it("shows a failed attempt as an alert under the link", () => {
    const html = step({ connected: false, notice: xNotice("taken", signedIn) });
    expect(html).toMatch(/<p role="alert" class="[^"]*text-fail[^"]*">This X account is connected to another wallet\.<\/p>/);
    expect(html).toContain("Connect X");
  });

  it("shows a cancelled attempt as a status, not an alert", () => {
    const html = step({ connected: false, notice: xNotice("cancelled", signedIn) });
    expect(html).toMatch(/<p role="status" class="[^"]*text-muted[^"]*">The X connection was cancelled\. Nothing was saved\.<\/p>/);
    expect(html).not.toContain('role="alert"');
  });

  it("keeps the connected state and says the wallet already has an account", () => {
    const html = step({ connected: true, notice: xNotice("wallet_bound", { signedIn: true, connected: true }) });
    expect(html).toContain("X account connected");
    expect(html).toMatch(/<p role="alert"[^>]*>This wallet already has an X account\. It stays connected to that one\.<\/p>/);
    expect(html).not.toContain("/api/x/connect");
  });

  it("is muted with nothing to press, and no red message, when X is not configured", () => {
    const html = step({ connected: false, available: false, notice: xNotice("unavailable", signedIn) });
    expect(html).toContain("Connect your X account");
    expect(html).toContain("Not available yet.");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("/api/x/connect");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("text-fail");
  });

  it("still says connected when X is not configured any more", () => {
    expect(step({ connected: true, available: false })).toContain("X account connected");
  });

  it("has a message and a tone for every outcome a failed attempt can return with", () => {
    expect(xNotice("taken", signedIn)).toEqual({ tone: "fail", text: "This X account is connected to another wallet." });
    expect(xNotice("cancelled", signedIn)).toEqual({ tone: "muted", text: "The X connection was cancelled. Nothing was saved." });
    expect(xNotice("retry", signedIn)).toEqual({ tone: "fail", text: "That X sign-in could not be completed. Try again." });
    expect(xNotice("x_failed", signedIn)).toEqual({ tone: "fail", text: "X did not answer. Try again in a moment." });
    expect(xNotice("unavailable", signedIn)).toEqual({ tone: "fail", text: "X sign-in is not available right now." });
    expect(xNotice("rate_limited", signedIn)).toEqual({ tone: "fail", text: "Too many attempts. Try again in a few minutes." });
    expect(xNotice("wallet_bound", { signedIn: true, connected: true })).toEqual({
      tone: "fail",
      text: "This wallet already has an X account. It stays connected to that one.",
    });
    expect(xNotice("signin", { signedIn: false, connected: false })).toEqual({
      tone: "muted",
      text: "Connect your wallet first, then connect your X account.",
    });
  });

  it("never claims a connection from the URL: connected comes from the database alone", () => {
    expect(xNotice("connected", signedIn)).toBeNull();
    expect(xNotice("connected", { signedIn: false, connected: false })).toBeNull();
    expect(xNotice(null, signedIn)).toBeNull();
    expect(xExploreNotice("connected")).toBeNull();
  });

  it("drops a message that no longer fits the wallet", () => {
    for (const outcome of X_OUTCOMES) {
      if (outcome !== "wallet_bound") expect(xNotice(outcome, { signedIn: true, connected: true })).toBeNull();
      if (outcome !== "signin") expect(xNotice(outcome, { signedIn: false, connected: false })).toBeNull();
    }
    expect(xNotice("signin", signedIn)).toBeNull();
    expect(xNotice("wallet_bound", signedIn)).toBeNull();
  });

  it("has a message on the campaign list for an attempt that names no campaign", () => {
    expect(xExploreNotice("retry")).toEqual({ tone: "fail", text: "That X sign-in could not be completed. Open the campaign and try again." });
    expect(xExploreNotice("signin")).toEqual({ tone: "muted", text: "Connect your wallet on the campaign page first, then connect your X account." });
    expect(xExploreNotice("x_failed")).toEqual({ tone: "fail", text: "The X sign-in did not go through. Open the campaign and try again in a moment." });
    expect(xExploreNotice("rate_limited")).toEqual({ tone: "fail", text: "Too many attempts. Try again in a few minutes." });
    for (const outcome of ["connected", "taken", "wallet_bound", "cancelled", "unavailable"] as const) expect(xExploreNotice(outcome)).toBeNull();
    expect(xExploreNotice(null)).toBeNull();
  });

  it("reads only the fixed outcome codes from the URL and returns only to this site's own paths", () => {
    expect(xOutcomeSchema.safeParse("taken").success).toBe(true);
    for (const bad of ["", "TAKEN", "<script>", ["taken", "retry"], undefined]) expect(xOutcomeSchema.safeParse(bad).success).toBe(false);
    // The anchor puts the submit panel, where the message is, in view.
    expect(returnPath("camp-1", "taken")).toBe("/c/camp-1?x=taken#submit");
    expect(noCampaignPath("retry")).toBe("/explore?x=retry");
  });
});
