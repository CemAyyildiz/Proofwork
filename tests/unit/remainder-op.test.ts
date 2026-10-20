import { Keypair } from "@stellar/stellar-sdk";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, escrowOps } from "@/db/schema";
import { campaignStage, NO_SUBMISSIONS } from "@/domain/campaign-status";
import { FakeEscrow } from "@/escrow/fake";
import { idempotencyKey } from "@/lib/ids";
import { confirmDeploy, confirmFund, prepareDeploy, prepareFund } from "@/services/campaign";
import { confirmClose, prepareClose } from "@/services/payout";
import { confirmRemainderReturn, prepareRemainderReturn } from "@/services/remainder-op";
import { makeTestDb } from "./db";
import { LIMITS, openGate } from "./funder-wallet";

const CAMPAIGN = "cmp_1";
const RESOLVER = Keypair.random().publicKey();
const FUNDER = Keypair.random().publicKey();
const funder = { pubkey: FUNDER, platformAdmin: "G_ADMIN", platformOps: "G_OPS" };
const resolver = { pubkey: RESOLVER };

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
    rewardAmount: "0.1",
    budget: "0.2",
    deadlineAt: new Date(Date.now() + 86_400_000),
    funderPubkey: FUNDER,
    disputeResolverPubkey: RESOLVER,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await close();
});

async function funded(): Promise<string> {
  const d = await prepareDeploy(CAMPAIGN, funder, escrow, openGate(), conn);
  const { contractId } = await confirmDeploy({ campaignId: CAMPAIGN, opId: d.opId, signedXdr: d.unsignedXdr }, funder, escrow, LIMITS, conn);
  const f = await prepareFund(CAMPAIGN, funder, escrow, openGate().account, conn);
  await confirmFund({ campaignId: CAMPAIGN, opId: f.opId, signedXdr: f.unsignedXdr }, funder, escrow, conn);
  return contractId;
}

/** Funded, then closed by its funder in the app: milestone 0 disputed, 0.2 USDC left. */
async function closed(): Promise<string> {
  const contractId = await funded();
  const c = await prepareClose(CAMPAIGN, { pubkey: FUNDER }, escrow, conn);
  await confirmClose({ campaignId: CAMPAIGN, opId: c.opId, signedXdr: c.unsignedXdr }, { pubkey: FUNDER }, escrow, conn);
  return contractId;
}

const row = async () => {
  const c = (await conn.select().from(campaigns).where(eq(campaigns.id, CAMPAIGN)))[0];
  if (!c) throw new Error("campaign missing");
  return c;
};
const balance = async (contractId: string) => (await escrow.getEscrow(contractId)).balance;
const returnOps = async () => (await conn.select().from(escrowOps)).filter((o) => o.kind === "withdraw_remaining");
const prepare = (actor = resolver) => prepareRemainderReturn(CAMPAIGN, actor, escrow, conn);
/** The resolver's wallet signs the prepared XDR; the fake hashes envelopes without their signatures. */
const confirm = (op: { opId: string; unsignedXdr: string }, actor = resolver, signedXdr = op.unsignedXdr) =>
  confirmRemainderReturn({ campaignId: CAMPAIGN, opId: op.opId, signedXdr }, actor, escrow, conn);

