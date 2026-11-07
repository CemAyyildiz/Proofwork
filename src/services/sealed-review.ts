import "server-only";
import { and, eq, inArray, isNotNull, isNull, notExists, or } from "drizzle-orm";
import {
  SEALED_PROPOSAL_SCHEMA_REF,
  SubRosaClient,
  chainInfo,
  decodePayloadEnvelope,
  decodeSealedProposal,
  drandRoundTime,
  generateAuditorKeypair,
  quicknet,
  roundInSeconds,
  serializeReceiptV2,
  verifyReceiptV2,
  type CoreV2Receipt,
} from "@sub-rosa/sdk";
import { z } from "zod";
import { campaigns, sealedReviewAssignments, sealedReviews, submissions, type SealedReview } from "@/db/schema";
import { type Db, db } from "@/db/client";
import { pubkeySchema } from "@/domain/wallet-auth";
import { RUBRIC_VERSION } from "@/domain/rubric";
import { parseSealedAssessment, type SealedAssessment } from "@/domain/sealed-review";
import { AppError, isUniqueViolation } from "@/lib/errors";
import { newId, sha256Hex } from "@/lib/ids";
import { canManageCampaign } from "./access";
import { rolesFor } from "./auth";
import { decide, type DecideInput } from "./review";
import type { DecisionLedger } from "@/ledger/decision-ledger";

const txHashSchema = z.string().regex(/^[0-9a-f]{64}$/i, "invalid transaction hash");
const roundIdSchema = z.string().regex(/^[1-9]\d*$/, "invalid round id");

export const prepareSealedReviewSchema = z.object({
  action: z.literal("prepare"),
  submissionId: z.string().min(1),
  reviewerPubkeys: z.tuple([pubkeySchema, pubkeySchema]),
  revealDelaySeconds: z.number().int().min(300).max(3600).default(600),
});

export const registerSealedReviewSchema = z.object({
  action: z.literal("register"),
  sealedReviewId: z.string().min(1),
  roundId: roundIdSchema,
  txHash: txHashSchema,
});

export const sealedReviewProgressSchema = z.object({
  action: z.enum(["commit", "reveal", "clear"]),
  sealedReviewId: z.string().min(1),
  txHash: txHashSchema,
});

export const finalizeSealedReviewSchema = z.object({
  action: z.literal("finalize"),
  sealedReviewId: z.string().min(1),
  selectedReviewer: pubkeySchema,
});

export const sealedReviewActionSchema = z.discriminatedUnion("action", [
  prepareSealedReviewSchema,
  registerSealedReviewSchema,
  sealedReviewProgressSchema,
  finalizeSealedReviewSchema,
]);

export interface ReceiptGateway {
  contractId: string;
  exportReceipt(roundId: string): Promise<CoreV2Receipt>;
}

export interface RoundPlanner {
  plan(revealDelaySeconds: number): Promise<{
    revealRound: number;
    commitDeadline: Date;
    revealDeadline: Date;
    auditorPubkey: string;
  }>;
}

export function liveRoundPlanner(): RoundPlanner {
  return {
    async plan(revealDelaySeconds) {
      const drand = quicknet();
      const [info, revealRound] = await Promise.all([chainInfo(drand), roundInSeconds(drand, revealDelaySeconds)]);
      const privacyAt = drandRoundTime(revealRound, info);
      return {
        revealRound,
        commitDeadline: new Date((privacyAt - 30) * 1000),
        revealDeadline: new Date((privacyAt + 600) * 1000),
        auditorPubkey: hex(generateAuditorKeypair().publicKey),
      };
    },
  };
}

export function liveReceiptGateway(): ReceiptGateway {
  const client = new SubRosaClient({ network: "testnet" });
  return { contractId: client.contractId, exportReceipt: (roundId) => client.exportReceiptV2(BigInt(roundId)) };
}

interface Actor {
  pubkey: string;
  roles?: ReadonlySet<"funder" | "reviewer" | "ops">;
}

