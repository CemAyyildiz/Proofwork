import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, escrowOps, payouts, submissions } from "@/db/schema";
import { FakeEscrow } from "@/escrow/fake";
import { idempotencyKey } from "@/lib/ids";
import { txHashOf } from "@/lib/tx";
import { confirmDeploy, confirmFund, prepareDeploy, prepareFund } from "@/services/campaign";
import { prepareOp, recordServerOp, STALE_SUBMITTED_MS, submitOp } from "@/services/escrow-ops";
import { confirmClose, confirmReleaseOp, prepareClose, prepareReleaseOp } from "@/services/payout";
import { makeTestDb } from "./db";

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
  await close();
});

async function opRow(id: string) {
  const row = (await conn.select().from(escrowOps).where(eq(escrowOps.id, id)))[0];
  if (!row) throw new Error("op row missing");
  return row;
}

/** Deploy and fund through the services, as the funder's wallet would. */
async function funded(): Promise<string> {
  const d = await prepareDeploy(CAMPAIGN, actor, escrow, conn);
  const { contractId } = await confirmDeploy({ campaignId: CAMPAIGN, opId: d.opId, signedXdr: d.unsignedXdr }, actor, escrow, conn);
  const f = await prepareFund(CAMPAIGN, actor, escrow, conn);
  await confirmFund({ campaignId: CAMPAIGN, opId: f.opId, signedXdr: f.unsignedXdr }, actor, escrow, conn);
  return contractId;
}

/** A funded campaign with milestone 1 approved on chain and an approved payout row. */
async function releasable(): Promise<{ contractId: string; payoutId: string }> {
  const contractId = await funded();
  await escrow.appendMilestones(contractId, [{ description: "s1", amount: "10", receiver: "G_C1" }]);
  await escrow.approveMilestones(contractId, [1]);
  await conn.insert(submissions).values({ id: "sub_1", shortId: "s1", campaignId: CAMPAIGN, contributorPubkey: "G_C1", workUrl: "https://x.com/a/status/1", status: "decided" });
  await conn.insert(payouts).values({ id: "pay_1", submissionId: "sub_1", milestoneIndex: 1, amount: "10", status: "approved" });
  return { contractId, payoutId: "pay_1" };
}

async function prepareRelease() {
  const [op] = await prepareReleaseOp(CAMPAIGN, { pubkey: FUNDER }, escrow, conn);
  if (!op) throw new Error("no release prepared");
  return op;
}

async function payout(id: string) {
  const row = (await conn.select().from(payouts).where(eq(payouts.id, id)))[0];
  if (!row) throw new Error("payout missing");
  return row;
}

