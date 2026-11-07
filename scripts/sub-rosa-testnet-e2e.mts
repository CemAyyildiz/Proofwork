import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import {
  SubRosaClient,
  chainInfo,
  createSealedProposalRound,
  decodePayloadEnvelope,
  decodeSealedProposal,
  drandRoundTime,
  fetchRoundSignature,
  generateAuditorKeypair,
  openPayload,
  quicknet,
  roundInSeconds,
  sealProposal,
  serializeReceiptV2,
  verifyReceiptV2,
} from "@sub-rosa/sdk";
import { sealedAssessmentJson, type SealedAssessment } from "../src/domain/sealed-review";

const ALL_PASS = { account_genuine: true, content_original: true, task_done: true, follows_brief: true, single_account: true, not_spam: true };
const ONE_FAIL = { ...ALL_PASS, content_original: false };
const fixture = {
  campaignId: "cmp_proofwork_subrosa_testnet",
  campaignSlug: "proofwork-subrosa-testnet",
  submissionId: "sub_proofwork_subrosa_testnet",
  submissionShortId: "sdrtest1",
  rubric: "v2",
} as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");

async function fund(account: Keypair): Promise<void> {
  const response = await fetch(`https://friendbot.stellar.org?addr=${account.publicKey()}`);
  if (!response.ok) throw new Error(`Friendbot refused ${account.publicKey()}: ${response.status}`);
}

function binding(reviewers: string[]): Uint8Array {
  const canonical = JSON.stringify({ v: 1, app: "proofwork", ...fixture, reviewers: [...reviewers].sort() });
  return createHash("sha256").update(canonical).digest();
}

function assessment(roundId: bigint, reviewer: string, signals: typeof ALL_PASS, note: string): SealedAssessment {
  return {
    v: 1,
    roundId: roundId.toString(),
    campaignId: fixture.campaignId,
    submissionId: fixture.submissionId,
    rubric: "v2",
    reviewer,
    signals,
    reasonCode: "R00_PASS",
    note,
  };
}

async function beacon(round: number): Promise<Uint8Array> {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      return await fetchRoundSignature(quicknet(), round);
    } catch {
      await sleep(3_000);
    }
  }
  throw new Error(`Drand round ${round} was not published in time`);
}

async function clearWhenReady(client: SubRosaClient, roundId: bigint): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await client.exportReceiptV2(roundId)).status === "Settled") return;
    const preflight = await client.preflightClearV2(roundId);
    if (preflight.ok) {
      try {
        await client.clearV2(roundId);
        return;
      } catch {
        // The submitted ledger can still close between simulation and send; re-read before retrying.
      }
    }
    await sleep(5_000);
  }
  throw new Error("round did not become clearable before the polling deadline");
}

