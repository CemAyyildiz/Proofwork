import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, decisions, funderRequests, payouts, submissions } from "@/db/schema";
import { campaignFacts, campaignPayouts, publicDirectory, publicTotals, recentPayouts } from "@/services/public-directory";
import { makeTestDb } from "./db";

vi.mock("server-only", () => ({}));

const DAY = 86_400_000;
const FUNDER = "G_FUNDER_A";
const OTHER_FUNDER = "G_FUNDER_B";
const HASH = "a".repeat(64);

let conn: Db;
let close: () => Promise<void>;

async function addCampaign(id: string, funderPubkey: string, over: Partial<typeof campaigns.$inferInsert> = {}): Promise<void> {
  await conn.insert(campaigns).values({
    id,
    slug: `slug-${id}`,
    title: `Campaign ${id}`,
    brief: "A brief long enough to pass validation.",
    rewardAmount: "5",
    budget: "100",
    deadlineAt: new Date(Date.now() + DAY),
    fundedAt: new Date(Date.now() - DAY),
    funderPubkey,
    disputeResolverPubkey: "G_DR",
    ...over,
  });
}

let n = 0;
async function addSubmission(campaignId: string, status: typeof submissions.$inferInsert.status = "pending"): Promise<string> {
  n += 1;
  const id = `sub_${n}`;
  await conn.insert(submissions).values({ id, shortId: `s${n}`, campaignId, contributorPubkey: `G_C${n}`, workUrl: `https://x.com/u/status/${n}`, status });
  return id;
}

async function addRequest(id: string, pubkey: string, team: string, status: "pending" | "approved" | "rejected", decidedDaysAgo: number | null): Promise<void> {
  await conn.insert(funderRequests).values({
    id,
    pubkey,
    team,
    note: "note",
    status,
    decidedAt: decidedDaysAgo === null ? null : new Date(Date.now() - decidedDaysAgo * DAY),
    decidedBy: decidedDaysAgo === null ? null : "G_OPS",
  });
}

async function addDecision(id: string, submissionId: string, txHash: string | null, outcome: "PASS" | "FAIL" = "PASS"): Promise<void> {
  await conn.insert(decisions).values({
    id,
    submissionId,
    reviewerPubkey: "G_REV",
    outcome,
    reasonCode: outcome === "PASS" ? "R00_PASS" : "R06_SPAM",
    signals: {},
    note: "n",
    canonicalJson: "{}",
    decisionHash: id,
    ledgerKey: `pw:${id}`,
    txHash,
  });
}

async function addPayout(id: string, submissionId: string, status: typeof payouts.$inferInsert.status, releaseTxHash: string | null, amount = "5"): Promise<void> {
  await conn.insert(payouts).values({ id, submissionId, amount, status, releaseTxHash, releasedAt: status === "released" ? new Date() : null });
}

beforeEach(async () => {
  n = 0;
  ({ db: conn, close } = await makeTestDb());
});

afterEach(async () => {
  await close();
});

describe("team names on the public pages", () => {
  it("come only from approved requests, and the newest approval wins", async () => {
    await addCampaign("c_a", FUNDER);
    await addCampaign("c_b", OTHER_FUNDER);
    await addRequest("r_old", FUNDER, "Old Team", "approved", 5);
    await addRequest("r_new", FUNDER, "New Team", "approved", 1);
    await addRequest("r_rejected", FUNDER, "Rejected Team", "rejected", 0);
    await addRequest("r_pending", FUNDER, "Pending Team", "pending", null);
    await addRequest("r_other_rejected", OTHER_FUNDER, "Never Approved", "rejected", 1);

    const teams = new Map((await publicDirectory(conn)).map((r) => [r.id, r.team]));
    expect(teams.get("c_a")).toBe("New Team");
    expect(teams.get("c_b")).toBeNull();
    expect((await campaignFacts("c_a", conn)).team).toBe("New Team");
    expect((await campaignFacts("c_b", conn)).team).toBeNull();
  });

  it("lists funded campaigns only, with their submission and paid counts", async () => {
    await addCampaign("c_a", FUNDER);
    await addCampaign("c_draft", FUNDER, { fundedAt: null });
    const s1 = await addSubmission("c_a", "paid");
    await addSubmission("c_a");
    await addPayout("p1", s1, "released", HASH);
    expect((await publicDirectory(conn)).map((r) => [r.id, r.submissions, r.paid])).toEqual([["c_a", 2, 1]]);
  });
});

describe("publicTotals", () => {
  it("counts only decisions with a tx hash and only released payouts", async () => {
    await addCampaign("c_a", FUNDER);
    await addCampaign("c_draft", FUNDER, { fundedAt: null });
    const s1 = await addSubmission("c_a", "paid");
    const s2 = await addSubmission("c_a", "decided");
    const s3 = await addSubmission("c_a", "decided");
    await addDecision("d1", s1, HASH);
    await addDecision("d2", s2, null);
    await addDecision("d3", s3, HASH);
    await addPayout("p1", s1, "released", HASH, "7.5");
    await addPayout("p2", s2, "approved", null, "100");
    await addPayout("p3", s3, "failed", null, "100");

    expect(await publicTotals(conn)).toEqual({ paidAmount: "7.5000000", payouts: 1, decisions: 2, campaigns: 1 });
  });
});

describe("recentPayouts", () => {
  it("lists every contributor's released payouts that carry a hash, newest first, up to the limit", async () => {
    await addCampaign("c_a", FUNDER);
    const older = await addSubmission("c_a", "paid");
    const newer = await addSubmission("c_a", "paid");
    const noHash = await addSubmission("c_a", "paid");
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
    await conn.insert(payouts).values([
      { id: "p_older", submissionId: older, amount: "5", status: "released", releaseTxHash: "b".repeat(64), releasedAt: at(30) },
      { id: "p_newer", submissionId: newer, amount: "7", status: "released", releaseTxHash: "c".repeat(64), releasedAt: at(10) },
      { id: "p_nohash", submissionId: noHash, amount: "9", status: "released", releaseTxHash: null, releasedAt: at(1) },
    ]);

    const rows = await recentPayouts(6, conn);
    expect(rows.map((r) => r.releaseTxHash)).toEqual(["c".repeat(64), "b".repeat(64)]);
    expect(rows[0]).toMatchObject({ amount: "7.0000000", campaignSlug: "slug-c_a", campaignTitle: "Campaign c_a" });
    expect((await recentPayouts(1, conn)).map((r) => r.releaseTxHash)).toEqual(["c".repeat(64)]);
  });
});

describe("campaignPayouts", () => {
  it("lists only released payouts that carry a release hash, each with its passing decision", async () => {
    await addCampaign("c_a", FUNDER);
    await addCampaign("c_b", OTHER_FUNDER);
    const paid = await addSubmission("c_a", "paid");
    const noHash = await addSubmission("c_a", "paid");
    const approved = await addSubmission("c_a", "decided");
    const elsewhere = await addSubmission("c_b", "paid");
    await addDecision("d_paid", paid, HASH);
    await addPayout("p_paid", paid, "released", HASH);
    await addPayout("p_nohash", noHash, "released", null);
    await addPayout("p_approved", approved, "approved", null);
    await addPayout("p_elsewhere", elsewhere, "released", HASH);

    const rows = await campaignPayouts("c_a", conn);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ shortId: "s1", releaseTxHash: HASH, decisionId: "d_paid" });
  });
});
