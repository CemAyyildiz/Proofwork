import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EscrowCard } from "@/components/escrow-card";
import type { Db } from "@/db/client";
import { campaigns, decisions, payouts, submissions } from "@/db/schema";
import { listPublicCampaigns, mySubmission, publicCampaign } from "@/services/submission";
import { makeTestDb } from "./db";

const CAMPAIGN = "cmp_1";
const SUB = "sub_1";
const CONTRIBUTOR = "G_C1";
const REMAINDER_TX = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const RELEASE_TX = "360d69ee23f843dbb237bd1d7533f14b891ac47bb83fdd9d25bb62eecf20658e";

let conn: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  await conn.insert(campaigns).values({
    id: CAMPAIGN,
    slug: "camp-1",
    title: "Campaign",
    brief: "A brief long enough to pass validation.",
    rewardAmount: "5",
    budget: "100",
    deadlineAt: new Date(Date.now() + 86_400_000),
    funderPubkey: "G_FUNDER",
    disputeResolverPubkey: "G_DR",
  });
  await conn.insert(submissions).values({ id: SUB, shortId: "s1", campaignId: CAMPAIGN, contributorPubkey: CONTRIBUTOR, workUrl: "https://x.com/a/status/1", status: "decided" });
});

afterEach(async () => {
  await close();
});

async function decided(outcome: "PASS" | "FAIL"): Promise<void> {
  await conn.insert(decisions).values({
    id: "dec_1",
    submissionId: SUB,
    reviewerPubkey: "G_REV",
    outcome,
    reasonCode: outcome === "PASS" ? "R00_PASS" : "R03_TASK",
    signals: {},
    note: "note",
    canonicalJson: "{}",
    decisionHash: "h",
    ledgerKey: "pw:s1",
    txHash: "t",
  });
}

describe("publicCampaign", () => {
  it("exposes the budget for the balance meter", async () => {
    const c = await publicCampaign("camp-1", conn);
    expect(c?.budget).toBe("100.0000000");
  });

  it("exposes no remainder tx until one is recorded", async () => {
    expect((await publicCampaign("camp-1", conn))?.remainderTxHash).toBeNull();
    await conn.update(campaigns).set({ closedAt: new Date(), remainderTxHash: REMAINDER_TX }).where(eq(campaigns.id, CAMPAIGN));
    const c = await publicCampaign("camp-1", conn);
    expect(c?.closedAt).not.toBeNull();
    expect(c?.remainderTxHash).toBe(REMAINDER_TX);
  });
});

describe("EscrowCard remainder", () => {
  const card = (p: { closed: boolean; balance: string | null; remainderTxHash: string | null }) =>
    renderToStaticMarkup(createElement(EscrowCard, { contractId: "CCONTRACT", budget: "100", ...p }));

  it("links the recorded remainder tx on a closed campaign", () => {
    const html = card({ closed: true, balance: "0", remainderTxHash: REMAINDER_TX });
    expect(html).toContain("Remainder returned to funder");
    expect(html).toContain(`href="https://stellar.expert/explorer/testnet/tx/${REMAINDER_TX}"`);
  });

  it("shows no remainder on a campaign that is not closed", () => {
    const html = card({ closed: false, balance: "95", remainderTxHash: REMAINDER_TX });
    expect(html).not.toContain("Remainder");
    expect(html).not.toContain(REMAINDER_TX);
  });

  it("says nothing is left when a closed escrow is empty and has no hash", () => {
    const html = card({ closed: true, balance: "0", remainderTxHash: null });
    expect(html).toContain("Nothing left to return");
    expect(html).not.toContain("Remainder return pending");
  });

  it("shows the return as pending while funds remain and no hash is recorded", () => {
    const html = card({ closed: true, balance: "40", remainderTxHash: null });
    expect(html).toContain("Remainder return pending");
    expect(html).not.toContain("/tx/");
  });
});

describe("mySubmission payout", () => {
  it("returns a released payout with its release tx", async () => {
    await decided("PASS");
    await conn.insert(payouts).values({ id: "pay_1", submissionId: SUB, milestoneIndex: 1, amount: "5", status: "released", releaseTxHash: RELEASE_TX, releasedAt: new Date() });
    const mine = await mySubmission(CAMPAIGN, CONTRIBUTOR, conn);
    expect(mine?.payout?.status).toBe("released");
    expect(mine?.payout?.releaseTxHash).toBe(RELEASE_TX);
    expect(Number(mine?.payout?.amount)).toBe(5);
  });

  it("returns an approved payout without a release tx", async () => {
    await decided("PASS");
    await conn.insert(payouts).values({ id: "pay_1", submissionId: SUB, milestoneIndex: 1, amount: "5", status: "approved" });
    const mine = await mySubmission(CAMPAIGN, CONTRIBUTOR, conn);
    expect(mine?.payout?.status).toBe("approved");
    expect(mine?.payout?.releaseTxHash).toBeNull();
  });

  it("returns null when there is no payout (FAIL)", async () => {
    await decided("FAIL");
    const mine = await mySubmission(CAMPAIGN, CONTRIBUTOR, conn);
    expect(mine?.decisions).toHaveLength(1);
    expect(mine?.payout).toBeNull();
  });

  it("returns null when undecided", async () => {
    const mine = await mySubmission(CAMPAIGN, CONTRIBUTOR, conn);
    expect(mine?.decisions).toHaveLength(0);
    expect(mine?.payout).toBeNull();
  });

  it("never returns another contributor's payout", async () => {
    await decided("PASS");
    await conn.insert(payouts).values({ id: "pay_1", submissionId: SUB, milestoneIndex: 1, amount: "5", status: "released", releaseTxHash: RELEASE_TX });
    expect(await mySubmission(CAMPAIGN, "G_OTHER", conn)).toBeNull();
  });
});

describe("listPublicCampaigns", () => {
  const base = {
    brief: "A brief long enough to pass validation.",
    rewardAmount: "5",
    budget: "100",
    funderPubkey: "G_FUNDER",
    disputeResolverPubkey: "G_DR",
  };

  it("lists funded campaigns only, open ones first", async () => {
    const day = 86_400_000;
    await conn.insert(campaigns).values([
      { ...base, id: "cmp_closed", slug: "closed", title: "Closed", deadlineAt: new Date(Date.now() + day), fundedAt: new Date(), closedAt: new Date(), createdAt: new Date(Date.now() + 2000) },
      { ...base, id: "cmp_open", slug: "open", title: "Open", deadlineAt: new Date(Date.now() + day), fundedAt: new Date(), createdAt: new Date(Date.now() + 1000) },
    ]);
    const list = await listPublicCampaigns(conn);
    expect(list.map((c) => c.slug)).toEqual(["open", "closed"]);
    expect(list[0]?.open).toBe(true);
    expect(list.map((c) => c.slug)).not.toContain("camp-1");
  });

  it("is empty when nothing is funded", async () => {
    expect(await listPublicCampaigns(conn)).toEqual([]);
  });
});