describe("prepareRemainderReturn / confirmRemainderReturn", () => {
  it("returns the whole on-chain balance to the escrow's funder in one distribution, and the campaign reads settled", async () => {
    const contractId = await closed();
    const withdraw = vi.spyOn(escrow, "buildWithdrawRemaining");
    const op = await prepare();
    expect(op).toMatchObject({ amount: "0.2", funder: FUNDER, unsignedXdr: expect.any(String) });
    expect(withdraw).toHaveBeenCalledTimes(1);
    expect(withdraw).toHaveBeenCalledWith(contractId, RESOLVER, [{ address: FUNDER, amount: "0.2" }]);
    expect((await row()).remainderTxHash).toBeNull();

    const { txHash } = await confirm(op);
    expect(txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await balance(contractId)).toBe("0");
    const c = await row();
    expect(c.remainderTxHash).toBe(txHash);
    expect(campaignStage(c, NO_SUBMISSIONS, new Date())).toBe("settled");
    const [rec] = await returnOps();
    expect(rec).toMatchObject({ status: "confirmed", txHash, idempotencyKey: idempotencyKey(["withdraw-remaining", CAMPAIGN]) });
  });

  it("takes the receiver from chain, never from the database", async () => {
    const contractId = await closed();
    // The chain is what pays out; a database that names another funder is refused outright.
    await conn.update(campaigns).set({ funderPubkey: Keypair.random().publicKey() });
    const withdraw = vi.spyOn(escrow, "buildWithdrawRemaining");
    await expect(prepare()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/another funder/) });
    expect(withdraw).not.toHaveBeenCalled();
    expect(await balance(contractId)).toBe("0.2");
  });

  it("a wallet that is not the campaign's resolver is refused with 403 and nothing is built or read", async () => {
    await closed();
    const withdraw = vi.spyOn(escrow, "buildWithdrawRemaining");
    const read = vi.spyOn(escrow, "getEscrow");
    for (const pubkey of [FUNDER, Keypair.random().publicKey()]) {
      await expect(prepare({ pubkey })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(withdraw).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(await returnOps()).toEqual([]);

    const op = await prepare();
    const before = escrow.submits;
    await expect(confirm(op, { pubkey: FUNDER })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(escrow.submits).toBe(before);
  });

  it("a campaign not closed in the app is refused with the escrow:close reason and nothing is built", async () => {
    const contractId = await funded();
    const withdraw = vi.spyOn(escrow, "buildWithdrawRemaining");
    await expect(prepare()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/not closed in the app/) });
    expect(withdraw).not.toHaveBeenCalled();
    expect(await returnOps()).toEqual([]);
    expect(await balance(contractId)).toBe("0.2");
  });

  it("an open payout milestone is refused with the escrow:close reason and nothing is built", async () => {
    const contractId = await closed();
    await escrow.appendMilestones(contractId, [{ description: "s1 x", amount: "0.1", receiver: "G_C1" }]);
    const withdraw = vi.spyOn(escrow, "buildWithdrawRemaining");
    await expect(prepare()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/milestones still open: 1/) });
    expect(withdraw).not.toHaveBeenCalled();
    expect(await returnOps()).toEqual([]);
  });

  it("an escrow whose on-chain resolver is another key is refused", async () => {
    await closed();
    await conn.update(campaigns).set({ disputeResolverPubkey: FUNDER });
    await expect(prepare({ pubkey: FUNDER })).rejects.toMatchObject({ code: "CONFLICT", message: "this wallet is not this escrow's dispute resolver" });
  });

  it("a signed transaction that is not the prepared one is refused with 400 and nothing is sent", async () => {
    const contractId = await closed();
    const op = await prepare();
    const other = await escrow.buildWithdrawRemaining(contractId, RESOLVER, [{ address: RESOLVER, amount: "0.2" }]);
    const before = escrow.submits;
    await expect(confirm(op, resolver, other.unsignedXdr)).rejects.toMatchObject({
      code: "VALIDATION",
      message: "signed transaction does not match the prepared operation",
    });
    expect(escrow.submits).toBe(before);
    expect(await balance(contractId)).toBe("0.2");
    expect((await row()).remainderTxHash).toBeNull();
  });

  it("an empty escrow with no remainder recorded is refused and points at the operator's record command", async () => {
    const contractId = await closed();
    // Swept outside the app, and not recorded.
    await escrow.submit((await escrow.buildWithdrawRemaining(contractId, RESOLVER, [{ address: FUNDER, amount: "0.2" }])).unsignedXdr);
    const withdraw = vi.spyOn(escrow, "buildWithdrawRemaining");
    await expect(prepare()).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(new RegExp(`escrow is empty and no remainder is recorded.*pnpm escrow:close ${contractId} --record <tx hash>`)),
    });
    expect(withdraw).not.toHaveBeenCalled();
  });

  it("a reply lost after the return landed is recorded as landed, under the prepared hash", async () => {
    const contractId = await closed();
    const op = await prepare();
    escrow.failNextSubmit("landed-then-throw");
    const { txHash } = await confirm(op);
    expect(await balance(contractId)).toBe("0");
    expect((await row()).remainderTxHash).toBe(txHash);
    expect((await returnOps())[0]).toMatchObject({ status: "confirmed", txHash });
  });

  it("a submit that failed without landing records nothing, and a fresh prepare can try again", async () => {
    const contractId = await closed();
    const op = await prepare();
    escrow.failNextSubmit("throw");
    await expect(confirm(op)).rejects.toThrow("send-transaction timed out");
    expect(await balance(contractId)).toBe("0.2");
    expect((await row()).remainderTxHash).toBeNull();
    expect((await returnOps())[0]).toMatchObject({ status: "failed" });

    const again = await prepare();
    expect(again.opId).toBe(op.opId);
    const { txHash } = await confirm(again);
    expect((await row()).remainderTxHash).toBe(txHash);
  });

  it("a return accepted without effect is not recorded", async () => {
    const contractId = await closed();
    const op = await prepare();
    escrow.failNextSubmit("accept-without-effect");
    await expect(confirm(op)).rejects.toMatchObject({ code: "ESCROW", message: "effect not visible on chain" });
    expect(await balance(contractId)).toBe("0.2");
    expect((await row()).remainderTxHash).toBeNull();
  });

  it("a returned campaign cannot be returned again, and a lost database write is replayed by the next prepare", async () => {
    await closed();
    const op = await prepare();
    const { txHash } = await confirm(op);
    await expect(prepare()).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(confirm(op)).rejects.toMatchObject({ code: "CONFLICT" });

    // The hash was lost from the campaign row after the op confirmed: the next prepare writes it back.
    await conn.update(campaigns).set({ remainderTxHash: null });
    await expect(prepare()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/already confirmed/) });
    expect((await row()).remainderTxHash).toBe(txHash);
  });

  it("a remainder recorded by the operator between prepare and submit stops the submit before sending", async () => {
    await closed();
    const op = await prepare();
    await conn.update(campaigns).set({ remainderTxHash: "a".repeat(64) });
    const before = escrow.submits;
    await expect(confirm(op)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/already has remainder/) });
    expect(escrow.submits).toBe(before);
  });

  it("an abandoned campaign has nothing to return", async () => {
    const d = await prepareDeploy(CAMPAIGN, funder, escrow, openGate(), conn);
    await confirmDeploy({ campaignId: CAMPAIGN, opId: d.opId, signedXdr: d.unsignedXdr }, funder, escrow, LIMITS, conn);
    await conn.update(campaigns).set({ closedAt: new Date() });
    await expect(prepare()).rejects.toMatchObject({ code: "CONFLICT", message: "the escrow is empty: there is nothing to return" });
  });

  it("an unknown campaign is NOT_FOUND and a draft without escrow is refused", async () => {
    await expect(prepareRemainderReturn("cmp_missing", resolver, escrow, conn)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(prepare()).rejects.toMatchObject({ code: "CONFLICT", message: "campaign has no escrow" });
  });

  it("refuses to submit an operation of another kind", async () => {
    await closed();
    const [closeOp] = (await conn.select().from(escrowOps)).filter((o) => o.kind === "dispute");
    if (!closeOp) throw new Error("no close op");
    await expect(confirm({ opId: closeOp.id, unsignedXdr: "x" })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