describe("wallet-signed ops: prepare → submit", () => {
  it("deploy and fund confirm from chain state and write campaign status", async () => {
    const contractId = await funded();
    const c = (await conn.select().from(campaigns).where(eq(campaigns.id, CAMPAIGN)))[0];
    expect(c?.escrowContractId).toBe(contractId);
    expect(c?.fundedAt).toBeInstanceOf(Date);
    expect((await escrow.getEscrow(contractId)).balance).toBe("100");
  });

  it("happy submit: op confirmed with the local tx hash, payout released", async () => {
    const { payoutId } = await releasable();
    const op = await prepareRelease();
    const res = await confirmReleaseOp({ campaignId: CAMPAIGN, opId: op.opId, signedXdr: op.unsignedXdr }, { pubkey: FUNDER }, escrow, conn);
    const hash = txHashOf(op.unsignedXdr);
    expect(res).toEqual({ txHash: hash, milestoneIndex: 1 });
    expect(await opRow(op.opId)).toMatchObject({ status: "confirmed", txHash: hash, error: null });
    expect(await payout(payoutId)).toMatchObject({ status: "released", releaseTxHash: hash });
  });

  it("submit ok but effect not visible: op failed, no payout status written", async () => {
    const { payoutId } = await releasable();
    const op = await prepareRelease();
    escrow.failNextSubmit("accept-without-effect");
    await expect(
      confirmReleaseOp({ campaignId: CAMPAIGN, opId: op.opId, signedXdr: op.unsignedXdr }, { pubkey: FUNDER }, escrow, conn),
    ).rejects.toMatchObject({ code: "ESCROW", message: "effect not visible on chain" });
    expect(await opRow(op.opId)).toMatchObject({ status: "failed", error: "effect not visible on chain" });
    expect((await payout(payoutId)).status).toBe("approved");
  });

  it("submit throws but tx landed: confirmed with the prepared hash, no second release built", async () => {
    const { payoutId } = await releasable();
    const op = await prepareRelease();
    escrow.failNextSubmit("landed-then-throw");
    const res = await confirmReleaseOp({ campaignId: CAMPAIGN, opId: op.opId, signedXdr: op.unsignedXdr }, { pubkey: FUNDER }, escrow, conn);
    const hash = txHashOf(op.unsignedXdr);
    expect(res.txHash).toBe(hash);
    expect(await opRow(op.opId)).toMatchObject({ status: "confirmed", txHash: hash });
    expect(await payout(payoutId)).toMatchObject({ status: "released", releaseTxHash: hash });
    expect(await prepareReleaseOp(CAMPAIGN, { pubkey: FUNDER }, escrow, conn)).toEqual([]);
  });

  it("submit throws and tx did not land: op failed, error rethrown", async () => {
    await releasable();
    const op = await prepareRelease();
    escrow.failNextSubmit("throw");
    await expect(
      confirmReleaseOp({ campaignId: CAMPAIGN, opId: op.opId, signedXdr: op.unsignedXdr }, { pubkey: FUNDER }, escrow, conn),
    ).rejects.toThrow(/timed out/);
    expect(await opRow(op.opId)).toMatchObject({ status: "failed", error: "send-transaction timed out" });
  });

  it("a throwing verifier never confirms", async () => {
    await releasable();
    const op = await prepareRelease();
    await expect(
      submitOp(
        { campaignId: CAMPAIGN, opId: op.opId, signedXdr: op.unsignedXdr, expectedKind: "release", verify: () => Promise.reject(new Error("read failed")) },
        escrow,
        conn,
      ),
    ).rejects.toMatchObject({ code: "ESCROW" });
    expect((await opRow(op.opId)).status).toBe("failed");
  });

  it("kind mismatch: a release XDR submitted as close is rejected before any network call", async () => {
    await releasable();
    const op = await prepareRelease();
    const before = escrow.submits;
    await expect(
      confirmClose({ campaignId: CAMPAIGN, opId: op.opId, signedXdr: op.unsignedXdr }, { pubkey: FUNDER }, escrow, conn),
    ).rejects.toMatchObject({ code: "VALIDATION", message: "operation is a release, not a dispute" });
    expect(escrow.submits).toBe(before);
    expect((await opRow(op.opId)).status).toBe("intent");
  });
});

