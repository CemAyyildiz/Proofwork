import "server-only";
import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
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

/** How long a payout lease holds without renewal; a crashed holder's lease lapses after this. */
export const PAYOUT_LEASE_MS = 10 * 60_000;

/** Extends the caller's lease; throws CONFLICT when another run has taken it. */
export type RenewLease = () => Promise<void>;

/**
 * Runs `fn` while holding the campaign's payout lease, so one approve run at a
 * time touches the escrow. The lease is a token and expiry on the campaign
 * row, not a row lock: the run makes minutes of network calls and must not
 * hold a transaction open. `fn` renews before each chain step; a renewal that
 * finds another token means the lease lapsed and was taken, and aborts.
 */
export async function withPayoutLease<T>(campaignId: string, conn: Db, fn: (renew: RenewLease) => Promise<T>): Promise<T> {
  const token = newId("lease");
  const until = sql`now() + ${`${PAYOUT_LEASE_MS} milliseconds`}::interval`;
  const taken = await conn
    .update(campaigns)
    .set({ payoutLockToken: token, payoutLockUntil: until })
    .where(and(eq(campaigns.id, campaignId), or(isNull(campaigns.payoutLockUntil), lt(campaigns.payoutLockUntil, sql`now()`))))
    .returning({ id: campaigns.id });
  if (taken.length !== 1) throw AppError.conflict("payout run in progress");

  const renew: RenewLease = async () => {
    const kept = await conn
      .update(campaigns)
      .set({ payoutLockUntil: until })
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.payoutLockToken, token)))
      .returning({ id: campaigns.id });
    if (kept.length !== 1) throw AppError.conflict("payout run lost its lease; retry");
  };

  try {
    return await fn(renew);
  } finally {
    try {
      await conn
        .update(campaigns)
        .set({ payoutLockToken: null, payoutLockUntil: null })
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.payoutLockToken, token)));
    } catch (e) {
      // The lease lapses on its own; do not mask the run's own outcome.
      log.warn("payout lease not cleared", { campaignId, err: e instanceof Error ? e.message : String(e) });
    }
  }
}

/**
 * A submission's own milestone on chain: its description starts with
 * `<shortId> ` and it pays the submission's contributor. Never located by
 * index, which depends on what else was appended.
 */
function milestoneOf(milestones: EscrowMilestone[], s: Submission): EscrowMilestone | undefined {
  return milestones.find((m) => m.description.startsWith(`${s.shortId} `) && m.receiver === s.contributorPubkey);
}

async function readMilestone(escrow: EscrowPort, contractId: string, s: Submission): Promise<EscrowMilestone | undefined> {
  return milestoneOf((await escrow.getEscrow(contractId)).milestones, s);
}

/** Pipeline order; `failed` ranks below every step so any confirmed step supersedes it. */
const STEP_RANK: Record<Payout["status"], number> = { failed: -1, milestone_added: 0, delivered: 1, approved: 2, released: 3 };

/** Move a payout to `to` only if it is behind it: the DB never walks back. */
async function advancePayout(conn: Db, payoutId: string, to: "delivered" | "approved"): Promise<void> {
  const behind = (Object.keys(STEP_RANK) as Array<Payout["status"]>).filter((s) => STEP_RANK[s] < STEP_RANK[to]);
  await conn
    .update(payouts)
    .set({ status: to })
    .where(and(eq(payouts.id, payoutId), inArray(payouts.status, behind)));
}

/**
 * Funder's final approval for a set of rubric-passed submissions, run as a
 * resumable pipeline under the campaign's payout lease:
 *
 *   read chain → append the milestones not on chain (one update-escrow)
 *              → re-read chain, record each payout at its own milestone index
 *              → per submission: deliver, then approve, each only if not on chain
 *
 * Chain state decides every skip, so a retry after any partial failure
 * finishes the work without a second chain effect. All steps are
 * platform-signed and move no money.
 */
