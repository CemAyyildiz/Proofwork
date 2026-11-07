import { Keypair } from "@stellar/stellar-sdk";
import {
  encodePayloadEnvelope,
  encodeSealedProposal,
  networkFingerprint,
  payloadCommitment,
  resolveSubRosaDeployment,
  type CoreV2Receipt,
} from "@sub-rosa/sdk";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { campaigns, decisions, sealedReviewAssignments, sealedReviews, submissions } from "@/db/schema";
import type { EscrowPort } from "@/escrow/port";
import { sealedAssessmentJson, type SealedAssessment } from "@/domain/sealed-review";
import { FakeDecisionLedger } from "@/ledger/decision-ledger";
import { decide, reviewQueue } from "@/services/review";
import {
  finalizeSealedReview,
  prepareSealedReview,
  recordSealedClear,
  recordSealedCommit,
  registerSealedReview,
  sealedReviewView,
  type ReceiptGateway,
  type RoundPlanner,
  type SealedReviewAuthority,
} from "@/services/sealed-review";
import { makeTestDb } from "./db";

const NETWORK = "Test SDF Network ; September 2015";
const CONTRACT = resolveSubRosaDeployment("testnet").contractId;
const CAMPAIGN = "cmp_sealed";
const SUBMISSION = "sub_sealed";
const ROUND_ID = "42";
const ALL_PASS = { account_genuine: true, content_original: true, task_done: true, follows_brief: true, single_account: true, not_spam: true };

let conn: Db;
let close: () => Promise<void>;
let FUNDER: string;
let R1: string;
let R2: string;
let R3: string;
let authority: SealedReviewAuthority;
let escrowReader: Pick<EscrowPort, "getEscrow">;

const planner: RoundPlanner = {
  plan: async () => ({
    revealRound: 123456,
    commitDeadline: new Date(Date.now() + 300_000),
    revealDeadline: new Date(Date.now() + 900_000),
    auditorPubkey: "11".repeat(32),
  }),
};

beforeEach(async () => {
  ({ db: conn, close } = await makeTestDb());
  FUNDER = Keypair.random().publicKey();
  R1 = Keypair.random().publicKey();
  R2 = Keypair.random().publicKey();
  R3 = Keypair.random().publicKey();
  authority = { adminPubkey: R1 };
  escrowReader = {
    getEscrow: async () => ({
      contractId: "C_SEALED",
      engagementId: "sealed-campaign",
      balance: "5",
      roles: { funder: FUNDER, releaseSigner: R1, approver: "G_OPS", platformAdmin: "G_PLATFORM", platformOps: "G_OPS", disputeResolver: "G_DR" },
      milestones: [],
    }),
  };
  await conn.insert(campaigns).values({
    id: CAMPAIGN,
    slug: "sealed-campaign",
    title: "Sealed campaign",
    brief: "A campaign brief that is long enough.",
    rewardAmount: "1",
    budget: "5",
    deadlineAt: new Date(Date.now() + 86_400_000),
    funderPubkey: FUNDER,
    releaseSignerPubkey: R1,
    founderSealedReview: true,
    disputeResolverPubkey: Keypair.random().publicKey(),
    escrowContractId: "C_SEALED",
    fundedAt: new Date(),
  });
  await conn.insert(submissions).values({
    id: SUBMISSION,
    shortId: "sealed01",
    campaignId: CAMPAIGN,
    contributorPubkey: Keypair.random().publicKey(),
    workUrl: "https://x.com/alice/status/123456789",
  });
});

afterEach(async () => close());

async function prepared() {
  return prepareSealedReview(
    { action: "prepare", submissionId: SUBMISSION, revealDelaySeconds: 600 },
    { pubkey: FUNDER },
    conn,
    new Date(),
    planner,
    authority,
    escrowReader,
  );
}

function baseReceipt(round: Awaited<ReturnType<typeof prepared>>): CoreV2Receipt {
  return {
    version: 2,
    protocolVersion: 2,
    network: NETWORK,
    networkFingerprint: networkFingerprint(NETWORK),
    contractId: CONTRACT,
    exportedAt: new Date().toISOString(),
    roundId: ROUND_ID,
    itemRef: round.itemRef,
    schemaRef: round.schemaRef,
    mode: "ReceiptOnly",
    paymentAsset: null,
    lotAsset: null,
    lotAmount: "0",
    revealRound: round.revealRound,
    drandGenesis: "1692803367",
    drandPeriod: "3",
    clearingRule: "LowestBid",
    commitDeadline: String(Math.floor(round.commitDeadline.getTime() / 1000)),
    revealDeadline: String(Math.floor(round.revealDeadline.getTime() / 1000)),
    operator: FUNDER,
    auditorPubkey: round.auditorPubkey,
    maxParticipants: 2,
    policy: { enforced: true, fixedEscrow: "0", participation: "Allowlist", eligibleParticipants: [R1, FUNDER] },
    bidders: [],
    submissions: {},
    winner: null,
    winningAmount: "0",
    status: "Open",
  };
}