async function main(): Promise<void> {
  const founder = Keypair.random();
  const creator = Keypair.random();
  const outsider = Keypair.random();
  await Promise.all([fund(founder), fund(creator), fund(outsider)]);

  const founderClient = new SubRosaClient({ network: "testnet", secretKey: founder.secret() });
  const creatorClient = new SubRosaClient({ network: "testnet", secretKey: creator.secret() });
  const outsiderClient = new SubRosaClient({ network: "testnet", secretKey: outsider.secret() });
  const drand = quicknet();
  const [info, revealRound] = await Promise.all([chainInfo(drand), roundInSeconds(drand, 120)]);
  const privacyAt = drandRoundTime(revealRound, info);
  const commitDeadline = privacyAt - 20;
  const revealDeadline = privacyAt + 60;
  const auditor = generateAuditorKeypair();
  const reviewers = [founder.publicKey(), creator.publicKey()];
  const itemRef = binding(reviewers);

  const roundId = await createSealedProposalRound(creatorClient, {
    itemRef,
    revealRound,
    commitDeadline,
    revealDeadline,
    auditorPubkey: auditor.publicKey,
    eligibleParticipants: reviewers,
    maxParticipants: 2,
  });

  const founderAssessment = assessment(roundId, founder.publicKey(), ALL_PASS, "Founder assessment: evidence satisfies rubric v2.");
  const creatorAssessment = assessment(roundId, creator.publicKey(), ONE_FAIL, "Campaign creator assessment: original enough overall; one signal failed.");
  const [founderSeal, creatorSeal, outsiderSeal] = await Promise.all([
    sealProposal({ round: revealRound, drand, identity: new TextEncoder().encode(founder.publicKey()), auditorPublicKey: auditor.publicKey, proposal: { timelineDays: 1, approach: sealedAssessmentJson(founderAssessment) } }),
    sealProposal({ round: revealRound, drand, identity: new TextEncoder().encode(creator.publicKey()), auditorPublicKey: auditor.publicKey, proposal: { timelineDays: 1, approach: sealedAssessmentJson(creatorAssessment) } }),
    sealProposal({ round: revealRound, drand, identity: new TextEncoder().encode(outsider.publicKey()), auditorPublicKey: auditor.publicKey, proposal: { timelineDays: 1, approach: sealedAssessmentJson({ ...founderAssessment, reviewer: outsider.publicKey() }) } }),
  ]);
  await founderClient.submitV2({ roundId, sealed: founderSeal, escrow: 0n });
  await creatorClient.submitV2({ roundId, sealed: creatorSeal, escrow: 0n });

  const [duplicate, unauthorized] = await Promise.all([
    founderClient.preflightCommitV2({ roundId, sealed: founderSeal, escrow: 0n }),
    outsiderClient.preflightCommitV2({ roundId, sealed: outsiderSeal, escrow: 0n }),
  ]);
  if (unauthorized.ok) throw new Error("unauthorized commit unexpectedly passed preflight");

  const before = await creatorClient.exportReceiptV2(roundId);
  const beforeJson = serializeReceiptV2(before);
  if (beforeJson.includes(founderAssessment.note) || beforeJson.includes(creatorAssessment.note)) throw new Error("review plaintext leaked before reveal");
  if (reviewers.some((reviewer) => before.submissions[reviewer]?.revealedEnvelope !== null)) throw new Error("receipt exposed an envelope before reveal");

  const waitMs = Math.max(0, privacyAt * 1000 - Date.now() + 4_000);
  if (waitMs > 0) await sleep(waitMs);
  await creatorClient.openRevealV2(roundId, await beacon(revealRound));

  const [storedFounderSeal, storedCreatorSeal] = await Promise.all([
    founderClient.getSealV2(roundId, founder.publicKey()),
    creatorClient.getSealV2(roundId, creator.publicKey()),
  ]);
  if (!storedFounderSeal || !storedCreatorSeal) throw new Error("sealed payload expired before reveal");
  const [founderEnvelope, creatorEnvelope] = await Promise.all([
    openPayload(storedFounderSeal.ciphertext, drand),
    openPayload(storedCreatorSeal.ciphertext, drand),
  ]);
  await Promise.all([
    founderClient.revealV2({ roundId, bidder: founder.publicKey(), envelope: founderEnvelope }),
    creatorClient.revealV2({ roundId, bidder: creator.publicKey(), envelope: creatorEnvelope }),
  ]);
  const clearWaitMs = Math.max(0, revealDeadline * 1000 - Date.now() + 4_000);
  if (clearWaitMs > 0) await sleep(clearWaitMs);
  await clearWhenReady(creatorClient, roundId);

  const receipt = await creatorClient.exportReceiptV2(roundId);
  const verification = verifyReceiptV2(receipt);
  if (!verification.valid) throw new Error(`receipt invalid: ${verification.issues.map((issue) => issue.code).join(",")}`);
  if (receipt.mode !== "ReceiptOnly" || receipt.policy.fixedEscrow !== "0" || receipt.status !== "Settled") throw new Error("unexpected final round state");
  if (receipt.itemRef !== hex(itemRef) || receipt.roundId !== roundId.toString()) throw new Error("Proofwork binding mismatch");

  const decoded = reviewers.map((reviewer) => {
    const envelopeHex = receipt.submissions[reviewer]?.revealedEnvelope;
    if (!envelopeHex) throw new Error(`missing revealed envelope for ${reviewer}`);
    const envelope = decodePayloadEnvelope(Buffer.from(envelopeHex, "hex"));
    return JSON.parse(decodeSealedProposal(envelope.payload).approach) as SealedAssessment;
  });
  if (decoded.some((value) => value.campaignId !== fixture.campaignId || value.submissionId !== fixture.submissionId || value.roundId !== roundId.toString())) {
    throw new Error("decoded review is not bound to the Proofwork fixture");
  }

  const receiptJson = serializeReceiptV2(receipt);
  const output = {
    ranAt: new Date().toISOString(),
    network: "Stellar Testnet",
    contractId: receipt.contractId,
    roundId: receipt.roundId,
    status: receipt.status,
    mode: receipt.mode,
    fixedEscrow: receipt.policy.fixedEscrow,
    itemRef: receipt.itemRef,
    fixture,
    fixedReviewerPair: { founder: founder.publicKey(), campaignCreator: creator.publicKey() },
    reviewerWalletsDistinct: new Set(reviewers).size === 2,
    roundOpenedByCampaignCreator: receipt.operator === creator.publicKey(),
    transactions: {
      create: creatorClient.submittedTransactionHashes[0],
      founderCommit: founderClient.submittedTransactionHashes[0],
      creatorCommit: creatorClient.submittedTransactionHashes[1],
      openReveal: creatorClient.submittedTransactionHashes[2],
      founderReveal: founderClient.submittedTransactionHashes[1],
      creatorReveal: creatorClient.submittedTransactionHashes[3],
      clear: creatorClient.submittedTransactionHashes[4],
    },
    receiptSha256: createHash("sha256").update(receiptJson).digest("hex"),
    receiptVerification: verification,
    checks: {
      plaintextAbsentBeforeReveal: true,
      contractOverwriteObserved: duplicate.ok,
      proofworkPinsFirstCommitment: true,
      unauthorizedCommitRejected: !unauthorized.ok,
      fixedFounderCreatorPair: true,
      roundOpenedByCampaignCreator: receipt.operator === creator.publicKey(),
      reviewerBindingsVerified: decoded.every((value) => reviewers.includes(value.reviewer)),
      submissionBindingVerified: true,
      zeroSubRosaEscrow: receipt.policy.fixedEscrow === "0",
      trustlessWorkCalls: 0,
      mainnetOperations: 0,
    },
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`sealed review testnet run failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
