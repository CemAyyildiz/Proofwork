import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, decisions, escrowOps, payouts, submissions } from "@/db/schema";
import { FakeEscrow } from "@/escrow/fake";
import { idempotencyKey } from "@/lib/ids";
import { txHashOf } from "@/lib/tx";
import { confirmDeploy, confirmFund, prepareDeploy, prepareFund } from "@/services/campaign";
import { prepareOp, recordServerOp, STALE_SUBMITTED_MS, submitOp } from "@/services/escrow-ops";
import { approveForPayout, confirmClose, confirmReleaseOp, prepareClose, prepareReleaseOp } from "@/services/payout";
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

async function campaign() {
  const c = (await conn.select().from(campaigns).where(eq(campaigns.id, CAMPAIGN)))[0];
  if (!c) throw new Error("campaign missing");
  return c;
}

/** Stage a row as `status` with `updated_at` pushed `ms` into the past. */
async function age(opId: string, status: "submitted" | "failed", ms: number) {
  await conn.update(escrowOps).set({ status, updatedAt: new Date(Date.now() - ms) }).where(eq(escrowOps.id, opId));
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

  async function openSubmissions() {
    await conn.insert(submissions).values([
      { id: "sub_p", shortId: "sp", campaignId: CAMPAIGN, contributorPubkey: "G_P", workUrl: "https://x.com/a/status/10", status: "pending" },
      { id: "sub_a", shortId: "sa", campaignId: CAMPAIGN, contributorPubkey: "G_A", workUrl: "https://x.com/a/status/11", status: "appealed" },
    ]);
  }

  async function expectClosed() {
    expect((await campaign()).closedAt).toBeInstanceOf(Date);
    const subs = await conn.select().from(submissions);
    expect(subs.map((x) => x.status)).toEqual(["rejected", "rejected"]);
  }

  it("close confirms from the disputed close milestone and closes the campaign", async () => {
    await funded();
    await openSubmissions();
    const op = await prepareClose(CAMPAIGN, { pubkey: FUNDER }, escrow, conn);
    const res = await confirmClose({ campaignId: CAMPAIGN, opId: op.opId, signedXdr: op.unsignedXdr }, { pubkey: FUNDER }, escrow, conn);
    expect(res.txHash).toBe(txHashOf(op.unsignedXdr));
    expect((await opRow(op.opId)).kind).toBe("dispute");
    await expectClosed();
  });

  it("reconciled close sets closedAt", async () => {
    await funded();
    await openSubmissions();
    const op = await prepareClose(CAMPAIGN, { pubkey: FUNDER }, escrow, conn);
    await escrow.submit(op.unsignedXdr);
    await age(op.opId, "submitted", STALE_SUBMITTED_MS + 1_000);
    await expect(prepareClose(CAMPAIGN, { pubkey: FUNDER }, escrow, conn)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/already confirmed/) });
    await expectClosed();
    await expect(prepareClose(CAMPAIGN, { pubkey: FUNDER }, escrow, conn)).rejects.toMatchObject({ message: "campaign already closed" });
  });

  it("verifier error before a rebuild: retryable conflict, row untouched, nothing built", async () => {
    await releasable();
    const op = await prepareRelease();
    await age(op.opId, "submitted", STALE_SUBMITTED_MS + 1_000);
    const before = await opRow(op.opId);
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
          verify: () => Promise.reject(new Error("read failed")),
          onConfirmed: async () => {},
        },
        conn,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "could not read chain state; retry" });
    expect(built).toBe(0);
    expect(await opRow(op.opId)).toEqual(before);
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
          onConfirmed: async () => {},
        },
        conn,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(built).toBe(0);
  });

  it("reconciled release marks the payout released with the prepared hash, and the next prepare moves on", async () => {
    const { contractId, payoutId } = await releasable();
    await escrow.appendMilestones(contractId, [{ description: "s2", amount: "10", receiver: "G_C2" }]);
    await escrow.approveMilestones(contractId, [2]);
    await conn.insert(submissions).values({ id: "sub_2", shortId: "s2", campaignId: CAMPAIGN, contributorPubkey: "G_C2", workUrl: "https://x.com/a/status/2", status: "decided" });
    await conn.insert(payouts).values({ id: "pay_2", submissionId: "sub_2", milestoneIndex: 2, amount: "10", status: "approved" });

    const op = await prepareRelease();
    expect(op.milestoneIndex).toBe(1);
    await escrow.submit(op.unsignedXdr); // landed; the app died before recording it
    await age(op.opId, "submitted", STALE_SUBMITTED_MS + 1_000);
    await expect(prepareRelease()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/already confirmed/) });
    expect(await payout(payoutId)).toMatchObject({ status: "released", releaseTxHash: txHashOf(op.unsignedXdr) });
    expect((await conn.select().from(submissions).where(eq(submissions.id, "sub_1")))[0]?.status).toBe("paid");

    const next = await prepareRelease();
    expect(next.milestoneIndex).toBe(2);
    expect(next.opId).not.toBe(op.opId);
  });

  it("confirmed op whose payout write was lost: prepare replays the write, then conflicts", async () => {
    const { payoutId } = await releasable();
    const op = await prepareRelease();
    await escrow.submit(op.unsignedXdr);
    const hash = txHashOf(op.unsignedXdr);
    await conn.update(escrowOps).set({ status: "confirmed", txHash: hash }).where(eq(escrowOps.id, op.opId));
    await expect(prepareRelease()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await payout(payoutId)).toMatchObject({ status: "released", releaseTxHash: hash });
    expect(await prepareReleaseOp(CAMPAIGN, { pubkey: FUNDER }, escrow, conn)).toEqual([]);
  });

  it("reconciled fund sets fundedAt", async () => {
    const d = await prepareDeploy(CAMPAIGN, actor, escrow, conn);
    await confirmDeploy({ campaignId: CAMPAIGN, opId: d.opId, signedXdr: d.unsignedXdr }, actor, escrow, conn);
    const f = await prepareFund(CAMPAIGN, actor, escrow, conn);
    await escrow.submit(f.unsignedXdr);
    await age(f.opId, "submitted", STALE_SUBMITTED_MS + 1_000);
    await expect(prepareFund(CAMPAIGN, actor, escrow, conn)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/already confirmed/) });
    expect((await campaign()).fundedAt).toBeInstanceOf(Date);
    await expect(prepareFund(CAMPAIGN, actor, escrow, conn)).rejects.toMatchObject({ message: "campaign already funded" });
  });

  it("confirmed deploy whose contract id write was lost: prepare replays it from the op", async () => {
    const d = await prepareDeploy(CAMPAIGN, actor, escrow, conn);
    const { contractId } = await confirmDeploy({ campaignId: CAMPAIGN, opId: d.opId, signedXdr: d.unsignedXdr }, actor, escrow, conn);
    expect((await opRow(d.opId)).payload).toMatchObject({ contractId });
    await conn.update(campaigns).set({ escrowContractId: null }).where(eq(campaigns.id, CAMPAIGN));
    await expect(prepareDeploy(CAMPAIGN, actor, escrow, conn)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await campaign()).escrowContractId).toBe(contractId);
  });
});

