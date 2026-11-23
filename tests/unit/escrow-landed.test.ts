import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, decisions, escrowOps, payouts, submissions } from "@/db/schema";
import { FakeEscrow } from "@/escrow/fake";
import { confirmDeploy, confirmFund, prepareDeploy, prepareFund } from "@/services/campaign";
import { STALE_SUBMITTED_MS } from "@/services/escrow-ops";
import { approveForPayout, confirmClose, confirmReleaseOp, prepareClose, prepareReleaseOp } from "@/services/payout";
import { makeTestDb } from "./db";
import { LIMITS, openGate } from "./funder-wallet";

/**
 * A wallet op is confirmed only under the hash of its own transaction, once
 * the network reports that transaction as successful (B4); a deploy whose
 * reply is lost is found from the transaction itself, or left unresolved
 * (B1); and the budget goes only into the escrow the campaign asked for (B9).
 */

const FUNDER = "G_FUNDER";
const actor = { pubkey: FUNDER, platformAdmin: "G_ADMIN", platformOps: "G_OPS" };
const CAMPAIGN = "cmp_1";

let conn: Db;
let close: () => Promise<void>;
let escrow: FakeEscrow;

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  escrow = new FakeEscrow();
  await conn.insert(campaigns).values({
    id: CAMPAIGN,
    slug: "camp-1",
    title: "Campaign",
    brief: "A brief long enough to pass validation.",
    rewardAmount: "10",
    budget: "100",
    deadlineAt: new Date(Date.now() + 86_400_000),
    funderPubkey: FUNDER,
    disputeResolverPubkey: "G_DR",
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});

const campaign = async () => {
  const c = (await conn.select().from(campaigns).where(eq(campaigns.id, CAMPAIGN)))[0];
  if (!c) throw new Error("campaign missing");
  return c;
};
const opsOf = (kind: "deploy" | "fund" | "release" | "dispute") => conn.select().from(escrowOps).where(eq(escrowOps.kind, kind));
const ageOp = (id: string) => conn.update(escrowOps).set({ updatedAt: new Date(Date.now() - STALE_SUBMITTED_MS - 1_000) }).where(eq(escrowOps.id, id));

async function deployed(): Promise<string> {
  const d = await prepareDeploy(CAMPAIGN, actor, escrow, openGate(), conn);
  return (await confirmDeploy({ campaignId: CAMPAIGN, opId: d.opId, signedXdr: d.unsignedXdr }, actor, escrow, LIMITS, conn)).contractId;
}

async function funded(): Promise<string> {
  const contractId = await deployed();
  const f = await prepareFund(CAMPAIGN, actor, escrow, openGate().account, conn);
  await confirmFund({ campaignId: CAMPAIGN, opId: f.opId, signedXdr: f.unsignedXdr }, actor, escrow, conn);
  return contractId;
}