function gateway(receipt: CoreV2Receipt): ReceiptGateway {
  return { contractId: CONTRACT, exportReceipt: async () => structuredClone(receipt) };
}

async function registered() {
  const round = await prepared();
  const receipt = baseReceipt(round);
  await registerSealedReview({ action: "register", sealedReviewId: round.id, roundId: ROUND_ID, txHash: "a".repeat(64) }, { pubkey: FUNDER }, gateway(receipt), conn, authority);
  return { round, receipt };
}

function revealedSubmission(round: Awaited<ReturnType<typeof prepared>>, reviewer: string, note: string) {
  const assessment: SealedAssessment = {
    v: 1,
    roundId: ROUND_ID,
    campaignId: CAMPAIGN,
    submissionId: SUBMISSION,
    rubric: "v2",
    reviewer,
    signals: ALL_PASS,
    reasonCode: "R00_PASS",
    note,
  };
  const envelope = { nonce: new Uint8Array(32).fill(reviewer === R1 ? 1 : 2), payload: encodeSealedProposal({ timelineDays: 1, approach: sealedAssessmentJson(assessment) }) };
  const encoded = encodePayloadEnvelope(envelope);
  return {
    commitment: Buffer.from(payloadCommitment(envelope)).toString("hex"),
    escrow: "0",
    revealedEnvelope: Buffer.from(encoded).toString("hex"),
    revealedAmount: null,
    valid: true,
    settled: true,
    evidence: { ciphertext: null, auditorBlob: null },
  };
}