describe("verify closures reject an accepted tx without effect", () => {
  it("deploy: op failed, escrowContractId stays null", async () => {
    const d = await prepareDeploy(CAMPAIGN, actor, escrow, conn);
    escrow.failNextSubmit("accept-without-effect");
    await expect(confirmDeploy({ campaignId: CAMPAIGN, opId: d.opId, signedXdr: d.unsignedXdr }, actor, escrow, conn)).rejects.toMatchObject({ code: "ESCROW" });
    expect((await opRow(d.opId)).status).toBe("failed");
    expect((await campaign()).escrowContractId).toBeNull();
  });

  it("fund: op failed, fundedAt stays null", async () => {
    const d = await prepareDeploy(CAMPAIGN, actor, escrow, conn);
    await confirmDeploy({ campaignId: CAMPAIGN, opId: d.opId, signedXdr: d.unsignedXdr }, actor, escrow, conn);
    const f = await prepareFund(CAMPAIGN, actor, escrow, conn);
    escrow.failNextSubmit("accept-without-effect");
    await expect(confirmFund({ campaignId: CAMPAIGN, opId: f.opId, signedXdr: f.unsignedXdr }, actor, escrow, conn)).rejects.toMatchObject({ code: "ESCROW" });
    expect((await opRow(f.opId)).status).toBe("failed");
    expect((await campaign()).fundedAt).toBeNull();
  });
});

