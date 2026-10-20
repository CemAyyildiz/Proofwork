import { describe, expect, it } from "vitest";
import { lifecycleNodes } from "@/components/workspace/lifecycle";
import type { Campaign, EscrowOp } from "@/db/schema";
import { campaignStage, NO_SUBMISSIONS } from "@/domain/campaign-status";

const NOW = new Date("2026-10-14T12:00:00Z");
const DAY = 86_400_000;
const tx = (c: string) => c.repeat(64);

const base: Campaign = {
  id: "cmp_1",
  slug: "camp-1",
  title: "Campaign",
  brief: "A brief long enough to pass validation.",
  rewardAmount: "5",
  budget: "50",
  deadlineAt: new Date(NOW.getTime() + DAY),
  funderPubkey: "G_FUNDER",
  disputeResolverPubkey: "G_RESOLVER",
  escrowContractId: null,
  fundedAt: null,
  closedAt: null,
  remainderTxHash: null,
  payoutLockToken: null,
  payoutLockUntil: null,
  createdAt: new Date(NOW.getTime() - 5 * DAY),
};

let n = 0;
const op = (kind: EscrowOp["kind"], status: EscrowOp["status"], txHash: string | null): EscrowOp => {
  n += 1;
  return { id: `op_${n}`, campaignId: base.id, kind, idempotencyKey: `k${n}`, payload: {}, status, txHash, error: null, at: NOW, updatedAt: NOW };
};

const deployed = { ...base, escrowContractId: "C1" };
const funded = { ...deployed, fundedAt: new Date(NOW.getTime() - 3 * DAY) };
const ended = { ...funded, deadlineAt: new Date(NOW.getTime() - DAY) };
const chainOps = [op("deploy", "confirmed", tx("a")), op("fund", "confirmed", tx("b"))];

/** label → [done, txHash] per node. */
function nodes(c: Campaign, ops: EscrowOp[]) {
  const stage = campaignStage(c, NO_SUBMISSIONS, NOW);
  return lifecycleNodes(c, stage, ops, NOW).map((x) => [x.label, x.done, x.txHash]);
}

describe("lifecycleNodes", () => {
  it("draft: only Created is done, and nothing carries a hash", () => {
    expect(nodes(base, [])).toEqual([
      ["Created", true, null],
      ["Escrow deployed", false, null],
      ["Funded", false, null],
      ["Submissions close", false, null],
      ["Closed", false, null],
      ["Remainder returned", false, null],
    ]);
  });

  it("open: deployed and funded are done with their confirmed hashes", () => {
    expect(nodes(funded, chainOps)).toEqual([
      ["Created", true, null],
      ["Escrow deployed", true, tx("a")],
      ["Funded", true, tx("b")],
      ["Submissions close", false, null],
      ["Closed", false, null],
      ["Remainder returned", false, null],
    ]);
  });

  it("ended: submissions are closed; a dispute op not confirmed gives Closed no hash", () => {
    const ops = [...chainOps, op("dispute", "submitted", tx("c")), op("dispute", "failed", tx("d"))];
    expect(nodes(ended, ops)).toEqual([
      ["Created", true, null],
      ["Escrow deployed", true, tx("a")],
      ["Funded", true, tx("b")],
      ["Submissions closed", true, null],
      ["Closed", false, null],
      ["Remainder returned", false, null],
    ]);
  });

  it("closed awaiting return: Closed carries the confirmed dispute tx, the return waits on the resolver", () => {
    const ops = [...chainOps, op("dispute", "failed", tx("d")), op("dispute", "confirmed", tx("c"))];
    const c = { ...ended, closedAt: NOW };
    expect(nodes(c, ops)).toEqual([
      ["Created", true, null],
      ["Escrow deployed", true, tx("a")],
      ["Funded", true, tx("b")],
      ["Submissions closed", true, null],
      ["Closed", true, tx("c")],
      ["Remainder returned", false, null],
    ]);
    expect(lifecycleNodes(c, "closed_awaiting_return", ops, NOW).at(-1)?.detail).toBe("by the resolver G_RE…LVER");
  });

  it("settled: the remainder node carries the remainder tx", () => {
    const ops = [...chainOps, op("dispute", "confirmed", tx("c"))];
    expect(nodes({ ...ended, closedAt: NOW, remainderTxHash: tx("e") }, ops).at(-1)).toEqual(["Remainder returned", true, tx("e")]);
  });

  it("closed before its deadline: submissions read as closed, not as closing in the future", () => {
    const ops = [...chainOps, op("dispute", "confirmed", tx("c"))];
    expect(nodes({ ...funded, closedAt: NOW }, ops)[3]).toEqual(["Submissions closed", true, null]);
  });

  it("abandoned: created, deployed and abandoned only", () => {
    expect(nodes({ ...deployed, closedAt: NOW }, [op("deploy", "confirmed", tx("a"))])).toEqual([
      ["Created", true, null],
      ["Escrow deployed", true, tx("a")],
      ["Abandoned", true, null],
    ]);
  });
});