describe("a deploy whose reply is lost", () => {
  it("is confirmed with the contract id read from its own transaction", async () => {
    const d = await prepareDeploy(CAMPAIGN, actor, escrow, openGate(), conn);
    escrow.failNextSubmit("landed-then-throw");
    const res = await confirmDeploy({ campaignId: CAMPAIGN, opId: d.opId, signedXdr: d.unsignedXdr }, actor, escrow, LIMITS, conn);
    expect(res.contractId).toMatch(/^C_/);
    expect((await campaign()).escrowContractId).toBe(res.contractId);
    expect((await opsOf("deploy")).map((o) => o.status)).toEqual(["confirmed"]);
  });

  it("without a readable contract id stays unresolved: never failed, never deployed twice", async () => {
    escrow.predictDeploy = false;
    const d = await prepareDeploy(CAMPAIGN, actor, escrow, openGate(), conn);
    escrow.failNextSubmit("landed-then-throw");
    await expect(confirmDeploy({ campaignId: CAMPAIGN, opId: d.opId, signedXdr: d.unsignedXdr }, actor, escrow, LIMITS, conn)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/landed but its escrow contract id is unknown; do not deploy again/),
    });
    expect((await opsOf("deploy")).map((o) => o.status)).toEqual(["submitted"]);
    expect((await campaign()).escrowContractId).toBeNull();

    // Once stale, a new prepare asks the chain again and still refuses instead of building a second deploy.
    await ageOp(d.opId);
    const build = vi.spyOn(escrow, "buildDeploy");
    await expect(prepareDeploy(CAMPAIGN, actor, escrow, openGate(), conn)).rejects.toMatchObject({ message: expect.stringMatching(/do not deploy again/) });
    expect(build).not.toHaveBeenCalled();
    expect((await opsOf("deploy")).map((o) => o.status)).toEqual(["submitted"]);
  });

  it("with a predicted contract id that never landed is failed, and the next prepare builds a new deploy", async () => {
    const d = await prepareDeploy(CAMPAIGN, actor, escrow, openGate(), conn);
    escrow.failNextSubmit("throw");
    await expect(confirmDeploy({ campaignId: CAMPAIGN, opId: d.opId, signedXdr: d.unsignedXdr }, actor, escrow, LIMITS, conn)).rejects.toThrow("send-transaction timed out");
    expect((await opsOf("deploy")).map((o) => o.status)).toEqual(["failed"]);
    // The predicted contract was never created: reading it must not block the retry.
    const build = vi.spyOn(escrow, "buildDeploy");
    const again = await prepareDeploy(CAMPAIGN, actor, escrow, openGate(), conn);
    expect(build).toHaveBeenCalledTimes(1);
    const res = await confirmDeploy({ campaignId: CAMPAIGN, opId: again.opId, signedXdr: again.unsignedXdr }, actor, escrow, LIMITS, conn);
    expect((await campaign()).escrowContractId).toBe(res.contractId);
  });

  it("a stale submitted deploy that never landed is reconciled as failed, not wedged", async () => {
    const d = await prepareDeploy(CAMPAIGN, actor, escrow, openGate(), conn);
    // The tab closed after the wallet signed: the row says submitted, nothing reached the chain.
    await conn.update(escrowOps).set({ status: "submitted", txHash: "a".repeat(64) }).where(eq(escrowOps.id, d.opId));
    await ageOp(d.opId);
    const build = vi.spyOn(escrow, "buildDeploy");
    await prepareDeploy(CAMPAIGN, actor, escrow, openGate(), conn);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("without a readable contract id that never landed is failed as usual", async () => {
    escrow.predictDeploy = false;
    const d = await prepareDeploy(CAMPAIGN, actor, escrow, openGate(), conn);
    escrow.failNextSubmit("throw");
    await expect(confirmDeploy({ campaignId: CAMPAIGN, opId: d.opId, signedXdr: d.unsignedXdr }, actor, escrow, LIMITS, conn)).rejects.toThrow("send-transaction timed out");
    expect((await opsOf("deploy")).map((o) => o.status)).toEqual(["failed"]);
  });
});