describe("concurrency", () => {
  it("concurrent prepareRelease: one fulfilled, one conflict", async () => {
    await releasable();
    const results = await Promise.allSettled([prepareRelease(), prepareRelease()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : undefined).toMatchObject({ code: "CONFLICT" });
    expect(await conn.select().from(escrowOps).where(eq(escrowOps.kind, "release"))).toHaveLength(1);
  });

  /** Holds the next submit until `release()` is called; `entered` resolves once the row is claimed. */
  function holdSubmit() {
    const original = escrow.submit.bind(escrow);
    let release = () => {};
    let entered = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const reached = new Promise<void>((r) => (entered = r));
    vi.spyOn(escrow, "submit").mockImplementationOnce(async (xdr: string) => {
      entered();
      await gate;
      return original(xdr);
    });
    return { release, reached };
  }

  async function reusedWhileSubmitting() {
    const { payoutId } = await releasable();
    const op = await prepareRelease();
    const hold = holdSubmit();
    const late = confirmReleaseOp({ campaignId: CAMPAIGN, opId: op.opId, signedXdr: op.unsignedXdr }, { pubkey: FUNDER }, escrow, conn);
    await hold.reached;
    await age(op.opId, "submitted", STALE_SUBMITTED_MS + 1_000);
    const again = await prepareRelease();
    expect(again.opId).toBe(op.opId);
    // The funder's new signature claims the reused row before the late result arrives.
    await conn.update(escrowOps).set({ status: "submitted" }).where(eq(escrowOps.id, op.opId));
    return { op, again, late, hold, payoutId };
  }

  it("a late failing submit does not overwrite the reused op", async () => {
    const { again, late, hold, op } = await reusedWhileSubmitting();
    escrow.failNextSubmit("throw");
    hold.release();
    await expect(late).rejects.toThrow(/timed out/);
    const row = await opRow(op.opId);
    expect(row.status).toBe("submitted");
    expect((row.payload as { unsignedHash: string }).unsignedHash).toBe(txHashOf(again.unsignedXdr));
  });

  it("a late landing submit does not overwrite the reused op", async () => {
    const { again, late, hold, op, payoutId } = await reusedWhileSubmitting();
    hold.release();
    await expect(late).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/changed concurrently/) });
    const row = await opRow(op.opId);
    expect(row.status).toBe("submitted");
    expect((row.payload as { unsignedHash: string }).unsignedHash).toBe(txHashOf(again.unsignedXdr));
    expect((await payout(payoutId)).status).toBe("approved");
  });
});

