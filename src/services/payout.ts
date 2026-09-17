import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, type Db } from "@/db/client";
import { campaigns, decisions, payouts, submissions, type Campaign, type Decision, type EscrowOp, type Payout, type Submission } from "@/db/schema";
import { addAmounts, toStroops } from "@/escrow/amount";
import type { EscrowMilestone, EscrowPort } from "@/escrow/port";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { log } from "@/lib/logger";
import { campaignOwnedBy, findOp, prepareOp, recordServerOp, submitOp, type OnConfirmed, type PreparedOp, type Verify } from "./escrow-ops";

/**
 * Payout pipeline (architecture §3.1), per approved submission:
 *
 *   funder selects in UI  →  platform appends milestone   (server key)
 *                         →  platform marks delivered     (server key)
 *                         →  platform approves milestone  (server key)
 *                         →  funder signs release-milestone-funds  (one wallet signature)
 *
 * Money only moves on the funder's signature; the release is the funder's
 * final approval. The DB mirrors chain state.
 */
export interface FunderSubmissionRow {
  submission: Submission;
  latest: Decision | null;
  payout: Payout | null;
}

export async function submissionsForFunder(campaignId: string, conn: Db = db): Promise<FunderSubmissionRow[]> {
  const subs = await conn.select().from(submissions).where(eq(submissions.campaignId, campaignId)).orderBy(asc(submissions.submittedAt));
  if (subs.length === 0) return [];
  const ids = subs.map((s) => s.id);
  const ds = await conn.select().from(decisions).where(inArray(decisions.submissionId, ids)).orderBy(desc(decisions.decidedAt));
  const ps = await conn.select().from(payouts).where(inArray(payouts.submissionId, ids));
  const latest = new Map<string, Decision>();
  for (const d of ds) if (!latest.has(d.submissionId)) latest.set(d.submissionId, d);
  const payoutBySub = new Map(ps.map((p) => [p.submissionId, p]));
  return subs.map((s) => ({ submission: s, latest: latest.get(s.id) ?? null, payout: payoutBySub.get(s.id) ?? null }));
}

/**
 * Each chosen submission's milestone on chain, located by its description
 * prefix (`<shortId> `), or null when any is missing. Never by index: the
 * index is recomputed on retry.
 */
async function chosenMilestones(escrow: EscrowPort, contractId: string, chosen: FunderSubmissionRow[]): Promise<EscrowMilestone[] | null> {
  const { milestones } = await escrow.getEscrow(contractId);
  const found: EscrowMilestone[] = [];
  for (const r of chosen) {
    const m = milestones.find((x) => x.description.startsWith(`${r.submission.shortId} `));
    if (!m) return null;
    found.push(m);
  }
  return found;
}

/**
 * Funder's final approval for a set of rubric-passed submissions. Appends
 * one milestone per submission in a single update-escrow call, then marks
 * each delivered. Both are platform-signed and move no money.
 */
