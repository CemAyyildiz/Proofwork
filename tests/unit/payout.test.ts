import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, decisions, escrowOps, payouts, submissions } from "@/db/schema";
import { FakeEscrow } from "@/escrow/fake";
import { confirmDeploy, confirmFund, prepareDeploy, prepareFund } from "@/services/campaign";
import { approveForPayout, prepareClose } from "@/services/payout";
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
  vi.restoreAllMocks();
  await close();
});

/** Deploy and fund through the services, as the funder's wallet would. */
async function funded(): Promise<string> {
  const d = await prepareDeploy(CAMPAIGN, actor, escrow, conn);
  const { contractId } = await confirmDeploy({ campaignId: CAMPAIGN, opId: d.opId, signedXdr: d.unsignedXdr }, actor, escrow, conn);
  const f = await prepareFund(CAMPAIGN, actor, escrow, conn);
  await confirmFund({ campaignId: CAMPAIGN, opId: f.opId, signedXdr: f.unsignedXdr }, actor, escrow, conn);
  return contractId;
}

/** A rubric-passed submission `sN` from contributor `G_CN`. */
async function pass(n: number): Promise<string> {
  const id = `sub_${n}`;
  await conn.insert(submissions).values({ id, shortId: `s${n}`, campaignId: CAMPAIGN, contributorPubkey: `G_C${n}`, workUrl: `https://x.com/a/status/${n}`, status: "decided" });
  await conn.insert(decisions).values({
    id: `dec_${n}`,
    submissionId: id,
    reviewerPubkey: "G_REV",
    outcome: "PASS",
    reasonCode: "R00_PASS",
    signals: {},
    note: "",
    canonicalJson: "{}",
    decisionHash: "h",
    ledgerKey: `pw:s${n}`,
  });
  return id;
}

/** Funded campaign with `count` passed submissions. */
async function passed(count: number): Promise<{ contractId: string; ids: string[] }> {
  const contractId = await funded();
  const ids: string[] = [];
  for (let n = 1; n <= count; n++) ids.push(await pass(n));
  return { contractId, ids };
}

const approve = (ids: string[]) => approveForPayout(CAMPAIGN, ids, { pubkey: FUNDER }, escrow, conn);

async function payoutOf(submissionId: string) {
  return (await conn.select().from(payouts).where(eq(payouts.submissionId, submissionId)))[0];
}

async function opsOf(kind: "append_milestones" | "mark_delivered" | "approve" | "dispute") {
  return conn.select().from(escrowOps).where(eq(escrowOps.kind, kind));
}

async function lease() {
  const c = (await conn.select().from(campaigns).where(eq(campaigns.id, CAMPAIGN)))[0];
  if (!c) throw new Error("campaign missing");
  return { token: c.payoutLockToken, until: c.payoutLockUntil };
}