describe("an effect on chain is not a landed transaction", () => {
  it("a deploy whose own transaction Horizon does not report is not confirmed", async () => {
    vi.spyOn(escrow, "txSucceeded").mockResolvedValue(false);
    const d = await prepareDeploy(CAMPAIGN, actor, escrow, openGate(), conn);
    await expect(confirmDeploy({ campaignId: CAMPAIGN, opId: d.opId, signedXdr: d.unsignedXdr }, actor, escrow, LIMITS, conn)).rejects.toMatchObject({
      message: "effect not visible on chain",
    });
    expect((await opsOf("deploy")).map((o) => o.status)).toEqual(["failed"]);
    expect((await campaign()).escrowContractId).toBeNull();
  });

  it("a budget put there by another transaction does not confirm the prepared fund, and no second fund is built", async () => {
    const contractId = await deployed();
    const f = await prepareFund(CAMPAIGN, actor, escrow, openGate().account, conn);
    const state = escrow.escrows.get(contractId);
    if (!state) throw new Error("escrow missing");
    state.balance = "100"; // funded by a transaction the app never prepared
    escrow.failNextSubmit("accept-without-effect");
    await expect(confirmFund({ campaignId: CAMPAIGN, opId: f.opId, signedXdr: f.unsignedXdr }, actor, escrow, conn)).rejects.toMatchObject({
      message: "effect not visible on chain",
    });
    expect((await campaign()).fundedAt).toBeNull();
    expect((await opsOf("fund")).map((o) => [o.status, o.txHash])).toEqual([["failed", null]]);

    const build = vi.spyOn(escrow, "buildFund");
    await expect(prepareFund(CAMPAIGN, actor, escrow, openGate().account, conn)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/already holds 100 USDC from a transaction this app did not record/),
    });
    expect(build).not.toHaveBeenCalled();
  });

  it("a stale fund whose own transaction landed is reconciled under its hash", async () => {
    await deployed();
    const f = await prepareFund(CAMPAIGN, actor, escrow, openGate().account, conn);
    const { txHash } = await escrow.submit(f.unsignedXdr);
    await conn.update(escrowOps).set({ status: "submitted" }).where(eq(escrowOps.id, f.opId));
    await ageOp(f.opId);
    await expect(prepareFund(CAMPAIGN, actor, escrow, openGate().account, conn)).rejects.toMatchObject({ message: `fund already confirmed (tx ${txHash})` });
    expect((await campaign()).fundedAt).toBeInstanceOf(Date);
  });

  it("a release and a close are not confirmed while Horizon does not report their transactions", async () => {
    await funded();
    await conn.insert(submissions).values({ id: "sub_1", shortId: "s1", campaignId: CAMPAIGN, contributorPubkey: "G_C1", workUrl: "https://x.com/a/status/1", status: "decided" });
    await conn.insert(decisions).values({
      id: "dec_1",
      submissionId: "sub_1",
      reviewerPubkey: "G_REV",
      outcome: "PASS",
      reasonCode: "R00_PASS",
      signals: {},
      note: "",
      canonicalJson: "{}",
      decisionHash: "h",
      ledgerKey: "pw:s1",
    });
    await approveForPayout(CAMPAIGN, ["sub_1"], { pubkey: FUNDER }, escrow, conn);

    const landed = vi.spyOn(escrow, "txSucceeded").mockResolvedValue(false);
    const [r] = await prepareReleaseOp(CAMPAIGN, ["sub_1"], { pubkey: FUNDER }, escrow, conn);
    if (!r) throw new Error("no release prepared");
    await expect(confirmReleaseOp({ campaignId: CAMPAIGN, opId: r.opId, signedXdr: r.unsignedXdr }, { pubkey: FUNDER }, escrow, conn)).rejects.toMatchObject({
      message: "effect not visible on chain",
    });
    expect((await conn.select().from(payouts))[0]).toMatchObject({ status: "approved", releaseTxHash: null });

    // Once Horizon reports it, the release reconciles under its own hash.
    landed.mockRestore();
    await expect(prepareReleaseOp(CAMPAIGN, ["sub_1"], { pubkey: FUNDER }, escrow, conn)).rejects.toMatchObject({ message: expect.stringMatching(/release already confirmed/) });
    const [released] = await conn.select().from(payouts);
    expect(released?.status).toBe("released");
    expect(escrow.landed.has(released?.releaseTxHash ?? "")).toBe(true);

    vi.spyOn(escrow, "txSucceeded").mockResolvedValue(false);
    const c = await prepareClose(CAMPAIGN, { pubkey: FUNDER }, escrow, conn);
    await expect(confirmClose({ campaignId: CAMPAIGN, opId: c.opId, signedXdr: c.unsignedXdr }, { pubkey: FUNDER }, escrow, conn)).rejects.toMatchObject({
      message: "effect not visible on chain",
    });
    expect((await campaign()).closedAt).toBeNull();
    expect((await opsOf("dispute")).map((o) => o.status)).toEqual(["failed"]);
  });
});

describe("the deployed escrow is checked before the budget goes in", () => {
  it.each([
    ["engagementId", (s: { engagementId: string }) => void (s.engagementId = "someone-else")],
    ["disputeResolver", (s: { roles: { disputeResolver: string } }) => void (s.roles.disputeResolver = "G_OTHER")],
    ["releaseSigner", (s: { roles: { releaseSigner?: string } }) => void (s.roles.releaseSigner = "G_OTHER")],
    ["close milestone", (s: { milestones: Array<{ receiver: string }> }) => void ((s.milestones[0] ?? { receiver: "" }).receiver = "G_OTHER")],
    ["close milestone", (s: { milestones: Array<{ amount: string }> }) => void ((s.milestones[0] ?? { amount: "" }).amount = "50")],
    [
      "milestones",
      (s: { milestones: Array<Record<string, unknown>> }) =>
        void s.milestones.push({ index: 1, description: "x", amount: "90", receiver: "G_OTHER", status: "pending", evidence: "", approved: false, released: false, disputed: false, resolved: false }),
    ],
  ] as const)("refuses an escrow with another %s and builds nothing", async (field, change) => {
    const contractId = await deployed();
    const state = escrow.escrows.get(contractId);
    if (!state) throw new Error("escrow missing");
    (change as (s: typeof state) => void)(state);
    const build = vi.spyOn(escrow, "buildFund");
    await expect(prepareFund(CAMPAIGN, actor, escrow, openGate().account, conn)).rejects.toMatchObject({ code: "ESCROW", details: { fields: [field] } });
    expect(build).not.toHaveBeenCalled();
    expect(await opsOf("fund")).toHaveLength(0);
  });

  it("builds the fund for the escrow the campaign asked for", async () => {
    await deployed();
    await expect(prepareFund(CAMPAIGN, actor, escrow, openGate().account, conn)).resolves.toMatchObject({ kind: "fund" });
  });
});