describe("sealed dual review", () => {
  it("keeps founder-sealed submissions out of the ordinary queue and rejects direct decisions", async () => {
    await expect(reviewQueue(conn, new Set())).resolves.toEqual([]);
    await expect(
      decide(
        {
          submissionId: SUBMISSION,
          signals: ALL_PASS,
          reasonCode: "R00_PASS",
          note: "Attempted ordinary reviewer bypass.",
          secondsTotal: 1,
          secondsPerSignal: {},
          sharedFundingCount: null,
        },
        { pubkey: R1 },
        new FakeDecisionLedger(),
        conn,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await conn.select().from(decisions)).toHaveLength(0);
  });

  it("derives the immutable reviewer pair from founder config and the original campaign creator", async () => {
    const round = await prepared();
    const assigned = await conn.select().from(sealedReviewAssignments).where(eq(sealedReviewAssignments.sealedReviewId, round.id));
    expect(assigned.map((row) => row.reviewerPubkey).sort()).toEqual([R1, FUNDER].sort());
    expect((await conn.select().from(submissions))[0]?.status).toBe("pending");
    expect(await conn.select().from(decisions)).toHaveLength(0);
  });

  it("refuses a round opener other than the original campaign creator", async () => {
    await expect(
      prepareSealedReview(
        { action: "prepare", submissionId: SUBMISSION, revealDelaySeconds: 600 },
        { pubkey: R2 }, conn, new Date(), planner, authority, escrowReader,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a round whose Proofwork binding differs", async () => {
    const round = await prepared();
    const receipt = { ...baseReceipt(round), itemRef: "ff".repeat(32) };
    await expect(
      registerSealedReview({ action: "register", sealedReviewId: round.id, roundId: ROUND_ID, txHash: "a".repeat(64) }, { pubkey: FUNDER }, gateway(receipt), conn, authority),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "submission and round binding mismatch" });
  });

  it("accepts one canonical commit per assigned wallet and stores no plaintext before reveal", async () => {
    const { round, receipt } = await registered();
    receipt.bidders = [R1];
    receipt.submissions[R1] = {
      commitment: "ab".repeat(32),
      escrow: "0",
      revealedEnvelope: null,
      revealedAmount: null,
      valid: false,
      settled: false,
      evidence: { ciphertext: null, auditorBlob: null },
    };
    await recordSealedCommit({ action: "commit", sealedReviewId: round.id, txHash: "b".repeat(64) }, { pubkey: R1 }, gateway(receipt), conn, authority);
    await expect(recordSealedCommit({ action: "commit", sealedReviewId: round.id, txHash: "c".repeat(64) }, { pubkey: R1 }, gateway(receipt), conn, authority)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(recordSealedCommit({ action: "commit", sealedReviewId: round.id, txHash: "d".repeat(64) }, { pubkey: R3 }, gateway(receipt), conn, authority)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const assignment = (await conn.select().from(sealedReviewAssignments).where(eq(sealedReviewAssignments.reviewerPubkey, R1)))[0];
    expect(assignment).toMatchObject({ commitment: "ab".repeat(32), revealedReview: null });
    const view = await sealedReviewView(round.id, { pubkey: R1 }, conn, authority);
    expect(view.revealed).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("private reviewer note");
  });

  it("rejects assignment tampering instead of trusting stored or client identities", async () => {
    const { round } = await registered();
    await conn.update(sealedReviewAssignments).set({ reviewerPubkey: R2 }).where(eq(sealedReviewAssignments.reviewerPubkey, R1));
    await expect(sealedReviewView(round.id, { pubkey: FUNDER }, conn, authority)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects replayed transaction hashes across sealed-review actions", async () => {
    const { round, receipt } = await registered();
    receipt.bidders = [R1, FUNDER];
    receipt.submissions[R1] = {
      commitment: "ab".repeat(32), escrow: "0", revealedEnvelope: null, revealedAmount: null, valid: false, settled: false, evidence: { ciphertext: null, auditorBlob: null },
    };
    receipt.submissions[FUNDER] = {
      commitment: "cd".repeat(32), escrow: "0", revealedEnvelope: null, revealedAmount: null, valid: false, settled: false, evidence: { ciphertext: null, auditorBlob: null },
    };
    const hash = "8".repeat(64);
    await recordSealedCommit({ action: "commit", sealedReviewId: round.id, txHash: hash }, { pubkey: R1 }, gateway(receipt), conn, authority);
    await expect(recordSealedCommit({ action: "commit", sealedReviewId: round.id, txHash: hash }, { pubkey: FUNDER }, gateway(receipt), conn, authority)).rejects.toMatchObject({ code: "CONFLICT", message: "transaction hash was already used by a sealed review action" });
  });

  it("marks an uncleared round expired after its reveal deadline", async () => {
    const { round } = await registered();
    await conn.update(sealedReviews).set({ revealDeadline: new Date(Date.now() - 1000) }).where(eq(sealedReviews.id, round.id));
    const view = await sealedReviewView(round.id, { pubkey: R1 }, conn, authority);
    expect(view.round).toMatchObject({ status: "expired", failureCode: "REVEAL_DEADLINE_PASSED" });
  });

  it("will not record a final decision before canonical receipt verification", async () => {
    const { round } = await registered();
    const ledger = new FakeDecisionLedger();
    await expect(finalizeSealedReview({ action: "finalize", sealedReviewId: round.id, selectedReviewer: R1 }, { pubkey: R1 }, ledger, conn, authority)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(ledger.commits).toHaveLength(0);
    expect(await conn.select().from(decisions)).toHaveLength(0);
  });

  it("verifies both reveals, stores their comparison, and writes only the selected final decision to Proofwork's ledger", async () => {
    const { round, receipt } = await registered();
    receipt.status = "Settled";
    receipt.bidders = [R1, FUNDER];
    receipt.submissions = {
      [R1]: revealedSubmission(round, R1, "Reviewer one verified the work."),
      [FUNDER]: revealedSubmission(round, FUNDER, "Campaign creator independently agrees."),
    };
    for (const reviewer of [R1, FUNDER]) {
      await conn
        .update(sealedReviewAssignments)
        .set({ commitment: receipt.submissions[reviewer]!.commitment, commitTxHash: `${reviewer === R1 ? "b" : "c"}`.repeat(64), revealTxHash: `${reviewer === R1 ? "d" : "f"}`.repeat(64) })
        .where(and(eq(sealedReviewAssignments.sealedReviewId, round.id), eq(sealedReviewAssignments.reviewerPubkey, reviewer)));
    }
    const result = await recordSealedClear({ action: "clear", sealedReviewId: round.id, txHash: "e".repeat(64) }, { pubkey: R1 }, gateway(receipt), conn, authority);
    expect(result.receiptSha256).toMatch(/^[0-9a-f]{64}$/);
    const stored = (await conn.select().from(sealedReviews).where(eq(sealedReviews.id, round.id)))[0];
    expect(stored).toMatchObject({ status: "cleared", receiptVerified: true, receiptSha256: result.receiptSha256 });
    const assignments = await conn.select().from(sealedReviewAssignments).where(eq(sealedReviewAssignments.sealedReviewId, round.id));
    expect(assignments.map((assignment) => assignment.revealedReview && (assignment.revealedReview as { reviewer: string }).reviewer).sort()).toEqual([R1, FUNDER].sort());

    const ledger = new FakeDecisionLedger();
    await expect(finalizeSealedReview({ action: "finalize", sealedReviewId: round.id, selectedReviewer: FUNDER }, { pubkey: FUNDER }, ledger, conn, authority)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(finalizeSealedReview({ action: "finalize", sealedReviewId: round.id, selectedReviewer: FUNDER }, { pubkey: R3 }, ledger, conn, authority)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const final = await finalizeSealedReview({ action: "finalize", sealedReviewId: round.id, selectedReviewer: FUNDER }, { pubkey: R1 }, ledger, conn, authority);
    expect(ledger.commits).toHaveLength(1);
    expect((await conn.select().from(decisions))[0]).toMatchObject({ id: final.decisionId, reviewerPubkey: R1, note: "Campaign creator independently agrees." });
    expect((await conn.select().from(sealedReviews).where(eq(sealedReviews.id, round.id)))[0]).toMatchObject({ status: "finalized", finalDecisionId: final.decisionId });
  });
});