describe("approveForPayout", () => {
  it("fresh approve: one append, payouts at chain indexes, one deliver and one approve op each", async () => {
    const { contractId, ids } = await passed(2);
    const append = vi.spyOn(escrow, "appendMilestones");
    const res = await approve(ids);

    expect(res.appended).toBe(2);
    expect(res.txHash).not.toBe("");
    expect(append).toHaveBeenCalledTimes(1);
    const ms = (await escrow.getEscrow(contractId)).milestones;
    expect(ms).toHaveLength(3);
    expect(ms[1]).toMatchObject({ description: "s1 https://x.com/a/status/1", receiver: "G_C1", evidence: "https://x.com/a/status/1", approved: true });
    expect(ms[2]).toMatchObject({ description: "s2 https://x.com/a/status/2", receiver: "G_C2", evidence: "https://x.com/a/status/2", approved: true });
    expect(await payoutOf("sub_1")).toMatchObject({ milestoneIndex: 1, status: "approved" });
    expect(await payoutOf("sub_2")).toMatchObject({ milestoneIndex: 2, status: "approved" });
    expect((await opsOf("append_milestones")).map((o) => o.status)).toEqual(["confirmed"]);
    expect((await opsOf("mark_delivered")).map((o) => o.status)).toEqual(["confirmed", "confirmed"]);
    expect((await opsOf("approve")).map((o) => o.status)).toEqual(["confirmed", "confirmed"]);
    expect((await lease()).token).toBeNull();
  });

  it("retry after a landed append: no second append, same indexes, budget not double-counted", async () => {
    const { contractId, ids } = await passed(2);
    // 2 x 40 fits the 100 budget once; counting the landed milestones twice would not.
    await conn.update(campaigns).set({ rewardAmount: "40" }).where(eq(campaigns.id, CAMPAIGN));
    const append = vi.spyOn(escrow, "appendMilestones");
    const read = escrow.getEscrow.bind(escrow);
    let reads = 0;
    // Reads: initial, append verify, then the post-append re-read, which dies here.
    vi.spyOn(escrow, "getEscrow").mockImplementation(async (id) => {
      reads += 1;
      if (reads === 3) throw new Error("rpc down");
      return read(id);
    });
    await expect(approve(ids)).rejects.toThrow("rpc down");
    expect(await payoutOf("sub_1")).toBeUndefined();
    expect((await opsOf("append_milestones"))[0]?.status).toBe("confirmed");

    const res = await approve(ids);
    expect(res).toEqual({ appended: 0, txHash: "" });
    expect(append).toHaveBeenCalledTimes(1);
    expect((await read(contractId)).milestones).toHaveLength(3);
    expect(await payoutOf("sub_1")).toMatchObject({ milestoneIndex: 1, status: "approved" });
    expect(await payoutOf("sub_2")).toMatchObject({ milestoneIndex: 2, status: "approved" });
  });

  it("resumes a milestone_added payout: delivers and approves without a new append", async () => {
    const { ids } = await passed(1);
    const deliver = vi.spyOn(escrow, "markDelivered").mockRejectedValueOnce(new Error("timeout"));
    await expect(approve(ids)).rejects.toThrow("timeout");
    expect(await payoutOf("sub_1")).toMatchObject({ milestoneIndex: 1, status: "milestone_added" });

    const append = vi.spyOn(escrow, "appendMilestones");
    await expect(approve(ids)).resolves.toEqual({ appended: 0, txHash: "" });
    expect(append).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(await payoutOf("sub_1")).toMatchObject({ milestoneIndex: 1, status: "approved" });
  });

  it("resumes a delivered payout: approves without delivering again", async () => {
    const { contractId, ids } = await passed(1);
    vi.spyOn(escrow, "approveMilestones").mockRejectedValueOnce(new Error("timeout"));
    await expect(approve(ids)).rejects.toThrow("timeout");
    expect(await payoutOf("sub_1")).toMatchObject({ status: "delivered" });

    const deliver = vi.spyOn(escrow, "markDelivered");
    await approve(ids);
    expect(deliver).not.toHaveBeenCalled();
    expect(await payoutOf("sub_1")).toMatchObject({ status: "approved" });
    expect((await escrow.getEscrow(contractId)).milestones[1]?.approved).toBe(true);
  });

  it("re-selecting an approved payout makes no chain call", async () => {
    const { ids } = await passed(1);
    await approve(ids);
    const calls = [vi.spyOn(escrow, "appendMilestones"), vi.spyOn(escrow, "markDelivered"), vi.spyOn(escrow, "approveMilestones")];
    await expect(approve(ids)).resolves.toEqual({ appended: 0, txHash: "" });
    for (const c of calls) expect(c).not.toHaveBeenCalled();
    expect(await payoutOf("sub_1")).toMatchObject({ milestoneIndex: 1, status: "approved" });
  });

  it("re-selecting a released payout is refused", async () => {
    const { ids } = await passed(1);
    await approve(ids);
    await conn.update(payouts).set({ status: "released" }).where(eq(payouts.submissionId, "sub_1"));
    await expect(approve(ids)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await payoutOf("sub_1")).toMatchObject({ status: "released" });
  });

  it("a lease held by another run is refused before any chain call", async () => {
    const { ids } = await passed(1);
    await conn.update(campaigns).set({ payoutLockToken: "lease_other", payoutLockUntil: new Date(Date.now() + 60_000) }).where(eq(campaigns.id, CAMPAIGN));
    const read = vi.spyOn(escrow, "getEscrow");
    await expect(approve(ids)).rejects.toMatchObject({ code: "CONFLICT", message: "payout run in progress" });
    expect(read).not.toHaveBeenCalled();
    expect((await lease()).token).toBe("lease_other");
  });

  it("two concurrent approves: one runs, the other is refused", async () => {
    const { ids } = await passed(1);
    const append = vi.spyOn(escrow, "appendMilestones");
    const results = await Promise.allSettled([approve(ids), approve(ids)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({ code: "CONFLICT", message: "payout run in progress" });
    expect(append).toHaveBeenCalledTimes(1);
  });

  it("a stale lease is taken over and the run completes", async () => {
    const { ids } = await passed(1);
    await conn.update(campaigns).set({ payoutLockToken: "lease_dead", payoutLockUntil: new Date(Date.now() - 1_000) }).where(eq(campaigns.id, CAMPAIGN));
    await expect(approve(ids)).resolves.toMatchObject({ appended: 1 });
    expect(await payoutOf("sub_1")).toMatchObject({ status: "approved" });
    expect(await lease()).toEqual({ token: null, until: null });
  });

  it("a milestone with the prefix but another receiver is not taken as appended", async () => {
    const { contractId, ids } = await passed(1);
    await escrow.appendMilestones(contractId, [{ description: "s1 https://x.com/a/status/1", amount: "10", receiver: "G_OTHER" }]);
    await expect(approve(ids)).resolves.toMatchObject({ appended: 1 });
    const ms = (await escrow.getEscrow(contractId)).milestones;
    expect(ms[1]).toMatchObject({ receiver: "G_OTHER", approved: false });
    expect(ms[2]).toMatchObject({ receiver: "G_C1", approved: true });
    expect(await payoutOf("sub_1")).toMatchObject({ milestoneIndex: 2, status: "approved" });
  });

  it("missing rewards over the free balance are refused before any chain write", async () => {
    const { ids } = await passed(2);
    await conn.update(campaigns).set({ rewardAmount: "60" }).where(eq(campaigns.id, CAMPAIGN));
    const append = vi.spyOn(escrow, "appendMilestones");
    await expect(approve(ids)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/cannot cover/) });
    expect(append).not.toHaveBeenCalled();
    expect(await conn.select().from(escrowOps).where(eq(escrowOps.kind, "append_milestones"))).toHaveLength(0);
    expect((await lease()).token).toBeNull();
  });

  it("a lost lease aborts before the next chain step", async () => {
    const { ids } = await passed(1);
    const deliver = escrow.markDelivered.bind(escrow);
    vi.spyOn(escrow, "markDelivered").mockImplementation(async (id, updates) => {
      // Another run takes the lease while this one is mid-step.
      await conn.update(campaigns).set({ payoutLockToken: "lease_thief" }).where(eq(campaigns.id, CAMPAIGN));
      return deliver(id, updates);
    });
    const approveMs = vi.spyOn(escrow, "approveMilestones");
    await expect(approve(ids)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/lost its lease/) });
    expect(approveMs).not.toHaveBeenCalled();
    expect(await payoutOf("sub_1")).toMatchObject({ status: "delivered" });
    expect((await lease()).token).toBe("lease_thief");
  });

  it("renew moves the lease expiry forward under the same token", async () => {
    const { ids } = await passed(1);
    let token: string | null = null;
    const deliver = escrow.markDelivered.bind(escrow);
    vi.spyOn(escrow, "markDelivered").mockImplementation(async (id, updates) => {
      token = (await lease()).token;
      await conn.update(campaigns).set({ payoutLockUntil: new Date(Date.now() - 1_000) }).where(eq(campaigns.id, CAMPAIGN));
      return deliver(id, updates);
    });
    const approveMs = escrow.approveMilestones.bind(escrow);
    let checked = false;
    vi.spyOn(escrow, "approveMilestones").mockImplementation(async (id, idx) => {
      const l = await lease();
      expect(token).not.toBeNull();
      expect(l.token).toBe(token);
      expect(l.until?.getTime()).toBeGreaterThan(Date.now());
      checked = true;
      return approveMs(id, idx);
    });
    await approve(ids);
    expect(checked).toBe(true);
  });

  it("one submission's failed deliver leaves the others approved, and a retry finishes it", async () => {
    const { ids } = await passed(3);
    const deliver = escrow.markDelivered.bind(escrow);
    let failed = false;
    vi.spyOn(escrow, "markDelivered").mockImplementation(async (id, updates) => {
      if (!failed && updates[0]?.index === 2) {
        failed = true;
        throw new Error("timeout");
      }
      return deliver(id, updates);
    });
    const approveMs = vi.spyOn(escrow, "approveMilestones");
    await expect(approve(ids)).rejects.toThrow("timeout");
    expect(await payoutOf("sub_1")).toMatchObject({ status: "approved" });
    expect(await payoutOf("sub_2")).toMatchObject({ milestoneIndex: 2, status: "milestone_added" });
    expect(await payoutOf("sub_3")).toMatchObject({ status: "approved" });

    await expect(approve(ids)).resolves.toEqual({ appended: 0, txHash: "" });
    expect(await payoutOf("sub_2")).toMatchObject({ milestoneIndex: 2, status: "approved" });
    expect(approveMs.mock.calls.map((c) => c[1])).toEqual([[1], [3], [2]]);
  });

  it.each([
    ["appendMilestones", "append_milestones"],
    ["markDelivered", "mark_delivered"],
    ["approveMilestones", "approve"],
  ] as const)("%s accepted without effect: op failed, ESCROW", async (method, kind) => {
    const { ids } = await passed(1);
    const noop = { txHash: "tx_noop" };
    if (method === "appendMilestones") vi.spyOn(escrow, method).mockResolvedValueOnce(noop);
    else vi.spyOn(escrow, method).mockResolvedValueOnce([noop]);
    await expect(approve(ids)).rejects.toMatchObject({ code: "ESCROW" });
    expect((await opsOf(kind))[0]?.status).toBe("failed");
  });
});