describe("server-signed ops run at most once", () => {
  const keyParts = ["append", CAMPAIGN, "sub_1"];
  const kind = "append_milestones" as const;

  /** A server op whose effect is "on chain" once `run` has succeeded (or `landed` is set). */
  function serverOp(opts: { failFirst?: "before-landing" | "after-landing"; delayMs?: number } = {}) {
    const state = { runs: 0, landed: false };
    const run = async () => {
      state.runs += 1;
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (state.runs === 1 && opts.failFirst === "before-landing") throw new Error("boom");
      state.landed = true;
      if (state.runs === 1 && opts.failFirst === "after-landing") throw new Error("timed out");
      return { txHash: `tx_${state.runs}` };
    };
    const call = () => recordServerOp({ campaignId: CAMPAIGN, kind, keyParts, run, verify: async () => state.landed }, conn);
    return { state, call };
  }

  async function stageSubmitted(ms: number) {
    await conn.insert(escrowOps).values({ id: "op_x", campaignId: CAMPAIGN, kind, idempotencyKey: idempotencyKey(keyParts), payload: {}, status: "submitted" });
    await age("op_x", "submitted", ms);
  }

  it("returns the recorded hash on retry without running again", async () => {
    const op = serverOp();
    await op.call();
    await expect(op.call()).resolves.toEqual({ txHash: "tx_1" });
    expect(op.state.runs).toBe(1);
  });

  it("in flight: conflict, run not called", async () => {
    await stageSubmitted(1_000);
    const op = serverOp();
    await expect(op.call()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/in progress/) });
    expect(op.state.runs).toBe(0);
  });

  it("concurrent first calls: run executes once, the loser gets 409", async () => {
    const op = serverOp({ delayMs: 20 });
    const results = await Promise.allSettled([op.call(), op.call()]);
    expect(op.state.runs).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : undefined).toMatchObject({ code: "CONFLICT" });
  });

  it("a failed op that never landed runs again on retry", async () => {
    const op = serverOp({ failFirst: "before-landing" });
    await expect(op.call()).rejects.toThrow("boom");
    await expect(op.call()).resolves.toEqual({ txHash: "tx_2" });
    expect(op.state.runs).toBe(2);
  });

  it("run throws after landing: confirmed, never run again", async () => {
    const op = serverOp({ failFirst: "after-landing" });
    await expect(op.call()).resolves.toEqual({ txHash: "" });
    expect(await opRow((await conn.select().from(escrowOps))[0]?.id ?? "")).toMatchObject({ status: "confirmed" });
    await expect(op.call()).resolves.toEqual({ txHash: "" });
    expect(op.state.runs).toBe(1);
  });

  it("run returns but the effect is not visible: failed, ESCROW", async () => {
    const res = recordServerOp({ campaignId: CAMPAIGN, kind, keyParts, run: async () => ({ txHash: "tx_p" }), verify: async () => false }, conn);
    await expect(res).rejects.toMatchObject({ code: "ESCROW", message: "effect not visible on chain" });
    expect((await conn.select().from(escrowOps))[0]).toMatchObject({ status: "failed", txHash: "tx_p" });
  });

  it("verifier error before a re-run: retryable conflict, run not called, row untouched", async () => {
    await stageSubmitted(STALE_SUBMITTED_MS + 1_000);
    const before = await opRow("op_x");
    let runs = 0;
    const call = recordServerOp(
      {
        campaignId: CAMPAIGN,
        kind,
        keyParts,
        run: async () => {
          runs += 1;
          return { txHash: "t" };
        },
        verify: () => Promise.reject(new Error("read failed")),
      },
      conn,
    );
    await expect(call).rejects.toMatchObject({ code: "CONFLICT", message: "could not read chain state; retry" });
    expect(runs).toBe(0);
    expect(await opRow("op_x")).toEqual(before);
  });

  it("taken over while running: the first caller records nothing and gets a conflict", async () => {
    let landed = false;
    const call = recordServerOp(
      {
        campaignId: CAMPAIGN,
        kind,
        keyParts,
        run: async () => {
          // A second caller's stale takeover re-claims the row mid-run.
          await conn.update(escrowOps).set({ updatedAt: new Date(Date.now() + 5_000) }).where(eq(escrowOps.idempotencyKey, idempotencyKey(keyParts)));
          landed = true;
          return { txHash: "tx_first" };
        },
        verify: async () => landed,
      },
      conn,
    );
    await expect(call).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/changed concurrently/) });
    expect((await conn.select().from(escrowOps))[0]).toMatchObject({ status: "submitted", txHash: null });
  });

  it("stale submitted row that landed: reconciled as confirmed, no re-run", async () => {
    await stageSubmitted(STALE_SUBMITTED_MS + 1_000);
    const op = serverOp();
    op.state.landed = true;
    await expect(op.call()).resolves.toEqual({ txHash: "" });
    expect(op.state.runs).toBe(0);
    expect(await opRow("op_x")).toMatchObject({ status: "confirmed" });
  });

  it("stale submitted row that never landed: claimed and run once", async () => {
    await stageSubmitted(STALE_SUBMITTED_MS + 1_000);
    const op = serverOp({ delayMs: 20 });
    const results = await Promise.allSettled([op.call(), op.call()]);
    expect(op.state.runs).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await opRow("op_x")).toMatchObject({ status: "confirmed", txHash: "tx_1" });
  });
});

describe("approveForPayout", () => {
  async function passed(): Promise<string> {
    const contractId = await funded();
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
    return contractId;
  }

  it("appends, delivers and approves, each confirmed from chain state", async () => {
    const contractId = await passed();
    await approveForPayout(CAMPAIGN, ["sub_1"], { pubkey: FUNDER }, escrow, conn);
    const m = (await escrow.getEscrow(contractId)).milestones[1];
    expect(m).toMatchObject({ description: "s1 https://x.com/a/status/1", evidence: "https://x.com/a/status/1", approved: true });
    const ops = await conn.select().from(escrowOps);
    expect(ops.filter((o) => ["append_milestones", "mark_delivered", "approve"].includes(o.kind)).map((o) => o.status)).toEqual([
      "confirmed",
      "confirmed",
      "confirmed",
    ]);
    expect((await conn.select().from(payouts))[0]?.status).toBe("approved");
  });

  it.each([
    ["appendMilestones", "append_milestones"],
    ["markDelivered", "mark_delivered"],
    ["approveMilestones", "approve"],
  ] as const)("%s accepted without effect: op failed, ESCROW", async (method, kind) => {
    await passed();
    const noop = { txHash: "tx_noop" };
    if (method === "appendMilestones") vi.spyOn(escrow, method).mockResolvedValueOnce(noop);
    else vi.spyOn(escrow, method).mockResolvedValueOnce([noop]);
    await expect(approveForPayout(CAMPAIGN, ["sub_1"], { pubkey: FUNDER }, escrow, conn)).rejects.toMatchObject({ code: "ESCROW" });
    expect((await conn.select().from(escrowOps).where(eq(escrowOps.kind, kind)))[0]?.status).toBe("failed");
  });
});