interface RoundWithContext {
  round: SealedReview;
  campaign: typeof campaigns.$inferSelect;
  submission: typeof submissions.$inferSelect;
  reviewers: string[];
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function bindingJson(input: {
  campaignId: string;
  campaignSlug: string;
  submissionId: string;
  submissionShortId: string;
  reviewers: readonly string[];
}): string {
  return JSON.stringify({
    v: 1,
    app: "proofwork",
    campaignId: input.campaignId,
    campaignSlug: input.campaignSlug,
    submissionId: input.submissionId,
    submissionShortId: input.submissionShortId,
    rubric: RUBRIC_VERSION,
    reviewers: [...input.reviewers].sort(),
  });
}

async function context(id: string, conn: Db): Promise<RoundWithContext> {
  const found = (
    await conn
      .select({ round: sealedReviews, campaign: campaigns, submission: submissions })
      .from(sealedReviews)
      .innerJoin(campaigns, eq(campaigns.id, sealedReviews.campaignId))
      .innerJoin(submissions, eq(submissions.id, sealedReviews.submissionId))
      .where(eq(sealedReviews.id, id))
      .limit(1)
  )[0];
  if (!found) throw AppError.notFound("sealed review");
  const assignments = await conn
    .select({ reviewer: sealedReviewAssignments.reviewerPubkey })
    .from(sealedReviewAssignments)
    .where(eq(sealedReviewAssignments.sealedReviewId, id));
  return { ...found, reviewers: assignments.map((a) => a.reviewer) };
}

async function isManager(value: RoundWithContext, actor: Actor, conn: Db): Promise<boolean> {
  const roles = actor.roles ?? (await rolesFor(actor.pubkey, value.campaign.id, conn));
  return roles.has("ops") || canManageCampaign(value.campaign, { pubkey: actor.pubkey, roles });
}

async function requireManager(value: RoundWithContext, actor: Actor, conn: Db): Promise<void> {
  if (!(await isManager(value, actor, conn))) throw AppError.forbidden("sealed review is managed by campaign funder or ops");
}

async function assertTransactionHashUnused(txHash: string, conn: Db): Promise<void> {
  const [round, assignment] = await Promise.all([
    conn
      .select({ id: sealedReviews.id })
      .from(sealedReviews)
      .where(or(eq(sealedReviews.createTxHash, txHash), eq(sealedReviews.clearTxHash, txHash)))
      .limit(1),
    conn
      .select({ id: sealedReviewAssignments.id })
      .from(sealedReviewAssignments)
      .where(or(eq(sealedReviewAssignments.commitTxHash, txHash), eq(sealedReviewAssignments.revealTxHash, txHash)))
      .limit(1),
  ]);
  if (round.length > 0 || assignment.length > 0) throw AppError.conflict("transaction hash was already used by a sealed review action");
}

function assertReceiptBinding(value: RoundWithContext, receipt: CoreV2Receipt, expectedContractId: string): void {
  const result = verifyReceiptV2(receipt);
  if (!result.valid) throw AppError.conflict("Sub Rosa receipt verification failed");
  if (receipt.contractId !== expectedContractId || receipt.network !== "Test SDF Network ; September 2015") {
    throw AppError.conflict("Sub Rosa network or contract mismatch");
  }
  if (receipt.roundId !== value.round.roundId || receipt.itemRef.toLowerCase() !== value.round.itemRef || receipt.schemaRef.toLowerCase() !== value.round.schemaRef) {
    throw AppError.conflict("submission and round binding mismatch");
  }
  if (receipt.mode !== "ReceiptOnly" || receipt.paymentAsset !== null || receipt.lotAsset !== null || receipt.lotAmount !== "0") {
    throw AppError.conflict("round is not zero-escrow ReceiptOnly mode");
  }
  if (!receipt.policy.enforced || receipt.policy.fixedEscrow !== "0" || receipt.policy.participation !== "Allowlist") {
    throw AppError.conflict("round does not enforce the sealed-review policy");
  }
  if (!sameMembers(receipt.policy.eligibleParticipants, value.reviewers) || receipt.maxParticipants !== 2) {
    throw AppError.conflict("round reviewer allowlist mismatch");
  }
  if (receipt.operator !== value.round.operatorPubkey || receipt.revealRound !== value.round.revealRound) {
    throw AppError.conflict("round operator or reveal boundary mismatch");
  }
  if (receipt.commitDeadline !== String(Math.floor(value.round.commitDeadline.getTime() / 1000)) || receipt.revealDeadline !== String(Math.floor(value.round.revealDeadline.getTime() / 1000))) {
    throw AppError.conflict("round deadline mismatch");
  }
}

export async function prepareSealedReview(
  input: z.infer<typeof prepareSealedReviewSchema>,
  actor: Actor,
  conn: Db = db,
  now = new Date(),
  planner: RoundPlanner = liveRoundPlanner(),
): Promise<SealedReview> {
  const [first, second] = input.reviewerPubkeys;
  if (first === second) throw AppError.validation("two distinct reviewer wallets are required");
  const found = (
    await conn
      .select({ submission: submissions, campaign: campaigns })
      .from(submissions)
      .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
      .where(eq(submissions.id, input.submissionId))
      .limit(1)
  )[0];
  if (!found) throw AppError.notFound("submission");
  if (found.campaign.closedAt) throw AppError.conflict("campaign is closed");
  if (found.submission.status !== "pending") throw AppError.conflict("only a pending submission can enter sealed dual review");
  const actorRoles = actor.roles ?? (await rolesFor(actor.pubkey, found.campaign.id, conn));
  if (!actorRoles.has("ops") && !canManageCampaign(found.campaign, { pubkey: actor.pubkey, roles: actorRoles })) {
    throw AppError.forbidden("sealed review is managed by campaign funder or ops");
  }
  for (const reviewer of [first, second]) {
    if (!(await rolesFor(reviewer, found.campaign.id, conn)).has("reviewer")) {
      throw AppError.validation("both assigned wallets must have reviewer access");
    }
  }

  const { revealRound, commitDeadline, revealDeadline, auditorPubkey } = await planner.plan(input.revealDelaySeconds);
  if (commitDeadline <= now) throw AppError.conflict("reveal boundary leaves no commit window");
  const itemRef = sha256Hex(
    bindingJson({
      campaignId: found.campaign.id,
      campaignSlug: found.campaign.slug,
      submissionId: found.submission.id,
      submissionShortId: found.submission.shortId,
      reviewers: [first, second],
    }),
  );
  const id = newId("sdr");
  try {
    return await conn.transaction(async (tx) => {
      const [round] = await tx
        .insert(sealedReviews)
        .values({
          id,
          submissionId: found.submission.id,
          campaignId: found.campaign.id,
          itemRef,
          schemaRef: hex(SEALED_PROPOSAL_SCHEMA_REF),
          revealRound,
          commitDeadline,
          revealDeadline,
          auditorPubkey,
          operatorPubkey: actor.pubkey,
          createdBy: actor.pubkey,
        })
        .returning();
      await tx.insert(sealedReviewAssignments).values([
        { id: newId("sra"), sealedReviewId: id, reviewerPubkey: first },
        { id: newId("sra"), sealedReviewId: id, reviewerPubkey: second },
      ]);
      return round as SealedReview;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw AppError.conflict("submission already has a sealed review");
    throw error;
  }
}

export async function registerSealedReview(
  input: z.infer<typeof registerSealedReviewSchema>,
  actor: Actor,
  gateway: ReceiptGateway = liveReceiptGateway(),
  conn: Db = db,
): Promise<void> {
  const value = await context(input.sealedReviewId, conn);
  await requireManager(value, actor, conn);
  await assertTransactionHashUnused(input.txHash, conn);
  if (value.round.status !== "draft" || value.round.roundId !== null) throw AppError.conflict("sealed review round is already registered");
  const candidate = { ...value, round: { ...value.round, roundId: input.roundId } };
  const receipt = await gateway.exportReceipt(input.roundId);
  assertReceiptBinding(candidate, receipt, gateway.contractId);
  if (receipt.status !== "Open" || receipt.bidders.length !== 0) throw AppError.conflict("new round is not empty and open");
  const changed = await conn
    .update(sealedReviews)
    .set({ status: "open", contractId: gateway.contractId, roundId: input.roundId, createTxHash: input.txHash, updatedAt: new Date() })
    .where(and(eq(sealedReviews.id, input.sealedReviewId), eq(sealedReviews.status, "draft"), isNull(sealedReviews.roundId)))
    .returning({ id: sealedReviews.id });
  if (changed.length !== 1) throw AppError.conflict("sealed review changed concurrently");
}

async function receiptFor(value: RoundWithContext, gateway: ReceiptGateway): Promise<CoreV2Receipt> {
  if (!value.round.roundId || !value.round.contractId) throw AppError.conflict("Sub Rosa round is not registered");
  const receipt = await gateway.exportReceipt(value.round.roundId);
  assertReceiptBinding(value, receipt, gateway.contractId);
  return receipt;
}

async function requireAssigned(value: RoundWithContext, actor: Actor, conn: Db): Promise<void> {
  if (!value.reviewers.includes(actor.pubkey)) throw AppError.forbidden("wallet is not assigned to this sealed review");
  if (!(await rolesFor(actor.pubkey, value.campaign.id, conn)).has("reviewer")) throw AppError.forbidden("assigned wallet no longer has reviewer access");
}

async function maybeExpired(value: RoundWithContext, conn: Db, now = new Date()): Promise<RoundWithContext> {
  if ((value.round.status !== "open" && value.round.status !== "revealing") || value.round.revealDeadline > now) return value;
  const revealed = await conn
    .select({ id: sealedReviewAssignments.id })
    .from(sealedReviewAssignments)
    .where(and(eq(sealedReviewAssignments.sealedReviewId, value.round.id), isNotNull(sealedReviewAssignments.revealTxHash)))
    .limit(2);
  // A fully revealed round is supposed to be cleared only after this deadline.
  if (revealed.length === 2) return value;
  await conn
    .update(sealedReviews)
    .set({ status: "expired", failureCode: "REVEAL_DEADLINE_PASSED", updatedAt: now })
    .where(and(eq(sealedReviews.id, value.round.id), inArray(sealedReviews.status, ["open", "revealing"]), eq(sealedReviews.receiptVerified, false)));
  return { ...value, round: { ...value.round, status: "expired", failureCode: "REVEAL_DEADLINE_PASSED", updatedAt: now } };
}

export async function recordSealedCommit(
  input: z.infer<typeof sealedReviewProgressSchema>,
  actor: Actor,
  gateway: ReceiptGateway = liveReceiptGateway(),
  conn: Db = db,
): Promise<void> {
  const value = await maybeExpired(await context(input.sealedReviewId, conn), conn);
  await requireAssigned(value, actor, conn);
  await assertTransactionHashUnused(input.txHash, conn);
  if (value.round.status !== "open") throw AppError.conflict("round is not accepting sealed reviews");
  if (new Date() > value.round.commitDeadline) throw AppError.conflict("commit deadline has passed");
  const receipt = await receiptFor(value, gateway);
  const submission = receipt.submissions[actor.pubkey];
  if (!receipt.bidders.includes(actor.pubkey) || !submission || !/^[0-9a-f]{64}$/i.test(submission.commitment)) {
    throw AppError.conflict("wallet has no canonical commit in this round");
  }
  const changed = await conn
    .update(sealedReviewAssignments)
    .set({ commitment: submission.commitment.toLowerCase(), commitTxHash: input.txHash, committedAt: new Date() })
    .where(and(eq(sealedReviewAssignments.sealedReviewId, value.round.id), eq(sealedReviewAssignments.reviewerPubkey, actor.pubkey), isNull(sealedReviewAssignments.commitTxHash)))
    .returning({ id: sealedReviewAssignments.id });
  if (changed.length !== 1) throw AppError.conflict("reviewer already committed a sealed assessment");
}

export async function recordSealedReveal(
  input: z.infer<typeof sealedReviewProgressSchema>,
  actor: Actor,
  gateway: ReceiptGateway = liveReceiptGateway(),
  conn: Db = db,
): Promise<void> {
  const value = await maybeExpired(await context(input.sealedReviewId, conn), conn);
  await requireAssigned(value, actor, conn);
  await assertTransactionHashUnused(input.txHash, conn);
  if (value.round.status !== "open" && value.round.status !== "revealing") throw AppError.conflict("round is not revealing");
  const receipt = await receiptFor(value, gateway);
  const submission = receipt.submissions[actor.pubkey];
  if (!submission?.valid || submission.revealedEnvelope === null) throw AppError.conflict("wallet has no valid reveal in this round");
  const pinned = (
    await conn
      .select({ commitment: sealedReviewAssignments.commitment })
      .from(sealedReviewAssignments)
      .where(and(eq(sealedReviewAssignments.sealedReviewId, value.round.id), eq(sealedReviewAssignments.reviewerPubkey, actor.pubkey)))
      .limit(1)
  )[0]?.commitment;
  if (!pinned || pinned !== submission.commitment.toLowerCase()) throw AppError.conflict("revealed commitment differs from the first recorded commit");
  await conn.transaction(async (tx) => {
    const changed = await tx
      .update(sealedReviewAssignments)
      .set({ revealTxHash: input.txHash, revealedAt: new Date() })
      .where(and(eq(sealedReviewAssignments.sealedReviewId, value.round.id), eq(sealedReviewAssignments.reviewerPubkey, actor.pubkey), isNull(sealedReviewAssignments.revealTxHash)))
      .returning({ id: sealedReviewAssignments.id });
    if (changed.length !== 1) throw AppError.conflict("reviewer already revealed an assessment");
    await tx.update(sealedReviews).set({ status: "revealing", updatedAt: new Date() }).where(eq(sealedReviews.id, value.round.id));
  });
}

function decodedAssessments(value: RoundWithContext, receipt: CoreV2Receipt): Map<string, SealedAssessment> {
  const out = new Map<string, SealedAssessment>();
  for (const reviewer of value.reviewers) {
    const envelopeHex = receipt.submissions[reviewer]?.revealedEnvelope;
    if (!envelopeHex) throw AppError.conflict("both reviewers must reveal valid assessments");
    let assessment: SealedAssessment;
    try {
      const envelope = decodePayloadEnvelope(Buffer.from(envelopeHex, "hex"));
      const proposal = decodeSealedProposal(envelope.payload);
      assessment = parseSealedAssessment(proposal.approach);
    } catch {
      throw AppError.conflict("revealed assessment is not canonical Proofwork rubric data");
    }
    if (
      assessment.roundId !== value.round.roundId ||
      assessment.campaignId !== value.campaign.id ||
      assessment.submissionId !== value.submission.id ||
      assessment.rubric !== RUBRIC_VERSION ||
      assessment.reviewer !== reviewer
    ) {
      throw AppError.conflict("revealed assessment binding mismatch");
    }
    out.set(reviewer, assessment);
  }
  return out;
}

export async function recordSealedClear(
  input: z.infer<typeof sealedReviewProgressSchema>,
  actor: Actor,
  gateway: ReceiptGateway = liveReceiptGateway(),
  conn: Db = db,
): Promise<{ receiptSha256: string }> {
  const value = await context(input.sealedReviewId, conn);
  const assigned = value.reviewers.includes(actor.pubkey) && (await rolesFor(actor.pubkey, value.campaign.id, conn)).has("reviewer");
  if (!(assigned || (await isManager(value, actor, conn)))) throw AppError.forbidden();
  await assertTransactionHashUnused(input.txHash, conn);
  if (value.round.status !== "revealing" && value.round.status !== "open") throw AppError.conflict("round cannot be cleared from its current state");
  const receipt = await receiptFor(value, gateway);
  if (receipt.status !== "Settled") throw AppError.conflict("Sub Rosa ReceiptOnly round is not finalized");
  if (!sameMembers(receipt.bidders, value.reviewers)) throw AppError.conflict("both assigned reviewers must commit");
  const pinned = await conn.select().from(sealedReviewAssignments).where(eq(sealedReviewAssignments.sealedReviewId, value.round.id));
  for (const assignment of pinned) {
    const finalCommitment = receipt.submissions[assignment.reviewerPubkey]?.commitment.toLowerCase();
    if (!assignment.commitTxHash || !assignment.revealTxHash || !assignment.commitment || assignment.commitment !== finalCommitment) {
      throw AppError.conflict("receipt does not match both first recorded reviewer commitments");
    }
  }
  const assessments = decodedAssessments(value, receipt);
  const canonical = serializeReceiptV2(receipt);
  const receiptSha256 = sha256Hex(canonical);
  await conn.transaction(async (tx) => {
    for (const [reviewer, assessment] of assessments) {
      await tx
        .update(sealedReviewAssignments)
        .set({ revealedReview: assessment })
        .where(and(eq(sealedReviewAssignments.sealedReviewId, value.round.id), eq(sealedReviewAssignments.reviewerPubkey, reviewer)));
    }
    const changed = await tx
      .update(sealedReviews)
      .set({ status: "cleared", clearTxHash: input.txHash, receiptJson: canonical, receiptSha256, receiptVerified: true, updatedAt: new Date() })
      .where(and(eq(sealedReviews.id, value.round.id), inArray(sealedReviews.status, ["open", "revealing"]), eq(sealedReviews.receiptVerified, false)))
      .returning({ id: sealedReviews.id });
    if (changed.length !== 1) throw AppError.conflict("sealed review was already cleared or changed concurrently");
  });
  return { receiptSha256 };
}

export async function finalizeSealedReview(
  input: z.infer<typeof finalizeSealedReviewSchema>,
  actor: Actor,
  ledger: DecisionLedger,
  conn: Db = db,
): Promise<{ decisionId: string; txHash: string | null }> {
  const value = await context(input.sealedReviewId, conn);
  const roles = actor.roles ?? (await rolesFor(actor.pubkey, value.campaign.id, conn));
  if (!roles.has("reviewer")) throw AppError.forbidden("final decision requires reviewer role");
  if (!value.reviewers.includes(input.selectedReviewer)) throw AppError.validation("selected review is not assigned to this round");
  if (value.round.status !== "cleared" || !value.round.receiptVerified || !value.round.receiptSha256) {
    throw AppError.conflict("both reviews and the canonical receipt must be verified first");
  }
  const assignment = (
    await conn
      .select()
      .from(sealedReviewAssignments)
      .where(and(eq(sealedReviewAssignments.sealedReviewId, value.round.id), eq(sealedReviewAssignments.reviewerPubkey, input.selectedReviewer)))
      .limit(1)
  )[0];
  if (!assignment?.revealedReview) throw AppError.conflict("selected review has not been verified");
  const assessment = parseSealedAssessment(JSON.stringify(assignment.revealedReview));
  const claimed = await conn
    .update(sealedReviews)
    .set({ status: "finalizing", updatedAt: new Date() })
    .where(and(eq(sealedReviews.id, value.round.id), eq(sealedReviews.status, "cleared"), eq(sealedReviews.receiptVerified, true)))
    .returning({ id: sealedReviews.id });
  if (claimed.length !== 1) throw AppError.conflict("final decision is already in progress or recorded");
  try {
    const decisionInput: DecideInput = {
      submissionId: value.submission.id,
      signals: assessment.signals,
      reasonCode: assessment.reasonCode,
      note: assessment.note,
      secondsTotal: 0,
      secondsPerSignal: {},
      sharedFundingCount: null,
    };
    const decision = await decide(decisionInput, actor, ledger, conn);
    await conn
      .update(sealedReviews)
      .set({ status: "finalized", finalDecisionId: decision.id, updatedAt: new Date() })
      .where(and(eq(sealedReviews.id, value.round.id), eq(sealedReviews.status, "finalizing")));
    return { decisionId: decision.id, txHash: decision.txHash };
  } catch (error) {
    await conn.update(sealedReviews).set({ status: "cleared", updatedAt: new Date() }).where(and(eq(sealedReviews.id, value.round.id), eq(sealedReviews.status, "finalizing")));
    throw error;
  }
}

export async function sealedReviewView(id: string, actor: Actor, conn: Db = db) {
  const value = await maybeExpired(await context(id, conn), conn);
  const manager = await isManager(value, actor, conn);
  const assigned = value.reviewers.includes(actor.pubkey) && (await rolesFor(actor.pubkey, value.campaign.id, conn)).has("reviewer");
  if (!manager && !assigned) throw AppError.forbidden("sealed review is private to its managers and assigned reviewers");
  const assignments = await conn
    .select()
    .from(sealedReviewAssignments)
    .where(eq(sealedReviewAssignments.sealedReviewId, id));
  const revealed = value.round.receiptVerified
    ? assignments.map((a) => ({ reviewerPubkey: a.reviewerPubkey, review: a.revealedReview }))
    : [];
  return {
    round: value.round,
    campaign: { id: value.campaign.id, slug: value.campaign.slug, title: value.campaign.title, brief: value.campaign.brief },
    submission: { id: value.submission.id, shortId: value.submission.shortId, workUrl: value.submission.workUrl },
    reviewers: value.reviewers,
    assignments: assignments.map((a) => ({
      reviewerPubkey: a.reviewerPubkey,
      commitment: a.commitment,
      commitTxHash: a.commitTxHash,
      revealTxHash: a.revealTxHash,
      committedAt: a.committedAt,
      revealedAt: a.revealedAt,
    })),
    revealed,
    manager,
    assigned,
  };
}

export async function sealedReviewList(actor: Actor, conn: Db = db) {
  const roles = actor.roles ?? (await rolesFor(actor.pubkey, null, conn));
  const assignedRows = await conn
    .select({ round: sealedReviews, assignment: sealedReviewAssignments, submission: submissions, campaign: campaigns })
    .from(sealedReviewAssignments)
    .innerJoin(sealedReviews, eq(sealedReviews.id, sealedReviewAssignments.sealedReviewId))
    .innerJoin(submissions, eq(submissions.id, sealedReviews.submissionId))
    .innerJoin(campaigns, eq(campaigns.id, sealedReviews.campaignId))
    .where(eq(sealedReviewAssignments.reviewerPubkey, actor.pubkey));
  const assigned = (
    await Promise.all(assignedRows.map(async (item) => ((await rolesFor(actor.pubkey, item.campaign.id, conn)).has("reviewer") ? item : null)))
  ).filter((item): item is (typeof assignedRows)[number] => item !== null);
  const managed = roles.has("ops")
    ? await conn.select({ round: sealedReviews, submission: submissions, campaign: campaigns }).from(sealedReviews).innerJoin(submissions, eq(submissions.id, sealedReviews.submissionId)).innerJoin(campaigns, eq(campaigns.id, sealedReviews.campaignId))
    : await conn
        .select({ round: sealedReviews, submission: submissions, campaign: campaigns })
        .from(sealedReviews)
        .innerJoin(submissions, eq(submissions.id, sealedReviews.submissionId))
        .innerJoin(campaigns, eq(campaigns.id, sealedReviews.campaignId))
        .where(eq(campaigns.funderPubkey, actor.pubkey));
  return { assigned, managed };
}

export async function sealedReviewCandidates(actor: Actor, conn: Db = db) {
  const roles = actor.roles ?? (await rolesFor(actor.pubkey, null, conn));
  if (!roles.has("ops") && !roles.has("funder")) return [];
  return conn
    .select({
      submissionId: submissions.id,
      shortId: submissions.shortId,
      campaignId: campaigns.id,
      campaignTitle: campaigns.title,
    })
    .from(submissions)
    .innerJoin(campaigns, eq(campaigns.id, submissions.campaignId))
    .where(
      and(
        eq(submissions.status, "pending"),
        isNull(campaigns.closedAt),
        roles.has("ops") ? undefined : eq(campaigns.funderPubkey, actor.pubkey),
        notExists(conn.select({ id: sealedReviews.id }).from(sealedReviews).where(eq(sealedReviews.submissionId, submissions.id))),
      ),
    );
}

export const _test = { bindingJson, assertReceiptBinding, decodedAssessments };