describe("prepareClose", () => {
  const closeIt = () => prepareClose(CAMPAIGN, { pubkey: FUNDER }, escrow, conn);

  it.each(["pending", "appealed"] as const)("refused while a submission is %s", async (status) => {
    await passed(0);
    await conn.insert(submissions).values({ id: "sub_r", shortId: "sr", campaignId: CAMPAIGN, contributorPubkey: "G_CR", workUrl: "https://x.com/a/status/9", status });
    await expect(closeIt()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/^1 submission\(s\) still in review/) });
    expect(await opsOf("dispute")).toHaveLength(0);
  });

  it("a prior close that never reached the chain does not lift the review guard", async () => {
    await passed(0);
    const op = await closeIt();
    await conn.update(escrowOps).set({ status: "failed" }).where(eq(escrowOps.id, op.opId));
    await conn.insert(submissions).values({ id: "sub_r", shortId: "sr", campaignId: CAMPAIGN, contributorPubkey: "G_CR", workUrl: "https://x.com/a/status/9", status: "pending" });
    await expect(closeIt()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/still in review/) });
    expect((await opsOf("dispute")).map((o) => o.status)).toEqual(["failed"]);
  });

  it("refused while an approve run holds the lease", async () => {
    await passed(0);
    await conn.update(campaigns).set({ payoutLockToken: "lease_other", payoutLockUntil: new Date(Date.now() + 60_000) }).where(eq(campaigns.id, CAMPAIGN));
    await expect(closeIt()).rejects.toMatchObject({ code: "CONFLICT", message: "payout run in progress" });
    expect(await opsOf("dispute")).toHaveLength(0);
  });

  it("refused when prepared between an approve run's append and its payout upsert", async () => {
    const { ids } = await passed(1);
    const append = escrow.appendMilestones.bind(escrow);
    let raced: unknown = null;
    vi.spyOn(escrow, "appendMilestones").mockImplementation(async (id, ms) => {
      const res = await append(id, ms);
      raced = await closeIt().then(() => "prepared", (e: unknown) => e);
      return res;
    });
    await approve(ids);
    expect(raced).toMatchObject({ code: "CONFLICT", message: "payout run in progress" });
    expect(await opsOf("dispute")).toHaveLength(0);
    expect(await payoutOf("sub_1")).toMatchObject({ status: "approved" });
  });

  it("refused while a payout is unreleased", async () => {
    const { ids } = await passed(1);
    await approve(ids);
    await expect(closeIt()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/unreleased/) });
  });

  it("an unselected PASS submission does not block the close and stays decided", async () => {
    await passed(1);
    const op = await closeIt();
    expect(op.opId).toBeTruthy();
    expect((await opsOf("dispute")).map((o) => o.status)).toEqual(["intent"]);
    const s = (await conn.select().from(submissions).where(eq(submissions.id, "sub_1")))[0];
    expect(s?.status).toBe("decided");
    expect(await payoutOf("sub_1")).toBeUndefined();
  });

  it("prepares the dispute op when every payout is released and the lease is free", async () => {
    const { ids } = await passed(2);
    await approve(ids);
    await conn.update(payouts).set({ status: "released" });
    await conn.update(submissions).set({ status: "paid" });
    const dispute = vi.spyOn(escrow, "buildDispute");
    await expect(closeIt()).resolves.toMatchObject({ unsignedXdr: expect.any(String) });
    expect(dispute).toHaveBeenCalledWith(expect.any(String), FUNDER, [0]);
    expect(await opsOf("dispute")).toHaveLength(1);
  });
});