export async function approveForPayout(
  campaignId: string,
  submissionIds: string[],
  actor: { pubkey: string },
  escrow: EscrowPort,
  conn: Db = db,
): Promise<{ appended: number; txHash: string }> {
  await campaignOwnedBy(campaignId, actor.pubkey, conn);
  const unique = [...new Set(submissionIds)];
  if (unique.length === 0) throw AppError.validation("no submissions selected");

  return withPayoutLease(campaignId, conn, async (renew) => {
    const c = await campaignOwnedBy(campaignId, actor.pubkey, conn);
    if (!c.escrowContractId || !c.fundedAt) throw AppError.conflict("campaign is not funded");
    if (c.closedAt) throw AppError.conflict("campaign is closed");
    const contractId = c.escrowContractId;

    const rows = await submissionsForFunder(campaignId, conn);
    const chosen = rows.filter((r) => unique.includes(r.submission.id));
    if (chosen.length !== unique.length) throw AppError.notFound("submission");
    for (const r of chosen) {
      if (r.payout?.status === "released") throw AppError.conflict(`${r.submission.shortId} is already paid`);
      if (r.submission.status !== "decided" || r.latest?.outcome !== "PASS") {
        throw AppError.conflict(`${r.submission.shortId} has not passed the rubric`);
      }
    }

    // Chain first: only submissions without their own milestone need one.
    await renew();
    const state = await escrow.getEscrow(contractId);
    const missing = chosen.filter((r) => !milestoneOf(state.milestones, r.submission));

    let txHash = "";
    if (missing.length > 0) {
      // Budget check against what is actually still in escrow, for the new rewards only.
      const committed = state.milestones.filter((m) => !m.released && !m.resolved).reduce((acc, m) => addAmounts(acc, m.amount), "0");
      const needed = missing.reduce((acc) => addAmounts(acc, c.rewardAmount), "0");
      if (toStroops(committed) + toStroops(needed) > toStroops(state.balance)) {
        throw AppError.conflict(`escrow balance ${state.balance} cannot cover ${needed} more in rewards`);
      }
      await renew();
      const res = await recordServerOp(
        {
          campaignId,
          kind: "append_milestones",
          keyParts: ["append", campaignId, ...missing.map((r) => r.submission.id).sort()],
          run: () =>
            escrow.appendMilestones(
              contractId,
              missing.map((r) => ({
                description: `${r.submission.shortId} ${r.submission.workUrl}`,
                amount: c.rewardAmount,
                receiver: r.submission.contributorPubkey,
              })),
            ),
          verify: async () => {
            const { milestones } = await escrow.getEscrow(contractId);
            return missing.every((r) => milestoneOf(milestones, r.submission) !== undefined);
          },
        },
        conn,
      );
      txHash = res.txHash;
    }

    // Every payout points at its own milestone as the chain reports it now.
    await renew();
    const after = await escrow.getEscrow(contractId);
    const plan: Array<{ row: FunderSubmissionRow; milestone: EscrowMilestone; payoutId: string }> = [];
    for (const r of chosen) {
      const m = milestoneOf(after.milestones, r.submission);
      if (!m) throw new AppError("ESCROW", `milestone for ${r.submission.shortId} not visible on chain`);
      const [p] = await conn
        .insert(payouts)
        .values({ id: newId("pay"), submissionId: r.submission.id, milestoneIndex: m.index, amount: c.rewardAmount, status: "milestone_added" })
        .onConflictDoUpdate({ target: payouts.submissionId, set: { milestoneIndex: m.index }, setWhere: ne(payouts.status, "released") })
        .returning({ id: payouts.id });
      if (!p) throw AppError.conflict(`${r.submission.shortId} is already paid`);
      plan.push({ row: r, milestone: m, payoutId: p.id });
    }

    // Deliver and approve per submission, so one failure does not hold back the rest.
    const failures: Array<{ shortId: string; error: unknown }> = [];
    try {
      for (const { row, milestone: m, payoutId } of plan) {
        const s = row.submission;
        await renew();
        try {
          if (!m.approved && m.evidence !== s.workUrl) {
            await recordServerOp(
              {
                campaignId,
                kind: "mark_delivered",
                keyParts: ["deliver", campaignId, s.id],
                run: async () => {
                  const [sub] = await escrow.markDelivered(contractId, [{ index: m.index, evidence: s.workUrl }]);
                  if (!sub) throw new AppError("ESCROW", "provider returned no transaction");
                  return sub;
                },
                verify: async () => (await readMilestone(escrow, contractId, s))?.evidence === s.workUrl,
              },
              conn,
            );
          }
          await advancePayout(conn, payoutId, "delivered");
        } catch (error) {
          failures.push({ shortId: s.shortId, error });
          continue;
        }

        await renew();
        try {
          if (!m.approved) {
            await recordServerOp(
              {
                campaignId,
                kind: "approve",
                keyParts: ["approve", campaignId, s.id],
                run: async () => {
                  const [sub] = await escrow.approveMilestones(contractId, [m.index]);
                  if (!sub) throw new AppError("ESCROW", "provider returned no transaction");
                  return sub;
                },
                verify: async () => (await readMilestone(escrow, contractId, s))?.approved === true,
              },
              conn,
            );
          }
          await advancePayout(conn, payoutId, "approved");
        } catch (error) {
          failures.push({ shortId: s.shortId, error });
        }
      }
    } finally {
      // Logged on every exit, including a lost lease that aborts the loop.
      for (const f of failures) {
        log.error("payout step failed", { campaignId, shortId: f.shortId, err: f.error instanceof Error ? f.error.message : String(f.error) });
      }
    }
    const first = failures[0];
    if (first) throw first.error;
    log.info("payouts approved", { campaignId, count: chosen.length, appended: missing.length, appendTx: txHash });
    return { appended: missing.length, txHash };
  });
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