export async function approveForPayout(
  campaignId: string,
  submissionIds: string[],
  actor: { pubkey: string },
  escrow: EscrowPort,
  conn: Db = db,
): Promise<{ appended: number; txHash: string }> {
  const c = await campaignOwnedBy(campaignId, actor.pubkey, conn);
  if (!c.escrowContractId || !c.fundedAt) throw AppError.conflict("campaign is not funded");
  if (c.closedAt) throw AppError.conflict("campaign is closed");
  const unique = [...new Set(submissionIds)];
  if (unique.length === 0) throw AppError.validation("no submissions selected");

  const rows = await submissionsForFunder(campaignId, conn);
  const chosen = rows.filter((r) => unique.includes(r.submission.id));
  if (chosen.length !== unique.length) throw AppError.notFound("submission");
  for (const r of chosen) {
    if (r.submission.status !== "decided" || r.latest?.outcome !== "PASS") {
      throw AppError.conflict(`${r.submission.shortId} has not passed the rubric`);
    }
    if (r.payout) throw AppError.conflict(`${r.submission.shortId} already queued for payout`);
  }

  // Budget check against what is actually still in escrow.
  const state = await escrow.getEscrow(c.escrowContractId);
  const committed = state.milestones.filter((m) => !m.released && !m.resolved).reduce((acc, m) => addAmounts(acc, m.amount), "0");
  const needed = chosen.reduce((acc) => addAmounts(acc, c.rewardAmount), "0");
  if (toStroops(committed) + toStroops(needed) > toStroops(state.balance)) {
    throw AppError.conflict(`escrow balance ${state.balance} cannot cover ${needed} more in rewards`);
  }

  const startIndex = state.milestones.length;
  const contractId = c.escrowContractId;
  const res = await recordServerOp(
    {
      campaignId,
      kind: "append_milestones",
      keyParts: ["append", campaignId, ...chosen.map((r) => r.submission.id).sort()],
      run: () =>
        escrow.appendMilestones(
          contractId,
          chosen.map((r) => ({
            description: `${r.submission.shortId} ${r.submission.workUrl}`,
            amount: c.rewardAmount,
            receiver: r.submission.contributorPubkey,
          })),
        ),
      verify: async () => (await chosenMilestones(escrow, contractId, chosen)) !== null,
    },
    conn,
  );

  for (const [i, r] of chosen.entries()) {
    await conn.insert(payouts).values({
      id: newId("pay"),
      submissionId: r.submission.id,
      milestoneIndex: startIndex + i,
      amount: c.rewardAmount,
      status: "milestone_added",
    });
  }

  const delivered = await recordServerOp(
    {
      campaignId,
      kind: "mark_delivered",
      keyParts: ["deliver", campaignId, ...chosen.map((r) => r.submission.id).sort()],
      run: async () => {
        const subs = await escrow.markDelivered(
          contractId,
          chosen.map((r, i) => ({ index: startIndex + i, evidence: r.submission.workUrl })),
        );
        return { txHash: subs.at(-1)?.txHash ?? "" };
      },
      verify: async () => {
        const ms = await chosenMilestones(escrow, contractId, chosen);
        return ms !== null && ms.every((m, i) => m.evidence === chosen[i]?.submission.workUrl);
      },
    },
    conn,
  );
  await conn
    .update(payouts)
    .set({ status: "delivered" })
    .where(inArray(payouts.submissionId, chosen.map((r) => r.submission.id)));

  const approved = await recordServerOp(
    {
      campaignId,
      kind: "approve",
      keyParts: ["approve", campaignId, ...chosen.map((r) => r.submission.id).sort()],
      run: async () => {
        const subs = await escrow.approveMilestones(contractId, chosen.map((_r, i) => startIndex + i));
        return { txHash: subs.at(-1)?.txHash ?? "" };
      },
      verify: async () => {
        const ms = await chosenMilestones(escrow, contractId, chosen);
        return ms !== null && ms.every((m) => m.approved);
      },
    },
    conn,
  );
  await conn
    .update(payouts)
    .set({ status: "approved" })
    .where(inArray(payouts.submissionId, chosen.map((r) => r.submission.id)));
  log.info("payouts queued", { campaignId, count: chosen.length, appendTx: res.txHash, deliverTx: delivered.txHash, approveTx: approved.txHash });
  return { appended: chosen.length, txHash: res.txHash };
}

/** A release is visible once the milestone reads back as released. */
function releaseVisible(escrow: EscrowPort, contractId: string, idx: number): Verify {
  return async () => (await escrow.getEscrow(contractId)).milestones[idx]?.released === true;
}

/** A close is visible once the close milestone (index 0) reads back as disputed. */
function closeVisible(escrow: EscrowPort, contractId: string): Verify {
  return async () => (await escrow.getEscrow(contractId)).milestones[0]?.disputed === true;
}

/** Mark the released milestone's payout (still `approved`) released with the op's tx hash. */
function releaseConfirmed(campaignId: string, conn: Db): OnConfirmed {
  return async (op: EscrowOp) => {
    const idx = (op.payload as { milestoneIndex?: number | null }).milestoneIndex;
    if (idx === null || idx === undefined) throw new AppError("INTERNAL", "operation has no milestone index");
    const row = (
      await conn
        .select({ p: payouts })
        .from(payouts)
        .innerJoin(submissions, eq(submissions.id, payouts.submissionId))
        .where(and(eq(submissions.campaignId, campaignId), eq(payouts.milestoneIndex, idx)))
        .limit(1)
    )[0];
    if (!row) throw AppError.notFound("payout");
    const moved = await conn
      .update(payouts)
      .set({ status: "released", releaseTxHash: op.txHash, releasedAt: new Date() })
      .where(and(eq(payouts.id, row.p.id), eq(payouts.status, "approved")))
      .returning({ id: payouts.id });
    if (moved.length === 1 || row.p.status === "released") {
      await conn.update(submissions).set({ status: "paid" }).where(eq(submissions.id, row.p.submissionId));
    }
  };
}

/** Close the campaign and reject whatever is still open. */
function closeConfirmed(campaignId: string, conn: Db): OnConfirmed {
  return async () => {
    await conn.update(campaigns).set({ closedAt: new Date() }).where(and(eq(campaigns.id, campaignId), isNull(campaigns.closedAt)));
    await conn
      .update(submissions)
      .set({ status: "rejected" })
      .where(and(eq(submissions.campaignId, campaignId), inArray(submissions.status, ["pending", "appealed"])));
  };
}

/**
 * Build the funder's next release transaction. One at a time on purpose:
 * every envelope carries the funder account's sequence number, so two
 * prepared together cannot both be submitted. The client loops
 * prepare → sign → submit until nothing is returned.
 */