describe("prepare reconciles stale and failed rows from chain state", () => {
  async function age(opId: string, status: "submitted" | "failed", ms: number) {
    await conn.update(escrowOps).set({ status, updatedAt: new Date(Date.now() - ms) }).where(eq(escrowOps.id, opId));
  }

  it("fresh submitted row: conflict, wait", async () => {
    await releasable();
    const op = await prepareRelease();
    await age(op.opId, "submitted", 1_000);
    await expect(prepareRelease()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/being submitted/) });
  });

  it("stale submitted row whose tx landed: marked confirmed, conflict", async () => {
    await releasable();
    const op = await prepareRelease();
    await escrow.submit(op.unsignedXdr); // landed; the app died before recording it
    await age(op.opId, "submitted", STALE_SUBMITTED_MS + 1_000);
    await expect(prepareRelease()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/already confirmed/) });
    expect(await opRow(op.opId)).toMatchObject({ status: "confirmed", txHash: txHashOf(op.unsignedXdr) });
  });

  it("stale submitted row whose tx never landed: fresh op on the same row", async () => {
    await releasable();
    const op = await prepareRelease();
    await age(op.opId, "submitted", STALE_SUBMITTED_MS + 1_000);
    const again = await prepareRelease();
    expect(again.opId).toBe(op.opId);
    expect(again.unsignedXdr).not.toBe(op.unsignedXdr);
    const row = await opRow(op.opId);
    expect(row.status).toBe("intent");
    expect((row.payload as { unsignedHash: string }).unsignedHash).toBe(txHashOf(again.unsignedXdr));
  });

  it("failed row whose tx later shows on chain: confirmed, conflict", async () => {
    await releasable();
    const op = await prepareRelease();
    escrow.failNextSubmit("throw");
    await expect(
      confirmReleaseOp({ campaignId: CAMPAIGN, opId: op.opId, signedXdr: op.unsignedXdr }, { pubkey: FUNDER }, escrow, conn),
    ).rejects.toThrow();
    await escrow.submit(op.unsignedXdr); // indexer caught up / tx landed late
    await expect(prepareRelease()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await opRow(op.opId)).toMatchObject({ status: "confirmed", txHash: txHashOf(op.unsignedXdr) });
  });

  it("failed row not on chain: reused as intent with a new hash", async () => {
    await releasable();
    const op = await prepareRelease();
    await age(op.opId, "failed", 0);
    const again = await prepareRelease();
    expect(again.opId).toBe(op.opId);
    expect(txHashOf(again.unsignedXdr)).not.toBe(txHashOf(op.unsignedXdr));
    expect((await opRow(op.opId)).status).toBe("intent");
  });

  it("close confirms from the disputed close milestone", async () => {
    await funded();
    const op = await prepareClose(CAMPAIGN, { pubkey: FUNDER }, escrow, conn);
    const res = await confirmClose({ campaignId: CAMPAIGN, opId: op.opId, signedXdr: op.unsignedXdr }, { pubkey: FUNDER }, escrow, conn);
    expect(res.txHash).toBe(txHashOf(op.unsignedXdr));
    expect((await opRow(op.opId)).kind).toBe("dispute");
  });

  it("generic prepareOp: confirmed row is never rebuilt", async () => {
    await releasable();
    const op = await prepareRelease();
    await conn.update(escrowOps).set({ status: "confirmed", txHash: "abc" }).where(eq(escrowOps.id, op.opId));
    let built = 0;
    await expect(
      prepareOp(
        {
          campaignId: CAMPAIGN,
          kind: "release",
          keyParts: ["release", CAMPAIGN, 1],
          build: async () => {
            built += 1;
            return { unsignedXdr: op.unsignedXdr };
          },
          verify: async () => false,
        },
        conn,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(built).toBe(0);
  });
});

describe("server-signed ops run at most once", () => {
  const keyParts = ["append", CAMPAIGN, "sub_1"];

  it("returns the recorded hash on retry without running again", async () => {
    let runs = 0;
    const run = async () => {
      runs += 1;
      return { txHash: "tx_server" };
    };
    await recordServerOp({ campaignId: CAMPAIGN, kind: "append_milestones", keyParts, run }, conn);
    await expect(recordServerOp({ campaignId: CAMPAIGN, kind: "append_milestones", keyParts, run }, conn)).resolves.toEqual({ txHash: "tx_server" });
    expect(runs).toBe(1);
  });

  it("in flight: conflict, run not called", async () => {
    await conn.insert(escrowOps).values({ id: "op_x", campaignId: CAMPAIGN, kind: "append_milestones", idempotencyKey: idempotencyKey(keyParts), payload: {}, status: "submitted" });
    let runs = 0;
    await expect(
      recordServerOp(
        {
          campaignId: CAMPAIGN,
          kind: "append_milestones",
          keyParts,
          run: async () => {
            runs += 1;
            return { txHash: "t" };
          },
        },
        conn,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/in progress/) });
    expect(runs).toBe(0);
  });

  it("concurrent first calls: run executes once, the loser gets 409", async () => {
    let runs = 0;
    const call = () =>
      recordServerOp(
        {
          campaignId: CAMPAIGN,
          kind: "append_milestones",
          keyParts,
          run: async () => {
            runs += 1;
            await new Promise((r) => setTimeout(r, 20));
            return { txHash: "tx_once" };
          },
        },
        conn,
      );
    const results = await Promise.allSettled([call(), call()]);
    expect(runs).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : undefined).toMatchObject({ code: "CONFLICT" });
  });

  it("a failed op runs again on retry", async () => {
    let runs = 0;
    const run = async () => {
      runs += 1;
      if (runs === 1) throw new Error("boom");
      return { txHash: "tx_2" };
    };
    await expect(recordServerOp({ campaignId: CAMPAIGN, kind: "append_milestones", keyParts, run }, conn)).rejects.toThrow("boom");
    await expect(recordServerOp({ campaignId: CAMPAIGN, kind: "append_milestones", keyParts, run }, conn)).resolves.toEqual({ txHash: "tx_2" });
    expect(runs).toBe(2);
  });
});