export async function prepareReleaseOp(
  campaignId: string,
  actor: { pubkey: string },
  escrow: EscrowPort,
  conn: Db = db,
): Promise<PreparedOp[]> {
  const c = await campaignOwnedBy(campaignId, actor.pubkey, conn);
  if (!c.escrowContractId) throw AppError.conflict("campaign is not funded");
  const kind = "release" as const;
  const wanted: Payout["status"] = "approved";
  const rows = await conn
    .select({ p: payouts })
    .from(payouts)
    .innerJoin(submissions, eq(submissions.id, payouts.submissionId))
    .where(and(eq(submissions.campaignId, campaignId), eq(payouts.status, wanted)))
    .orderBy(asc(payouts.milestoneIndex))
    .limit(1);
  const contractId = c.escrowContractId;
  const out: PreparedOp[] = [];
  for (const { p } of rows) {
    if (p.milestoneIndex === null) continue;
    const idx = p.milestoneIndex;
    out.push(
      await prepareOp(
        {
          campaignId,
          kind,
          keyParts: [kind, campaignId, idx],
          build: async () => {
            const built = await escrow.buildRelease(contractId, c.funderPubkey, [idx]);
            const u = built[0];
            if (!u) throw new AppError("ESCROW", "provider returned no transaction");
            return { unsignedXdr: u.unsignedXdr, milestoneIndex: idx };
          },
          verify: releaseVisible(escrow, contractId, idx),
          onConfirmed: releaseConfirmed(campaignId, conn),
        },
        conn,
      ),
    );
  }
  return out;
}

export async function confirmReleaseOp(
  input: { campaignId: string; opId: string; signedXdr: string },
  actor: { pubkey: string },
  escrow: EscrowPort,
  conn: Db = db,
): Promise<{ txHash: string; milestoneIndex: number }> {
  const c = await campaignOwnedBy(input.campaignId, actor.pubkey, conn);
  if (!c.escrowContractId) throw AppError.conflict("campaign is not funded");
  const op = await findOp(input.opId, input.campaignId, conn);
  if (op.kind !== "release") throw AppError.validation(`operation is a ${op.kind}, not a release`);
  const idx = (op.payload as { milestoneIndex?: number | null }).milestoneIndex;
  if (idx === null || idx === undefined) throw new AppError("INTERNAL", "operation has no milestone index");
  const res = await submitOp({ ...input, expectedKind: "release", verify: releaseVisible(escrow, c.escrowContractId, idx) }, escrow, conn);
  await releaseConfirmed(input.campaignId, conn)(res.op);
  return { txHash: res.txHash, milestoneIndex: idx };
}

/** Funder closes the campaign: disputes the close milestone so the resolver can sweep the remainder. */
export async function prepareClose(campaignId: string, actor: { pubkey: string }, escrow: EscrowPort, conn: Db = db): Promise<PreparedOp> {
  const c = await campaignOwnedBy(campaignId, actor.pubkey, conn);
  if (!c.escrowContractId) throw AppError.conflict("campaign is not funded");
  if (c.closedAt) throw AppError.conflict("campaign already closed");
  const open = await conn
    .select({ id: payouts.id })
    .from(payouts)
    .innerJoin(submissions, eq(submissions.id, payouts.submissionId))
    .where(and(eq(submissions.campaignId, campaignId), inArray(payouts.status, ["milestone_added", "delivered", "approved"])));
  if (open.length > 0) throw AppError.conflict(`${open.length} payout(s) still unreleased; release or resolve them first`);
  const contractId = c.escrowContractId;
  return prepareOp(
    {
      campaignId,
      kind: "dispute",
      keyParts: ["dispute-close", campaignId],
      build: async () => {
        const u = (await escrow.buildDispute(contractId, c.funderPubkey, [0]))[0];
        if (!u) throw new AppError("ESCROW", "provider returned no transaction");
        return { unsignedXdr: u.unsignedXdr, milestoneIndex: 0 };
      },
      verify: closeVisible(escrow, contractId),
      onConfirmed: closeConfirmed(campaignId, conn),
    },
    conn,
  );
}

export async function confirmClose(
  input: { campaignId: string; opId: string; signedXdr: string },
  actor: { pubkey: string },
  escrow: EscrowPort,
  conn: Db = db,
): Promise<{ txHash: string }> {
  const c = await campaignOwnedBy(input.campaignId, actor.pubkey, conn);
  if (!c.escrowContractId) throw AppError.conflict("campaign is not funded");
  const res = await submitOp({ ...input, expectedKind: "dispute", verify: closeVisible(escrow, c.escrowContractId) }, escrow, conn);
  await closeConfirmed(input.campaignId, conn)(res.op);
  return { txHash: res.txHash };
}

/** Record the resolver's remainder sweep (done outside the app with the resolver key). */
export async function recordRemainder(campaignId: string, txHash: string, conn: Db = db): Promise<Campaign> {
  const [row] = await conn.update(campaigns).set({ remainderTxHash: txHash }).where(eq(campaigns.id, campaignId)).returning();
  if (!row) throw AppError.notFound("campaign");
  return row;
}
